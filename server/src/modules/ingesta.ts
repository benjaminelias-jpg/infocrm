import { createHmac, timingSafeEqual } from 'node:crypto';
import { pool, query, queryOne } from '../db/pool.js';
import { primerValor, aNumero, aFecha, limpiarUsername } from '../lib/utils.js';
import { registrarEvento, type IdentidadLead } from './eventos.js';
import type { SenalesAtribucion } from './atribucion.js';

/**
 * Códigos de error de lo que llega, para que la pantalla lo explique según
 * la app ("En ManyChat, revisá que el Body tenga {{ig_username}}") en vez de
 * mostrar el detalle técnico.
 */
export type CodigoErrorIngesta = 'sin_identidad' | 'firma_invalida' | 'error_interno';

class ErrorIngesta extends Error {
  codigo: CodigoErrorIngesta;
  constructor(codigo: CodigoErrorIngesta, mensaje: string) { super(mensaje); this.codigo = codigo; }
}

export const MENSAJE_SIN_IDENTIDAD =
  'No se puede identificar a la persona: llegó sin id de ManyChat, sin @ de Instagram y sin email. ' +
  'Sumá al menos uno de esos datos en lo que manda la otra app.';

/**
 * Rutas candidatas por campo. Se prueban en orden y gana la primera que
 * traiga valor, así un mismo endpoint traga payloads de ManyChat, Make,
 * Zapier, Calendly, Stripe o un curl a mano sin configurar nada.
 */
const MAPEO_BASE: Record<string, string[]> = {
  manychat_subscriber_id: ['subscriber_id', 'contact_id', 'manychat_id', 'subscriber.id', 'contact.id'],
  ig_user_id: ['ig_id', 'instagram_id', 'ig_user_id', 'subscriber.ig_id', 'instagram.user_id'],
  ig_username: ['ig_username', 'instagram_username', 'username', 'user_name', 'subscriber.ig_username', 'instagram.username'],
  nombre: ['first_name', 'nombre', 'name', 'full_name', 'subscriber.first_name', 'invitee.name', 'payload.invitee.name'],
  apellido: ['last_name', 'apellido', 'subscriber.last_name'],
  email: ['email', 'correo', 'invitee.email', 'payload.invitee.email', 'customer_email', 'subscriber.email', 'buyer.email', 'data.object.customer_email'],
  telefono: ['phone', 'telefono', 'whatsapp', 'subscriber.phone'],
  pais: ['country', 'pais', 'country_code', 'subscriber.country'],
  zona_horaria: ['timezone', 'zona_horaria', 'subscriber.timezone', 'payload.invitee.timezone'],
  idioma: ['language', 'locale', 'idioma', 'subscriber.language'],
  avatar_url: ['profile_pic', 'avatar', 'profile_pic_url', 'subscriber.profile_pic'],

  // Datos de calificación (el flujo de DM de ManyChat los deja en custom_fields)
  modelo_negocio: ['modelo_negocio', 'business', 'business_model', 'custom_fields.modelo_negocio', 'custom_fields.negocio'],
  ingresos_aprox: ['ingresos', 'ingresos_aprox', 'revenue', 'facturacion', 'custom_fields.ingresos', 'custom_fields.facturacion'],
  cuello_botella: ['cuello_botella', 'bottleneck', 'problema_principal', 'custom_fields.cuello_botella', 'custom_fields.problema'],

  // Señales de atribución de contenido
  ig_media_id: ['ig_media_id', 'media_id', 'post_id', 'instagram_media_id', 'custom_fields.ig_media_id', 'data.media_id'],
  permalink: ['permalink', 'post_url', 'media_url', 'custom_fields.permalink'],
  palabra_clave: ['palabra_clave', 'keyword', 'trigger_word', 'custom_fields.palabra_clave', 'custom_fields.keyword', 'last_input_text'],
  automatizacion_id: ['automatizacion_id', 'automation_id'],
  manychat_flow_id: ['flow_id', 'flow_ns', 'manychat_flow_id', 'custom_fields.flow_id'],
  campania: ['campania', 'campaign', 'utm_campaign', 'ref', 'custom_fields.campania'],
  contenido_id: ['contenido_id', 'content_id'],

  // Evento
  evento: ['evento', 'event', 'event_type', 'tipo', 'type'],
  valor: ['valor', 'amount', 'price', 'value', 'total', 'purchase.price', 'data.object.amount_total'],
  moneda: ['moneda', 'currency', 'data.object.currency'],
  titulo: ['titulo', 'producto', 'product', 'product_name', 'item_name', 'data.object.description'],
  ocurrido_en: ['ocurrido_en', 'timestamp', 'occurred_at', 'event_time', 'scheduled_at', 'start_time', 'payload.event.start_time', 'created_at'],
  idempotency_key: ['idempotency_key', 'event_id', 'transaction_id'],
};

