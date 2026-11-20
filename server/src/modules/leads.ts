import { query, queryOne } from '../db/pool.js';
import { noEncontrado } from '../lib/errores.js';
import { recomputarScore, gradoDe } from './infoproduccion.js';

export interface FiltrosLeads {
  q?: string;
  etapaId?: string;
  pipelineId?: string;
  contenidoId?: string;
  automatizacionId?: string;
  etiqueta?: string;
  propietarioId?: string;
  estado?: string;
  calificacion?: string;
  desde?: string;
  hasta?: string;
  sinAtribuir?: boolean;
  limite?: number;
  offset?: number;
  orden?: 'reciente' | 'valor' | 'antiguo' | 'score';
}

const SELECT_LEAD = `
  SELECT l.*,
         o.id                AS oportunidad_id,
         o.etapa_id,
         o.valor             AS oportunidad_valor,
         o.estado            AS oportunidad_estado,
         o.reunion_agendada_en,
         o.reunion_realizada_en,
         e.nombre            AS etapa_nombre,
         e.slug              AS etapa_slug,
         e.color             AS etapa_color,
         e.orden             AS etapa_orden,
         c.titulo            AS contenido_titulo,
         c.permalink         AS contenido_permalink,
         c.thumbnail_url     AS contenido_thumbnail,
         c.tipo              AS contenido_tipo,
         a.palabra_clave     AS palabra_clave,
         u.nombre            AS propietario_nombre
    FROM leads l
    LEFT JOIN LATERAL (
      SELECT * FROM oportunidades o2
       WHERE o2.lead_id = l.id
       ORDER BY (o2.estado = 'abierta') DESC, o2.abierta_en DESC LIMIT 1
    ) o ON true
    LEFT JOIN etapas e            ON e.id = o.etapa_id
    LEFT JOIN contenidos c        ON c.id = l.primer_contenido_id
    LEFT JOIN automatizaciones a  ON a.id = l.primer_automatizacion_id
    LEFT JOIN usuarios u          ON u.id = l.propietario_id`;

const JOIN_OPORTUNIDAD = `
  LEFT JOIN LATERAL (
    SELECT * FROM oportunidades o2 WHERE o2.lead_id = l.id
     ORDER BY (o2.estado = 'abierta') DESC, o2.abierta_en DESC LIMIT 1
  ) o ON true`;

export async function listarLeads(cuentaId: string, f: FiltrosLeads = {}) {
  const limite = Math.min(f.limite ?? 50, 500);
  const offset = f.offset ?? 0;

  const condiciones: string[] = ['l.cuenta_id = $1'];
  const params: any[] = [cuentaId];
  const add = (sql: string, valor: any) => {
    params.push(valor);
    condiciones.push(sql.replaceAll('$n', `$${params.length}`));
  };

  if (f.q) add(`(l.ig_username ILIKE '%'||$n||'%' OR l.nombre ILIKE '%'||$n||'%' OR l.email ILIKE '%'||$n||'%')`, f.q);
  if (f.etapaId) add('o.etapa_id = $n::uuid', f.etapaId);
  if (f.pipelineId) add('o.pipeline_id = $n::uuid', f.pipelineId);
  if (f.contenidoId) add('l.primer_contenido_id = $n::uuid', f.contenidoId);
  if (f.automatizacionId) add('l.primer_automatizacion_id = $n::uuid', f.automatizacionId);
  if (f.etiqueta) add('$n = ANY(l.etiquetas)', f.etiqueta);
  if (f.propietarioId) add('l.propietario_id = $n::uuid', f.propietarioId);
  if (f.estado) add('l.estado = $n', f.estado);
  if (f.calificacion) add('l.calificacion = $n', f.calificacion);
  if (f.desde) add('l.primer_contacto_en >= $n::timestamptz', f.desde);
  if (f.hasta) add('l.primer_contacto_en < $n::timestamptz', f.hasta);
  if (f.sinAtribuir) condiciones.push('l.primer_contenido_id IS NULL');

  const orden =
    f.orden === 'valor' ? 'l.valor_total DESC, l.ultimo_contacto_en DESC'
    : f.orden === 'antiguo' ? 'l.primer_contacto_en ASC'
    : f.orden === 'score' ? 'l.score DESC, l.ultimo_contacto_en DESC'
    : 'l.ultimo_contacto_en DESC';

  const where = condiciones.join(' AND ');
  const paramsLista = [...params, limite, offset];

  const filas = await query(
    `${SELECT_LEAD} WHERE ${where} ORDER BY ${orden} LIMIT $${paramsLista.length - 1} OFFSET $${paramsLista.length}`,
    paramsLista,
  );

  const [conteo] = await query(
    `SELECT COUNT(*)::int AS total FROM leads l ${JOIN_OPORTUNIDAD} WHERE ${where}`,
    params,
  );

  return { leads: filas, total: conteo?.total ?? 0, limite, offset };
}

