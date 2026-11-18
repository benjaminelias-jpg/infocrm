import { query } from '../db/pool.js';
import { truncar } from '../lib/utils.js';

export interface Filtros {
  desde?: string | null;
  hasta?: string | null;
  pipelineId?: string | null;
  /** primer_toque = el reel que lo trajo. ultimo_toque = el último que tocó. */
  modelo?: 'primer_toque' | 'ultimo_toque';
}

function columnaAtribucion(modelo?: string) {
  return modelo === 'ultimo_toque' ? 'ultimo_contenido_id' : 'primer_contenido_id';
}

/**
 * Rendimiento por contenido. Es la pantalla que responde a
 * "de este reel vinieron tantos leads, tantas reuniones y tantas ventas".
 *
 * El periodo filtra por COHORTE: leads que entraron en esas fechas, con
 * todo lo que hicieron después, aunque la venta llegara más tarde. Es la
 * única forma honesta de medir el retorno de un contenido.
 */
export async function rendimientoPorContenido(cuentaId: string, f: Filtros = {}) {
  const col = columnaAtribucion(f.modelo);
  const params = [cuentaId, f.desde ?? null, f.hasta ?? null];

  const filas = await query(
    `WITH base AS (
       SELECT l.id AS lead_id, l.${col} AS contenido_id, l.valor_total
         FROM leads l
        WHERE l.cuenta_id = $1
          AND ($2::timestamptz IS NULL OR l.primer_contacto_en >= $2::timestamptz)
          AND ($3::timestamptz IS NULL OR l.primer_contacto_en <  $3::timestamptz)
     ),
     agg AS (
       SELECT b.contenido_id,
              COUNT(DISTINCT b.lead_id)                                                     AS leads,
              COUNT(DISTINCT o.id) FILTER (WHERE o.reunion_agendada_en IS NOT NULL)         AS reuniones_agendadas,
              COUNT(DISTINCT o.id) FILTER (WHERE o.reunion_realizada_en IS NOT NULL)        AS reuniones_realizadas,
              COUNT(DISTINCT o.id) FILTER (WHERE o.reunion_no_asistio)                      AS no_shows
         FROM base b
         LEFT JOIN oportunidades o ON o.lead_id = b.lead_id
        GROUP BY b.contenido_id
     ),
     vts AS (
       SELECT b.contenido_id,
              COUNT(e.id)                  AS ventas,
              COALESCE(SUM(e.valor), 0)    AS ingresos
         FROM base b
         JOIN eventos e ON e.lead_id = b.lead_id AND e.tipo = 'venta'
        GROUP BY b.contenido_id
     ),
     conf AS (
       SELECT t.contenido_id,
              COUNT(*) FILTER (WHERE t.confianza = 'baja') AS toques_dudosos
         FROM toques t WHERE t.cuenta_id = $1 GROUP BY t.contenido_id
     )
     SELECT c.id, c.titulo, c.tipo, c.permalink, c.thumbnail_url, c.publicado_en,
            c.ig_alcance, c.ig_reproducciones, c.ig_comentarios, c.etiquetas,
            c.angulo, c.etapa_embudo, c.rol_manual,
            COALESCE(a.leads, 0)                 AS leads,
            COALESCE(a.reuniones_agendadas, 0)   AS reuniones_agendadas,
            COALESCE(a.reuniones_realizadas, 0)  AS reuniones_realizadas,
            COALESCE(a.no_shows, 0)              AS no_shows,
            COALESCE(v.ventas, 0)                AS ventas,
            COALESCE(v.ingresos, 0)              AS ingresos,
            COALESCE(cf.toques_dudosos, 0)       AS toques_dudosos
       FROM contenidos c
       LEFT JOIN agg  a ON a.contenido_id = c.id
       LEFT JOIN vts  v ON v.contenido_id = c.id
       LEFT JOIN conf cf ON cf.contenido_id = c.id
      WHERE c.cuenta_id = $1 AND c.activo
      ORDER BY COALESCE(v.ingresos,0) DESC, COALESCE(a.leads,0) DESC, c.publicado_en DESC NULLS LAST`,
    params,
  );

  // Fila de leads que no se pudieron atribuir a ningún contenido
  const [sinAtribuir] = await query(
    `WITH base AS (
       SELECT l.id AS lead_id FROM leads l
        WHERE l.cuenta_id = $1 AND l.${col} IS NULL
          AND ($2::timestamptz IS NULL OR l.primer_contacto_en >= $2::timestamptz)
          AND ($3::timestamptz IS NULL OR l.primer_contacto_en <  $3::timestamptz)
     )
     SELECT (SELECT COUNT(*) FROM base) AS leads,
            (SELECT COUNT(DISTINCT o.id) FROM oportunidades o JOIN base b ON b.lead_id = o.lead_id
              WHERE o.reunion_agendada_en IS NOT NULL) AS reuniones_agendadas,
            (SELECT COUNT(DISTINCT o.id) FROM oportunidades o JOIN base b ON b.lead_id = o.lead_id
              WHERE o.reunion_realizada_en IS NOT NULL) AS reuniones_realizadas,
            (SELECT COUNT(*) FROM eventos e JOIN base b ON b.lead_id = e.lead_id
              WHERE e.tipo = 'venta') AS ventas,
            (SELECT COALESCE(SUM(e.valor),0) FROM eventos e JOIN base b ON b.lead_id = e.lead_id
              WHERE e.tipo = 'venta') AS ingresos`,
    params,
  );

  const conTasas = filas.map(añadirTasas);
  if (sinAtribuir && Number(sinAtribuir.leads) > 0) {
    conTasas.push(añadirTasas({
      id: null, titulo: 'Sin atribuir', tipo: 'otro', permalink: null, thumbnail_url: null,
      publicado_en: null, etiquetas: [], no_shows: 0, toques_dudosos: 0,
      ...sinAtribuir,
    }));
  }
  return conTasas;
}

