import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { pool, query, queryOne } from '../db/pool.js';
import { generarApiKey, generarTokenWebhook } from '../lib/auth.js';
import { noEncontrado, peticionInvalida } from '../lib/errores.js';
import { metasProgreso } from '../modules/infoproduccion.js';

// Rutas de la pantalla de Configuración / Integraciones (montadas en
// /api/ux/integraciones):
//  · resumen del estado de cada app (una sola llamada para las tarjetas),
//  · direcciones de entrada que se crean recién cuando el usuario las pide,
//  · la "prueba en vivo" (¿llegó algo desde que tocaste Probar?),
//  · Calendly y Stripe conectados PEGANDO UNA CLAVE (el CRM crea solo la
//    suscripción de avisos y guarda el secreto de firma),
//  · Tu Claude (conexiones con permiso de solo lectura o con cambios),
//  · Tu negocio (nombre, moneda, zona horaria, criterios, comisiones).

/**
 * Cada integración "de entrada" es un endpoint de webhook con su URL secreta.
 * La pantalla nunca le pide al usuario que cree uno a mano: pide el de su
 * tipo y, si no existe, se crea con la configuración correcta.
 */
const FUENTES = {
  manychat: { nombre: 'ManyChat — entrada de leads', slug: 'manychat-leads', fuente: 'manychat', evento_defecto: 'lead_creado', mapeo: {} },
  agenda: { nombre: 'Calendly / agenda — reunión agendada', slug: 'reunion-agendada', fuente: 'calendly', evento_defecto: 'reunion_agendada', mapeo: {} },
  // Stripe manda los importes en céntimos (amount_total = 49700 → 497 €).
  stripe: { nombre: 'Stripe — ventas', slug: 'stripe-ventas', fuente: 'stripe', evento_defecto: 'venta', mapeo: { opciones: { valor_divisor: 100 } } },
  hotmart: { nombre: 'Hotmart — ventas', slug: 'hotmart-ventas', fuente: 'hotmart', evento_defecto: 'venta', mapeo: {} },
  pagos: { nombre: 'Pasarela de pago — venta', slug: 'venta', fuente: 'generico', evento_defecto: 'venta', mapeo: {} },
  zapier: { nombre: 'Zapier / Make — entrada de leads', slug: 'zapier-leads', fuente: 'generico', evento_defecto: 'lead_creado', mapeo: {} },
} as const;
export type TipoFuente = keyof typeof FUENTES;
const TIPOS = Object.keys(FUENTES) as [TipoFuente, ...TipoFuente[]];

const CAMPOS_ENDPOINT = `id, nombre, slug, fuente, evento_defecto, total_recibidos, total_errores, ultimo_evento_en,
  activo, token, configurado_en, (secreto_firma IS NOT NULL) AS verificada`;

const conUrl = (e: any) => (e ? { ...e, url: `${config.apiUrl}/webhooks/${e.token}`, token: undefined } : e);

/** Crea (si falta) la dirección de un tipo y la devuelve CON su token. */
async function asegurarFuente(cuentaId: string, tipo: TipoFuente) {
  const f = FUENTES[tipo];
  await query(
    `INSERT INTO webhook_endpoints (cuenta_id, nombre, slug, token, fuente, evento_defecto, mapeo)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     ON CONFLICT (cuenta_id, slug) DO NOTHING`,
    [cuentaId, f.nombre, f.slug, generarTokenWebhook(), f.fuente, f.evento_defecto, JSON.stringify(f.mapeo)]);
  const e = await queryOne(`SELECT ${CAMPOS_ENDPOINT} FROM webhook_endpoints WHERE cuenta_id = $1 AND slug = $2`, [cuentaId, f.slug]);
  if (!e) throw noEncontrado('Dirección');
  return e;
}

// ---------------------------------------------------------------------
// APIs de terceros (Calendly y Stripe) con cliente HTTP inyectable: en los
// tests se apunta a un servidor falso local.
// ---------------------------------------------------------------------