/** Diferencias por fuente respecto al mapeo base. */
const MAPEO_POR_FUENTE: Record<string, Record<string, string[]>> = {
  // En ManyChat el campo "id" del payload es el id del suscriptor
  manychat: {
    manychat_subscriber_id: ['id', ...MAPEO_BASE.manychat_subscriber_id],
  },
  // Agenda: Calendly (v1 y v2) y Cal.com ({ triggerEvent, payload: { attendees: [...] } }).
  calendly: {
    evento: ['triggerEvent', ...MAPEO_BASE.evento],
    idempotency_key: ['payload.uri', 'uri', 'payload.uid', ...MAPEO_BASE.idempotency_key],
    ocurrido_en: ['payload.scheduled_event.start_time', 'payload.event.start_time', 'payload.startTime', ...MAPEO_BASE.ocurrido_en],
    email: ['payload.email', 'payload.attendees.0.email', ...MAPEO_BASE.email],
    nombre: ['payload.name', 'payload.attendees.0.name', ...MAPEO_BASE.nombre],
    zona_horaria: ['payload.timezone', 'payload.attendees.0.timeZone', ...MAPEO_BASE.zona_horaria],
    titulo: ['payload.scheduled_event.name', 'payload.title', ...MAPEO_BASE.titulo],
  },
  // Stripe: el evento viene en "type" y los datos en data.object (checkout
  // session, charge o payment intent). Los importes van en céntimos: el
  // endpoint de Stripe que crea la pantalla de Integraciones divide por 100.
  stripe: {
    idempotency_key: ['id', ...MAPEO_BASE.idempotency_key],
    email: ['data.object.customer_details.email', 'data.object.customer_email', 'data.object.billing_details.email',
      'data.object.receipt_email', ...MAPEO_BASE.email],
    nombre: ['data.object.customer_details.name', 'data.object.billing_details.name', ...MAPEO_BASE.nombre],
    telefono: ['data.object.customer_details.phone', 'data.object.billing_details.phone', ...MAPEO_BASE.telefono],
    valor: ['data.object.amount_total', 'data.object.amount_refunded', 'data.object.amount', ...MAPEO_BASE.valor],
    moneda: ['data.object.currency', ...MAPEO_BASE.moneda],
    ig_username: ['data.object.metadata.ig_username', 'data.object.metadata.instagram', ...MAPEO_BASE.ig_username],
  },
  // Hotmart (webhook 2.0): { id, event: "PURCHASE_APPROVED", data: { buyer, product, purchase } }.
  // El "id" es único por aviso: la compra y su devolución comparten la
  // transacción, así que la transacción NO sirve para deduplicar.
  hotmart: {
    idempotency_key: ['id', ...MAPEO_BASE.idempotency_key],
    email: ['data.buyer.email', ...MAPEO_BASE.email],
    nombre: ['data.buyer.name', ...MAPEO_BASE.nombre],
    telefono: ['data.buyer.checkout_phone', ...MAPEO_BASE.telefono],
    pais: ['data.buyer.address.country_iso', ...MAPEO_BASE.pais],
    valor: ['data.purchase.price.value', 'data.purchase.full_price.value', ...MAPEO_BASE.valor],
    moneda: ['data.purchase.price.currency_value', ...MAPEO_BASE.moneda],
    titulo: ['data.product.name', ...MAPEO_BASE.titulo],
    ocurrido_en: ['data.purchase.approved_date', 'creation_date', ...MAPEO_BASE.ocurrido_en],
  },
};

