import { pool } from '../db/pool.js';
import type { Ejecutor, ResultadoAtribucion } from './atribucion.js';

/** Devuelve la oportunidad abierta del lead, o abre una nueva. */
export async function oportunidadAbierta(
  cuentaId: string,
  leadId: string,
  db: Ejecutor,
  opts: { pipelineId?: string; atribucion?: ResultadoAtribucion; abiertaEn?: Date } = {},
): Promise<any> {
  const { rows: abiertas } = await db.query(
    `SELECT * FROM oportunidades WHERE cuenta_id = $1 AND lead_id = $2 AND estado = 'abierta'
     ORDER BY abierta_en DESC LIMIT 1`,
    [cuentaId, leadId],
  );
  if (abiertas[0]) return abiertas[0];

  const { rows: pipes } = await db.query(
    `SELECT * FROM pipelines WHERE cuenta_id = $1 AND activo
       ${opts.pipelineId ? 'AND id = $2' : ''}
     ORDER BY es_predeterminado DESC, orden ASC LIMIT 1`,
    opts.pipelineId ? [cuentaId, opts.pipelineId] : [cuentaId],
  );
  const pipeline = pipes[0];
  if (!pipeline) throw new Error('La cuenta no tiene ningún pipeline configurado');

  const { rows: etapas } = await db.query(
    `SELECT * FROM etapas WHERE pipeline_id = $1 AND tipo = 'abierta' ORDER BY orden ASC LIMIT 1`,
    [pipeline.id],
  );
  const etapa = etapas[0];
  if (!etapa) throw new Error(`El pipeline ${pipeline.nombre} no tiene etapas abiertas`);

  const { rows } = await db.query(
    `INSERT INTO oportunidades
       (cuenta_id, lead_id, pipeline_id, etapa_id, titulo, contenido_id, automatizacion_id, abierta_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      cuentaId, leadId, pipeline.id, etapa.id, null,
      opts.atribucion?.contenidoId ?? null,
      opts.atribucion?.automatizacionId ?? null,
      opts.abiertaEn ?? new Date(),
    ],
  );

  await db.query(
    `INSERT INTO etapa_historial (cuenta_id, oportunidad_id, etapa_desde_id, etapa_hasta_id, origen, cambiado_en)
     VALUES ($1,$2,NULL,$3,'webhook',$4)`,
    [cuentaId, rows[0].id, etapa.id, opts.abiertaEn ?? new Date()],
  );

  return rows[0];
}

/** Mueve una oportunidad de etapa y deja rastro en el historial. */
export async function moverEtapa(
  cuentaId: string,
  oportunidadId: string,
  etapaDestinoId: string,
  db: Ejecutor = pool,
  opts: { origen?: string; usuarioId?: string | null; reglaId?: string | null; cuando?: Date } = {},
): Promise<{ desde: string | null; hasta: string } | null> {
  const { rows: oppRows } = await db.query(
    `SELECT o.*, e.orden AS etapa_orden FROM oportunidades o
       JOIN etapas e ON e.id = o.etapa_id
      WHERE o.cuenta_id = $1 AND o.id = $2`,
    [cuentaId, oportunidadId],
  );
  const opp = oppRows[0];
  if (!opp || opp.etapa_id === etapaDestinoId) return null;

  const { rows: destRows } = await db.query(`SELECT * FROM etapas WHERE id = $1`, [etapaDestinoId]);
  const destino = destRows[0];
  if (!destino) return null;

  const cuando = opts.cuando ?? new Date();
  const estado = destino.tipo === 'ganada' ? 'ganada' : destino.tipo === 'perdida' ? 'perdida' : 'abierta';

  await db.query(
    `UPDATE oportunidades
        SET etapa_id = $3,
            estado = $4,
            cerrada_en = CASE WHEN $4 = 'abierta' THEN NULL ELSE COALESCE(cerrada_en, $5) END
      WHERE cuenta_id = $1 AND id = $2`,
    [cuentaId, oportunidadId, etapaDestinoId, estado, cuando],
  );

  await db.query(
    `INSERT INTO etapa_historial (cuenta_id, oportunidad_id, etapa_desde_id, etapa_hasta_id, origen, usuario_id, regla_id, cambiado_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [cuentaId, oportunidadId, opp.etapa_id, etapaDestinoId, opts.origen ?? 'webhook',
     opts.usuarioId ?? null, opts.reglaId ?? null, cuando],
  );

  return { desde: opp.etapa_id, hasta: etapaDestinoId };
}

/** Encuentra la etapa a la que debe ir una oportunidad para un tipo de evento. */
export async function etapaParaEvento(
  pipelineId: string,
  tipoEvento: string,
  db: Ejecutor,
): Promise<any | null> {
  const { rows } = await db.query(
    `SELECT * FROM etapas WHERE pipeline_id = $1 AND evento_asociado = $2 ORDER BY orden ASC LIMIT 1`,
    [pipelineId, tipoEvento],
  );
  if (rows[0]) return rows[0];

  // Respaldo por semántica, para pipelines personalizados sin mapeo explícito
  if (tipoEvento === 'venta') {
    const { rows: v } = await db.query(
      `SELECT * FROM etapas WHERE pipeline_id = $1 AND marca_venta ORDER BY orden ASC LIMIT 1`,
      [pipelineId],
    );
    return v[0] ?? null;
  }
  if (tipoEvento === 'reunion_agendada') {
    const { rows: r } = await db.query(
      `SELECT * FROM etapas WHERE pipeline_id = $1 AND marca_reunion ORDER BY orden ASC LIMIT 1`,
      [pipelineId],
    );
    return r[0] ?? null;
  }
  return null;
}

