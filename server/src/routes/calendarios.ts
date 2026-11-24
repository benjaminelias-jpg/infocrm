import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db/pool.js';
import { noEncontrado, peticionInvalida } from '../lib/errores.js';
import {
  ErrorAgenda, calendarioPorSlug, cancelarReserva, feedIcs, huecos, leerCalendly, reservar, slugDe, urlPublica,
  type Calendario,
} from '../modules/calendarios.js';
import { paginaAgenda } from './pagina_agenda.js';

const HORA = z.string().regex(/^\d{2}:\d{2}$/);
const esquema = z.object({
  nombre: z.string().min(1).max(120),
  descripcion: z.string().max(2000).nullable().optional(),
  duracion_min: z.number().int().min(5).max(480).optional(),
  intervalo_min: z.number().int().min(5).max(240).optional(),
  zona_horaria: z.string().min(1).max(60).optional(),
  horario: z.record(z.string().regex(/^[0-6]$/), z.array(z.tuple([HORA, HORA])).max(6)).optional(),
  antelacion_min: z.number().int().min(0).max(60 * 24 * 30).optional(),
  dias_max: z.number().int().min(1).max(730).optional(),
  fecha_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  buffer_antes: z.number().int().min(0).max(240).optional(),
  buffer_despues: z.number().int().min(0).max(240).optional(),
  max_por_dia: z.number().int().min(1).max(100).nullable().optional(),
  preguntas: z.array(z.object({ nombre: z.string().min(1).max(120), obligatoria: z.boolean().optional() })).max(10).optional(),
  color: z.string().max(20).optional(),
  ubicacion: z.string().max(300).nullable().optional(),
  ics_ocupado: z.string().url().max(1000).nullable().optional().or(z.literal('')),
  activo: z.boolean().optional(),
  origen: z.any().optional(),
});
const COLS = ['nombre', 'descripcion', 'duracion_min', 'intervalo_min', 'zona_horaria', 'horario', 'antelacion_min', 'dias_max', 'fecha_fin',
  'buffer_antes', 'buffer_despues', 'max_por_dia', 'preguntas', 'color', 'ubicacion', 'ics_ocupado', 'activo', 'origen'] as const;
const JSONB = new Set(['horario', 'preguntas', 'origen']);

const conUrls = (c: any) => c && ({ ...c, url: urlPublica(c.slug), feed_url: `${urlPublica('feed')}/${c.feed_token}.ics` });
const traducir = (e: unknown) => (e instanceof ErrorAgenda ? peticionInvalida(e.message) : e);