/**
 * Fuentes de pago: si llega un evento con nombre que no conocemos (p. ej.
 * "customer.created" de Stripe o "PURCHASE_BILLET_PRINTED" de Hotmart) NO se
 * cuenta como venta: se guarda como "otro". Así una suscripción de más en la
 * pasarela no infla la facturación.
 */
const FUENTES_ESTRICTAS = new Set(['stripe', 'hotmart']);

/** Nombres de evento de terceros → tipos del CRM. */
const ALIAS_EVENTO: Record<string, string> = {
  lead: 'lead_creado', new_lead: 'lead_creado', subscriber: 'lead_creado', nuevo_lead: 'lead_creado',
  recurso: 'recurso_entregado', resource_sent: 'recurso_entregado', dm_sent: 'recurso_entregado',
  entregado: 'recurso_entregado',
  reply: 'respondio_dm', dm_reply: 'respondio_dm', respuesta: 'respondio_dm',
  'invitee.created': 'reunion_agendada', 'booking.created': 'reunion_agendada',
  meeting_scheduled: 'reunion_agendada', agendado: 'reunion_agendada', booked: 'reunion_agendada',
  'invitee.canceled': 'reunion_cancelada', 'booking.cancelled': 'reunion_cancelada',
  cancelado: 'reunion_cancelada',
  no_show: 'reunion_no_asistio', noshow: 'reunion_no_asistio', no_asistio: 'reunion_no_asistio',
  meeting_completed: 'reunion_realizada', asistio: 'reunion_realizada', attended: 'reunion_realizada',
  purchase: 'venta', payment: 'venta', sale: 'venta', compra: 'venta', pago: 'venta',
  'order.paid': 'venta', 'checkout.session.completed': 'venta', 'payment_intent.succeeded': 'venta',
  refund: 'reembolso', 'charge.refunded': 'reembolso', devolucion: 'reembolso',
  // Cal.com
  booking_created: 'reunion_agendada', booking_rescheduled: 'reunion_agendada',
  booking_cancelled: 'reunion_cancelada', booking_rejected: 'reunion_cancelada',
  meeting_ended: 'reunion_realizada',
  // Hotmart
  purchase_approved: 'venta', purchase_complete: 'venta',
  purchase_refunded: 'reembolso', purchase_chargeback: 'reembolso',
  purchase_canceled: 'otro', purchase_billet_printed: 'otro', purchase_delayed: 'otro',
  purchase_expired: 'otro', purchase_protest: 'otro', purchase_out_of_shopping_cart: 'otro',
  subscription_cancellation: 'otro', switch_plan: 'otro',
};

const TIPOS_VALIDOS = new Set([
  'lead_creado', 'recurso_entregado', 'respondio_dm', 'comentario',
  'reunion_agendada', 'reunion_realizada', 'reunion_no_asistio', 'reunion_cancelada',
  'venta', 'reembolso', 'etapa_cambiada', 'etiqueta', 'nota',
  'mensaje_enviado', 'mensaje_recibido', 'otro',
]);

export function normalizarTipoEvento(bruto: string | undefined, porDefecto: string): string {
  if (!bruto) return porDefecto;
  const limpio = bruto.trim().toLowerCase();
  if (TIPOS_VALIDOS.has(limpio)) return limpio;
  const alias = ALIAS_EVENTO[limpio];
  if (alias) return alias;
  return porDefecto;
}

interface MapeoEndpoint {
  campos?: Record<string, string[]>;
  opciones?: { valor_divisor?: number; evento_fijo?: string; origen_toque?: string };
}

