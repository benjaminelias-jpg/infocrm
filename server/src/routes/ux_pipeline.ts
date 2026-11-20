import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, query, queryOne } from '../db/pool.js';
import { noEncontrado, peticionInvalida } from '../lib/errores.js';
import { registrarEvento } from '../modules/eventos.js';
import { moverEtapa } from '../modules/pipeline.js';
import { limpiarUsername } from '../lib/utils.js';

// Rutas propias del Pipeline (mejoras de UX). Montadas en /api/ux/pipeline.
export default async function rutasUx_pipeline(app: FastifyInstance) {
  /** Cuántos leads abiertos tiene cada pipeline (para el selector con "+"). */
  app.get('/conteos', async (req) => {
    const filas = await query(
      `SELECT p.id, COUNT(o.id)::int AS abiertos
         FROM pipelines p
         LEFT JOIN oportunidades o ON o.pipeline_id = p.id AND o.estado = 'abierta'
        WHERE p.cuenta_id = $1 AND p.activo
        GROUP BY p.id`, [req.sesion.cuentaId]);
    return Object.fromEntries(filas.map((f: any) => [f.id, f.abiertos]));
  });

  /** Cuántos leads hay en cada etapa de un pipeline (para avisar antes de borrar una). */
  app.get('/conteos-etapas', async (req) => {
    const { pipeline_id } = z.object({ pipeline_id: z.string().uuid() }).parse(req.query);
    const filas = await query(
      `SELECT e.id, COUNT(o.id)::int AS n
         FROM etapas e LEFT JOIN oportunidades o ON o.etapa_id = e.id
        WHERE e.cuenta_id = $1 AND e.pipeline_id = $2
        GROUP BY e.id`, [req.sesion.cuentaId, pipeline_id]);
    return Object.fromEntries(filas.map((f: any) => [f.id, f.n]));
  });

  /**
   * Lead rápido (como en Kommo): se carga a mano directo en una etapa.
   * Lo atiende quien lo crea. Si ya existía (mismo @usuario), lo mueve.
   */
  app.post('/lead-rapido', async (req, reply) => {
    const d = z.object({
      etapa_id: z.string().uuid(),
      usuario: z.string().max(120).optional(),
      nombre: z.string().max(120).optional(),
      etiqueta: z.string().max(60).optional(),
    }).parse(req.body);
    const usuario = limpiarUsername(d.usuario ?? undefined);
    const nombre = d.nombre?.trim() || undefined;
    if (!usuario && !nombre) throw peticionInvalida('Escribí el @usuario de Instagram o el nombre del lead.');

    const etapa = await queryOne(
      `SELECT id, pipeline_id, nombre FROM etapas WHERE id = $1 AND cuenta_id = $2`, [d.etapa_id, req.sesion.cuentaId]);
    if (!etapa) throw noEncontrado('Etapa');

    const previo = usuario
      ? await queryOne(`SELECT id FROM leads WHERE cuenta_id = $1 AND lower(ig_username) = lower($2)`, [req.sesion.cuentaId, usuario])
      : null;
    const res = await registrarEvento({
      cuentaId: req.sesion.cuentaId,
      tipo: 'lead_creado',
      identidad: { igUsername: usuario, nombre },
      fuente: 'manual',
      origenToque: 'directo',
      pipelineId: etapa.pipeline_id,
    });
    const usuarioId = req.sesion.usuarioId && req.sesion.usuarioId !== 'api-key' ? req.sesion.usuarioId : null;
    // La oportunidad abierta del lead en ESTE pipeline (puede venir de otro).
    let opp = await queryOne(
      `SELECT id FROM oportunidades WHERE lead_id = $1 AND pipeline_id = $2 AND estado = 'abierta' ORDER BY abierta_en DESC LIMIT 1`,
      [res.leadId, etapa.pipeline_id]);
    if (!opp) {
      opp = await queryOne(
        `INSERT INTO oportunidades (cuenta_id, lead_id, pipeline_id, etapa_id, propietario_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [req.sesion.cuentaId, res.leadId, etapa.pipeline_id, etapa.id, usuarioId]);
    } else {
      await moverEtapa(req.sesion.cuentaId, opp.id, etapa.id, pool, { origen: 'manual', usuarioId });
    }
    if (!opp) throw peticionInvalida('No se pudo cargar el lead en esa etapa. Probá de nuevo.');
    if (usuarioId) {
      await pool.query(`UPDATE leads SET propietario_id = COALESCE(propietario_id, $2) WHERE id = $1`, [res.leadId, usuarioId]);
      await pool.query(`UPDATE oportunidades SET propietario_id = COALESCE(propietario_id, $2) WHERE id = $1`, [opp.id, usuarioId]);
    }
    const etiqueta = d.etiqueta?.trim();
    if (etiqueta) {
      await pool.query(
        `UPDATE leads SET etiquetas = (SELECT array_agg(DISTINCT x) FROM unnest(etiquetas || ARRAY[$2]) x)
          WHERE id = $1 AND cuenta_id = $3`, [res.leadId, etiqueta, req.sesion.cuentaId]);
    }
    return reply.code(201).send({ lead_id: res.leadId, oportunidad_id: opp.id, ya_existia: !!previo });
  });

  /**
   * ¿Ya existe este @usuario? Para que el "lead rápido" pregunte antes de
   * mover a alguien que ya está en otra etapa (en vez de moverlo sin avisar).
   */
  app.get('/existe', async (req) => {
    const { usuario, pipeline_id } = z.object({ usuario: z.string().min(1).max(120), pipeline_id: z.string().uuid().optional() }).parse(req.query);
    const u = limpiarUsername(usuario);
    if (!u) return { existe: false };
    const lead = await queryOne(
      `SELECT l.id, l.nombre, l.ig_username,
              e.nombre AS etapa, p.nombre AS pipeline
         FROM leads l
         LEFT JOIN LATERAL (
           SELECT o.etapa_id, o.pipeline_id FROM oportunidades o
            WHERE o.lead_id = l.id AND o.estado = 'abierta'
            ORDER BY (o.pipeline_id = $3::uuid) DESC NULLS LAST, o.abierta_en DESC LIMIT 1) o ON true
         LEFT JOIN etapas e ON e.id = o.etapa_id
         LEFT JOIN pipelines p ON p.id = o.pipeline_id
        WHERE l.cuenta_id = $1 AND lower(l.ig_username) = lower($2)`,
      [req.sesion.cuentaId, u, pipeline_id ?? null]);
    return lead ? { existe: true, ...lead } : { existe: false };
  });

  /** Pasar a una etapa "perdida" guardando por qué (para aprender de las pérdidas). */
  app.post('/perdido', async (req) => {
    const d = z.object({
      oportunidad_id: z.string().uuid(), etapa_id: z.string().uuid(),
      motivo: z.string().trim().max(200).optional(),
    }).parse(req.body);
    const c = req.sesion.cuentaId;
    const etapa = await queryOne(`SELECT id, tipo FROM etapas WHERE id = $1 AND cuenta_id = $2`, [d.etapa_id, c]);
    if (!etapa) throw noEncontrado('Etapa');
    const opp = await queryOne(`UPDATE oportunidades SET motivo_perdida = $3 WHERE cuenta_id = $1 AND id = $2 RETURNING id, lead_id`,
      [c, d.oportunidad_id, d.motivo || null]);
    if (!opp) throw noEncontrado('Oportunidad');
    const usuarioId = req.sesion.usuarioId && req.sesion.usuarioId !== 'api-key' ? req.sesion.usuarioId : null;
    const mov = await moverEtapa(c, d.oportunidad_id, d.etapa_id, pool, { origen: 'manual', usuarioId });
    if (d.motivo) {
      await pool.query(`INSERT INTO notas (cuenta_id, lead_id, cuerpo) VALUES ($1, $2, $3)`,
        [c, opp.lead_id, `Se perdió: ${d.motivo}`]).catch(() => {});
    }
    return { movido: Boolean(mov) };
  });

  /** Asignar quién atiende una tarjeta (desde el "⋯" del tablero). null = sin asignar. */
  app.post('/asignar', async (req) => {
    const d = z.object({ oportunidad_id: z.string().uuid(), usuario_id: z.string().uuid().nullable() }).parse(req.body);
    const c = req.sesion.cuentaId;
    if (d.usuario_id) {
      const u = await queryOne(`SELECT id FROM usuarios WHERE id = $1 AND cuenta_id = $2`, [d.usuario_id, c]);
      if (!u) throw noEncontrado('Usuario');
    }
    const opp = await queryOne(`UPDATE oportunidades SET propietario_id = $3 WHERE cuenta_id = $1 AND id = $2 RETURNING lead_id`,
      [c, d.oportunidad_id, d.usuario_id]);
    if (!opp) throw noEncontrado('Oportunidad');
    await pool.query(`UPDATE leads SET propietario_id = $3 WHERE cuenta_id = $1 AND id = $2`, [c, opp.lead_id, d.usuario_id]);
    return { ok: true };
  });

  /**
   * "Probar" de una acción que avisa a una dirección pegada a mano (Avanzado):
   * manda un lead de ejemplo y dice si la otra app lo recibió.
   */
  app.post('/probar-aviso', async (req) => {
    const d = z.object({ url: z.string().max(2000), tipo: z.enum(['webhook', 'email']).default('webhook') }).parse(req.body);
    let url: URL;
    try { url = new URL(d.url.trim()); } catch { throw peticionInvalida('Pegá la dirección completa (empieza con https://).'); }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw peticionInvalida('La dirección tiene que empezar con https://');
    const lead = { nombre: 'Lead de prueba', ig_username: 'prueba', email: 'prueba@ejemplo.com', etiquetas: ['prueba'] };
    const cuerpo = d.tipo === 'email'
      ? { evento: 'agregar_a_secuencia', prueba: true, secuencia: 'Prueba', email: lead.email, nombre: lead.nombre, ig_username: lead.ig_username }
      : { evento: 'lead_movido_a_etapa', prueba: true, etapa: 'Prueba', lead };
    try {
      const r = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'InfoCRM-Webhooks/1.0' },
        body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(8000),
      });
      if (r.ok) return { ok: true, status: r.status };
      return { ok: false, status: r.status, error: `la otra app respondió ${r.status}` };
    } catch (err: any) {
      const motivo = /timeout|abort/i.test(String(err?.name ?? err?.message)) ? 'no respondió a tiempo' : 'no se pudo llegar a esa dirección';
      return { ok: false, error: motivo };
    }
  });
}