export async function obtenerLead(cuentaId: string, leadId: string) {
  const lead = await queryOne(`${SELECT_LEAD} WHERE l.cuenta_id = $1 AND l.id = $2`, [cuentaId, leadId]);
  if (!lead) throw noEncontrado('Lead');

  const [oportunidades, eventos, toques, notas] = await Promise.all([
    query(
      `SELECT o.*, e.nombre AS etapa_nombre, e.color AS etapa_color, e.slug AS etapa_slug,
              p.nombre AS pipeline_nombre
         FROM oportunidades o
         JOIN etapas e ON e.id = o.etapa_id
         JOIN pipelines p ON p.id = o.pipeline_id
        WHERE o.lead_id = $1 ORDER BY o.abierta_en DESC`, [leadId]),
    query(
      `SELECT ev.id, ev.tipo, ev.titulo, ev.valor, ev.moneda, ev.fuente, ev.ocurrido_en,
              c.titulo AS contenido_titulo, c.permalink AS contenido_permalink,
              a.palabra_clave
         FROM eventos ev
         LEFT JOIN contenidos c ON c.id = ev.contenido_id
         LEFT JOIN automatizaciones a ON a.id = ev.automatizacion_id
        WHERE ev.lead_id = $1 ORDER BY ev.ocurrido_en DESC, ev.id DESC LIMIT 200`, [leadId]),
    query(
      `SELECT t.*, c.titulo AS contenido_titulo, c.permalink, a.palabra_clave
         FROM toques t
         LEFT JOIN contenidos c ON c.id = t.contenido_id
         LEFT JOIN automatizaciones a ON a.id = t.automatizacion_id
        WHERE t.lead_id = $1 ORDER BY t.ocurrido_en ASC`, [leadId]),
    query(
      `SELECT n.*, u.nombre AS usuario_nombre FROM notas n
         LEFT JOIN usuarios u ON u.id = n.usuario_id
        WHERE n.lead_id = $1 ORDER BY n.creado_en DESC`, [leadId]),
  ]);

  return { ...lead, oportunidades, eventos, toques, notas };
}

export async function actualizarLead(cuentaId: string, leadId: string, datos: Record<string, any>) {
  const permitidos = ['nombre', 'apellido', 'email', 'telefono', 'pais', 'idioma',
                      'estado', 'etiquetas', 'propietario_id', 'ig_username',
                      'modelo_negocio', 'ingresos_aprox', 'cuello_botella',
                      'calificacion', 'motivo_descarte',
                      'calif_c1', 'calif_c2', 'calif_c3'];
  const sets: string[] = [];
  const params: any[] = [cuentaId, leadId];

  for (const campo of permitidos) {
    if (campo in datos) {
      params.push(datos[campo]);
      sets.push(`${campo} = $${params.length}`);
    }
  }

  // Si tocó algún criterio de calificación, recalcula el grado (DSBA).
  if (['calif_c1', 'calif_c2', 'calif_c3'].some((c) => c in datos)) {
    const actual = await queryOne(
      `SELECT calif_c1, calif_c2, calif_c3 FROM leads WHERE cuenta_id = $1 AND id = $2`,
      [cuentaId, leadId]);
    if (!actual) throw noEncontrado('Lead');
    const c1 = 'calif_c1' in datos ? !!datos.calif_c1 : actual.calif_c1;
    const c2 = 'calif_c2' in datos ? !!datos.calif_c2 : actual.calif_c2;
    const c3 = 'calif_c3' in datos ? !!datos.calif_c3 : actual.calif_c3;
    params.push(gradoDe(c1, c2, c3));
    sets.push(`grado = $${params.length}`);
  }

  if (sets.length === 0) return obtenerLead(cuentaId, leadId);

  const fila = await queryOne(
    `UPDATE leads SET ${sets.join(', ')} WHERE cuenta_id = $1 AND id = $2 RETURNING id`,
    params,
  );
  if (!fila) throw noEncontrado('Lead');

  // Si cambió algo que afecta al score (datos de calificación), recalcúlalo.
  // La calificación puesta a mano NO se pisa: recomputarScore solo promueve
  // desde "sin_calificar".
  if (['modelo_negocio', 'ingresos_aprox', 'cuello_botella'].some((c) => c in datos)) {
    await recomputarScore(leadId);
  }
  return obtenerLead(cuentaId, leadId);
}

export async function crearNota(cuentaId: string, leadId: string, usuarioId: string | null, cuerpo: string) {
  return queryOne(
    `INSERT INTO notas (cuenta_id, lead_id, usuario_id, cuerpo) VALUES ($1,$2,$3,$4) RETURNING *`,
    [cuentaId, leadId, usuarioId, cuerpo],
  );
}

/** Vista kanban: oportunidades agrupadas por etapa. */
export interface FiltrosKanban {
  /** Texto: usuario, nombre, etiquetas o responsable. */
  q?: string;
  /** 'mios' (los que atiende usuarioId) o 'sin' (sin responsable). */
  propietario?: 'mios' | 'sin';
  usuarioId?: string;
  /** Solo con mensajes sin leer. */
  sinLeer?: boolean;
}