export interface PayloadNormalizado {
  tipo: string;
  identidad: IdentidadLead;
  senales: SenalesAtribucion;
  valor?: number;
  moneda?: string;
  titulo?: string;
  ocurridoEn?: Date;
  idempotencyKey?: string;
  origenToque: string;
}

export function normalizarPayload(
  endpoint: { fuente: string; evento_defecto: string; mapeo?: any; id?: string },
  payload: any,
): PayloadNormalizado {
  const cfg: MapeoEndpoint = (() => {
    const m = endpoint.mapeo ?? {};
    if (m.campos || m.opciones) return m as MapeoEndpoint;
    return Object.keys(m).length ? { campos: m } : {};
  })();

  const mapa: Record<string, string[]> = {
    ...MAPEO_BASE,
    ...(MAPEO_POR_FUENTE[endpoint.fuente] ?? {}),
  };
  // Las rutas del usuario van primero: mandan sobre las de por defecto
  for (const [campo, rutas] of Object.entries(cfg.campos ?? {})) {
    const lista = Array.isArray(rutas) ? rutas : [String(rutas)];
    mapa[campo] = [...lista, ...(mapa[campo] ?? [])];
  }

  const v = (campo: string) => primerValor(payload, mapa[campo] ?? []);

  const divisor = cfg.opciones?.valor_divisor ?? 1;
  const valorBruto = aNumero(v('valor'));

  const identidad: IdentidadLead = {
    manychatSubscriberId: v('manychat_subscriber_id'),
    igUserId: v('ig_user_id'),
    igUsername: limpiarUsername(v('ig_username') ?? (endpoint.fuente === 'calendly' ? instagramDeRespuestas(payload) : undefined)),
    nombre: v('nombre'),
    apellido: v('apellido'),
    email: v('email')?.toLowerCase(),
    telefono: v('telefono'),
    pais: v('pais'),
    zonaHoraria: v('zona_horaria'),
    idioma: v('idioma'),
    avatarUrl: v('avatar_url'),
    camposExtra: extraerCamposExtra(payload),
    consentimiento: true,
    modeloNegocio: v('modelo_negocio'),
    ingresosAprox: v('ingresos_aprox'),
    cuelloBotella: v('cuello_botella'),
  };

  const senales: SenalesAtribucion = {
    contenidoId: v('contenido_id'),
    igMediaId: v('ig_media_id'),
    permalink: v('permalink'),
    automatizacionId: v('automatizacion_id'),
    manychatFlowId: v('manychat_flow_id'),
    palabraClave: v('palabra_clave'),
    campania: v('campania'),
  };

  return {
    tipo: cfg.opciones?.evento_fijo ?? (() => {
      const bruto = v('evento');
      const tipo = normalizarTipoEvento(bruto, endpoint.evento_defecto);
      // Evento con nombre desconocido en una pasarela de pago → "otro", no venta.
      if (bruto && FUENTES_ESTRICTAS.has(endpoint.fuente) && tipo === endpoint.evento_defecto
        && !TIPOS_VALIDOS.has(bruto.trim().toLowerCase()) && !ALIAS_EVENTO[bruto.trim().toLowerCase()]) return 'otro';
      return tipo;
    })(),
    identidad,
    senales,
    valor: valorBruto !== undefined ? valorBruto / divisor : undefined,
    moneda: v('moneda')?.toUpperCase(),
    titulo: v('titulo'),
    ocurridoEn: aFecha(v('ocurrido_en')),
    idempotencyKey: v('idempotency_key'),
    origenToque: cfg.opciones?.origen_toque ?? (endpoint.fuente === 'manychat' ? 'comentario' : 'directo'),
  };
}

/**
 * Calendly: si el formulario de la reunión pregunta el Instagram ("¿Cuál es
 * tu @ de Instagram?"), la respuesta identifica al lead que ya está en el CRM.
 */
