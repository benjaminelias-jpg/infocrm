import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne, pool } from '../db/pool.js';
import { noEncontrado, peticionInvalida } from '../lib/errores.js';
import {
  enviarMensajeIG, mensajeDeRecurso, registrarSaliente, urlPublicaRecurso,
  procesarEsperasVencidas, esperasDeLead, MAX_TEXTO_DM,
} from '../modules/instagram_dm.js';

const VENTANA_MS = 24 * 3600 * 1000; // Instagram deja responder 24 h desde el último mensaje del lead

export default async function rutasChat(app: FastifyInstance) {
  // Lista de conversaciones: leads ordenados por actividad, con el último
  // mensaje, si esperan respuesta, y de qué contenido vinieron.
  app.get('/chat/conversaciones', async (req) => {
    // Aprovecha para reanudar flujos cuya espera por tiempo ya venció.
    procesarEsperasVencidas(req.sesion.cuentaId, 5).catch(() => {});
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
         LEFT JOIN oportunidades o ON o.lead_id = l.id AND o.estado = 'abierta'
         LEFT JOIN etapas e ON e.id = o.etapa_id
         LEFT JOIN usuarios u ON u.id = l.propietario_id
        WHERE l.cuenta_id = $1
        ORDER BY COALESCE(l.ultimo_mensaje_en, l.creado_en) DESC
        LIMIT 150`, [req.sesion.cuentaId]);
  });

  // Hilo de un lead (marca como leído).
  app.get('/chat/:leadId', async (req) => {
    const { leadId } = req.params as { leadId: string };
    const lead = await queryOne(
      `SELECT l.*, c.titulo AS contenido, e.nombre AS etapa, o.id AS oportunidad_id, o.pipeline_id,
              u.nombre AS responsable
         FROM leads l
         LEFT JOIN contenidos c ON c.id = l.primer_contenido_id
         LEFT JOIN oportunidades o ON o.lead_id = l.id AND o.estado = 'abierta'
         LEFT JOIN etapas e ON e.id = o.etapa_id
         LEFT JOIN usuarios u ON u.id = l.propietario_id
        WHERE l.cuenta_id = $1 AND l.id = $2`, [req.sesion.cuentaId, leadId]);
    if (!lead) throw noEncontrado('Lead');
    const mensajes = await query(
      `SELECT m.id, m.direccion, m.cuerpo AS texto, m.estado, m.error, m.creado_en, m.ocurrido_en,
              u.nombre AS autor,
              r.nombre AS recurso_nombre, r.tipo AS recurso_tipo, r.token AS recurso_token, r.url AS recurso_url,
              (r.datos IS NOT NULL) AS recurso_tiene_archivo,
              CASE WHEN r.tipo = 'audio' THEN 'audio' WHEN r.tipo = 'imagen' THEN 'imagen'
                   WHEN m.recurso_id IS NOT NULL THEN 'recurso' ELSE 'texto' END AS tipo
         FROM mensajes m
         LEFT JOIN recursos r ON r.id = m.recurso_id
         LEFT JOIN usuarios u ON u.id = m.enviado_por
        WHERE m.lead_id = $1 AND m.cuenta_id = $2 ORDER BY m.ocurrido_en`, [leadId, req.sesion.cuentaId]);
    await pool.query(`UPDATE leads SET mensajes_sin_leer = 0 WHERE id = $1 AND cuenta_id = $2`,
      [leadId, req.sesion.cuentaId]);

    // Ventana de 24 h de Instagram: desde el último mensaje del lead.
    const ultimoEntrante = [...mensajes].reverse().find((m: any) => m.direccion === 'entrante');
    const cierra = ultimoEntrante ? new Date(new Date(ultimoEntrante.ocurrido_en).getTime() + VENTANA_MS) : null;

    return {
      lead,
      ventana: {
        abierta: !!cierra && cierra.getTime() > Date.now(),
        cierra_en: cierra?.toISOString() ?? null,
        nunca_escribio: !ultimoEntrante,
      },
      esperas: await esperasDeLead(req.sesion.cuentaId, leadId),
      mensajes: mensajes.map((m: any) => ({
        ...m,
        autor: m.direccion === 'entrante' ? 'lead' : (m.autor ?? (m.estado === 'enviado' ? 'automático' : 'vos')),
        recurso_url_publica: m.recurso_token || m.recurso_url
          ? urlPublicaRecurso({ url: m.recurso_url, token: m.recurso_token, tiene_archivo: m.recurso_tiene_archivo })
          : null,
      })),
    };
  });

  // El setter envía un mensaje (texto, audio del founder o cualquier recurso).
  app.post('/chat/:leadId/enviar', async (req, reply) => {
    const { leadId } = req.params as { leadId: string };
    const d = z.object({
      texto: z.string().max(MAX_TEXTO_DM, `Instagram no deja mandar más de ${MAX_TEXTO_DM} caracteres por mensaje`).optional(),
      recurso_id: z.string().uuid().optional(),
    }).parse(req.body);

    const lead = await queryOne(`SELECT id, ig_user_id FROM leads WHERE cuenta_id=$1 AND id=$2`,
      [req.sesion.cuentaId, leadId]);
    if (!lead) throw noEncontrado('Lead');

    let mensaje: Record<string, unknown>;
    let cuerpo: string;
    if (d.recurso_id) {
      const rec = await queryOne(
        `SELECT id, nombre, tipo, texto, url, token, (datos IS NOT NULL) AS tiene_archivo
           FROM recursos WHERE cuenta_id=$1 AND id=$2`, [req.sesion.cuentaId, d.recurso_id]);
      if (!rec) throw noEncontrado('Recurso');
      ({ mensaje, cuerpo } = mensajeDeRecurso(rec));
    } else {
      const texto = (d.texto ?? '').trim();
      if (!texto) throw peticionInvalida('El mensaje está vacío');
      mensaje = { text: texto };
      cuerpo = texto;
    }

    // Lo manda por Instagram; si no se puede, queda guardado con el motivo.
    const r = lead.ig_user_id
      ? await enviarMensajeIG(req.sesion.cuentaId, { igId: lead.ig_user_id }, mensaje)
      : { ok: false, error: 'Este lead no tiene Instagram vinculado (entró por otra vía)' };
    const usuarioId = req.sesion.usuarioId && req.sesion.usuarioId !== 'api-key' ? req.sesion.usuarioId : null;
    const msg = await registrarSaliente(req.sesion.cuentaId, leadId, cuerpo, d.recurso_id ?? null, r, usuarioId);
    return reply.code(201).send({ ...msg, aviso: r.ok ? null : r.error });
  });
}
