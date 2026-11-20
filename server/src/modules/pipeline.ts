import { pool } from '../db/pool.js';
import type { Ejecutor, ResultadoAtribucion } from './atribucion.js';
import {
  enviarMensajeIG, registrarSaliente, mensajeDeRecurso, ejecutarFlujo,
} from './instagram_dm.js';

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
  opts: {
    origen?: string; usuarioId?: string | null; reglaId?: string | null; cuando?: Date;
    /** "Deshacer" en el tablero: volver a la etapa anterior SIN repetir sus automatizaciones. */
    sinAcciones?: boolean;
  } = {},
): Promise<MovimientoEtapa | null> {
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

  // Acciones automáticas de la etapa de destino. Se ESPERAN (en serverless lo
  // que queda corriendo tras responder puede no ejecutarse nunca). Dentro de
  // una transacción no: las ejecuta quien la abrió, después del commit.
  if (!opts.sinAcciones && Array.isArray(destino.acciones) && destino.acciones.length && opp.lead_id) {
    if (db === pool) {
      await ejecutarAccionesEtapa(cuentaId, opp.lead_id, destino).catch(() => {});
    } else {
      return { desde: opp.etapa_id, hasta: etapaDestinoId, pendiente: { leadId: opp.lead_id, etapa: destino } };
    }
  }

  return { desde: opp.etapa_id, hasta: etapaDestinoId };
}

export interface MovimientoEtapa {
  desde: string | null;
  hasta: string;
  /** Acciones de etapa por ejecutar tras el commit (solo dentro de transacciones). */
  pendiente?: { leadId: string; etapa: any };
}

function rellenar(texto: string, lead: any) {
  const nombre = (lead?.nombre ? String(lead.nombre).split(' ')[0] : '') || lead?.ig_username || '';
  return String(texto ?? '').replace(/\{\{\s*nombre\s*\}\}/gi, nombre)
    .replace(/\{\{\s*usuario\s*\}\}/gi, lead?.ig_username ? `@${lead.ig_username}` : '');
}

async function postJson(url: string, cuerpo: unknown): Promise<boolean> {
  return fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(10_000),
  }).then((r) => r.ok).catch(() => false);
}

async function notaAuto(cuentaId: string, leadId: string, texto: string) {
  await pool.query(`INSERT INTO notas (cuenta_id, lead_id, cuerpo) VALUES ($1,$2,$3)`,
    [cuentaId, leadId, `🤖 ${texto}`]);
}

/**
 * Ejecuta las acciones configuradas en una etapa cuando un lead entra en ella:
 * etiquetar, nota, avisar a otra app (webhook), mandar un DM o un audio por
 * Instagram, arrancar un automensaje, sumar a una secuencia de email,
 * asignar al equipo. Una acción que falla no frena las demás y deja nota.
 */