function pct(a: number, b: number) {
  return b > 0 ? Math.round((a / b) * 1000) / 10 : 0;
}

function añadirTasas(r: any) {
  const leads = Number(r.leads ?? 0);
  const agendadas = Number(r.reuniones_agendadas ?? 0);
  const realizadas = Number(r.reuniones_realizadas ?? 0);
  const ventas = Number(r.ventas ?? 0);
  const ingresos = Number(r.ingresos ?? 0);
  return {
    ...r,
    leads, reuniones_agendadas: agendadas, reuniones_realizadas: realizadas,
    ventas, ingresos,
    tasa_lead_reunion: pct(agendadas, leads),
    tasa_reunion_venta: pct(ventas, realizadas || agendadas),
    tasa_lead_venta: pct(ventas, leads),
    tasa_asistencia: pct(realizadas, agendadas),
    valor_por_lead: leads > 0 ? Math.round((ingresos / leads) * 100) / 100 : 0,
    ticket_medio: ventas > 0 ? Math.round((ingresos / ventas) * 100) / 100 : 0,
  };
}

/** KPIs de cabecera. */
export async function resumen(cuentaId: string, f: Filtros = {}) {
  const params = [cuentaId, f.desde ?? null, f.hasta ?? null];
  const [r] = await query(
    `WITH base AS (
       SELECT l.id FROM leads l
        WHERE l.cuenta_id = $1
          AND ($2::timestamptz IS NULL OR l.primer_contacto_en >= $2::timestamptz)
          AND ($3::timestamptz IS NULL OR l.primer_contacto_en <  $3::timestamptz)
     )
     SELECT
       (SELECT COUNT(*) FROM base)                                              AS leads,
       (SELECT COUNT(DISTINCT o.id) FROM oportunidades o JOIN base b ON b.id=o.lead_id
         WHERE o.reunion_agendada_en IS NOT NULL)                               AS reuniones_agendadas,
       (SELECT COUNT(DISTINCT o.id) FROM oportunidades o JOIN base b ON b.id=o.lead_id
         WHERE o.reunion_realizada_en IS NOT NULL)                              AS reuniones_realizadas,
       (SELECT COUNT(DISTINCT o.id) FROM oportunidades o JOIN base b ON b.id=o.lead_id
         WHERE o.reunion_no_asistio)                                            AS no_shows,
       (SELECT COUNT(*) FROM eventos e JOIN base b ON b.id=e.lead_id
         WHERE e.tipo='venta')                                                  AS ventas,
       (SELECT COALESCE(SUM(e.valor),0) FROM eventos e JOIN base b ON b.id=e.lead_id
         WHERE e.tipo='venta')                                                  AS ingresos,
       (SELECT COUNT(*) FROM leads l WHERE l.cuenta_id=$1 AND l.id IN (SELECT id FROM base)
         AND l.primer_contenido_id IS NOT NULL)                                 AS leads_atribuidos,
       (SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (o.cerrada_en - o.abierta_en))/86400),0)
          FROM oportunidades o JOIN base b ON b.id=o.lead_id
         WHERE o.estado='ganada' AND o.cerrada_en IS NOT NULL)                  AS dias_medios_cierre`,
    params,
  );

  const leads = Number(r?.leads ?? 0);
  const ventas = Number(r?.ventas ?? 0);
  const ingresos = Number(r?.ingresos ?? 0);
  const agendadas = Number(r?.reuniones_agendadas ?? 0);
  const realizadas = Number(r?.reuniones_realizadas ?? 0);

  return {
    leads,
    reuniones_agendadas: agendadas,
    reuniones_realizadas: realizadas,
    no_shows: Number(r?.no_shows ?? 0),
    ventas,
    ingresos,
    leads_atribuidos: Number(r?.leads_atribuidos ?? 0),
    cobertura_atribucion: pct(Number(r?.leads_atribuidos ?? 0), leads),
    tasa_lead_reunion: pct(agendadas, leads),
    tasa_asistencia: pct(realizadas, agendadas),
    tasa_reunion_venta: pct(ventas, realizadas || agendadas),
    tasa_lead_venta: pct(ventas, leads),
    ticket_medio: ventas > 0 ? Math.round((ingresos / ventas) * 100) / 100 : 0,
    valor_por_lead: leads > 0 ? Math.round((ingresos / leads) * 100) / 100 : 0,
    dias_medios_cierre: Math.round(Number(r?.dias_medios_cierre ?? 0) * 10) / 10,
  };
}

