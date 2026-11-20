import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { query, queryOne } from '../db/pool.js';
import { generarTokenWebhook } from '../lib/auth.js';

// Rutas de la pantalla de Integraciones (montadas en /api/ux/integraciones).
// Sirven para la "prueba en vivo": el usuario toca Probar, hace una acción
// concreta (mandar un DM, disparar ManyChat, preguntarle algo a Claude) y la
// pantalla consulta acá cada pocos segundos si llegó algo desde ese momento.

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

const conUrl = (e: any) => (e ? { ...e, url: `${config.apiUrl}/webhooks/${e.token}`, token: undefined } : e);

export default async function rutasUx_integraciones(app: FastifyInstance) {
  /** Resumen de estado para las tarjetas (una sola llamada). */
  app.get('/resumen', async (req) => {
    const c = req.sesion.cuentaId;
    const [dm, endpoints, salientes, claves] = await Promise.all([
      queryOne(
        `SELECT max(m.ocurrido_en) AS ultimo_dm_en, COUNT(*)::int AS dms_7d
           FROM mensajes m
          WHERE m.cuenta_id = $1 AND m.direccion = 'entrante' AND m.canal = 'instagram_dm'
            AND m.ocurrido_en > now() - interval '7 days'`, [c]),
      query(
        `SELECT e.id, e.nombre, e.slug, e.fuente, e.evento_defecto, e.total_recibidos, e.total_errores, e.ultimo_evento_en, e.activo, e.token
           FROM webhook_endpoints e WHERE e.cuenta_id = $1 ORDER BY e.creado_en ASC`, [c]),
      queryOne(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE activo)::int AS activos,
                       COALESCE(SUM(total_fallos), 0)::int AS fallos, max(ultimo_envio_en) AS ultimo_envio_en
                  FROM suscripciones_webhook WHERE cuenta_id = $1`, [c]),
      queryOne(`SELECT COUNT(*)::int AS n, max(ultimo_uso_en) AS ultimo_uso_en FROM api_keys WHERE cuenta_id = $1 AND revocado_en IS NULL`, [c]),
    ]);
    // api_url: base pública para armar la URL del conector de Claude (/mcp/<clave>).
    return { instagram: dm, endpoints: endpoints.map(conUrl), salientes, claves, api_url: config.apiUrl };
  });

  /**
   * Devuelve el endpoint de un tipo de integración (ManyChat, agenda, Stripe…)
   * y lo crea si todavía no existe. Idempotente: tocar dos veces no duplica.
   */
  app.post('/fuente', async (req) => {
    const { tipo } = z.object({ tipo: z.enum(Object.keys(FUENTES) as [TipoFuente, ...TipoFuente[]]) }).parse(req.body);
    const f = FUENTES[tipo];
    const c = req.sesion.cuentaId;
    await query(
      `INSERT INTO webhook_endpoints (cuenta_id, nombre, slug, token, fuente, evento_defecto, mapeo)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       ON CONFLICT (cuenta_id, slug) DO NOTHING`,
      [c, f.nombre, f.slug, generarTokenWebhook(), f.fuente, f.evento_defecto, JSON.stringify(f.mapeo)]);
    const e = await queryOne(
      `SELECT id, nombre, slug, fuente, evento_defecto, total_recibidos, total_errores, ultimo_evento_en, activo, token
         FROM webhook_endpoints WHERE cuenta_id = $1 AND slug = $2`, [c, f.slug]);
    return conUrl(e);
  });

  /** ¿Llegó algo desde `desde`? (DMs de Instagram, webhooks de otras apps o uso de una llave) */
  app.get('/actividad', async (req) => {
    const q = z.object({
      desde: z.string().datetime(),
      endpoint_id: z.string().uuid().optional(),
      clave_id: z.string().uuid().optional(),
    }).parse(req.query);
    const c = req.sesion.cuentaId;
    const [dm, webhook, clave] = await Promise.all([
      queryOne(
        `SELECT m.cuerpo AS texto, m.ocurrido_en AS en, l.ig_username AS de, l.nombre
           FROM mensajes m JOIN leads l ON l.id = m.lead_id
          WHERE m.cuenta_id = $1 AND m.direccion = 'entrante' AND m.canal = 'instagram_dm' AND m.creado_en >= $2
          ORDER BY m.creado_en DESC LIMIT 1`, [c, q.desde]),
      queryOne(
        `SELECT w.id, w.estado, w.error, w.recibido_en AS en, l.ig_username AS de, l.nombre, e.nombre AS endpoint
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
      `SELECT w.id, w.estado, w.error, w.recibido_en AS en, l.ig_username AS de, l.nombre, e.nombre AS endpoint
         FROM webhook_eventos w
         LEFT JOIN leads l ON l.id = w.lead_id
         LEFT JOIN webhook_endpoints e ON e.id = w.endpoint_id
        WHERE w.cuenta_id = $1 AND ($2::uuid IS NULL OR w.endpoint_id = $2::uuid)
        ORDER BY w.recibido_en DESC LIMIT $3`, [req.sesion.cuentaId, q.endpoint_id ?? null, q.limite]);
  });
}
