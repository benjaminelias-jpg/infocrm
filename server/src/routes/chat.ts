import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { query, queryOne, pool } from '../db/pool.js';
import { noEncontrado } from '../lib/errores.js';
import { enviarDM } from '../modules/instagram_dm.js';

export default async function rutasChat(app: FastifyInstance) {
  // Lista de conversaciones: leads ordenados por actividad, con el último
  // mensaje, si esperan respuesta, y de qué contenido vinieron.
  app.get('/chat/conversaciones', async (req) => {
    return query(
      `SELECT l.id, l.nombre, l.ig_username, l.ig_user_id, l.etiquetas,
              l.mensajes_sin_leer, l.score, l.score_cualitativo,
              COALESCE(l.ultimo_mensaje_en, l.creado_en) AS actividad,
              c.titulo AS contenido, c.tipo AS contenido_tipo,
              e.nombre AS etapa,
              (SELECT m.cuerpo FROM mensajes m WHERE m.lead_id = l.id ORDER BY m.ocurrido_en DESC LIMIT 1) AS ultimo_texto,
              (SELECT m.direccion FROM mensajes m WHERE m.lead_id = l.id ORDER BY m.ocurrido_en DESC LIMIT 1) AS ultimo_dir
         FROM leads l
         LEFT JOIN contenidos c ON c.id = l.primer_contenido_id
         LEFT JOIN oportunidades o ON o.lead_id = l.id AND o.estado = 'abierta'
         LEFT JOIN etapas e ON e.id = o.etapa_id
        WHERE l.cuenta_id = $1
        ORDER BY COALESCE(l.ultimo_mensaje_en, l.creado_en) DESC
        LIMIT 100`, [req.sesion.cuentaId]);
  });

  // Hilo de un lead (marca como leído).
  app.get('/chat/:leadId', async (req) => {
    const { leadId } = req.params as { leadId: string };
    const lead = await queryOne(
      `SELECT l.*, c.titulo AS contenido, e.nombre AS etapa, o.id AS oportunidad_id, o.pipeline_id
         FROM leads l
         LEFT JOIN contenidos c ON c.id = l.primer_contenido_id
         LEFT JOIN oportunidades o ON o.lead_id = l.id AND o.estado = 'abierta'
         LEFT JOIN etapas e ON e.id = o.etapa_id
        WHERE l.cuenta_id = $1 AND l.id = $2`, [req.sesion.cuentaId, leadId]);
    if (!lead) throw noEncontrado('Lead');
    const mensajes = await query(
      `SELECT m.id, m.direccion, m.cuerpo AS texto, m.estado, m.creado_en, m.ocurrido_en,
              u.nombre AS autor,
              r.nombre AS recurso_nombre, r.tipo AS recurso_tipo, r.token AS recurso_token, r.url AS recurso_url,
              CASE WHEN r.tipo = 'audio' THEN 'audio' WHEN m.recurso_id IS NOT NULL THEN 'recurso' ELSE 'texto' END AS tipo
         FROM mensajes m
         LEFT JOIN recursos r ON r.id = m.recurso_id
         LEFT JOIN usuarios u ON u.id = m.enviado_por
        WHERE m.lead_id = $1 ORDER BY m.ocurrido_en`, [leadId]);
    await pool.query(`UPDATE leads SET mensajes_sin_leer = 0 WHERE id = $1 AND cuenta_id = $2`,
      [leadId, req.sesion.cuentaId]);
    return { lead, mensajes: mensajes.map((m: any) => ({
      ...m,
      autor: m.direccion === 'entrante' ? 'lead' : (m.autor ?? 'vos'),
      recurso_url_publica: m.recurso_url || (m.recurso_token ? `${config.apiUrl}/recursos/pub/${m.recurso_token}` : null),
    })) };
  });

  // El setter envía un mensaje (texto, audio o recurso).
  app.post('/chat/:leadId/enviar', async (req, reply) => {
    const { leadId } = req.params as { leadId: string };
    const d = z.object({
      texto: z.string().optional(),
      recurso_id: z.string().uuid().optional(),
    }).parse(req.body);

    const lead = await queryOne(`SELECT id, ig_user_id FROM leads WHERE cuenta_id=$1 AND id=$2`,
      [req.sesion.cuentaId, leadId]);
    if (!lead) throw noEncontrado('Lead');

    let contenido = d.texto ?? '';
    let rec: any = null;
    if (d.recurso_id) {
      rec = await queryOne(`SELECT nombre, tipo, texto, url, token, (datos IS NOT NULL) tiene FROM recursos WHERE cuenta_id=$1 AND id=$2`,
        [req.sesion.cuentaId, d.recurso_id]);
      if (rec) contenido = rec.texto || rec.url || (rec.tiene ? `${config.apiUrl}/recursos/pub/${rec.token}` : rec.nombre);
    }
    if (!contenido) throw noEncontrado('Mensaje vacío');

    // Intenta enviarlo por Instagram; si no está conectado/aprobado, queda pendiente.
    let estado = 'pendiente';
    let igErr: string | undefined;
    if (lead.ig_user_id) {
      const r = await enviarDM(req.sesion.cuentaId, lead.ig_user_id, contenido);
      estado = r.ok ? 'enviado' : 'pendiente';
      igErr = r.error;
    }
    const usuarioId = req.sesion.usuarioId && req.sesion.usuarioId !== 'api-key' ? req.sesion.usuarioId : null;

    const msg = await queryOne(
      `INSERT INTO mensajes (cuenta_id, lead_id, direccion, canal, cuerpo, recurso_id, enviado_por, estado)
       VALUES ($1,$2,'saliente','instagram_dm',$3,$4,$5,$6)
       RETURNING id, direccion, cuerpo AS texto, estado, creado_en`,
      [req.sesion.cuentaId, leadId, contenido, d.recurso_id ?? null, usuarioId, estado]);
    await pool.query(`UPDATE leads SET ultimo_mensaje_en = now() WHERE id = $1`, [leadId]);
    return reply.code(201).send({ ...msg, aviso: igErr });
  });
}