/** Embudo: cuántas oportunidades hay en cada etapa y conversión entre ellas. */
export async function embudo(cuentaId: string, f: Filtros = {}) {
  const filas = await query(
    `SELECT e.id, e.nombre, e.slug, e.orden, e.color, e.tipo,
            COUNT(o.id)                       AS oportunidades,
            COALESCE(SUM(o.valor), 0)         AS valor
       FROM etapas e
       LEFT JOIN oportunidades o
              ON o.etapa_id = e.id
             AND ($3::timestamptz IS NULL OR o.abierta_en >= $3::timestamptz)
             AND ($4::timestamptz IS NULL OR o.abierta_en <  $4::timestamptz)
      WHERE e.cuenta_id = $1
        AND ($2::uuid IS NULL OR e.pipeline_id = $2::uuid)
      GROUP BY e.id ORDER BY e.orden ASC`,
    [cuentaId, f.pipelineId ?? null, f.desde ?? null, f.hasta ?? null],
  );

  // Conversión acumulada: cuántos llegaron a cada etapa alguna vez
  const alcanzadas = await query(
    `SELECT h.etapa_hasta_id AS etapa_id, COUNT(DISTINCT h.oportunidad_id) AS alcanzaron
       FROM etapa_historial h
      WHERE h.cuenta_id = $1
        AND ($2::timestamptz IS NULL OR h.cambiado_en >= $2::timestamptz)
        AND ($3::timestamptz IS NULL OR h.cambiado_en <  $3::timestamptz)
      GROUP BY h.etapa_hasta_id`,
    [cuentaId, f.desde ?? null, f.hasta ?? null],
  );
  const mapa = new Map(alcanzadas.map((a: any) => [a.etapa_id, Number(a.alcanzaron)]));
  const primera = filas[0] ? (mapa.get(filas[0].id) ?? 0) : 0;

  return filas.map((e: any) => {
    const alcanzaron = mapa.get(e.id) ?? 0;
    return {
      ...e,
      oportunidades: Number(e.oportunidades),
      valor: Number(e.valor),
      alcanzaron,
      conversion_desde_inicio: pct(alcanzaron, primera),
    };
  });
}

/** Serie temporal de leads, reuniones, ventas e ingresos. */
export async function serieTemporal(
  cuentaId: string,
  granularidad: 'dia' | 'semana' | 'mes' = 'dia',
  f: Filtros = {},
) {
  const trunc = truncar(granularidad);
  return query(
    `WITH rango AS (
       SELECT generate_series(
         date_trunc('${trunc}', COALESCE($2::timestamptz, now() - interval '30 days')),
         date_trunc('${trunc}', COALESCE($3::timestamptz, now())),
         ('1 ${trunc}')::interval
       ) AS periodo
     ),
     ev AS (
       SELECT date_trunc('${trunc}', e.ocurrido_en) AS periodo,
              COUNT(*) FILTER (WHERE e.tipo = 'lead_creado')       AS leads,
              COUNT(*) FILTER (WHERE e.tipo = 'reunion_agendada')  AS reuniones,
              COUNT(*) FILTER (WHERE e.tipo = 'venta')             AS ventas,
              COALESCE(SUM(e.valor) FILTER (WHERE e.tipo = 'venta'), 0) AS ingresos
         FROM eventos e
        WHERE e.cuenta_id = $1
          AND ($2::timestamptz IS NULL OR e.ocurrido_en >= $2::timestamptz)
          AND ($3::timestamptz IS NULL OR e.ocurrido_en <  $3::timestamptz)
        GROUP BY 1
     )
     SELECT r.periodo,
            COALESCE(ev.leads, 0)     AS leads,
            COALESCE(ev.reuniones, 0) AS reuniones,
            COALESCE(ev.ventas, 0)    AS ventas,
            COALESCE(ev.ingresos, 0)  AS ingresos
       FROM rango r LEFT JOIN ev ON ev.periodo = r.periodo
      ORDER BY r.periodo ASC`,
    [cuentaId, f.desde ?? null, f.hasta ?? null],
  );
}

