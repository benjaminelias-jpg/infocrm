import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { query, queryOne } from '../db/pool.js';
import { noEncontrado, peticionInvalida } from '../lib/errores.js';
import { generarTokenWebhook } from '../lib/auth.js';
import { randomBytes } from 'node:crypto';
import {
  recibirWebhook, endpointPorToken, reprocesarWebhook, reprocesarErrores, normalizarPayload,
  verificarFirmaWebhook, registrarRechazo,
} from '../modules/ingesta.js';
import { reintentarEntrega, probarSuscripcion } from '../modules/webhooks_salida.js';

/** Lo que se muestra de una dirección: nunca el secreto de firma. */
function publico(e: any) {
  if (!e) return e;
  const { secreto_firma, ...resto } = e;
  return { ...resto, verificada: Boolean(secreto_firma), url: `${config.apiUrl}/webhooks/${e.token}` };
}

export default async function rutasWebhooks(app: FastifyInstance) {
  // =================== ENTRADA PÚBLICA ===================
  // El token secreto va en la URL: esta es la URL que se pega en ManyChat.

  /** Ping de verificación: ManyChat y Calendly hacen un GET al configurar. */
  app.get('/webhooks/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const endpoint = await endpointPorToken(token);
    if (!endpoint) return reply.code(404).send({ error: 'webhook_desconocido' });

    // Meta/Facebook exige devolver hub.challenge tal cual
    const q = req.query as Record<string, string>;
    if (q['hub.challenge']) return reply.send(q['hub.challenge']);

    return {
      ok: true,
      endpoint: endpoint.nombre,
      fuente: endpoint.fuente,
      evento_por_defecto: endpoint.evento_defecto,
      mensaje: 'Webhook activo. Manda un POST con los datos del lead.',
    };
  });

  app.post('/webhooks/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const endpoint = await endpointPorToken(token);
    if (!endpoint) return reply.code(404).send({ error: 'webhook_desconocido' });
    const cabeceras = { 'user-agent': req.headers['user-agent'], 'content-type': req.headers['content-type'] };

    // Stripe / Calendly conectados pegando una clave: el aviso viene firmado
    // con el secreto que guardamos al conectar. Si la firma no coincide, se
    // guarda para verlo en el historial pero NO se procesa (nada de ventas
    // falsas). Las direcciones sin secreto siguen como siempre.
    if (endpoint.secreto_firma) {
      const crudo: string = (req as any).rawBody ?? JSON.stringify(req.body ?? {});
      const v = verificarFirmaWebhook(endpoint.fuente, endpoint.secreto_firma, crudo, req.headers as Record<string, unknown>);
      if (!v.ok) {
        const r = await registrarRechazo(endpoint, req.body ?? {}, cabeceras, req.ip, 'firma_invalida', v.motivo ?? 'Firma inválida.');
        return reply.code(400).send({ ...r, error: 'firma_invalida', mensaje: v.motivo });
      }
    }

    const resultado = await recibirWebhook(endpoint, req.body ?? {}, cabeceras, req.ip);

    // Siempre 200/202: si devolviéramos error, ManyChat reintentaría en bucle
    // y el payload ya está guardado para poder reprocesarlo desde el panel.
    return reply.code(resultado.estado === 'procesado' ? 200 : 202).send(resultado);
  });

  // =================== ADMINISTRACIÓN ===================

  app.get('/api/webhooks/endpoints', async (req) => {
    const filas = await query(
      `SELECT * FROM webhook_endpoints WHERE cuenta_id = $1 ORDER BY creado_en ASC`,
      [req.sesion.cuentaId],
    );
    return filas.map(publico);
  });

  /**
   * Cambiar la dirección (si se filtró): nuevo token, la vieja deja de
   * funcionar al instante. Las que maneja una conexión por clave (Stripe,
   * Calendly) no se cambian acá: hay que desconectar y volver a conectar.
   */
  app.post('/api/webhooks/endpoints/:id/rotar', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const c = req.sesion.cuentaId;
    const e = await queryOne(`SELECT * FROM webhook_endpoints WHERE cuenta_id = $1 AND id = $2`, [c, id]);
    if (!e) throw noEncontrado('Dirección');
    if (e.secreto_firma) {
      throw peticionInvalida('Esta dirección la maneja tu conexión con Stripe o Calendly: desconectala y volvé a conectarla para cambiarla.');
    }
    const fila = await queryOne(
      `UPDATE webhook_endpoints SET token = $3 WHERE cuenta_id = $1 AND id = $2 RETURNING *`,
      [c, id, generarTokenWebhook()]);
    return publico(fila);
  });

  app.post('/api/webhooks/endpoints', async (req, reply) => {
    const d = z.object({
      nombre: z.string().min(1),
      slug: z.string().min(1),
      fuente: z.enum(['manychat', 'calendly', 'stripe', 'hotmart', 'instagram', 'generico']),
      evento_defecto: z.string().default('lead_creado'),
      mapeo: z.record(z.any()).optional(),
    }).parse(req.body);

    const fila = await queryOne(
      `INSERT INTO webhook_endpoints (cuenta_id, nombre, slug, token, fuente, evento_defecto, mapeo)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *`,
      [req.sesion.cuentaId, d.nombre, d.slug, generarTokenWebhook(), d.fuente,
       d.evento_defecto, JSON.stringify(d.mapeo ?? {})],
    );
    return reply.code(201).send(publico(fila));
  });

  app.patch('/api/webhooks/endpoints/:id', async (req) => {
    const { id } = req.params as { id: string };
    const d = z.object({
      nombre: z.string().optional(),
      evento_defecto: z.string().optional(),
      mapeo: z.record(z.any()).optional(),
      activo: z.boolean().optional(),
    }).parse(req.body);

    const params: any[] = [req.sesion.cuentaId, id];
    const sets = Object.keys(d).map((c) => {
      const v = (d as any)[c];
      params.push(c === 'mapeo' ? JSON.stringify(v) : v);
      return c === 'mapeo' ? `mapeo = $${params.length}::jsonb` : `${c} = $${params.length}`;
    });
    if (sets.length === 0) throw noEncontrado('Nada que actualizar');

    const fila = await queryOne(
      `UPDATE webhook_endpoints SET ${sets.join(', ')} WHERE cuenta_id = $1 AND id = $2 RETURNING *`,
      params);
    if (!fila) throw noEncontrado('Endpoint');
    return publico(fila);
  });

  /** Bandeja de entrada cruda: todo lo que ha llegado, procesado o no. */
  app.get('/api/webhooks/eventos', async (req) => {
    const q = req.query as Record<string, string>;
    const endpointId = q.endpoint_id && /^[0-9a-f-]{36}$/i.test(q.endpoint_id) ? q.endpoint_id : null;
    return query(
      `SELECT w.id, w.estado, w.error, w.codigo_error, w.fuente, w.recibido_en, w.procesado_en, w.intentos,
              w.payload, w.lead_id, w.evento_id, w.endpoint_id,
              e.nombre AS endpoint_nombre,
              l.ig_username, l.nombre AS lead_nombre, l.avatar_url
         FROM webhook_eventos w
         LEFT JOIN webhook_endpoints e ON e.id = w.endpoint_id
         LEFT JOIN leads l ON l.id = w.lead_id
        WHERE w.cuenta_id = $1 AND ($2::text IS NULL OR w.estado = $2)
          AND ($4::uuid IS NULL OR w.endpoint_id = $4::uuid)
        ORDER BY w.recibido_en DESC
        LIMIT $3`,
      [req.sesion.cuentaId, q.estado || null, Math.min(Number(q.limite ?? 100), 500), endpointId],
    );
  });

  app.post('/api/webhooks/eventos/:id/reprocesar', async (req) => {
    const { id } = req.params as { id: string };
    const res = await reprocesarWebhook(req.sesion.cuentaId, Number(id));
    if (!res) throw noEncontrado('Evento de webhook');
    return res;
  });

  app.post('/api/webhooks/reprocesar-errores', async (req) =>
    reprocesarErrores(req.sesion.cuentaId));

  // =================== SALIDA (conectar con otras apps) ===================

  app.get('/api/webhooks/salida', async (req) =>
    query(
      `SELECT id, nombre, url, eventos, activo, total_enviados, total_fallos,
              ultimo_envio_en, ultimo_error, creado_en
         FROM suscripciones_webhook WHERE cuenta_id = $1 ORDER BY creado_en DESC`,
      [req.sesion.cuentaId]));

  app.post('/api/webhooks/salida', async (req, reply) => {
    const d = z.object({
      nombre: z.string().min(1),
      url: z.string().url(),
      eventos: z.array(z.string()).default(['*']),
      cabeceras: z.record(z.string()).optional(),
    }).parse(req.body);

    const fila = await queryOne(
      `INSERT INTO suscripciones_webhook (cuenta_id, nombre, url, eventos, secreto, cabeceras)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING *`,
      [req.sesion.cuentaId, d.nombre, d.url, d.eventos.length ? d.eventos : ['*'],
       `whsec_${randomBytes(24).toString('hex')}`, JSON.stringify(d.cabeceras ?? {})]);
    return reply.code(201).send(fila);
  });

  app.patch('/api/webhooks/salida/:id', async (req) => {
    const { id } = req.params as { id: string };
    const d = z.object({
      nombre: z.string().optional(),
      url: z.string().url().optional(),
      eventos: z.array(z.string()).optional(),
      cabeceras: z.record(z.string()).optional(),
      activo: z.boolean().optional(),
    }).parse(req.body);
    const params: any[] = [req.sesion.cuentaId, id];
    const sets = Object.keys(d).map((c) => {
      const v = (d as any)[c];
      params.push(c === 'cabeceras' ? JSON.stringify(v) : v);
      return c === 'cabeceras' ? `cabeceras = $${params.length}::jsonb` : `${c} = $${params.length}`;
    });
    if (sets.length === 0) throw noEncontrado('Nada que actualizar');
    const fila = await queryOne(
      `UPDATE suscripciones_webhook SET ${sets.join(', ')} WHERE cuenta_id = $1 AND id = $2 RETURNING *`,
      params);
    if (!fila) throw noEncontrado('Suscripción');
    return fila;
  });

  app.delete('/api/webhooks/salida/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await queryOne(`DELETE FROM suscripciones_webhook WHERE cuenta_id = $1 AND id = $2 RETURNING id`,
      [req.sesion.cuentaId, id]);
    return reply.code(204).send();
  });

  /** Muestra el secreto de firma una vez (para configurarlo en la otra app). */
  app.get('/api/webhooks/salida/:id/secreto', async (req) => {
    const { id } = req.params as { id: string };
    const fila = await queryOne(
      `SELECT secreto FROM suscripciones_webhook WHERE cuenta_id = $1 AND id = $2`,
      [req.sesion.cuentaId, id]);
    if (!fila) throw noEncontrado('Suscripción');
    return { secreto: fila.secreto };
  });

  app.post('/api/webhooks/salida/:id/probar', async (req) => {
    const { id } = req.params as { id: string };
    const r = await probarSuscripcion(req.sesion.cuentaId, id);
    if (!r) throw noEncontrado('Suscripción');
    return r;
  });

  app.get('/api/webhooks/salida/entregas', async (req) => {
    const q = req.query as Record<string, string>;
    const subId = q.suscripcion_id && /^[0-9a-f-]{36}$/i.test(q.suscripcion_id) ? q.suscripcion_id : null;
    return query(
      `SELECT e.id, e.tipo_evento, e.url, e.estado, e.intentos, e.http_status, e.error,
              e.creado_en, e.entregado_en, e.suscripcion_id, s.nombre AS suscripcion
         FROM entregas_webhook e
         JOIN suscripciones_webhook s ON s.id = e.suscripcion_id
        WHERE e.cuenta_id = $1 AND ($2::text IS NULL OR e.estado = $2)
          AND ($4::uuid IS NULL OR e.suscripcion_id = $4::uuid)
        ORDER BY e.creado_en DESC LIMIT $3`,
      [req.sesion.cuentaId, q.estado || null, Math.min(Number(q.limite ?? 100), 500), subId]);
  });

  app.post('/api/webhooks/salida/entregas/:id/reintentar', async (req) => {
    const { id } = req.params as { id: string };
    const r = await reintentarEntrega(req.sesion.cuentaId, Number(id));
    if (!r) throw noEncontrado('Entrega');
    // El reintento queda como una entrega NUEVA: se devuelve esa (la última de
    // esa conexión), así la pantalla sabe si esta vez llegó.
    const ultima = await queryOne(
      `SELECT * FROM entregas_webhook WHERE cuenta_id = $1 AND suscripcion_id = $2 ORDER BY creado_en DESC, id DESC LIMIT 1`,
      [req.sesion.cuentaId, r.suscripcion_id]);
    return ultima ?? r;
  });

  /**
   * Probador: enseña cómo se leería un payload SIN guardar nada.
   * Sirve para configurar el webhook de ManyChat sin ensuciar los datos.
   */
  app.post('/api/webhooks/probar', async (req) => {
    const d = z.object({
      fuente: z.string().default('manychat'),
      evento_defecto: z.string().default('lead_creado'),
      mapeo: z.record(z.any()).optional(),
      payload: z.record(z.any()),
    }).parse(req.body);

    const normalizado = normalizarPayload(
      { fuente: d.fuente, evento_defecto: d.evento_defecto, mapeo: d.mapeo },
      d.payload,
    );

    const identificado =
      normalizado.identidad.manychatSubscriberId || normalizado.identidad.igUserId ||
      normalizado.identidad.igUsername || normalizado.identidad.email;

    return {
      lo_que_entiendo: normalizado,
      lead_identificable: Boolean(identificado),
      aviso: identificado
        ? null
        : 'Con estos datos no se puede identificar al lead. Sumá el id de ManyChat, el @ de Instagram o el email.',
    };
  });
}
