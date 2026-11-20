import type { FastifyInstance } from 'fastify';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { query, queryOne } from '../db/pool.js';
import { noEncontrado, peticionInvalida } from '../lib/errores.js';
import {
  guardarApp, urlAutorizacion, manejarCallback, cuentaDeState, redirectUri, conectarConToken,
} from '../modules/instagram_oauth.js';
import {
  ejecutarFlujo, normalizarPasos, validarFlujo, validarFlujoDetallado, procesarEsperasVencidas,
} from '../modules/instagram_dm.js';
import { parsearWebhookInstagram, procesarEventoInstagram } from '../modules/instagram_eventos.js';
import { integracionInstagram } from '../modules/instagram.js';

const DISPAROS = ['comentario', 'dm', 'historia', 'mencion', 'reaccion', 'boton', 'anuncio'] as const;
const PASO = z.object({ tipo: z.string() }).passthrough();
const esquemaFlujo = z.object({
  nombre: z.string().min(1),
  descripcion: z.string().optional(),
  disparo: z.enum(DISPAROS).default('comentario'),
  palabra_clave: z.string().nullable().optional(),
  contenido_id: z.string().uuid().nullable().optional(),
  pasos: z.array(PASO).default([]),
  activo: z.boolean().optional(),
});

/** Token que se pega en Meta al suscribir el webhook (estable por instalación). */
export function verifyTokenMeta(): string {
  return process.env.META_VERIFY_TOKEN
    || createHash('sha256').update(`${config.jwtSecret}:ig-verify`).digest('hex').slice(0, 24);
}