/**
 * Tablero del pipeline. Los filtros se aplican en la base ANTES del límite
 * por etapa: buscar encuentra a cualquiera, no solo a los primeros 50.
 * Cada etapa trae `total` (todos los de la etapa) y `coinciden` (con filtros).
 * Orden: última actividad primero (lo que se mueve, arriba).
 */
export async function kanban(cuentaId: string, pipelineId?: string, limitePorEtapa = 50, filtros: FiltrosKanban = {}) {
  const etapas = await query(
    `SELECT e.* FROM etapas e
       JOIN pipelines p ON p.id = e.pipeline_id
      WHERE e.cuenta_id = $1 AND ($2::uuid IS NULL OR e.pipeline_id = $2::uuid)
        AND p.activo
      ORDER BY p.es_predeterminado DESC, e.orden ASC`,
    [cuentaId, pipelineId ?? null],
  );

  // Totales de cada etapa (sin filtros): para "3 de 232".
  const totalesFilas = await query(
    `SELECT o.etapa_id, COUNT(*)::int AS n, COALESCE(SUM(o.valor), 0) AS valor
       FROM oportunidades o
      WHERE o.cuenta_id = $1 AND ($2::uuid IS NULL OR o.pipeline_id = $2::uuid)
      GROUP BY o.etapa_id`,
    [cuentaId, pipelineId ?? null],
  );
  const totales = new Map<string, { n: number; valor: number }>(
    totalesFilas.map((r: any) => [r.etapa_id, { n: Number(r.n), valor: Number(r.valor) }]));

  const q = filtros.q?.trim().replace(/^@/, '') || null;
  const propietario = filtros.propietario === 'mios' && filtros.usuarioId ? 'mios' : filtros.propietario === 'sin' ? 'sin' : null;
  const tarjetas = await query(
    `SELECT * FROM (
       SELECT o.id AS oportunidad_id, o.etapa_id, o.valor, o.estado, o.abierta_en,
              o.reunion_agendada_en,
              l.id AS lead_id, l.nombre, l.ig_username, l.avatar_url, l.etiquetas, l.valor_total,
              l.mensajes_sin_leer,
              GREATEST(o.abierta_en, COALESCE(l.ultimo_contacto_en, o.abierta_en),
                       COALESCE(l.ultimo_mensaje_en, o.abierta_en)) AS ultima_actividad,
              c.titulo AS contenido_titulo, c.tipo AS contenido_tipo,
              u.id AS propietario_id, u.nombre AS propietario_nombre,
              COUNT(*) OVER (PARTITION BY o.etapa_id) AS coinciden,
              row_number() OVER (PARTITION BY o.etapa_id ORDER BY GREATEST(o.abierta_en, COALESCE(l.ultimo_contacto_en, o.abierta_en),
                       COALESCE(l.ultimo_mensaje_en, o.abierta_en)) DESC, o.id) AS rn
         FROM oportunidades o
         JOIN leads l ON l.id = o.lead_id
         LEFT JOIN contenidos c ON c.id = o.contenido_id
         LEFT JOIN usuarios u ON u.id = COALESCE(o.propietario_id, l.propietario_id)
        WHERE o.cuenta_id = $1 AND ($2::uuid IS NULL OR o.pipeline_id = $2::uuid)
          AND ($3::text IS NULL OR l.ig_username ILIKE '%' || $3 || '%' OR l.nombre ILIKE '%' || $3 || '%'
               OR l.email ILIKE '%' || $3 || '%' OR array_to_string(l.etiquetas, ' ') ILIKE '%' || $3 || '%'
               OR u.nombre ILIKE '%' || $3 || '%')
          AND ($4::text IS NULL
               OR ($4 = 'mios' AND COALESCE(o.propietario_id, l.propietario_id) = $5::uuid)
               OR ($4 = 'sin' AND COALESCE(o.propietario_id, l.propietario_id) IS NULL))
          AND (NOT $6::boolean OR l.mensajes_sin_leer > 0)
     ) t WHERE t.rn <= $7
     ORDER BY t.etapa_id, t.rn`,
    [cuentaId, pipelineId ?? null, q, propietario, filtros.usuarioId ?? null, Boolean(filtros.sinLeer), limitePorEtapa],
  );

  const porEtapa = new Map<string, any[]>();
  const coinciden = new Map<string, number>();
  for (const t of tarjetas) {
    coinciden.set(t.etapa_id, Number(t.coinciden));
    const lista = porEtapa.get(t.etapa_id) ?? [];
    lista.push(t);
    porEtapa.set(t.etapa_id, lista);
  }

  return etapas.map((e: any) => ({
    ...e,
    total: totales.get(e.id)?.n ?? 0,
    valor_total: totales.get(e.id)?.valor ?? 0,
    coinciden: coinciden.get(e.id) ?? 0,
    tarjetas: porEtapa.get(e.id) ?? [],
  }));
}

export async function etiquetasUsadas(cuentaId: string) {
  return query(
    `SELECT unnest(etiquetas) AS etiqueta, COUNT(*)::int AS n
       FROM leads WHERE cuenta_id = $1 GROUP BY 1 ORDER BY n DESC`,
    [cuentaId],
  );
}