function instagramDeRespuestas(payload: any): string | undefined {
  const qa = payload?.payload?.questions_and_answers ?? payload?.questions_and_answers;
  if (!Array.isArray(qa)) return undefined;
  for (const x of qa) {
    if (/instagram|\binsta\b|\big\b|@/i.test(String(x?.question ?? '')) && typeof x?.answer === 'string' && x.answer.trim()) {
      const m = x.answer.trim().match(/(?:instagram\.com\/)?@?([A-Za-z0-9._]{2,30})/i);
      if (m) return m[1];
    }
  }
  return undefined;
}

/** Los custom_fields de ManyChat se guardan tal cual en el lead. */
function extraerCamposExtra(payload: any): Record<string, unknown> {
  const cf = payload?.custom_fields ?? payload?.customFields;
  if (cf && typeof cf === 'object' && !Array.isArray(cf)) return cf;
  return {};
}

// ---------------------------------------------------------------------
// Procesamiento
// ---------------------------------------------------------------------

export interface ResultadoIngesta {
  webhookEventoId: number;
  estado: 'procesado' | 'error' | 'duplicado';
  leadId?: string;
  eventoId?: number | null;
  tipo?: string;
  atribucion?: unknown;
  error?: string;
  codigo?: CodigoErrorIngesta;
}

// ---------------------------------------------------------------------
// Firma de los avisos (Stripe y Calendly)
// ---------------------------------------------------------------------

/** Cabecera de firma de cada app ("t=…,v1=…" en las dos). */
const CABECERA_FIRMA: Record<string, string> = {
  stripe: 'stripe-signature',
  calendly: 'calendly-webhook-signature',
};

/**
 * Verifica la firma de un aviso con el secreto guardado al conectar la app
 * pegando una clave. Stripe y Calendly firman igual: HMAC-SHA256 de
 * "<t>.<cuerpo crudo>" en la cabecera "t=<segundos>,v1=<hex>". Se acepta
 * hasta 5 minutos de diferencia de reloj (protege de reenvíos viejos).
 */
export function verificarFirmaWebhook(
  fuente: string, secreto: string, crudo: string, cabeceras: Record<string, unknown>,
  ahoraMs = Date.now(), toleranciaS = 300,
): { ok: boolean; motivo?: string } {
  const nombre = CABECERA_FIRMA[fuente];
  if (!nombre) return { ok: true };
  const valor = String(cabeceras[nombre] ?? '');
  if (!valor) return { ok: false, motivo: 'El aviso llegó sin firma.' };
  const partes = valor.split(',').map((p) => p.trim().split('='));
  const t = partes.find(([k]) => k === 't')?.[1];
  const firmas = partes.filter(([k]) => k === 'v1').map(([, v]) => v ?? '');
  if (!t || !firmas.length || !/^\d+$/.test(t)) return { ok: false, motivo: 'La firma del aviso no tiene el formato esperado.' };
  if (Math.abs(ahoraMs / 1000 - Number(t)) > toleranciaS) return { ok: false, motivo: 'El aviso es viejo (más de 5 minutos): se descarta por seguridad.' };
  const esperada = Buffer.from(createHmac('sha256', secreto).update(`${t}.${crudo}`, 'utf8').digest('hex'));
  const coincide = firmas.some((f) => {
    const b = Buffer.from(f);
    return b.length === esperada.length && timingSafeEqual(b, esperada);
  });
  return coincide ? { ok: true } : { ok: false, motivo: 'La firma no coincide: el aviso no vino de tu cuenta o el secreto cambió.' };
}

/**
 * Guarda un aviso que NO se procesa (firma inválida): queda en el historial
 * para que se vea qué pasó, pero no toca leads ni ventas.
 */
