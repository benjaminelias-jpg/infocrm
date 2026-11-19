import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { query, queryOne } from '../db/pool.js';
import { noEncontrado, peticionInvalida } from '../lib/errores.js';
import {
  guardarApp, urlAutorizacion, manejarCallback, cuentaDeState, redirectUri,
} from '../modules/instagram_oauth.js';
import { ejecutarFlujo, procesarComentarioInstagram } from '../modules/instagram_dm.js';
import { integracionInstagram } from '../modules/instagram.js';

const PASO = z.object({ tipo: z.string() }).passthrough();
const esquemaFlujo = z.object({
  nombre: z.string().min(1),
  descripcion: z.string().optional(),
  disparo: z.enum(['comentario', 'dm', 'historia', 'mencion']).default('comentario'),
  palabra_clave: z.string().nullable().optional(),
  contenido_id: z.string().uuid().nullable().optional(),
  pasos: z.array(PASO).default([]),
  activo: z.boolean().optional(),
});

export default async function rutasInstagram(app: FastifyInstance) {
  // ---------------- OAuth: conectar Instagram ----------------

  app.put('/api/instagram/app', async (req) => {
    const d = z.object({
      app_id: z.string().min(1),
      app_secret: z.string().min(1),
      config_id: z.string().optional(),
    }).parse(req.body);
    await guardarApp(req.sesion.cuentaId, d.app_id, d.app_secret, d.config_id?.trim() || undefined);
    return { ok: true, redirect_uri: redirectUri() };
  });

  app.get('/api/instagram/estado', async (req) => {
    const integ = await integracionInstagram(req.sesion.cuentaId);
    const cfg = integ?.config ?? {};
    const cred = integ?.credenciales ?? {};
    const conectado = integ?.estado === 'conectado'
      && Boolean(cred.access_token || cred.page_token || cred.user_token);
    return {
      tiene_app: Boolean(cfg.app_id),
      app_id: cfg.app_id ?? null,
      config_id: cfg.config_id ?? null,
      flujo: cfg.config_id ? 'facebook' : 'instagram',
      conectado,
      username: cred.username ?? null,
      redirect_uri: redirectUri(),
      ultimo_error: integ?.ultimo_error ?? null,
    };
  });

  app.get('/api/instagram/oauth/start', async (req, reply) => {
    const r = await urlAutorizacion(req.sesion.cuentaId);
    if ('error' in r) throw peticionInvalida(r.error);
    return r; // { url }
  });

  // Callback PÚBLICO (Meta llama sin sesión; la cuenta viaja firmada en state)
  app.get('/instagram/callback', async (req, reply) => {
    const q = req.query as Record<string, string>;
    if (q.error) {
      return reply.redirect(`${config.appUrl}/conexiones?instagram=denegado`);
    }
    const cuentaId = q.state ? cuentaDeState(q.state) : null;
    if (!cuentaId || !q.code) {
      return reply.redirect(`${config.appUrl}/conexiones?instagram=error`);
    }
    const r = await manejarCallback(cuentaId, q.code);
    return reply.redirect(
      `${config.appUrl}/conexiones?instagram=${r.ok ? 'ok' : 'error'}${r.username ? `&ig=${encodeURIComponent(r.username)}` : ''}`);
  });

  // Meta exige estas dos URLs en "Business login settings" para poder guardar.
  // Desautorización: Meta hace POST (signed_request) cuando alguien quita la app.
  app.post('/instagram/deauthorize', async (req, reply) => reply.send({ ok: true }));
  app.get('/instagram/deauthorize', async (req, reply) => reply.send({ ok: true }));
  // Borrado de datos: debe responder JSON con url + código de confirmación.
  const borrado = async (_req: any, reply: any) => {
    const code = Math.random().toString(36).slice(2, 12);
    return reply.send({ url: `${config.appUrl}/conexiones?borrado=${code}`, confirmation_code: code });
  };
  app.post('/instagram/data-deletion', borrado);
  app.get('/instagram/data-deletion', borrado);

  // ---------------- Flujos (ManyChat propio) ----------------

  app.get('/api/flujos', async (req) =>
    query(
      `SELECT f.*, c.titulo AS contenido_titulo,
              (SELECT COUNT(*) FROM flujo_ejecuciones e WHERE e.flujo_id=f.id AND e.estado <> 'simulado')::int AS ejecuciones
         FROM flujos f LEFT JOIN contenidos c ON c.id=f.contenido_id
        WHERE f.cuenta_id=$1 ORDER BY f.creado_en DESC`, [req.sesion.cuentaId]));

  app.post('/api/flujos', async (req, reply) => {
    const d = esquemaFlujo.parse(req.body);
    const fila = await queryOne(
      `INSERT INTO flujos (cuenta_id, nombre, descripcion, disparo, palabra_clave, contenido_id, pasos, activo)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING *`,
      [req.sesion.cuentaId, d.nombre, d.descripcion ?? null, d.disparo, d.palabra_clave ?? null,
       d.contenido_id ?? null, JSON.stringify(d.pasos), d.activo ?? true]);
    return reply.code(201).send(fila);
  });

  app.patch('/api/flujos/:id', async (req) => {
    const { id } = req.params as { id: string };
    const d = esquemaFlujo.partial().parse(req.body);
    const campos = Object.keys(d);
    if (campos.length === 0) throw peticionInvalida('Nada que actualizar');
    const params: any[] = [req.sesion.cuentaId, id];
    const sets = campos.map((c) => {
      const v = (d as any)[c];
      params.push(c === 'pasos' ? JSON.stringify(v) : v);
      return c === 'pasos' ? `pasos=$${params.length}::jsonb` : `${c}=$${params.length}`;
    });
    const fila = await queryOne(
      `UPDATE flujos SET ${sets.join(', ')} WHERE cuenta_id=$1 AND id=$2 RETURNING *`, params);
    if (!fila) throw noEncontrado('Flujo');
    return fila;
  });

  app.delete('/api/flujos/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await queryOne(`DELETE FROM flujos WHERE cuenta_id=$1 AND id=$2 RETURNING id`,
      [req.sesion.cuentaId, id]);
    return reply.code(204).send();
  });

  /** Probar el flujo en modo simulación (sin enviar DMs reales). */
  app.post('/api/flujos/:id/simular', async (req) => {
    const { id } = req.params as { id: string };
    const r = await ejecutarFlujo(req.sesion.cuentaId, id, { simular: true });
    if (!r) throw noEncontrado('Flujo');
    return r;
  });

  app.get('/api/flujos/:id/ejecuciones', async (req) => {
    const { id } = req.params as { id: string };
    return query(
      `SELECT * FROM flujo_ejecuciones WHERE cuenta_id=$1 AND flujo_id=$2
        ORDER BY ejecutado_en DESC LIMIT 50`, [req.sesion.cuentaId, id]);
  });

  // ---------------- Webhook de Instagram (comentarios/DMs) ----------------
  // Público. GET = verificación de Meta (hub.challenge). POST = eventos.

  app.get('/webhooks/instagram/:token', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const ep = await queryOne(
      `SELECT cuenta_id FROM webhook_endpoints WHERE token=$1 AND fuente='instagram'`,
      [(req.params as any).token]);
    // Verificación de suscripción de Meta
    if (q['hub.mode'] === 'subscribe' && q['hub.challenge']) {
      if (ep || q['hub.verify_token']) return reply.send(q['hub.challenge']);
    }
    return reply.code(ep ? 200 : 404).send(ep ? { ok: true } : { error: 'desconocido' });
  });

  app.post('/webhooks/instagram/:token', async (req, reply) => {
    const ep = await queryOne(
      `SELECT cuenta_id FROM webhook_endpoints WHERE token=$1 AND fuente='instagram'`,
      [(req.params as any).token]);
    if (!ep) return reply.code(404).send({ error: 'desconocido' });

    // Estructura típica de Meta: entry[].changes[] (comentarios) o entry[].messaging[]
    const body: any = req.body ?? {};
    const procesados: any[] = [];
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field === 'comments') {
          const v = change.value ?? {};
          const r = await procesarComentarioInstagram(ep.cuenta_id, {
            palabra: v.text,
            igUserId: v.from?.id,
            username: v.from?.username,
            mediaId: v.media?.id,
          }).catch(() => null);
          if (r) procesados.push(r);
        }
      }
    }
    return reply.send({ ok: true, procesados: procesados.length });
  });
}