export default async function rutasCalendarios(app: FastifyInstance) {
  // ------------------------- con sesión -------------------------
  app.get('/api/calendarios', async (req) => {
    const lista = await query(
      `SELECT c.*, (SELECT COUNT(*) FROM reservas r WHERE r.calendario_id = c.id AND r.estado = 'confirmada' AND r.inicio > now())::int AS proximas
         FROM calendarios c WHERE c.cuenta_id = $1 ORDER BY c.creado_en`, [req.sesion.cuentaId]);
    return { calendarios: lista.map(conUrls) };
  });

  app.post('/api/calendarios', async (req, reply) => {
    const d = esquema.parse(req.body);
    const cols = COLS.filter((k) => (d as any)[k] !== undefined);
    const vals = cols.map((k) => (JSONB.has(k) ? JSON.stringify((d as any)[k]) : ((d as any)[k] === '' ? null : (d as any)[k])));
    const c = await queryOne(
      `INSERT INTO calendarios (cuenta_id, slug${cols.map((k) => `, ${k}`).join('')})
       VALUES ($1, $2${cols.map((_, i) => `, $${i + 3}`).join('')}) RETURNING *`,
      [req.sesion.cuentaId, slugDe(d.nombre), ...vals]);
    return reply.code(201).send(conUrls(c));
  });

  app.patch('/api/calendarios/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const d = esquema.partial().parse(req.body);
    const cols = COLS.filter((k) => (d as any)[k] !== undefined);
    if (!cols.length) throw peticionInvalida('Nada para cambiar.');
    const vals = cols.map((k) => (JSONB.has(k) ? JSON.stringify((d as any)[k]) : ((d as any)[k] === '' ? null : (d as any)[k])));
    const c = await queryOne(
      `UPDATE calendarios SET ${cols.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE cuenta_id = $1 AND id = $2 RETURNING *`,
      [req.sesion.cuentaId, id, ...vals]);
    if (!c) throw noEncontrado('calendario');
    return conUrls(c);
  });

  app.delete('/api/calendarios/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await query(`DELETE FROM calendarios WHERE cuenta_id = $1 AND id = $2`, [req.sesion.cuentaId, id]);
    return { ok: true };
  });

  app.get('/api/calendarios/:id/reservas', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rs = await query(
      `SELECT r.*, l.ig_username AS lead_ig FROM reservas r LEFT JOIN leads l ON l.id = r.lead_id
        WHERE r.cuenta_id = $1 AND r.calendario_id = $2 AND r.inicio > now() - interval '30 days' ORDER BY r.inicio`, [req.sesion.cuentaId, id]);
    return { reservas: rs };
  });

  /** Migrador: lee un link público de Calendly y devuelve el calendario listo para crear. */
  app.post('/api/calendarios/importar', async (req) => {
    const { url } = z.object({ url: z.string().min(8).max(500) }).parse(req.body);
    try { return await leerCalendly(url); } catch (e) { throw traducir(e); }
  });

  // ------------------------- público -------------------------
  app.get('/agendar/feed/:archivo', async (req, reply) => {
    const { archivo } = req.params as { archivo: string };
    const ics = await feedIcs(archivo.replace(/\.ics$/, ''));
    if (!ics) return reply.code(404).send('no encontrado');
    return reply.header('content-type', 'text/calendar; charset=utf-8').send(ics);
  });

  app.get('/agendar/cancelar/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const r = await cancelarReserva(token);
    return reply.header('content-type', 'text/html; charset=utf-8')
      .send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:-apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;color:#111"><p>${r ? 'Listo, tu reunión quedó cancelada.' : 'Esta reunión ya estaba cancelada.'}</p></body>`);
  });

  app.get('/agendar/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const cal = await calendarioPorSlug(slug);
    if (!cal) return reply.code(404).header('content-type', 'text/html; charset=utf-8').send('<!doctype html><meta charset="utf-8"><p style="font-family:system-ui;padding:40px">Este calendario no existe o está pausado.</p>');
    return reply.header('content-type', 'text/html; charset=utf-8').send(paginaAgenda(cal));
  });

  app.get('/agendar/:slug/huecos', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const { desde, dias } = z.object({ desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dias: z.coerce.number().int().min(1).max(42).default(7) }).parse(req.query);
    const cal = await calendarioPorSlug(slug);
    if (!cal) return reply.code(404).send({ error: 'no_encontrado' });
    return { zona: cal.zona_horaria, dias: await huecos(cal as Calendario, desde, dias) };
  });

  app.post('/agendar/:slug/reservar', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const d = z.object({
      inicio: z.string().min(10).max(40),
      nombre: z.string().min(1).max(120),
      email: z.string().email().max(200).optional().or(z.literal('')),
      telefono: z.string().max(40).optional(),
      ig_username: z.string().max(80).optional(),
      respuestas: z.record(z.string().max(120), z.string().max(2000)).optional(),
      invitacion: z.string().max(60).optional(),
    }).parse(req.body);
    const cal = await calendarioPorSlug(slug);
    if (!cal) return reply.code(404).send({ error: 'no_encontrado' });
    for (const p of cal.preguntas ?? []) {
      if (p.obligatoria && !String(d.respuestas?.[p.nombre] ?? '').trim()) throw peticionInvalida(`Completá «${p.nombre}».`);
    }
    try {
      const r = await reservar(cal as Calendario, { ...d, email: d.email || undefined });
      return reply.code(201).send({ ok: true, inicio: r.inicio, fin: r.fin, cancelar: `${urlPublica('cancelar')}/${r.token}` });
    } catch (e) { throw traducir(e); }
  });
}