export async function ejecutarAccionesEtapa(cuentaId: string, leadId: string, etapa: any) {
  const lead = (await pool.query(
    `SELECT id, nombre, apellido, ig_username, ig_user_id, email, telefono, etiquetas
       FROM leads WHERE id = $1 AND cuenta_id = $2`, [leadId, cuentaId])).rows[0];
  if (!lead) return;
  const datosLead = {
    id: lead.id, nombre: lead.nombre, apellido: lead.apellido, ig_username: lead.ig_username,
    email: lead.email, telefono: lead.telefono, etiquetas: lead.etiquetas,
  };
  for (const a of etapa.acciones ?? []) {
    try {
      switch (a.tipo) {
        case 'etiquetar':
          if (a.etiqueta) {
            await pool.query(
              `UPDATE leads SET etiquetas = (SELECT array_agg(DISTINCT x) FROM unnest(etiquetas || ARRAY[$2]) x)
                 WHERE id = $1 AND cuenta_id = $3`, [leadId, a.etiqueta, cuentaId]);
          }
          break;
        case 'quitar_etiqueta':
          if (a.etiqueta) {
            await pool.query(`UPDATE leads SET etiquetas = array_remove(etiquetas, $2) WHERE id = $1 AND cuenta_id = $3`,
              [leadId, a.etiqueta, cuentaId]);
          }
          break;
        case 'nota':
          if (a.texto) await notaAuto(cuentaId, leadId, rellenar(a.texto, lead));
          break;
        case 'webhook':
          if (a.url) {
            const ok = await postJson(a.url, {
              evento: 'lead_movido_a_etapa', etapa: etapa.nombre, etapa_slug: etapa.slug, lead: datosLead,
            });
            if (!ok) await notaAuto(cuentaId, leadId, `No se pudo avisar a ${a.url} al pasar a «${etapa.nombre}».`);
          }
          break;
        case 'email': {
          // Suma el lead a una secuencia del proveedor de email (ActiveCampaign,
          // Mailchimp, Brevo… o vía Zapier/Make) llamando a su webhook.
          if (!a.url) break;
          if (!lead.email) {
            await notaAuto(cuentaId, leadId, `No entró a la secuencia «${a.secuencia ?? ''}»: el lead todavía no tiene email.`);
            break;
          }
          const ok = await postJson(a.url, {
            evento: 'agregar_a_secuencia', secuencia: a.secuencia ?? null, etapa: etapa.nombre,
            email: lead.email, nombre: lead.nombre, telefono: lead.telefono,
            ig_username: lead.ig_username, etiquetas: lead.etiquetas,
          });
          await notaAuto(cuentaId, leadId, ok
            ? `Agregado a la secuencia de email «${a.secuencia ?? ''}».`
            : `El proveedor de email no respondió bien al sumar a «${a.secuencia ?? ''}».`);
          break;
        }
        case 'dm': {
          // Mensaje por Instagram (API de Meta).
          const texto = rellenar(String(a.texto ?? ''), lead).trim();
          if (!texto) break;
          const r = lead.ig_user_id
            ? await enviarMensajeIG(cuentaId, { igId: lead.ig_user_id }, { text: texto })
            : { ok: false, error: 'El lead no tiene Instagram vinculado' };
          await registrarSaliente(cuentaId, leadId, texto, null, r);
          break;
        }
        case 'recurso': {
          if (!a.recurso_id) break;
          const rec = (await pool.query(
            `SELECT id, nombre, tipo, texto, url, token, (datos IS NOT NULL) AS tiene_archivo
               FROM recursos WHERE cuenta_id = $1 AND id = $2`, [cuentaId, a.recurso_id])).rows[0];
          if (!rec) break;
          const { mensaje, cuerpo } = mensajeDeRecurso(rec);
          const r = lead.ig_user_id
            ? await enviarMensajeIG(cuentaId, { igId: lead.ig_user_id }, mensaje)
            : { ok: false, error: 'El lead no tiene Instagram vinculado' };
          await registrarSaliente(cuentaId, leadId, cuerpo, rec.id, r);
          break;
        }
        case 'flujo':
          if (a.flujo_id) {
            await ejecutarFlujo(cuentaId, a.flujo_id, { leadId, destinatarioIgId: lead.ig_user_id ?? undefined });
          }
          break;
        case 'asignar': {
          const roles = a.rol === 'closer' ? ['closer'] : a.rol === 'setter' ? ['setter'] : ['setter', 'closer'];
          const u = (await pool.query(
            `SELECT u.id FROM usuarios u LEFT JOIN leads l ON l.propietario_id = u.id
              WHERE u.cuenta_id = $1 AND u.activo AND u.rol = ANY($2)
              GROUP BY u.id ORDER BY COUNT(l.id) ASC, u.creado_en ASC LIMIT 1`, [cuentaId, roles])).rows[0];
          if (u) {
            await pool.query(`UPDATE leads SET propietario_id = $2 WHERE id = $1`, [leadId, u.id]);
            await pool.query(`UPDATE oportunidades SET propietario_id = $2 WHERE lead_id = $1 AND estado = 'abierta'`,
              [leadId, u.id]);
          }
          break;
        }
      }
    } catch { /* una acción fallida no frena las demás */ }
  }
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

