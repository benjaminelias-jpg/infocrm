import { pool, query, queryOne } from '../db/pool.js';
import { primerValor, aNumero, aFecha, limpiarUsername } from '../lib/utils.js';
import { registrarEvento, type IdentidadLead } from './eventos.js';
import type { SenalesAtribucion } from './atribucion.js';

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
  calendly: {
    idempotency_key: ['payload.uri', 'uri', ...MAPEO_BASE.idempotency_key],
    ocurrido_en: ['payload.scheduled_event.start_time', 'payload.event.start_time', ...MAPEO_BASE.ocurrido_en],
  },
  stripe: {
    idempotency_key: ['id', ...MAPEO_BASE.idempotency_key],
  },
};

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
    igUsername: limpiarUsername(v('ig_username')),
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
    tipo: cfg.opciones?.evento_fijo ?? normalizarTipoEvento(v('evento'), endpoint.evento_defecto),
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

    if (!tieneIdentidad) {
      throw new Error(
        'El payload no trae ninguna forma de identificar al lead (ni subscriber id, ni ig_username, ni email). ' +
        'Añade uno de esos campos en el webhook de ManyChat.',
      );
    }

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

    await pool.query(
      `UPDATE webhook_eventos
          SET estado = 'procesado', procesado_en = now(), lead_id = $2, evento_id = $3,
              intentos = intentos + 1, error = NULL
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
    await pool.query(
      `UPDATE webhook_eventos SET estado = 'error', error = $2, intentos = intentos + 1 WHERE id = $1`,
      [bruto.id, mensaje],
    );
    await pool.query(
      `UPDATE webhook_endpoints SET total_errores = total_errores + 1 WHERE id = $1`,
      [endpoint.id],
    );
    return { webhookEventoId: bruto.id, estado: 'error', error: mensaje };
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
