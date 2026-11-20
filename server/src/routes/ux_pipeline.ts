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
}