/** Rendimiento por closer. */
export async function rendimientoClosers(cuentaId: string, f: Filtros = {}) {
  return query(
    `SELECT u.id, u.nombre, u.email, u.rol,
            COUNT(DISTINCT o.id)                                             AS oportunidades,
            COUNT(DISTINCT o.id) FILTER (WHERE o.reunion_realizada_en IS NOT NULL) AS reuniones,
            COUNT(DISTINCT o.id) FILTER (WHERE o.estado = 'ganada')          AS ventas,
            COALESCE(SUM(o.valor) FILTER (WHERE o.estado = 'ganada'), 0)     AS ingresos
       FROM usuarios u
       LEFT JOIN oportunidades o ON o.propietario_id = u.id
            AND ($2::timestamptz IS NULL OR o.abierta_en >= $2::timestamptz)
            AND ($3::timestamptz IS NULL OR o.abierta_en <  $3::timestamptz)
      WHERE u.cuenta_id = $1 AND u.activo
      GROUP BY u.id ORDER BY ingresos DESC`,
    [cuentaId, f.desde ?? null, f.hasta ?? null],
  );
}

/**
 * Calidad de la atribución: cuánto de lo que dice el panel es fiable.
 * Sirve para no tomar decisiones de contenido sobre datos inventados.
 */
export async function calidadAtribucion(cuentaId: string) {
  const [t] = await query(
    `SELECT
       COUNT(*)                                          AS toques,
       COUNT(*) FILTER (WHERE confianza = 'alta')        AS alta,
       COUNT(*) FILTER (WHERE confianza = 'media')       AS media,
       COUNT(*) FILTER (WHERE confianza = 'baja')        AS baja,
       COUNT(*) FILTER (WHERE confianza = 'ninguna')     AS ninguna,
       COUNT(*) FILTER (WHERE metodo = 'ig_media_id')    AS por_media_id,
       COUNT(*) FILTER (WHERE metodo = 'palabra_clave')  AS por_palabra
       FROM toques WHERE cuenta_id = $1`,
    [cuentaId],
  );
  const total = Number(t?.toques ?? 0);

  const palabrasAmbiguas = await query(
    `SELECT a.palabra_clave, COUNT(DISTINCT a.contenido_id) AS contenidos
       FROM automatizaciones a
      WHERE a.cuenta_id = $1 AND a.activo AND a.palabra_clave IS NOT NULL
        AND a.contenido_id IS NOT NULL
      GROUP BY a.palabra_clave HAVING COUNT(DISTINCT a.contenido_id) > 1
      ORDER BY contenidos DESC`,
    [cuentaId],
  );

  const sinEnlazar = await query(
    `SELECT a.id, a.nombre, a.palabra_clave,
            (SELECT COUNT(*) FROM toques t WHERE t.automatizacion_id = a.id) AS toques
       FROM automatizaciones a
      WHERE a.cuenta_id = $1 AND a.contenido_id IS NULL
      ORDER BY toques DESC`,
    [cuentaId],
  );

  return {
    total,
    alta: Number(t?.alta ?? 0),
    media: Number(t?.media ?? 0),
    baja: Number(t?.baja ?? 0),
    ninguna: Number(t?.ninguna ?? 0),
    porcentaje_fiable: pct(Number(t?.alta ?? 0) + Number(t?.media ?? 0), total),
    por_media_id: Number(t?.por_media_id ?? 0),
    por_palabra: Number(t?.por_palabra ?? 0),
    palabras_ambiguas: palabrasAmbiguas,
    automatizaciones_sin_contenido: sinEnlazar,
  };
}