export type ClienteHttp = (url: string, init?: RequestInit) => Promise<Response>;
const POR_DEFECTO = {
  http: ((url: string, init?: RequestInit) => fetch(url, init)) as ClienteHttp,
  stripe: process.env.STRIPE_API_URL || 'https://api.stripe.com',
  calendly: process.env.CALENDLY_API_URL || 'https://api.calendly.com',
};
const externas = { ...POR_DEFECTO };
export function configurarApisExternas(o: Partial<typeof POR_DEFECTO>) { Object.assign(externas, o); }
export function restaurarApisExternas() { Object.assign(externas, POR_DEFECTO); }

async function pedir(url: string, init: RequestInit = {}) {
  let r: Response;
  try {
    r = await externas.http(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch {
    return { status: 0, datos: null as any };
  }
  const texto = await r.text().catch(() => '');
  let datos: any = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch { datos = texto; }
  return { status: r.status, datos };
}

/** Guarda (o actualiza) la integración de una app conectada por clave. */
async function guardarIntegracion(cuentaId: string, tipo: 'calendly' | 'stripe', nombre: string, credenciales: object, cfg: object) {
  await pool.query(
    `INSERT INTO integraciones (cuenta_id, tipo, nombre, credenciales, config, estado)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,'conectado')
     ON CONFLICT (cuenta_id, tipo, nombre) DO UPDATE
       SET credenciales = EXCLUDED.credenciales, config = EXCLUDED.config,
           estado = 'conectado', ultimo_error = NULL, activo = true`,
    [cuentaId, tipo, nombre, JSON.stringify(credenciales), JSON.stringify(cfg)]);
}

async function integracion(cuentaId: string, tipo: 'calendly' | 'stripe') {
  return queryOne(`SELECT * FROM integraciones WHERE cuenta_id = $1 AND tipo = $2 AND activo ORDER BY creado_en ASC LIMIT 1`, [cuentaId, tipo]);
}

const SIN_RED = (app: string) => `No pudimos hablar con ${app}. Revisá tu internet y probá de nuevo en un rato.`;

/**
 * Calendly con un token personal: el CRM crea la suscripción de avisos
 * (reunión agendada y cancelada) con un secreto de firma propio.
 */
export async function conectarCalendly(cuentaId: string, token: string) {
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const yo = await pedir(`${externas.calendly}/users/me`, { headers: auth });
  if (yo.status === 0) throw peticionInvalida(SIN_RED('Calendly'));
  if (yo.status === 401 || yo.status === 403) {
    throw peticionInvalida('Calendly no aceptó ese token. Copialo de nuevo: es un texto largo que empieza con «eyJ».');
  }
  if (yo.status >= 400 || !yo.datos?.resource?.uri) throw peticionInvalida(`Calendly no respondió bien (${yo.status}). Probá de nuevo en un rato.`);
  const usuario = yo.datos.resource;

  const ep = await asegurarFuente(cuentaId, 'agenda');
  const url = `${config.apiUrl}/webhooks/${ep.token}`;
  const secreto = randomBytes(24).toString('hex');
  const cuerpo = JSON.stringify({
    url, events: ['invitee.created', 'invitee.canceled'],
    organization: usuario.current_organization, user: usuario.uri, scope: 'user', signing_key: secreto,
  });

  let alta = await pedir(`${externas.calendly}/webhook_subscriptions`, { method: 'POST', headers: auth, body: cuerpo });
  if (alta.status === 409) {
    // Ya había una suscripción a esta dirección (p. ej. reconectar): se
    // borra y se crea de nuevo para que lleve nuestro secreto de firma.
    const qs = new URLSearchParams({ organization: usuario.current_organization ?? '', user: usuario.uri, scope: 'user', count: '100' });
    const lista = await pedir(`${externas.calendly}/webhook_subscriptions?${qs}`, { headers: auth });
    for (const s of lista.datos?.collection ?? []) {
      if (s?.callback_url === url && s?.uri) await pedir(s.uri, { method: 'DELETE', headers: auth });
    }
    alta = await pedir(`${externas.calendly}/webhook_subscriptions`, { method: 'POST', headers: auth, body: cuerpo });
  }
  if (alta.status === 0) throw peticionInvalida(SIN_RED('Calendly'));
  if (alta.status === 403 || (alta.status === 400 && /upgrade|plan|premium/i.test(JSON.stringify(alta.datos ?? '')))) {
    throw peticionInvalida('Tu plan de Calendly no permite avisos automáticos (hace falta el plan Standard o superior). Podés conectarlo con Zapier o Make: elegí «Otra agenda».');
  }
  if (alta.status === 401) throw peticionInvalida('Calendly no aceptó ese token. Copialo de nuevo.');
  if (alta.status >= 400 || !alta.datos?.resource?.uri) throw peticionInvalida(`Calendly no dejó crear el aviso (${alta.status}). Probá de nuevo en un rato.`);

  // Cuántos tipos de reunión tiene activos (para el "✓ conectado · 2 tipos de evento").
  const tipos = await pedir(`${externas.calendly}/event_types?${new URLSearchParams({ user: usuario.uri, active: 'true', count: '100' })}`, { headers: auth });
  const tiposEvento = Array.isArray(tipos.datos?.collection) ? tipos.datos.collection.length : null;

  await guardarIntegracion(cuentaId, 'calendly', 'Calendly', { token }, {
    suscripcion_uri: alta.datos.resource.uri, email: usuario.email ?? null, nombre: usuario.name ?? null,
    usuario_uri: usuario.uri, organizacion: usuario.current_organization ?? null, tipos_evento: tiposEvento,
    conectado_en: new Date().toISOString(),
  });
  await pool.query(`UPDATE webhook_endpoints SET secreto_firma = $2, configurado_en = now(), activo = true WHERE id = $1`, [ep.id, secreto]);
  return { ok: true, email: usuario.email ?? null, nombre: usuario.name ?? null, tipos_evento: tiposEvento, endpoint_id: ep.id };
}

export async function desconectarCalendly(cuentaId: string) {
  const integ = await integracion(cuentaId, 'calendly');
  if (integ?.credenciales?.token && integ.config?.suscripcion_uri) {
    await pedir(integ.config.suscripcion_uri, { method: 'DELETE', headers: { authorization: `Bearer ${integ.credenciales.token}` } });
  }
  if (integ) await pool.query(`UPDATE integraciones SET credenciales = '{}'::jsonb, estado = 'sin_configurar' WHERE id = $1`, [integ.id]);
  await pool.query(
    `UPDATE webhook_endpoints SET secreto_firma = NULL, configurado_en = NULL WHERE cuenta_id = $1 AND slug = $2`,
    [cuentaId, FUENTES.agenda.slug]);
}

const EVENTOS_STRIPE = ['checkout.session.completed', 'charge.refunded'];

/**
 * Stripe con una clave restringida: el CRM crea el aviso (webhook) con los
 * eventos justos y GUARDA el secreto de firma, así cada venta llega verificada.
 */
export async function conectarStripe(cuentaId: string, clave: string) {
  if (!/^(rk|sk)_(live|test)_[A-Za-z0-9]{8,}$/.test(clave)) {
    throw peticionInvalida('Eso no parece una clave de Stripe: tiene que empezar con «rk_live_» (o «rk_test_» para probar).');
  }
  const auth = { authorization: `Bearer ${clave}` };
  const ep = await asegurarFuente(cuentaId, 'stripe');
  const url = `${config.apiUrl}/webhooks/${ep.token}`;

  const lista = await pedir(`${externas.stripe}/v1/webhook_endpoints?limit=100`, { headers: auth });
  if (lista.status === 0) throw peticionInvalida(SIN_RED('Stripe'));
  if (lista.status === 401) throw peticionInvalida('Stripe no aceptó esa clave. Copiala de nuevo (empieza con «rk_live_»).');
  if (lista.status === 403) throw peticionInvalida('A esa clave le falta un permiso: en Stripe, en «Webhook Endpoints», elegí «Escritura».');
  // Si ya había un aviso a esta misma dirección (pegado a mano antes), se
  // reemplaza: dos avisos iguales contarían cada venta dos veces.
  for (const w of lista.datos?.data ?? []) {
    if (w?.url === url && w?.id) await pedir(`${externas.stripe}/v1/webhook_endpoints/${encodeURIComponent(w.id)}`, { method: 'DELETE', headers: auth });
  }
  const form = new URLSearchParams();
  form.set('url', url);
  for (const ev of EVENTOS_STRIPE) form.append('enabled_events[]', ev);
  form.set('description', 'InfoCRM: ventas y devoluciones');
  const alta = await pedir(`${externas.stripe}/v1/webhook_endpoints`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString(),
  });
  if (alta.status === 0) throw peticionInvalida(SIN_RED('Stripe'));
  if (alta.status === 401) throw peticionInvalida('Stripe no aceptó esa clave. Copiala de nuevo.');
  if (alta.status === 403) throw peticionInvalida('A esa clave le falta un permiso: en Stripe, en «Webhook Endpoints», elegí «Escritura».');
  if (alta.status >= 400 || !alta.datos?.id || !alta.datos?.secret) {
    throw peticionInvalida(`Stripe no dejó crear el aviso (${alta.status}): ${alta.datos?.error?.message ?? 'probá de nuevo en un rato'}.`);
  }
  const real = Boolean(alta.datos.livemode ?? clave.includes('_live_'));
  await guardarIntegracion(cuentaId, 'stripe', 'Stripe', { clave }, {
    webhook_id: alta.datos.id, livemode: real, eventos: EVENTOS_STRIPE, conectado_en: new Date().toISOString(),
  });
  await pool.query(`UPDATE webhook_endpoints SET secreto_firma = $2, configurado_en = now(), activo = true WHERE id = $1`, [ep.id, alta.datos.secret]);
  return { ok: true, modo: real ? 'real' : 'prueba', endpoint_id: ep.id };
}

export async function desconectarStripe(cuentaId: string) {
  const integ = await integracion(cuentaId, 'stripe');
  if (integ?.credenciales?.clave && integ.config?.webhook_id) {
    await pedir(`${externas.stripe}/v1/webhook_endpoints/${encodeURIComponent(integ.config.webhook_id)}`, {
      method: 'DELETE', headers: { authorization: `Bearer ${integ.credenciales.clave}` },
    });
  }
  if (integ) await pool.query(`UPDATE integraciones SET credenciales = '{}'::jsonb, estado = 'sin_configurar' WHERE id = $1`, [integ.id]);
  await pool.query(
    `UPDATE webhook_endpoints SET secreto_firma = NULL, configurado_en = NULL WHERE cuenta_id = $1 AND slug = $2`,
    [cuentaId, FUENTES.stripe.slug]);
}

// ---------------------------------------------------------------------
// Tu negocio
// ---------------------------------------------------------------------

function zonaValida(z: string) {
  try { new Intl.DateTimeFormat('es', { timeZone: z }); return true; } catch { return false; }
}
/** Monedas ISO que conoce el sistema (Intl acepta cualquier código "bien formado", no alcanza). */
const MONEDAS = new Set<string>((() => {
  try { return (Intl as any).supportedValuesOf('currency') as string[]; } catch { return ['EUR', 'USD', 'ARS', 'MXN', 'COP', 'CLP', 'PEN', 'UYU', 'BRL', 'GBP']; }
})());
function monedaValida(m: string) { return /^[A-Z]{3}$/.test(m) && MONEDAS.has(m); }

async function negocio(cuentaId: string) {
  const [c, objetivo] = await Promise.all([
    queryOne(
      `SELECT nombre, moneda, zona_horaria, ig_username, criterios_calif, comision_closer_def, comision_setter_def
         FROM cuentas WHERE id = $1`, [cuentaId]),
    metasProgreso(cuentaId),
  ]);
  if (!c) throw noEncontrado('Cuenta');
  return {
    cuenta: {
      nombre: c.nombre, moneda: c.moneda, zona_horaria: c.zona_horaria, ig_username: c.ig_username ?? null,
      criterios_calif: Array.isArray(c.criterios_calif) ? c.criterios_calif : [],
    },
    comisiones: { closer_pct: Number(c.comision_closer_def ?? 20), setter_pct: Number(c.comision_setter_def ?? 5) },
    objetivo,
  };
}

export default async function rutasUx_integraciones(app: FastifyInstance) {
  /** Resumen de estado para las tarjetas (una sola llamada). */
  app.get('/resumen', async (req) => {
    const c = req.sesion.cuentaId;
    const [dm, endpoints, salientes, claves, otras, conexiones] = await Promise.all([
      queryOne(
        `SELECT max(m.ocurrido_en) AS ultimo_dm_en, COUNT(*)::int AS dms_7d
           FROM mensajes m
          WHERE m.cuenta_id = $1 AND m.direccion = 'entrante' AND m.canal = 'instagram_dm'
            AND m.ocurrido_en > now() - interval '7 days'`, [c]),
      query(`SELECT ${CAMPOS_ENDPOINT} FROM webhook_endpoints e WHERE e.cuenta_id = $1 ORDER BY e.creado_en ASC`, [c]),
      queryOne(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE activo)::int AS activos,
                       COUNT(*) FILTER (WHERE activo AND ultimo_error IS NOT NULL)::int AS con_fallos,
                       COALESCE(SUM(total_fallos), 0)::int AS fallos, max(ultimo_envio_en) AS ultimo_envio_en
                  FROM suscripciones_webhook WHERE cuenta_id = $1`, [c]),
      // Tu Claude: solo las conexiones creadas desde su guía (no cualquier clave).
      queryOne(`SELECT COUNT(*)::int AS n, max(ultimo_uso_en) AS ultimo_uso_en, max(creado_en) AS creado_en
                  FROM api_keys WHERE cuenta_id = $1 AND revocado_en IS NULL AND tipo = 'claude'`, [c]),
      queryOne(`SELECT COUNT(*)::int AS n FROM api_keys WHERE cuenta_id = $1 AND revocado_en IS NULL AND tipo IS DISTINCT FROM 'claude'`, [c]),
      query(`SELECT tipo, estado, config FROM integraciones WHERE cuenta_id = $1 AND tipo IN ('calendly','stripe') AND activo`, [c]),
    ]);
    const con = (tipo: string) => conexiones.find((x: any) => x.tipo === tipo && x.estado === 'conectado');
    const cal = con('calendly');
    const str = con('stripe');
    return {
      instagram: dm,
      endpoints: endpoints.map(conUrl),
      salientes,
      claves,
      otras_claves: otras,
      conexiones: {
        calendly: cal ? { conectado: true, email: cal.config?.email ?? null, nombre: cal.config?.nombre ?? null, tipos_evento: cal.config?.tipos_evento ?? null } : null,
        stripe: str ? { conectado: true, modo: str.config?.livemode === false ? 'prueba' : 'real' } : null,
      },
      // api_url: base pública para armar la URL del conector de Claude (/mcp/<clave>).
      api_url: config.apiUrl,
    };
  });

  /** La dirección de un tipo SI YA EXISTE (mirar una guía no crea nada). */
  app.get('/fuente', async (req) => {
    const { tipo } = z.object({ tipo: z.enum(TIPOS) }).parse(req.query);
    const e = await queryOne(
      `SELECT ${CAMPOS_ENDPOINT} FROM webhook_endpoints WHERE cuenta_id = $1 AND slug = $2`, [req.sesion.cuentaId, FUENTES[tipo].slug]);
    return { fuente: conUrl(e) ?? null };
  });

  /**
   * Devuelve el endpoint de un tipo de integración (ManyChat, agenda, Stripe…)
   * y lo crea si todavía no existe. Idempotente: tocar dos veces no duplica.
   * La pantalla lo llama recién cuando el usuario pide su dirección.
   */
  app.post('/fuente', async (req) => {
    const { tipo } = z.object({ tipo: z.enum(TIPOS) }).parse(req.body);
    return conUrl(await asegurarFuente(req.sesion.cuentaId, tipo));
  });

  /** "Listo, ya la pegué": desde acá la tarjeta dice "Esperando el primer dato". */
  app.post('/fuente/:id/configurado', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const e = await queryOne(
      `UPDATE webhook_endpoints SET configurado_en = COALESCE(configurado_en, now())
        WHERE cuenta_id = $1 AND id = $2 RETURNING ${CAMPOS_ENDPOINT}`, [req.sesion.cuentaId, id]);
    if (!e) throw noEncontrado('Dirección');
    return conUrl(e);
  });

  /** ¿Llegó algo desde `desde`? (DMs de Instagram, webhooks de otras apps o uso de una llave) */
  // Etiquetas que pone/quita cada aviso de este webhook (p. ej. Calendly: agendó → «Reunión agendada»).
  app.get('/fuente/:id/etiquetas', async (req) => {
    const { id } = req.params as { id: string };
    const e = await queryOne<any>(`SELECT mapeo FROM webhook_endpoints WHERE cuenta_id = $1 AND id = $2`, [req.sesion.cuentaId, id]);
    if (!e) throw noEncontrado('No encontramos esa conexión.');
    return { reglas: e.mapeo?.opciones?.etiquetas ?? null };
  });
  app.put('/fuente/:id/etiquetas', async (req) => {
    const { id } = req.params as { id: string };
    const { reglas } = z.object({
      reglas: z.array(z.object({
        evento: z.string().min(1).max(60),
        poner: z.string().max(60).optional(),
        quitar: z.string().max(60).optional(),
      })).max(20),
    }).parse(req.body);
    const e = await queryOne<any>(
      `UPDATE webhook_endpoints
          SET mapeo = base || jsonb_build_object('opciones', COALESCE(base->'opciones', '{}'::jsonb) || jsonb_build_object('etiquetas', $3::jsonb))
         FROM (SELECT id AS bid, CASE WHEN mapeo ? 'campos' OR mapeo ? 'opciones' OR mapeo = '{}'::jsonb THEN mapeo
                                      ELSE jsonb_build_object('campos', mapeo) END AS base
                 FROM webhook_endpoints WHERE cuenta_id = $1 AND id = $2) b
        WHERE webhook_endpoints.id = b.bid RETURNING mapeo`,
      [req.sesion.cuentaId, id, JSON.stringify(reglas)]);
    if (!e) throw noEncontrado('No encontramos esa conexión.');
    return { reglas: e.mapeo?.opciones?.etiquetas ?? [] };
  });

  app.get('/actividad', async (req) => {
    const q = z.object({
      desde: z.string().datetime(),
      endpoint_id: z.string().uuid().optional(),
      clave_id: z.string().uuid().optional(),
    }).parse(req.query);
    const c = req.sesion.cuentaId;
    const [dm, webhook, clave] = await Promise.all([
      queryOne(
        `SELECT m.cuerpo AS texto, m.ocurrido_en AS en, l.id AS lead_id, l.ig_username AS de, l.nombre, l.avatar_url
           FROM mensajes m JOIN leads l ON l.id = m.lead_id
          WHERE m.cuenta_id = $1 AND m.direccion = 'entrante' AND m.canal = 'instagram_dm' AND m.creado_en >= $2
          ORDER BY m.creado_en DESC LIMIT 1`, [c, q.desde]),
      queryOne(
        `SELECT w.id, w.estado, w.error, w.codigo_error AS codigo, w.recibido_en AS en,
                l.id AS lead_id, l.ig_username AS de, l.nombre, l.avatar_url, e.nombre AS endpoint
           FROM webhook_eventos w
           LEFT JOIN leads l ON l.id = w.lead_id
           LEFT JOIN webhook_endpoints e ON e.id = w.endpoint_id
          WHERE w.cuenta_id = $1 AND w.recibido_en >= $2 AND ($3::uuid IS NULL OR w.endpoint_id = $3::uuid)
          ORDER BY w.recibido_en DESC LIMIT 1`, [c, q.desde, q.endpoint_id ?? null]),
      q.clave_id
        ? queryOne(
          `SELECT id, nombre, ultimo_uso_en AS en FROM api_keys
            WHERE cuenta_id = $1 AND id = $2 AND revocado_en IS NULL AND ultimo_uso_en >= $3`, [c, q.clave_id, q.desde])
        : Promise.resolve(null),
    ]);
    return { dm, webhook, clave };
  });

  /** Últimos eventos de un endpoint, en lenguaje simple (para la guía). */
  app.get('/ultimos', async (req) => {
    const q = z.object({ endpoint_id: z.string().uuid().optional(), limite: z.coerce.number().int().min(1).max(20).default(5) }).parse(req.query);
    return query(
      `SELECT w.id, w.estado, w.error, w.codigo_error AS codigo, w.recibido_en AS en,
              l.id AS lead_id, l.ig_username AS de, l.nombre, l.avatar_url, e.nombre AS endpoint
         FROM webhook_eventos w
         LEFT JOIN leads l ON l.id = w.lead_id
         LEFT JOIN webhook_endpoints e ON e.id = w.endpoint_id
        WHERE w.cuenta_id = $1 AND ($2::uuid IS NULL OR w.endpoint_id = $2::uuid)
        ORDER BY w.recibido_en DESC LIMIT $3`, [req.sesion.cuentaId, q.endpoint_id ?? null, q.limite]);
  });

  // ---------------- Calendly y Stripe pegando una clave ----------------

  app.post('/calendly', async (req) => {
    const { token } = z.object({ token: z.string().trim().min(20, 'Pegá el token completo.') }).parse(req.body);
    return conectarCalendly(req.sesion.cuentaId, token);
  });
  app.delete('/calendly', async (req, reply) => {
    await desconectarCalendly(req.sesion.cuentaId);
    return reply.code(204).send();
  });

  app.post('/stripe', async (req) => {
    const { clave } = z.object({ clave: z.string().trim().min(10, 'Pegá la clave completa.') }).parse(req.body);
    return conectarStripe(req.sesion.cuentaId, clave);
  });
  app.delete('/stripe', async (req, reply) => {
    await desconectarStripe(req.sesion.cuentaId);
    return reply.code(204).send();
  });

  // ---------------- Tu Claude ----------------

  const CAMPOS_CLAVE = 'id, nombre, prefijo, tipo, solo_lectura, ultimo_uso_en, creado_en';

  app.get('/claude', async (req) =>
    query(`SELECT ${CAMPOS_CLAVE} FROM api_keys
            WHERE cuenta_id = $1 AND revocado_en IS NULL AND tipo = 'claude' ORDER BY creado_en DESC`, [req.sesion.cuentaId]));

  /** Conexión nueva para Claude. Por defecto SOLO LECTURA: mira, no toca. */
  app.post('/claude', async (req, reply) => {
    const d = z.object({ nombre: z.string().trim().max(60).optional(), puede_escribir: z.boolean().default(false) }).parse(req.body ?? {});
    const { clave, prefijo, hash } = generarApiKey();
    const fila = await queryOne(
      `INSERT INTO api_keys (cuenta_id, nombre, prefijo, hash, creado_por, tipo, solo_lectura)
       VALUES ($1,$2,$3,$4,$5,'claude',$6) RETURNING ${CAMPOS_CLAVE}`,
      [req.sesion.cuentaId, d.nombre || 'Claude', prefijo, hash,
       req.sesion.usuarioId === 'api-key' ? null : req.sesion.usuarioId, !d.puede_escribir]);
    // La dirección (con la clave adentro) se muestra una sola vez.
    return reply.code(201).send({ ...fila, url: `${config.apiUrl.replace(/\/$/, '')}/mcp/${clave}` });
  });

  app.patch('/claude/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const d = z.object({ nombre: z.string().trim().min(1).max(60).optional(), puede_escribir: z.boolean().optional() }).parse(req.body ?? {});
    const fila = await queryOne(
      `UPDATE api_keys SET nombre = COALESCE($3, nombre), solo_lectura = COALESCE($4, solo_lectura)
        WHERE cuenta_id = $1 AND id = $2 AND tipo = 'claude' AND revocado_en IS NULL RETURNING ${CAMPOS_CLAVE}`,
      [req.sesion.cuentaId, id, d.nombre ?? null, d.puede_escribir === undefined ? null : !d.puede_escribir]);
    if (!fila) throw noEncontrado('Conexión');
    return fila;
  });

  /** Otras claves técnicas (SDK, scripts…): van aparte, en Para técnicos. */
  app.get('/claves', async (req) =>
    query(`SELECT ${CAMPOS_CLAVE} FROM api_keys
            WHERE cuenta_id = $1 AND revocado_en IS NULL AND tipo IS DISTINCT FROM 'claude' ORDER BY creado_en DESC`, [req.sesion.cuentaId]));

  // ---------------- Tu negocio ----------------

  app.get('/negocio', async (req) => negocio(req.sesion.cuentaId));

  app.patch('/negocio', async (req) => {
    const d = z.object({
      nombre: z.string().trim().min(1, 'Poné un nombre.').max(80).optional(),
      moneda: z.string().trim().toUpperCase().refine(monedaValida, 'Elegí una moneda de la lista.').optional(),
      zona_horaria: z.string().trim().refine(zonaValida, 'Esa zona horaria no existe.').optional(),
      ig_username: z.string().trim().max(40).nullable().optional(),
      criterios_calif: z.array(z.string().trim().min(1, 'Cada criterio necesita un texto.').max(80)).length(3).optional(),
      comision_closer_pct: z.number().min(0).max(100).optional(),
      comision_setter_pct: z.number().min(0).max(100).optional(),
    }).parse(req.body ?? {});
    const sets: string[] = [];
    const params: any[] = [req.sesion.cuentaId];
    const poner = (col: string, v: unknown, cast = '') => { params.push(v); sets.push(`${col} = $${params.length}${cast}`); };
    if (d.nombre !== undefined) poner('nombre', d.nombre);
    if (d.moneda !== undefined) poner('moneda', d.moneda);
    if (d.zona_horaria !== undefined) poner('zona_horaria', d.zona_horaria);
    if (d.ig_username !== undefined) {
      const u = (d.ig_username ?? '').replace(/^@+/, '').replace(/\s+/g, '').toLowerCase();
      if (u && !/^[a-z0-9._]{1,30}$/.test(u)) throw peticionInvalida('El @ de Instagram solo lleva letras, números, puntos y guiones bajos.');
      poner('ig_username', u || null);
    }
    if (d.criterios_calif !== undefined) poner('criterios_calif', JSON.stringify(d.criterios_calif), '::jsonb');
    if (d.comision_closer_pct !== undefined) poner('comision_closer_def', d.comision_closer_pct);
    if (d.comision_setter_pct !== undefined) poner('comision_setter_def', d.comision_setter_pct);
    if (sets.length) await pool.query(`UPDATE cuentas SET ${sets.join(', ')}, actualizado_en = now() WHERE id = $1`, params);
    return negocio(req.sesion.cuentaId);
  });
}