/** Verifica X-Hub-Signature-256 (HMAC-SHA256 del cuerpo con el App Secret). */
function firmaValida(crudo: string, firma: string, secreto: string): boolean {
  if (!firma.startsWith('sha256=')) return false;
  const esperada = Buffer.from(`sha256=${createHmac('sha256', secreto).update(crudo, 'utf8').digest('hex')}`);
  const recibida = Buffer.from(firma);
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

/**
 * Normaliza el árbol y lo revisa. Si algo falta, el flujo se guarda igual
 * (no se pierde trabajo) pero EN PAUSA, para que nunca corra roto.
 */
function prepararFlujo<T extends { pasos?: any[]; activo?: boolean }>(d: T) {
  if (!d.pasos) return { datos: d, avisos: [] as string[], marcados: [] as string[] };
  const pasos = normalizarPasos(d.pasos);
  const problemas = validarFlujoDetallado(pasos);
  const avisos = problemas.map((p) => p.texto);
  const marcados = [...new Set(problemas.map((p) => p.nodo).filter((x): x is string => !!x))];
  const datos = { ...d, pasos, ...(avisos.length && d.activo !== false ? { activo: false } : {}) };
  return { datos, avisos, marcados };
}

export default async function rutasInstagram(app: FastifyInstance) {
  // ---------------- OAuth: conectar Instagram ----------------

  app.put('/api/instagram/app', async (req) => {
    const d = z.object({
      app_id: z.string().min(1),
      app_secret: z.string().min(1),
      config_id: z.string().optional(),
      ig_user_id: z.string().optional(),
    }).parse(req.body);
    await guardarApp(
      req.sesion.cuentaId, d.app_id, d.app_secret,
      d.config_id?.trim() || undefined, d.ig_user_id?.trim() || undefined);
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
      ig_user_id: cfg.ig_user_id ?? null,
      flujo: cfg.config_id ? 'facebook' : 'instagram',
      conectado,
      username: cred.username ?? null,
      token_expira_en: cred.token_expira_en ?? null,
      // Para recibir DMs/comentarios en vivo: se pegan en Meta → Webhooks.
      webhook_url: `${config.apiUrl}/webhooks/instagram`,
      webhook_verify_token: verifyTokenMeta(),
      redirect_uri: redirectUri(),
      ultimo_error: integ?.ultimo_error ?? null,
    };
  });

  // Conexión directa con token a mano (SUAT) + IG id — sin OAuth.
  app.post('/api/instagram/conectar-token', async (req) => {
    const d = z.object({
      access_token: z.string().min(10),
      ig_user_id: z.string().min(5),
    }).parse(req.body);
    const r = await conectarConToken(req.sesion.cuentaId, d.access_token.trim(), d.ig_user_id.trim());
    if (!r.ok) throw peticionInvalida(r.mensaje);
    return r;
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

  // Siempre en formato pizarra (los flujos viejos en árbol se convierten al vuelo).
  app.get('/api/flujos', async (req) => {
    const filas = await query(
      `SELECT f.*, c.titulo AS contenido_titulo,
              (SELECT COUNT(*) FROM flujo_ejecuciones e WHERE e.flujo_id=f.id AND e.estado <> 'simulado')::int AS ejecuciones
         FROM flujos f LEFT JOIN contenidos c ON c.id=f.contenido_id
        WHERE f.cuenta_id=$1 ORDER BY f.creado_en DESC`, [req.sesion.cuentaId]);
    return filas.map((f: any) => ({ ...f, pasos: normalizarPasos(f.pasos ?? []) }));
  });

  app.post('/api/flujos', async (req, reply) => {
    const { datos: d, avisos, marcados } = prepararFlujo(esquemaFlujo.parse(req.body));
    const fila = await queryOne(
      `INSERT INTO flujos (cuenta_id, nombre, descripcion, disparo, palabra_clave, contenido_id, pasos, activo)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING *`,
      [req.sesion.cuentaId, d.nombre, d.descripcion ?? null, d.disparo, d.palabra_clave ?? null,
       d.contenido_id ?? null, JSON.stringify(d.pasos), d.activo ?? true]);
    return reply.code(201).send({ ...fila, avisos, marcados });
  });

  app.patch('/api/flujos/:id', async (req) => {
    const { id } = req.params as { id: string };
    let d: any = esquemaFlujo.partial().parse(req.body);
    let avisos: string[] = [];
    let marcados: string[] = [];
    if (d.pasos) {
      ({ datos: d, avisos, marcados } = prepararFlujo(d));
    } else if (d.activo === true) {
      // Activar un flujo guardado con problemas: se revisa antes.
      const actual = await queryOne(`SELECT pasos FROM flujos WHERE cuenta_id=$1 AND id=$2`, [req.sesion.cuentaId, id]);
      avisos = validarFlujo(normalizarPasos(actual?.pasos ?? []));
      if (avisos.length) d = { ...d, activo: false };
    }
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
    return { ...fila, avisos, marcados };
  });

  /** Duplicar un flujo (queda en pausa para editarlo tranquilo). */
  app.post('/api/flujos/:id/duplicar', async (req, reply) => {
    const { id } = req.params as { id: string };
    const fila = await queryOne(
      `INSERT INTO flujos (cuenta_id, nombre, descripcion, disparo, palabra_clave, contenido_id, pasos, activo)
       SELECT cuenta_id, nombre || ' (copia)', descripcion, disparo, palabra_clave, contenido_id, pasos, false
         FROM flujos WHERE cuenta_id=$1 AND id=$2 RETURNING *`, [req.sesion.cuentaId, id]);
    if (!fila) throw noEncontrado('Flujo');
    return reply.code(201).send(fila);
  });

  app.delete('/api/flujos/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await queryOne(`DELETE FROM flujos WHERE cuenta_id=$1 AND id=$2 RETURNING id`,
      [req.sesion.cuentaId, id]);
    return reply.code(204).send();
  });

  /**
   * Prueba en seco: recorre el flujo entero sin mandar nada ni tocar la
   * base. `respuestas` elige la rama de cada pregunta/condición.
   */
  app.post('/api/flujos/:id/simular', async (req) => {
    const { id } = req.params as { id: string };
    const d = z.object({
      respuestas: z.record(z.string()).optional(),
      texto: z.string().optional(),
    }).parse(req.body ?? {});
    const r = await ejecutarFlujo(req.sesion.cuentaId, id, {
      simular: true, respuestas: d.respuestas, texto: d.texto,
    });
    if (!r) throw noEncontrado('Flujo');
    return r;
  });

  /**
   * Prueba EN VIVO con un lead: simula que el lead comenta / escribe / toca
   * un botón. Todo pasa de verdad en el CRM (Chat, etiquetas, pausas y
   * reanudaciones) pero no se llama a Instagram.
   */
  app.post('/api/instagram/simular-evento', async (req) => {
    const d = z.object({
      lead_id: z.string().uuid(),
      tipo: z.enum(['comentario', 'dm', 'historia', 'mencion', 'reaccion', 'boton', 'anuncio']).default('dm'),
      texto: z.string().max(1000).optional(),
      payload: z.string().optional(),
    }).parse(req.body);
    const r = await procesarEventoInstagram(req.sesion.cuentaId, {
      tipo: d.tipo, leadId: d.lead_id, texto: d.texto, payload: d.payload,
      emoji: d.tipo === 'reaccion' ? (d.texto || '❤️') : undefined,
      sinInstagram: true,
    });
    if (!r) throw noEncontrado('Lead');
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

    // Comentarios, DMs, respuestas a historias, menciones, reacciones,
    // botones, anuncios y los mensajes que la cuenta manda desde el celular.
    const eventos = parsearWebhookInstagram(req.body ?? {});
    let procesados = 0;
    for (const ev of eventos) {
      const r = await procesarEventoInstagram(ep.cuenta_id, ev).catch((err) => {
        req.log.error({ err }, 'evento de Instagram');
        return null;
      });
      if (r) procesados++;
    }
    // Aprovecha la visita para reanudar las esperas por tiempo vencidas.
    await procesarEsperasVencidas(ep.cuenta_id, 5).catch(() => 0);
    return reply.send({ ok: true, eventos: eventos.length, procesados });
  });

  // ---------------- Webhook ÚNICO de la app de Meta ----------------
  // Meta configura UNA url por app para todas las cuentas. Se enruta a la
  // cuenta del CRM por el id de la cuenta de Instagram (entry.id) y se
  // verifica la firma X-Hub-Signature-256 con el App Secret.

  app.get('/webhooks/instagram', async (req, reply) => {
    const q = req.query as Record<string, string>;
    if (q['hub.mode'] === 'subscribe' && q['hub.challenge'] && q['hub.verify_token'] === verifyTokenMeta()) {
      return reply.type('text/plain').send(q['hub.challenge']);
    }
    return reply.code(403).send({ error: 'verify_token incorrecto' });
  });

  app.post('/webhooks/instagram', async (req, reply) => {
    const body: any = req.body ?? {};
    const firma = String(req.headers['x-hub-signature-256'] ?? '');
    const crudo: string = (req as any).rawBody ?? JSON.stringify(body);
    let procesados = 0;
    for (const entry of body.entry ?? []) {
      const igId = entry?.id ? String(entry.id) : '';
      if (!igId) continue;
      const integ = await queryOne(
        `SELECT cuenta_id, config FROM integraciones
          WHERE tipo = 'instagram' AND activo
            AND (credenciales->>'ig_user_id' = $1 OR config->>'ig_user_id' = $1
                 OR credenciales->>'ig_account_id' = $1)
          ORDER BY creado_en ASC LIMIT 1`, [igId]);
      if (!integ) continue; // cuenta de Instagram que no está en el CRM
      const secreto = integ.config?.app_secret || process.env.META_APP_SECRET;
      if (secreto && !firmaValida(crudo, firma, secreto)) {
        req.log.warn({ igId }, 'webhook de Instagram con firma inválida: ignorado');
        continue;
      }
      for (const ev of parsearWebhookInstagram({ entry: [entry] })) {
        const r = await procesarEventoInstagram(integ.cuenta_id, ev).catch((err) => {
          req.log.error({ err }, 'evento de Instagram');
          return null;
        });
        if (r) procesados++;
      }
      await procesarEsperasVencidas(integ.cuenta_id, 5).catch(() => 0);
    }
    // Siempre 200: si no, Meta reintenta y termina desactivando el webhook.
    return reply.send({ ok: true, procesados });
  });

  // Reloj de los flujos: reanuda las esperas por tiempo vencidas de todas
  // las cuentas. Lo llama el cron de Vercel (y se puede llamar a mano).
  app.get('/webhooks/cron/flujos', async (req, reply) => {
    const secreto = process.env.CRON_SECRET;
    if (secreto && req.headers.authorization !== `Bearer ${secreto}`) {
      return reply.code(401).send({ error: 'no_autorizado' });
    }
    const reanudadas = await procesarEsperasVencidas(undefined, 50);
    return { ok: true, reanudadas };
  });
}