export async function registrarRechazo(
  endpoint: any, payload: any, headers: Record<string, unknown>, ip: string | undefined,
  codigo: CodigoErrorIngesta, mensaje: string,
): Promise<ResultadoIngesta> {
  const fila = await queryOne(
    `INSERT INTO webhook_eventos (cuenta_id, endpoint_id, fuente, payload, headers, ip, estado, error, codigo_error, intentos)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,'error',$7,$8,1) RETURNING id`,
    [endpoint.cuenta_id, endpoint.id, endpoint.fuente, JSON.stringify(payload ?? {}),
     JSON.stringify(headers), ip ?? null, mensaje.slice(0, 500), codigo]);
  await pool.query(`UPDATE webhook_endpoints SET total_errores = total_errores + 1 WHERE id = $1`, [endpoint.id]);
  return { webhookEventoId: fila?.id ?? 0, estado: 'error', error: mensaje, codigo };
}

/**
 * Recibe un webhook: PRIMERO guarda el payload crudo, después intenta
 * procesarlo. Si el procesado falla, el payload sigue ahí y se puede
 * reprocesar desde el panel. Nunca se pierde un lead por un payload raro.
 */
export async function recibirWebhook(
  endpoint: any,
  payload: any,
  headers: Record<string, unknown> = {},
  ip?: string,
): Promise<ResultadoIngesta> {
  let normalizado: PayloadNormalizado | null = null;
  try {
    normalizado = normalizarPayload(endpoint, payload);
  } catch {
    normalizado = null;
  }

  const claveIdem = normalizado?.idempotencyKey
    ? `${endpoint.id}:${normalizado.idempotencyKey}`
    : null;

  // 1. Guardado crudo e inmediato
  let bruto: any;
  try {
    bruto = await queryOne(
      `INSERT INTO webhook_eventos (cuenta_id, endpoint_id, fuente, payload, headers, ip, idempotency_key)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7) RETURNING *`,
      [endpoint.cuenta_id, endpoint.id, endpoint.fuente,
       JSON.stringify(payload ?? {}), JSON.stringify(headers), ip ?? null, claveIdem],
    );
  } catch (err: any) {
    if (err?.code === '23505') {
      const previo = await queryOne(
        `SELECT id, lead_id, evento_id FROM webhook_eventos WHERE cuenta_id = $1 AND idempotency_key = $2`,
        [endpoint.cuenta_id, claveIdem],
      );
      return {
        webhookEventoId: previo?.id ?? 0,
        estado: 'duplicado',
        leadId: previo?.lead_id,
        eventoId: previo?.evento_id,
      };
    }
    throw err;
  }

  await pool.query(
    `UPDATE webhook_endpoints SET total_recibidos = total_recibidos + 1, ultimo_evento_en = now() WHERE id = $1`,
    [endpoint.id],
  );

  // 2. Procesado
  return procesarBruto(bruto, endpoint, normalizado);
}

async function procesarBruto(
  bruto: any,
  endpoint: any,
  normalizado: PayloadNormalizado | null,
): Promise<ResultadoIngesta> {
  try {
    const n = normalizado ?? normalizarPayload(endpoint, bruto.payload);

    const tieneIdentidad =
      n.identidad.manychatSubscriberId || n.identidad.igUserId ||
      n.identidad.igUsername || n.identidad.email;

    if (!tieneIdentidad) throw new ErrorIngesta('sin_identidad', MENSAJE_SIN_IDENTIDAD);

    const res = await registrarEvento({
      cuentaId: endpoint.cuenta_id,
      tipo: n.tipo,
      identidad: n.identidad,
      senales: n.senales,
      valor: n.valor,
      moneda: n.moneda,
      titulo: n.titulo,
      fuente: (endpoint.fuente === 'generico' ? 'generico' : endpoint.fuente),
      payload: bruto.payload,
      ocurridoEn: n.ocurridoEn,
      idempotencyKey: bruto.idempotency_key ?? undefined,
      origenToque: n.origenToque,
    });

    if (res.leadId) await aplicarEtiquetasDelAviso(endpoint, n.tipo, res.leadId);

    await pool.query(
      `UPDATE webhook_eventos
          SET estado = 'procesado', procesado_en = now(), lead_id = $2, evento_id = $3,
              intentos = intentos + 1, error = NULL, codigo_error = NULL
        WHERE id = $1`,
      [bruto.id, res.leadId, res.eventoId],
    );

    return {
      webhookEventoId: bruto.id,
      estado: 'procesado',
      leadId: res.leadId,
      eventoId: res.eventoId,
      tipo: n.tipo,
      atribucion: res.atribucion,
    };
  } catch (err: any) {
    const mensaje = String(err?.message ?? err).slice(0, 500);
    const codigo: CodigoErrorIngesta = err instanceof ErrorIngesta ? err.codigo : 'error_interno';
    await pool.query(
      `UPDATE webhook_eventos SET estado = 'error', error = $2, codigo_error = $3, intentos = intentos + 1 WHERE id = $1`,
      [bruto.id, mensaje, codigo],
    );
    await pool.query(
      `UPDATE webhook_endpoints SET total_errores = total_errores + 1 WHERE id = $1`,
      [endpoint.id],
    );
    return { webhookEventoId: bruto.id, estado: 'error', error: mensaje, codigo };
  }
}

