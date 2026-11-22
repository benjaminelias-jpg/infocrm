import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne, pool } from '../db/pool.js';
import { noEncontrado, peticionInvalida } from '../lib/errores.js';
import { enviarAtajo, procesarEnviosProgramados, pendientesDeLead, cancelarPendientes } from '../modules/secuencias.js';
import {
  enviarMensajeIG, mensajeDeRecurso, registrarSaliente, urlPublicaRecurso,
  procesarEsperasVencidas, esperasDeLead, MAX_TEXTO_DM,
} from '../modules/instagram_dm.js';

const VENTANA_MS = 24 * 3600 * 1000; // Instagram deja responder 24 h desde el último mensaje del lead
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function rutasChat(app: FastifyInstance) {
  // Lista de conversaciones: leads ordenados por actividad, con el último
  // mensaje, si esperan respuesta, y de qué contenido vinieron.
  app.get('/chat/conversaciones', async (req) => {
    // Aprovecha para reanudar flujos cuya espera por tiempo ya venció.
    procesarEsperasVencidas(req.sesion.cuentaId, 5).catch(() => {});
    procesarEnviosProgramados(req.sesion.cuentaId).catch(() => {});
    return query(
      `SELECT l.id, l.nombre, l.ig_username, l.ig_user_id, l.etiquetas,
              l.mensajes_sin_leer, l.score, l.score_cualitativo,
              COALESCE(l.ultimo_mensaje_en, l.creado_en) AS actividad,
              c.titulo AS contenido, c.tipo AS contenido_tipo,
              e.nombre AS etapa,
              u.nombre AS responsable,
              (SELECT m.cuerpo FROM mensajes m WHERE m.lead_id = l.id ORDER BY m.ocurrido_en DESC LIMIT 1) AS ultimo_texto,
              (SELECT m.direccion FROM mensajes m WHERE m.lead_id = l.id ORDER BY m.ocurrido_en DESC LIMIT 1) AS ultimo_dir,
              (SELECT max(m.ocurrido_en) FROM mensajes m WHERE m.lead_id = l.id AND m.direccion = 'entrante') AS ultimo_entrante,
              EXISTS (SELECT 1 FROM flujo_ejecuciones fe WHERE fe.lead_id = l.id AND fe.estado = 'esperando') AS flujo_esperando
         FROM leads l
         LEFT JOIN contenidos c ON c.id = l.primer_contenido_id
         -- Una sola fila por lead aunque tenga varias oportunidades abiertas.
         LEFT JOIN LATERAL (
           SELECT o.etapa_id FROM oportunidades o
            WHERE o.lead_id = l.id AND o.estado = 'abierta'
            ORDER BY o.abierta_en DESC LIMIT 1
         ) o ON true
         LEFT JOIN etapas e ON e.id = o.etapa_id
         LEFT JOIN usuarios u ON u.id = l.propietario_id
        WHERE l.cuenta_id = $1
        ORDER BY COALESCE(l.ultimo_mensaje_en, l.creado_en) DESC
        LIMIT 150`, [req.sesion.cuentaId]);
  });

  // Hilo de un lead. Lo marca como leído, salvo con ?sin_marcar=1 (para
  // precargar el siguiente chat sin darlo por visto).
  app.get('/chat/:leadId', async (req) => {
    const { leadId } = req.params as { leadId: string };
    if (!UUID.test(leadId ?? '')) throw noEncontrado('Lead');
    const sinMarcar = (req.query as Record<string, string> | undefined)?.sin_marcar === '1';
    const usuarioId = req.sesion.usuarioId && req.sesion.usuarioId !== 'api-key' ? req.sesion.usuarioId : null;
    const lead = await queryOne(
      `SELECT l.*, c.titulo AS contenido, op.etapa, op.etapa_id, op.etapa_color, op.oportunidad_id, op.pipeline_id,
              op.oportunidad_estado, u.nombre AS responsable,
              (NULLIF(l.campos_extra->>'chat_archivado_en', '') IS NOT NULL) AS archivado
         FROM leads l
         LEFT JOIN contenidos c ON c.id = l.primer_contenido_id
         -- La oportunidad que se muestra en el Chat: la abierta más nueva (o la última cerrada).
         LEFT JOIN LATERAL (
           SELECT o.id AS oportunidad_id, o.pipeline_id, o.estado AS oportunidad_estado,
                  e.id AS etapa_id, e.nombre AS etapa, e.color AS etapa_color
             FROM oportunidades o JOIN etapas e ON e.id = o.etapa_id
            WHERE o.lead_id = l.id AND o.cuenta_id = l.cuenta_id
            ORDER BY (o.estado = 'abierta') DESC, o.abierta_en DESC LIMIT 1
         ) op ON true
         LEFT JOIN usuarios u ON u.id = l.propietario_id
        WHERE l.cuenta_id = $1 AND l.id = $2`, [req.sesion.cuentaId, leadId]);
    if (!lead) throw noEncontrado('Lead');
    const mensajes = await query(
      `SELECT m.id, m.direccion, m.cuerpo AS texto, m.estado, m.error, m.creado_en, m.ocurrido_en,
              m.enviado_por, m.recurso_id, u.nombre AS autor, fl.nombre AS flujo,
              r.nombre AS recurso_nombre, r.tipo AS recurso_tipo, r.token AS recurso_token, r.url AS recurso_url,
              (r.datos IS NOT NULL) AS recurso_tiene_archivo,
              CASE WHEN r.tipo = 'audio' THEN 'audio' WHEN r.tipo = 'imagen' THEN 'imagen'
                   WHEN m.recurso_id IS NOT NULL THEN 'recurso' ELSE 'texto' END AS tipo
         FROM mensajes m
         LEFT JOIN recursos r ON r.id = m.recurso_id
         LEFT JOIN usuarios u ON u.id = m.enviado_por
         -- Los automáticos: el automensaje que estaba corriendo cuando salió.
         LEFT JOIN LATERAL (
           SELECT f.nombre FROM flujo_ejecuciones fe JOIN flujos f ON f.id = fe.flujo_id
            WHERE m.direccion = 'saliente' AND m.enviado_por IS NULL
              AND fe.cuenta_id = m.cuenta_id AND fe.lead_id = m.lead_id
              AND fe.ejecutado_en <= m.ocurrido_en + interval '5 seconds'
              AND fe.actualizado_en >= m.ocurrido_en - interval '5 seconds'
            ORDER BY fe.ejecutado_en DESC LIMIT 1
         ) fl ON true
        WHERE m.lead_id = $1 AND m.cuenta_id = $2 ORDER BY m.ocurrido_en, m.creado_en`, [leadId, req.sesion.cuentaId]);
    if (!sinMarcar) {
      await pool.query(`UPDATE leads SET mensajes_sin_leer = 0 WHERE id = $1 AND cuenta_id = $2`,
        [leadId, req.sesion.cuentaId]);
    }
    // Lo que pasó con el lead (para el chat vacío: de dónde vino, qué recibió).
    const eventos = await query(
      `SELECT e.tipo, e.fuente, e.ocurrido_en, e.titulo, c.titulo AS contenido
         FROM eventos e LEFT JOIN contenidos c ON c.id = e.contenido_id
        WHERE e.cuenta_id = $1 AND e.lead_id = $2 AND e.tipo <> 'etapa_cambiada'
        ORDER BY e.ocurrido_en DESC LIMIT 8`, [req.sesion.cuentaId, leadId]);

    // Ventana de 24 h de Instagram: desde el último mensaje del lead.
    const ultimoEntrante = [...mensajes].reverse().find((m: any) => m.direccion === 'entrante');
    const cierra = ultimoEntrante ? new Date(new Date(ultimoEntrante.ocurrido_en).getTime() + VENTANA_MS) : null;
    // ¿Respondió por ManyChat (fuera de este Chat) en las últimas 24 h?
    const porManychat = eventos.find((e: any) => e.tipo === 'respondio_dm' && e.fuente === 'manychat');
    const tManychat = porManychat ? new Date(porManychat.ocurrido_en).getTime() : 0;

    return {
      lead,
      ventana: {
        abierta: !!cierra && cierra.getTime() > Date.now(),
        cierra_en: cierra?.toISOString() ?? null,
        nunca_escribio: !ultimoEntrante,
        por_manychat: tManychat > Date.now() - VENTANA_MS
          && (!ultimoEntrante || new Date(ultimoEntrante.ocurrido_en).getTime() < tManychat),
      },
      esperas: await esperasDeLead(req.sesion.cuentaId, leadId),
      eventos,
      mensajes: mensajes.map((m: any) => {
        const autorTipo = m.direccion === 'entrante' ? 'lead'
          : !m.enviado_por ? 'automatico'
          : m.enviado_por === usuarioId ? 'yo' : 'equipo';
        return {
          ...m,
          autor_tipo: autorTipo,
          autor: m.direccion === 'entrante' ? 'lead' : (m.autor ?? 'automático'),
          recurso_url_publica: m.recurso_token || m.recurso_url
            ? urlPublicaRecurso({ url: m.recurso_url, token: m.recurso_token, tiene_archivo: m.recurso_tiene_archivo })
            : null,
        };
      }),
    };
  });

  // El setter envía un mensaje (texto, audio del founder o cualquier recurso).
  // Lo que falta mandar de una secuencia a este lead, y cancelarlo.
  app.get('/chat/:leadId/programados', async (req) => {
    const { leadId } = req.params as { leadId: string };
    if (!UUID.test(leadId ?? '')) throw noEncontrado('Lead');
    return pendientesDeLead(req.sesion.cuentaId, leadId);
  });
  app.post('/chat/:leadId/programados/cancelar', async (req) => {
    const { leadId } = req.params as { leadId: string };
    if (!UUID.test(leadId ?? '')) throw noEncontrado('Lead');
    return { cancelados: await cancelarPendientes(req.sesion.cuentaId, leadId) };
  });

  app.post('/chat/:leadId/enviar', async (req, reply) => {
    const { leadId } = req.params as { leadId: string };
    if (!UUID.test(leadId ?? '')) throw noEncontrado('Lead');
    const d = z.object({
      texto: z.string().max(MAX_TEXTO_DM, `Instagram no deja mandar más de ${MAX_TEXTO_DM} caracteres por mensaje`).optional(),
      recurso_id: z.string().uuid().optional(),
    }).parse(req.body);

    const lead = await queryOne(`SELECT id, ig_user_id FROM leads WHERE cuenta_id=$1 AND id=$2`,
      [req.sesion.cuentaId, leadId]);
    if (!lead) throw noEncontrado('Lead');

    const usuarioId = req.sesion.usuarioId && req.sesion.usuarioId !== 'api-key' ? req.sesion.usuarioId : null;
    if (d.recurso_id) {
      // Atajo suelto o secuencia (el primero sale ya; el resto queda programado).
      const env = await enviarAtajo(req.sesion.cuentaId, leadId, d.recurso_id, usuarioId);
      if (!env) throw noEncontrado('Recurso');
      return reply.code(201).send({ ...env.msg, aviso: env.r.ok ? null : env.r.error, programados: env.programados });
    }
    const texto = (d.texto ?? '').trim();
    if (!texto) throw peticionInvalida('El mensaje está vacío');
    const mensaje: Record<string, unknown> = { text: texto };
    const cuerpo = texto;

    // Lo manda por Instagram; si no se puede, queda guardado con el motivo.
    const r = lead.ig_user_id
      ? await enviarMensajeIG(req.sesion.cuentaId, { igId: lead.ig_user_id }, mensaje)
      : { ok: false, error: 'Este lead no tiene Instagram vinculado (entró por otra vía)' };
    const msg = await registrarSaliente(req.sesion.cuentaId, leadId, cuerpo, null, r, usuarioId);
    return reply.code(201).send({ ...msg, aviso: r.ok ? null : r.error });
  });
}
