import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool, query, queryOne } from '../db/pool.js';
import { noEncontrado, peticionInvalida } from '../lib/errores.js';
import { moverEtapa } from '../modules/pipeline.js';
import { procesarEsperasVencidas } from '../modules/instagram_dm.js';
import { procesarEnviosProgramados } from '../modules/secuencias.js';

// Rutas propias de la zona "chat" (mejoras de UX). Montadas en /api/ux/chat.
// Requieren sesión (cuelgan de /api). Usar req.sesion.cuentaId en TODAS las
// consultas: nada de datos de otra cuenta.

export const FILTROS_CHAT = [
  'por_responder', 'sin_leer', 'mios', 'se_cierra', 'automensaje', 'todos', 'sin_conversacion', 'archivados',
] as const;
export type FiltroChat = typeof FILTROS_CHAT[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 3_200_000;

function usuarioDe(req: FastifyRequest): string | null {
  const u = req.sesion.usuarioId;
  return u && u !== 'api-key' && UUID.test(u) ? u : null;
}

function leadIdDe(req: FastifyRequest): string {
  const { leadId } = req.params as { leadId: string };
  if (!UUID.test(leadId ?? '')) throw noEncontrado('Lead');
  return leadId;
}

/**
 * Cada lead de la cuenta con lo que la bandeja necesita: su último mensaje
 * (una sola fila por lead aunque tenga varias oportunidades), si espera
 * respuesta, la ventana de 24 h de Instagram, la etapa y quién lo atiende.
 * El archivo vive en campos_extra.chat_archivado_en y se "desarchiva" solo
 * cuando el lead vuelve a escribir.
 * $1 = cuenta, $2 = usuario de la sesión (puede ser NULL).
 */
const BANDEJA = `
  WITH base AS (
    SELECT l.id, l.nombre, l.apellido, l.ig_username, l.avatar_url, l.pais, l.email,
           ('Calendario enviado' = ANY(l.etiquetas)) AS calendario_enviado,
           ('Reunión agendada' = ANY(l.etiquetas)) AS reunion_agendada,
           l.mensajes_sin_leer::int AS mensajes_sin_leer, l.propietario_id, l.creado_en,
           COALESCE(l.ultimo_mensaje_en, l.creado_en) AS actividad,
           u.nombre AS responsable,
           c.titulo AS contenido,
           op.oportunidad_id, op.etapa_id, op.etapa, op.etapa_color, op.pipeline_id,
           left(um.cuerpo, 160) AS ultimo_texto, um.direccion AS ultimo_dir, um.estado AS ultimo_estado,
           um.enviado_por AS ultimo_enviado_por, um.autor_nombre AS ultimo_autor_nombre,
           um.recurso_tipo AS ultimo_recurso_tipo, um.ocurrido_en AS ultimo_en,
           ue.ultimo_entrante,
           NULLIF(l.campos_extra->>'chat_archivado_en', '')::timestamptz AS archivado_en,
           EXISTS (SELECT 1 FROM flujo_ejecuciones fe
                    WHERE fe.cuenta_id = l.cuenta_id AND fe.lead_id = l.id AND fe.estado = 'esperando') AS flujo_esperando
      FROM leads l
      LEFT JOIN usuarios u ON u.id = l.propietario_id
      LEFT JOIN contenidos c ON c.id = l.primer_contenido_id
      LEFT JOIN LATERAL (
        SELECT o.id AS oportunidad_id, o.etapa_id, o.pipeline_id, e.nombre AS etapa, e.color AS etapa_color
          FROM oportunidades o JOIN etapas e ON e.id = o.etapa_id
         WHERE o.lead_id = l.id AND o.cuenta_id = l.cuenta_id
         ORDER BY (o.estado = 'abierta') DESC, o.abierta_en DESC
         LIMIT 1
      ) op ON true
      LEFT JOIN LATERAL (
        SELECT m.cuerpo, m.direccion, m.estado, m.enviado_por, m.ocurrido_en, r.tipo AS recurso_tipo, uu.nombre AS autor_nombre
          FROM mensajes m
          LEFT JOIN recursos r ON r.id = m.recurso_id
          LEFT JOIN usuarios uu ON uu.id = m.enviado_por
         WHERE m.lead_id = l.id
         ORDER BY m.ocurrido_en DESC, m.creado_en DESC
         LIMIT 1
      ) um ON true
      LEFT JOIN LATERAL (
        SELECT max(m.ocurrido_en) AS ultimo_entrante FROM mensajes m
         WHERE m.lead_id = l.id AND m.direccion = 'entrante'
      ) ue ON true
     WHERE l.cuenta_id = $1
  ), bandeja AS (
    SELECT b.*,
           (b.ultimo_dir IS NOT NULL OR b.mensajes_sin_leer > 0) AS con_conversacion,
           (b.archivado_en IS NOT NULL AND (b.ultimo_entrante IS NULL OR b.ultimo_entrante <= b.archivado_en)) AS archivado,
           (b.ultimo_entrante IS NOT NULL AND b.ultimo_entrante > now() - interval '24 hours') AS ventana_abierta,
           CASE WHEN b.ultimo_entrante IS NOT NULL THEN b.ultimo_entrante + interval '24 hours' END AS ventana_cierra_en,
           CASE WHEN b.ultimo_dir = 'entrante' THEN 'lead'
                WHEN b.ultimo_dir IS NULL THEN NULL
                WHEN b.ultimo_enviado_por IS NOT NULL AND b.ultimo_enviado_por = $2::uuid THEN 'yo'
                WHEN b.ultimo_enviado_por IS NOT NULL THEN 'equipo'
                ELSE 'automatico' END AS ultimo_autor,
           floor(extract(epoch FROM b.actividad) * 1000000)::bigint AS actividad_us
      FROM base b
  )`;

/** Condición SQL de cada filtro sobre la CTE "bandeja". */
const CONDICION: Record<FiltroChat, string> = {
  por_responder: `con_conversacion AND NOT archivado AND ultimo_dir = 'entrante'`,
  sin_leer: `NOT archivado AND mensajes_sin_leer > 0`,
  mios: `con_conversacion AND NOT archivado AND propietario_id = $2::uuid`,
  se_cierra: `NOT archivado AND ventana_abierta AND ultimo_entrante <= now() - interval '20 hours'`,
  automensaje: `NOT archivado AND flujo_esperando`,
  todos: `con_conversacion AND NOT archivado`,
  sin_conversacion: `NOT con_conversacion AND NOT archivado`,
  archivados: `archivado`,
};

const COLUMNAS = `id, nombre, apellido, ig_username, avatar_url, pais, mensajes_sin_leer, propietario_id, responsable,
  contenido, oportunidad_id, etapa_id, etapa, etapa_color, pipeline_id, ultimo_texto, ultimo_dir, ultimo_estado,
  ultimo_autor, ultimo_autor_nombre, ultimo_recurso_tipo, ultimo_en, actividad, ultimo_entrante, ventana_cierra_en,
  ventana_abierta, flujo_esperando, archivado, con_conversacion, actividad_us`;

/**
 * "%olivia%" en minúsculas y sin tildes (así "tomas" encuentra a "Tomás"),
 * escapando los comodines de LIKE. Sin la @ del principio.
 */
function patron(q: string) {
  const limpio = q.trim().replace(/^@+/, '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${limpio}%`;
}
/** La misma normalización del lado de la base. */
const sinTildes = (col: string) =>
  `translate(lower(coalesce(${col}, '')), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc')`;

export default async function rutasUx_chat(app: FastifyInstance) {
  /**
   * Bandeja del setter, paginada y con búsqueda en el servidor.
   *   ?filtro=por_responder|sin_leer|mios|se_cierra|automensaje|todos|sin_conversacion|archivados
   *   ?q=texto  → busca en TODOS los leads (nombre, apellido, @usuario, email) e ignora el filtro
   *   ?cursor=<lo que devolvió "siguiente">  &limite=40
   * Devuelve { items, siguiente, conteos } (conteos solo en la primera página).
   */
  app.get('/conversaciones', async (req) => {
    const p = z.object({
      filtro: z.enum(FILTROS_CHAT).default('todos'),
      q: z.string().max(120).optional(),
      cursor: z.string().max(80).optional(),
      limite: z.coerce.number().int().min(1).max(100).default(40),
    }).parse(req.query ?? {});
    const cuenta = req.sesion.cuentaId;
    const usuario = usuarioDe(req);
    const q = p.q?.trim() ?? '';
    // Como la lista vieja: aprovecha para reanudar automensajes cuya espera por
    // tiempo ya venció (sin websockets ni cron, la bandeja hace de "reloj").
    if (!p.cursor) procesarEsperasVencidas(cuenta, 5).catch(() => {});
    if (!p.cursor) procesarEnviosProgramados(cuenta).catch(() => {});

    const params: any[] = [cuenta, usuario];
    const donde: string[] = [];
    if (q) {
      params.push(patron(q));
      const n = params.length;
      donde.push(`(${sinTildes(`nombre || ' ' || coalesce(apellido, '')`)} LIKE $${n}
                   OR ${sinTildes('apellido')} LIKE $${n} OR lower(coalesce(ig_username, '')) LIKE $${n}
                   OR lower(coalesce(email, '')) LIKE $${n})`);
    } else {
      donde.push(CONDICION[p.filtro]);
    }
    if (p.cursor) {
      const m = /^(\d{1,20})_([0-9a-f-]{36})$/i.exec(p.cursor);
      if (!m) throw peticionInvalida('Cursor inválido');
      params.push(m[1], m[2]);
      donde.push(`(actividad_us, id) < ($${params.length - 1}::bigint, $${params.length}::uuid)`);
    }
    params.push(p.limite + 1);
    const filas = await query(
      `${BANDEJA}
       SELECT ${COLUMNAS} FROM bandeja
        WHERE ${donde.join(' AND ')}
        ORDER BY actividad_us DESC, id DESC
        LIMIT $${params.length}`, params);

    const hayMas = filas.length > p.limite;
    const items = filas.slice(0, p.limite);
    const ultimo = items[items.length - 1];
    const siguiente = hayMas && ultimo ? `${ultimo.actividad_us}_${ultimo.id}` : null;

    let conteos: Record<FiltroChat, number> | undefined;
    if (!p.cursor) {
      const c = await queryOne(
        `${BANDEJA}
         SELECT ${FILTROS_CHAT.map((f) => `count(*) FILTER (WHERE ${CONDICION[f]})::int AS ${f}`).join(', ')}
           FROM bandeja`, [cuenta, usuario]);
      conteos = Object.fromEntries(FILTROS_CHAT.map((f) => [f, Number(c?.[f] ?? 0)])) as Record<FiltroChat, number>;
    }
    return { items: items.map(({ actividad_us, ...resto }) => resto), siguiente, conteos };
  });

  /** Marcar como leído / no leído (deslizar la fila o desde el menú ⋯). */
  app.post('/:leadId/leido', async (req) => {
    const leadId = leadIdDe(req);
    const d = z.object({ leido: z.boolean() }).parse(req.body ?? {});
    const fila = await queryOne(
      `UPDATE leads SET mensajes_sin_leer = CASE WHEN $3 THEN 0 ELSE GREATEST(mensajes_sin_leer, 1) END
        WHERE cuenta_id = $1 AND id = $2 RETURNING mensajes_sin_leer`, [req.sesion.cuentaId, leadId, d.leido]);
    if (!fila) throw noEncontrado('Lead');
    return { mensajes_sin_leer: Number(fila.mensajes_sin_leer) };
  });

  /**
   * Archivar una conversación (sale de la bandeja). Vuelve sola cuando el
   * lead escribe de nuevo. Archivar también la da por leída.
   */
  app.post('/:leadId/archivar', async (req) => {
    const leadId = leadIdDe(req);
    const d = z.object({ archivado: z.boolean() }).parse(req.body ?? {});
    const fila = await queryOne(
      `UPDATE leads
          SET campos_extra = CASE WHEN $3
                THEN COALESCE(campos_extra, '{}'::jsonb) || jsonb_build_object('chat_archivado_en', now())
                ELSE COALESCE(campos_extra, '{}'::jsonb) - 'chat_archivado_en' END,
              mensajes_sin_leer = CASE WHEN $3 THEN 0 ELSE mensajes_sin_leer END
        WHERE cuenta_id = $1 AND id = $2 RETURNING id`, [req.sesion.cuentaId, leadId, d.archivado]);
    if (!fila) throw noEncontrado('Lead');
    return { archivado: d.archivado };
  });

  /** Quién lo atiende. usuario_id null = sin asignar. */
  app.post('/:leadId/asignar', async (req) => {
    const leadId = leadIdDe(req);
    const d = z.object({ usuario_id: z.string().uuid().nullable() }).parse(req.body ?? {});
    const cuenta = req.sesion.cuentaId;
    const lead = await queryOne(`SELECT id, propietario_id FROM leads WHERE cuenta_id = $1 AND id = $2`, [cuenta, leadId]);
    if (!lead) throw noEncontrado('Lead');
    let nombre: string | null = null;
    if (d.usuario_id) {
      const u = await queryOne(`SELECT id, nombre FROM usuarios WHERE cuenta_id = $1 AND id = $2 AND activo`, [cuenta, d.usuario_id]);
      if (!u) throw noEncontrado('Persona del equipo');
      nombre = u.nombre;
    }
    await pool.query(`UPDATE leads SET propietario_id = $3 WHERE cuenta_id = $1 AND id = $2`, [cuenta, leadId, d.usuario_id]);
    await pool.query(
      `UPDATE oportunidades SET propietario_id = $3 WHERE cuenta_id = $1 AND lead_id = $2 AND estado = 'abierta'`,
      [cuenta, leadId, d.usuario_id]);
    return { propietario_id: d.usuario_id, responsable: nombre, anterior_id: lead.propietario_id ?? null };
  });

  /**
   * Pasar al lead a una etapa desde el Chat. Si ya tiene oportunidad en ese
   * pipeline la mueve (con sus acciones automáticas); si no, lo mete en el
   * pipeline y lo lleva a esa etapa.
   */
  app.post('/:leadId/etapa', async (req) => {
    const leadId = leadIdDe(req);
    const d = z.object({
      etapa_id: z.string().uuid(),
      // "Deshacer": volver a la etapa anterior SIN repetir sus automatizaciones.
      sin_acciones: z.boolean().optional(),
    }).parse(req.body ?? {});
    const cuenta = req.sesion.cuentaId;
    const usuario = usuarioDe(req);
    const sinAcciones = d.sin_acciones === true;
    const etapa = await queryOne(
      `SELECT id, pipeline_id, nombre, color, tipo FROM etapas WHERE id = $1 AND cuenta_id = $2`, [d.etapa_id, cuenta]);
    if (!etapa) throw noEncontrado('Etapa');
    const lead = await queryOne(`SELECT id, propietario_id FROM leads WHERE cuenta_id = $1 AND id = $2`, [cuenta, leadId]);
    if (!lead) throw noEncontrado('Lead');

    const opp = await queryOne(
      `SELECT id, etapa_id FROM oportunidades
        WHERE cuenta_id = $1 AND lead_id = $2 AND pipeline_id = $3
        ORDER BY (estado = 'abierta') DESC, abierta_en DESC LIMIT 1`, [cuenta, leadId, etapa.pipeline_id]);
    if (opp) {
      if (opp.etapa_id === etapa.id) return { oportunidad_id: opp.id, etapa, desde_etapa_id: opp.etapa_id, creada: false, movido: false };
      await moverEtapa(cuenta, opp.id, etapa.id, pool, { origen: 'manual', usuarioId: usuario, sinAcciones });
      return { oportunidad_id: opp.id, etapa, desde_etapa_id: opp.etapa_id, creada: false, movido: true };
    }
    // Sin oportunidad en ese pipeline: entra por la primera etapa y, si hace
    // falta, se mueve a la elegida (así corren sus acciones e historial).
    const primera = await queryOne(
      `SELECT id FROM etapas WHERE pipeline_id = $1 AND cuenta_id = $2 AND tipo = 'abierta' ORDER BY orden ASC LIMIT 1`,
      [etapa.pipeline_id, cuenta]);
    const nueva = await queryOne(
      `INSERT INTO oportunidades (cuenta_id, lead_id, pipeline_id, etapa_id, propietario_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [cuenta, leadId, etapa.pipeline_id, primera?.id ?? etapa.id, lead.propietario_id ?? usuario]);
    if (!nueva) throw peticionInvalida('No se pudo meter al lead en el pipeline. Probá de nuevo.');
    if ((primera?.id ?? etapa.id) !== etapa.id) {
      await moverEtapa(cuenta, nueva.id, etapa.id, pool, { origen: 'manual', usuarioId: usuario, sinAcciones });
    }
    return { oportunidad_id: nueva.id, etapa, desde_etapa_id: null, creada: true, movido: true };
  });

  /**
   * Cortar los automensajes que esperan a este lead (cuando el setter toma
   * la conversación a mano y no quiere que le llegue un mensaje automático).
   */
  // Volver a dejar que los automensajes le respondan (después de pausarlos al escribirle a mano).
  app.post('/:leadId/reanudar-automensajes', async (req) => {
    const leadId = leadIdDe(req);
    await pool.query(`UPDATE leads SET automensajes_pausados_hasta = NULL WHERE cuenta_id = $1 AND id = $2`, [req.sesion.cuentaId, leadId]);
    return { ok: true };
  });

  app.post('/:leadId/cortar-automensajes', async (req) => {
    const leadId = leadIdDe(req);
    const filas = await query(
      `UPDATE flujo_ejecuciones
          SET estado = 'cancelado', esperando = NULL, reanudar_en = NULL, actualizado_en = now()
        WHERE cuenta_id = $1 AND lead_id = $2 AND estado = 'esperando'
        RETURNING id`, [req.sesion.cuentaId, leadId]);
    return { cortados: filas.length };
  });

  /**
   * Editar un atajo: nombre y, según el tipo, el texto de la respuesta
   * rápida, la URL del enlace o el archivo (volver a grabar un audio,
   * reemplazar un PDF), sin perder su lugar ni lo que se usó.
   */
  app.patch('/recursos/:id', async (req) => {
    const { id } = req.params as { id: string };
    if (!UUID.test(id ?? '')) throw noEncontrado('Atajo');
    const d = z.object({
      nombre: z.string().trim().min(1, 'Ponele un nombre').max(80).optional(),
      texto: z.string().trim().min(1, 'El texto está vacío').max(1000, 'Instagram no deja mandar más de 1000 caracteres').optional(),
      url: z.string().trim().max(2000).optional(),
      archivo_base64: z.string().max(Math.ceil(MAX_BYTES * 1.4) + 200, 'El archivo pasa de ~3 MB').optional(),
      mime: z.string().max(120).optional(),
    }).parse(req.body ?? {});
    const cuenta = req.sesion.cuentaId;
    const r = await queryOne(`SELECT id, tipo FROM recursos WHERE cuenta_id = $1 AND id = $2`, [cuenta, id]);
    if (!r) throw noEncontrado('Atajo');
    if (d.texto !== undefined && r.tipo !== 'texto') throw peticionInvalida('Solo las respuestas rápidas tienen texto');
    if (d.url !== undefined) {
      if (r.tipo !== 'link') throw peticionInvalida('Solo los enlaces tienen dirección');
      if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(d.url)) throw peticionInvalida('El enlace tiene que empezar con https://');
    }
    let datos: Buffer | null = null;
    if (d.archivo_base64 !== undefined) {
      if (!['audio', 'pdf', 'imagen', 'video'].includes(r.tipo)) throw peticionInvalida('Este atajo no lleva archivo');
      datos = Buffer.from(d.archivo_base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
      if (!datos.length) throw peticionInvalida('El archivo está vacío');
      if (datos.length > MAX_BYTES) throw peticionInvalida('El archivo pasa de ~3 MB. Grabalo más corto o usá uno más liviano.');
    }
    const sets: string[] = [];
    const params: any[] = [cuenta, id];
    for (const campo of ['nombre', 'texto', 'url'] as const) {
      if (d[campo] === undefined) continue;
      params.push(d[campo]);
      sets.push(`${campo} = $${params.length}`);
    }
    if (datos) {
      params.push(datos);
      sets.push(`datos = $${params.length}`);
      if (d.mime) { params.push(d.mime); sets.push(`mime = $${params.length}`); }
    }
    if (!sets.length) throw peticionInvalida('No hay nada para cambiar');
    return queryOne(
      `UPDATE recursos SET ${sets.join(', ')} WHERE cuenta_id = $1 AND id = $2
       RETURNING id, nombre, tipo, texto, url, mime`, params);
  });

  /** Duplicar un atajo: la copia queda justo debajo del original. */
  app.post('/recursos/:id/duplicar', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!UUID.test(id ?? '')) throw noEncontrado('Atajo');
    const cuenta = req.sesion.cuentaId;
    const original = await queryOne(`SELECT id, length(datos) AS bytes FROM recursos WHERE cuenta_id = $1 AND id = $2`, [cuenta, id]);
    if (!original) throw noEncontrado('Atajo');
    if (Number(original.bytes ?? 0) > MAX_BYTES) throw peticionInvalida('Ese archivo es muy pesado para duplicarlo');
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      // Orden explícito y con huecos (0, 2, 4…) para poder meter la copia al lado.
      await cliente.query(
        `UPDATE recursos r SET orden = x.pos * 2
           FROM (SELECT id, row_number() OVER (ORDER BY orden ASC NULLS LAST, creado_en DESC) AS pos
                   FROM recursos WHERE cuenta_id = $1) x
          WHERE r.id = x.id`, [cuenta]);
      const { rows } = await cliente.query(
        `INSERT INTO recursos (cuenta_id, nombre, tipo, descripcion, mime, datos, url, texto, etiquetas, creado_por, orden)
         SELECT cuenta_id, left(nombre, 72) || ' (copia)', tipo, descripcion, mime, datos, url, texto, etiquetas, $3, orden + 1
           FROM recursos WHERE cuenta_id = $1 AND id = $2
         RETURNING id, nombre, tipo, texto, url`, [cuenta, id, usuarioDe(req)]);
      await cliente.query('COMMIT');
      return reply.code(201).send(rows[0]);
    } catch (e) {
      await cliente.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  });
}