/** Reintenta un webhook que falló, con la configuración actual. */
export async function reprocesarWebhook(cuentaId: string, webhookEventoId: number) {
  const bruto = await queryOne(
    `SELECT * FROM webhook_eventos WHERE cuenta_id = $1 AND id = $2`,
    [cuentaId, webhookEventoId],
  );
  if (!bruto) return null;
  const endpoint = await queryOne(
    `SELECT * FROM webhook_endpoints WHERE id = $1`, [bruto.endpoint_id]);
  if (!endpoint) return null;
  return procesarBruto(bruto, endpoint, null);
}

export async function reprocesarErrores(cuentaId: string, limite = 100) {
  const pendientes = await query(
    `SELECT id FROM webhook_eventos WHERE cuenta_id = $1 AND estado = 'error'
     ORDER BY recibido_en ASC LIMIT $2`,
    [cuentaId, limite],
  );
  const resultados = [];
  for (const p of pendientes) {
    resultados.push(await reprocesarWebhook(cuentaId, p.id));
  }
  return {
    intentados: resultados.length,
    recuperados: resultados.filter((r) => r?.estado === 'procesado').length,
  };
}

export async function endpointPorToken(token: string) {
  return queryOne(`SELECT * FROM webhook_endpoints WHERE token = $1 AND activo`, [token]);
}


/** Regla del usuario: cuando llega este evento por este webhook, poner/quitar etiquetas. */
export interface ReglaEtiqueta { evento: string; poner?: string; quitar?: string }

export function reglasEtiquetas(endpoint: { mapeo?: any }): ReglaEtiqueta[] {
  const r = endpoint?.mapeo?.opciones?.etiquetas;
  return Array.isArray(r) ? r.filter((x: any) => x && typeof x.evento === 'string') : [];
}

async function aplicarEtiquetasDelAviso(endpoint: any, tipo: string, leadId: string) {
  const reglas = reglasEtiquetas(endpoint).filter((r) => r.evento === tipo);
  if (!reglas.length) return;
  const poner = reglas.map((r) => (r.poner ?? '').trim()).filter(Boolean);
  const quitar = reglas.map((r) => (r.quitar ?? '').trim()).filter(Boolean);
  // Si eligió otra etiqueta para «agendó», la verde automática no se queda.
  if (tipo === 'reunion_agendada' && !poner.includes('Reunión agendada')) quitar.push('Reunión agendada');
  await pool.query(
    `UPDATE leads SET etiquetas = ARRAY(
        SELECT DISTINCT x FROM unnest(etiquetas || $3::text[]) x WHERE NOT (x = ANY($4::text[])) OR x = ANY($3::text[]))
      WHERE id = $1 AND cuenta_id = $2`,
    [leadId, endpoint.cuenta_id, poner, quitar]);
}
