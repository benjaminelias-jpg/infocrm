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

/** Condición "la columna cae dentro del rango" ($2 = desde, $3 = hasta). */
function enRango(columna: string) {
  return `($2::timestamptz IS NULL OR ${columna} >= $2::timestamptz)
          AND ($3::timestamptz IS NULL OR ${columna} < $3::timestamptz)`;
}

const n = (v: unknown) => Number(v ?? 0);
const redondear2 = (v: number) => Math.round(v * 100) / 100;

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
       -- Las devoluciones revierten de verdad: restan la venta y el dinero.
       SELECT b.contenido_id,
              GREATEST(COUNT(e.id) FILTER (WHERE e.tipo = 'venta')
                       - COUNT(e.id) FILTER (WHERE e.tipo = 'reembolso'), 0)          AS ventas,
              COALESCE(SUM(e.valor) FILTER (WHERE e.tipo = 'venta'), 0)
                - COALESCE(SUM(ABS(e.valor)) FILTER (WHERE e.tipo = 'reembolso'), 0)  AS ingresos,
              COUNT(e.id) FILTER (WHERE e.tipo = 'reembolso')                         AS reembolsos
         FROM base b
         JOIN eventos e ON e.lead_id = b.lead_id AND e.tipo IN ('venta', 'reembolso')
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
            (SELECT COUNT(DISTINCT o.id) FROM oportunidades o JOIN base b ON b.lead_id = o.lead_id
              WHERE o.reunion_no_asistio) AS no_shows,
            GREATEST((SELECT COUNT(*) FROM eventos e JOIN base b ON b.lead_id = e.lead_id WHERE e.tipo = 'venta')
              - (SELECT COUNT(*) FROM eventos e JOIN base b ON b.lead_id = e.lead_id WHERE e.tipo = 'reembolso'), 0) AS ventas,
            (SELECT COALESCE(SUM(e.valor),0) FROM eventos e JOIN base b ON b.lead_id = e.lead_id WHERE e.tipo = 'venta')
              - (SELECT COALESCE(SUM(ABS(e.valor)),0) FROM eventos e JOIN base b ON b.lead_id = e.lead_id
                  WHERE e.tipo = 'reembolso') AS ingresos`,
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
  const noShows = Number(r.no_shows ?? 0);
  const ventas = Number(r.ventas ?? 0);
  const ingresos = Number(r.ingresos ?? 0);
  return {
    ...r,
    leads, reuniones_agendadas: agendadas, reuniones_realizadas: realizadas, no_shows: noShows,
    ventas, ingresos,
    tasa_lead_reunion: pct(agendadas, leads),
    tasa_reunion_venta: pct(ventas, realizadas || agendadas),
    tasa_lead_venta: pct(ventas, leads),
    // Solo cuentan las reuniones que ya tienen resultado (vino o faltó): las
    // que todavía no pasaron no son faltazos.
    tasa_asistencia: pct(realizadas, realizadas + noShows),
    valor_por_lead: leads > 0 ? Math.round((ingresos / leads) * 100) / 100 : 0,
    ticket_medio: ventas > 0 ? Math.round((ingresos / ventas) * 100) / 100 : 0,
  };
}

/**
 * KPIs de cabecera, con criterio de CALENDARIO: lo que pasó dentro del
 * período (leads que entraron, reuniones que se agendaron, ventas que se
 * cobraron), igual que la evolución y el objetivo del mes. Así "Ventas" o
 * "Ingresos" dicen lo mismo en toda la pantalla.
 *
 * La única métrica de COHORTE es el valor por lead: lo que facturaron (hasta
 * hoy) los leads que entraron en el período, dividido por esos leads.
 */
export async function resumen(cuentaId: string, f: Filtros = {}) {
  const params = [cuentaId, f.desde ?? null, f.hasta ?? null];
  const [r] = await query(
    `WITH base AS (
       SELECT l.id, l.primer_contenido_id FROM leads l
        WHERE l.cuenta_id = $1 AND ${enRango('l.primer_contacto_en')}
     ),
     ev AS (
       SELECT e.tipo, e.valor FROM eventos e
        WHERE e.cuenta_id = $1 AND e.tipo IN ('venta', 'reembolso', 'reunion_no_asistio')
          AND ${enRango('e.ocurrido_en')}
     )
     SELECT
       (SELECT COUNT(*) FROM base)                                              AS leads,
       (SELECT COUNT(*) FROM base WHERE primer_contenido_id IS NOT NULL)        AS leads_atribuidos,
       (SELECT COUNT(*) FROM oportunidades o
         WHERE o.cuenta_id = $1 AND o.reunion_agendada_en IS NOT NULL
           AND ${enRango('o.reunion_agendada_en')})                             AS reuniones_agendadas,
       (SELECT COUNT(*) FROM oportunidades o
         WHERE o.cuenta_id = $1 AND o.reunion_realizada_en IS NOT NULL
           AND ${enRango('o.reunion_realizada_en')})                            AS reuniones_realizadas,
       (SELECT COUNT(*) FROM oportunidades o
         WHERE o.cuenta_id = $1 AND o.reunion_agendada_en IS NOT NULL
           AND ${enRango('o.reunion_agendada_en')}
           AND o.reunion_realizada_en IS NULL AND NOT o.reunion_no_asistio
           AND o.estado = 'abierta')                                            AS reuniones_pendientes,
       -- De las reuniones que se hicieron en el período, cuántas terminaron en
       -- venta (nunca más de 100 %: ventas sin reunión no inflan el cierre).
       (SELECT COUNT(*) FROM oportunidades o
         WHERE o.cuenta_id = $1 AND o.reunion_realizada_en IS NOT NULL
           AND ${enRango('o.reunion_realizada_en')}
           AND o.estado = 'ganada')                                             AS reuniones_con_venta,
       -- De los leads que entraron en el período, cuántos ya agendaron.
       (SELECT COUNT(DISTINCT o.lead_id) FROM oportunidades o JOIN base b ON b.id = o.lead_id
         WHERE o.reunion_agendada_en IS NOT NULL)                               AS leads_con_reunion,
       -- …y cuántos ya compraron.
       (SELECT COUNT(DISTINCT e.lead_id) FROM eventos e JOIN base b ON b.id = e.lead_id
         WHERE e.tipo = 'venta')                                                AS leads_con_venta,
       (SELECT COUNT(*) FROM ev WHERE tipo = 'reunion_no_asistio')              AS no_shows,
       (SELECT COUNT(*) FROM ev WHERE tipo = 'venta')                           AS ventas_brutas,
       (SELECT COALESCE(SUM(valor), 0) FROM ev WHERE tipo = 'venta')            AS ingresos_brutos,
       (SELECT COUNT(*) FROM ev WHERE tipo = 'reembolso')                       AS reembolsos,
       (SELECT COALESCE(SUM(ABS(valor)), 0) FROM ev WHERE tipo = 'reembolso')   AS reembolsado,
       (SELECT COALESCE(SUM(CASE WHEN e.tipo = 'venta' THEN e.valor ELSE -ABS(e.valor) END), 0)
          FROM eventos e JOIN base b ON b.id = e.lead_id
         WHERE e.tipo IN ('venta', 'reembolso'))                                AS ingresos_cohorte,
       (SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (o.cerrada_en - o.abierta_en)) / 86400), 0)
          FROM oportunidades o
         WHERE o.cuenta_id = $1 AND o.estado = 'ganada' AND o.cerrada_en IS NOT NULL
           AND ${enRango('o.cerrada_en')})                                      AS dias_medios_cierre`,
    params,
  );

  const leads = n(r?.leads);
  // Netas: una devolución revierte la venta y el dinero.
  const reembolsos = n(r?.reembolsos);
  const reembolsado = n(r?.reembolsado);
  const ventas = Math.max(n(r?.ventas_brutas) - reembolsos, 0);
  const ingresos = n(r?.ingresos_brutos) - reembolsado;
  const agendadas = n(r?.reuniones_agendadas);
  const realizadas = n(r?.reuniones_realizadas);
  const noShows = n(r?.no_shows);
  const ingresosCohorte = n(r?.ingresos_cohorte);
  const conVenta = n(r?.reuniones_con_venta);
  const leadsConReunion = n(r?.leads_con_reunion);

  return {
    leads,
    reuniones_agendadas: agendadas,
    reuniones_realizadas: realizadas,
    no_shows: noShows,
    /** Agendadas en el período que todavía no tienen resultado (por venir). */
    reuniones_pendientes: n(r?.reuniones_pendientes),
    ventas,
    ingresos,
    reembolsos,
    reembolsado,
    leads_atribuidos: n(r?.leads_atribuidos),
    cobertura_atribucion: pct(n(r?.leads_atribuidos), leads),
    /** Leads que entraron en el período y ya agendaron una reunión. */
    leads_con_reunion: leadsConReunion,
    // Las tasas comparan cosas del MISMO grupo (nunca pasan de 100 %): reuniones
    // agendadas ÷ leads o ventas ÷ reuniones de calendario mezclaban grupos
    // distintos (una semana con ventas sin reunión daba "115 % de las reuniones").
    tasa_lead_reunion: pct(leadsConReunion, leads),
    // Asistencia = vinieron / (vinieron + faltaron). Las que todavía no
    // pasaron no cuentan como faltazo.
    tasa_asistencia: pct(realizadas, realizadas + noShows),
    /** Reuniones hechas en el período que terminaron en venta. */
    reuniones_con_venta: conVenta,
    tasa_reunion_venta: pct(conVenta, realizadas),
    /** De los leads que entraron en el período, qué % ya compró. */
    tasa_lead_venta: pct(n(r?.leads_con_venta), leads),
    ticket_medio: ventas > 0 ? redondear2(ingresos / ventas) : 0,
    /** Lo que facturaron (neto, hasta hoy) los leads que entraron en el período. */
    ingresos_cohorte: ingresosCohorte,
    valor_por_lead: leads > 0 ? redondear2(ingresosCohorte / leads) : 0,
    dias_medios_cierre: Math.round(n(r?.dias_medios_cierre) * 10) / 10,
  };
}

// ---------------------------------------------------------------------
// Pipelines y embudo
// ---------------------------------------------------------------------

/** Pipelines activos con sus leads abiertos (el predeterminado primero). */
export async function pipelinesConLeads(cuentaId: string) {
  const filas = await query(
    `SELECT p.id, p.nombre, p.es_predeterminado,
            COUNT(o.id) FILTER (WHERE o.estado = 'abierta') AS abiertos
       FROM pipelines p
       LEFT JOIN oportunidades o ON o.pipeline_id = p.id
      WHERE p.cuenta_id = $1 AND p.activo
      GROUP BY p.id
      ORDER BY p.es_predeterminado DESC, p.orden ASC, p.creado_en ASC`,
    [cuentaId],
  );
  return filas.map((p: any) => ({ id: p.id, nombre: p.nombre, es_predeterminado: p.es_predeterminado, abiertos: n(p.abiertos) }));
}

export async function pipelinePredeterminado(cuentaId: string): Promise<string | null> {
  const [p] = await query(
    `SELECT id FROM pipelines WHERE cuenta_id = $1 AND activo
      ORDER BY es_predeterminado DESC, orden ASC, creado_en ASC LIMIT 1`,
    [cuentaId],
  );
  return p?.id ?? null;
}

/**
 * Etapas que no son un paso del embudo sino una salida: "Perdido" y
 * "No asistió" (el lead no avanzó; se muestran como nota, no como paso).
 */
export function esSalida(e: { tipo?: string; slug?: string; evento_asociado?: string | null }) {
  return e.tipo === 'perdida' || e.evento_asociado === 'reunion_no_asistio' || e.slug === 'no-asistio';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Embudo de UN pipeline (el elegido o, si no se pide ninguno, el
 * predeterminado): de las oportunidades que se abrieron en el período,
 * cuántas llegaron a cada paso (o más lejos). Así el embudo nunca sube.
 * Las salidas ("No asistió", "Perdido") devuelven cuántos pasaron por ahí.
 */
export async function embudo(cuentaId: string, f: Filtros = {}) {
  const pipelineId = f.pipelineId && UUID.test(f.pipelineId) ? f.pipelineId : await pipelinePredeterminado(cuentaId);
  if (!pipelineId) return [];
  const params = [cuentaId, pipelineId, f.desde ?? null, f.hasta ?? null];

  const etapas = await query(
    `SELECT e.id, e.nombre, e.slug, e.orden, e.color, e.tipo, e.pipeline_id, e.evento_asociado,
            COUNT(o.id)                       AS oportunidades,
            COALESCE(SUM(o.valor), 0)         AS valor
       FROM etapas e
       LEFT JOIN oportunidades o
              ON o.etapa_id = e.id
             AND ($3::timestamptz IS NULL OR o.abierta_en >= $3::timestamptz)
             AND ($4::timestamptz IS NULL OR o.abierta_en <  $4::timestamptz)
      WHERE e.cuenta_id = $1 AND e.pipeline_id = $2::uuid
      GROUP BY e.id ORDER BY e.orden ASC`,
    params,
  );
  if (!etapas.length) return [];

  // Por qué etapas pasó cada oportunidad de la cohorte (historial + la actual).
  const cohorte = `
    WITH coh AS (
      SELECT o.id, o.etapa_id FROM oportunidades o
       WHERE o.cuenta_id = $1 AND o.pipeline_id = $2::uuid
         AND ($3::timestamptz IS NULL OR o.abierta_en >= $3::timestamptz)
         AND ($4::timestamptz IS NULL OR o.abierta_en <  $4::timestamptz)
    ),
    visitas AS (
      SELECT c.id AS opp, h.etapa_hasta_id AS etapa
        FROM coh c JOIN etapa_historial h ON h.oportunidad_id = c.id
      UNION
      SELECT c.id, c.etapa_id FROM coh c
    )`;
  const [porEtapa, maximos] = await Promise.all([
    query(`${cohorte} SELECT etapa, COUNT(DISTINCT opp) AS n FROM visitas GROUP BY etapa`, params),
    query(
      `${cohorte},
       maximo AS (
         SELECT v.opp,
                MAX(e.orden) FILTER (WHERE NOT (e.tipo = 'perdida'
                                                OR COALESCE(e.evento_asociado, '') = 'reunion_no_asistio'
                                                OR e.slug = 'no-asistio')) AS max_paso
           FROM visitas v JOIN etapas e ON e.id = v.etapa AND e.pipeline_id = $2::uuid
          GROUP BY v.opp
       )
       SELECT max_paso, COUNT(*) AS n FROM maximo GROUP BY max_paso`,
      params,
    ),
  ]);

  const visitaron = new Map(porEtapa.map((r: any) => [r.etapa, n(r.n)]));
  const pasos = etapas.filter((e: any) => !esSalida(e));
  const ordenInicial = pasos[0]?.orden ?? 0;
  // Quien nunca pasó por un paso (solo por una salida) igual "entró".
  const histograma = maximos.map((m: any) => ({ max: m.max_paso ?? ordenInicial, n: n(m.n) }));
  const llegaron = (orden: number) => histograma.reduce((a, h) => a + (h.max >= orden ? h.n : 0), 0);
  const entraron = pasos.length ? llegaron(ordenInicial) : 0;

  let anterior: number | null = null;
  return etapas.map((e: any) => {
    const salida = esSalida(e);
    const alcanzaron = salida ? (visitaron.get(e.id) ?? 0) : llegaron(e.orden);
    const fila = {
      id: e.id, nombre: e.nombre, slug: e.slug, orden: e.orden, color: e.color, tipo: e.tipo,
      pipeline_id: e.pipeline_id,
      oportunidades: n(e.oportunidades),
      valor: n(e.valor),
      alcanzaron,
      conversion_desde_inicio: pct(alcanzaron, entraron),
      /** De los que llegaron al paso anterior, qué % llegó a este (null en el primero y en las salidas). */
      conversion_desde_anterior: !salida && anterior !== null ? pct(alcanzaron, anterior) : null,
      es_salida: salida,
      /** Para "No asistió": el paso del que sale (el anterior). Las pérdidas salen de cualquier paso. */
      salida_de: salida && e.tipo !== 'perdida'
        ? ([...pasos].reverse().find((p: any) => p.orden < e.orden)?.id ?? null)
        : null,
    };
    if (!salida) anterior = alcanzaron;
    return fila;
  });
}

/**
 * Elige la granularidad de la serie según el largo del período:
 * hasta ~5 semanas, por día; hasta 6 meses, por semana; más, por mes.
 */
export async function granularidadAuto(cuentaId: string, f: Filtros = {}): Promise<'dia' | 'semana' | 'mes'> {
  let desde = f.desde ? Date.parse(f.desde) : NaN;
  if (Number.isNaN(desde)) {
    const [r] = await query(
      `SELECT LEAST(
         (SELECT MIN(primer_contacto_en) FROM leads WHERE cuenta_id = $1),
         (SELECT MIN(ocurrido_en) FROM eventos WHERE cuenta_id = $1 AND tipo IN ('venta', 'reembolso')),
         (SELECT MIN(reunion_agendada_en) FROM oportunidades WHERE cuenta_id = $1)) AS inicio`,
      [cuentaId],
    );
    desde = r?.inicio ? new Date(r.inicio).getTime() : Date.now() - 30 * 86_400_000;
  }
  const hasta = f.hasta ? Date.parse(f.hasta) : Date.now();
  const dias = (hasta - desde) / 86_400_000;
  return dias <= 35 ? 'dia' : dias <= 186 ? 'semana' : 'mes';
}

/**
 * Serie temporal de leads, reuniones, ventas e ingresos. Usa las MISMAS
 * fuentes y el mismo criterio que los KPIs (resumen): sumando la serie da
 * exactamente el número de la tarjeta. Sin "desde" arranca en la primera
 * actividad de la cuenta (no en los últimos 30 días).
 */
export async function serieTemporal(
  cuentaId: string,
  granularidad: 'dia' | 'semana' | 'mes' = 'dia',
  f: Filtros = {},
) {
  const trunc = truncar(granularidad);
  return query(
    `WITH lim AS (
       SELECT COALESCE($2::timestamptz,
                (SELECT LEAST(
                   (SELECT MIN(primer_contacto_en) FROM leads WHERE cuenta_id = $1),
                   (SELECT MIN(ocurrido_en) FROM eventos WHERE cuenta_id = $1 AND tipo IN ('venta', 'reembolso')),
                   (SELECT MIN(reunion_agendada_en) FROM oportunidades WHERE cuenta_id = $1))),
                now() - interval '30 days') AS desde,
              COALESCE($3::timestamptz, now()) AS hasta
     ),
     rango AS (
       SELECT generate_series(
         date_trunc('${trunc}', (SELECT desde FROM lim)),
         date_trunc('${trunc}', (SELECT hasta FROM lim)),
         ('1 ${trunc}')::interval
       ) AS periodo
     ),
     ld AS (
       SELECT date_trunc('${trunc}', l.primer_contacto_en) AS periodo, COUNT(*) AS leads
         FROM leads l
        WHERE l.cuenta_id = $1 AND ${enRango('l.primer_contacto_en')}
        GROUP BY 1
     ),
     re AS (
       SELECT date_trunc('${trunc}', o.reunion_agendada_en) AS periodo, COUNT(*) AS reuniones
         FROM oportunidades o
        WHERE o.cuenta_id = $1 AND o.reunion_agendada_en IS NOT NULL AND ${enRango('o.reunion_agendada_en')}
        GROUP BY 1
     ),
     ve AS (
       SELECT date_trunc('${trunc}', e.ocurrido_en) AS periodo,
              COUNT(*) FILTER (WHERE e.tipo = 'venta') - COUNT(*) FILTER (WHERE e.tipo = 'reembolso') AS ventas,
              COALESCE(SUM(e.valor) FILTER (WHERE e.tipo = 'venta'), 0)
                - COALESCE(SUM(ABS(e.valor)) FILTER (WHERE e.tipo = 'reembolso'), 0) AS ingresos
         FROM eventos e
        WHERE e.cuenta_id = $1 AND e.tipo IN ('venta', 'reembolso') AND ${enRango('e.ocurrido_en')}
        GROUP BY 1
     )
     SELECT r.periodo,
            COALESCE(ld.leads, 0)     AS leads,
            COALESCE(re.reuniones, 0) AS reuniones,
            COALESCE(ve.ventas, 0)    AS ventas,
            COALESCE(ve.ingresos, 0)  AS ingresos
       FROM rango r
       LEFT JOIN ld ON ld.periodo = r.periodo
       LEFT JOIN re ON re.periodo = r.periodo
       LEFT JOIN ve ON ve.periodo = r.periodo
      ORDER BY r.periodo ASC`,
    [cuentaId, f.desde ?? null, f.hasta ?? null],
  );
}

/**
 * Rendimiento por persona del equipo, con criterio de calendario (como los
 * KPIs): leads que le entraron, reuniones que agendó o hizo y ventas que
 * cerró dentro del período.
 */
export async function rendimientoClosers(cuentaId: string, f: Filtros = {}) {
  const filas = await query(
    `SELECT u.id, u.nombre, u.email, u.rol,
            COUNT(o.id) FILTER (WHERE ${enRango('o.abierta_en')})                       AS oportunidades,
            COUNT(o.id) FILTER (WHERE o.reunion_agendada_en IS NOT NULL
                                  AND ${enRango('o.reunion_agendada_en')})              AS reuniones_agendadas,
            COUNT(o.id) FILTER (WHERE o.reunion_realizada_en IS NOT NULL
                                  AND ${enRango('o.reunion_realizada_en')})             AS reuniones,
            -- Para las tasas (nunca más de 100 %): de SUS reuniones hechas en el
            -- período, cuántas terminaron en venta; de SUS leads que entraron en
            -- el período, cuántos agendaron.
            COUNT(o.id) FILTER (WHERE o.reunion_realizada_en IS NOT NULL AND o.estado = 'ganada'
                                  AND ${enRango('o.reunion_realizada_en')})             AS reuniones_con_venta,
            COUNT(o.id) FILTER (WHERE o.reunion_agendada_en IS NOT NULL
                                  AND ${enRango('o.abierta_en')})                       AS oportunidades_con_reunion,
            COUNT(o.id) FILTER (WHERE o.estado = 'ganada' AND o.cerrada_en IS NOT NULL
                                  AND ${enRango('o.cerrada_en')})                       AS ventas,
            COALESCE(SUM(o.valor) FILTER (WHERE o.estado = 'ganada' AND o.cerrada_en IS NOT NULL
                                  AND ${enRango('o.cerrada_en')}), 0)                   AS ingresos
       FROM usuarios u
       LEFT JOIN oportunidades o ON o.propietario_id = u.id AND o.cuenta_id = $1
      WHERE u.cuenta_id = $1 AND u.activo
      GROUP BY u.id ORDER BY ingresos DESC, ventas DESC, u.nombre ASC`,
    [cuentaId, f.desde ?? null, f.hasta ?? null],
  );
  return filas.map((u: any) => ({
    ...u,
    oportunidades: n(u.oportunidades),
    reuniones_agendadas: n(u.reuniones_agendadas),
    reuniones: n(u.reuniones),
    reuniones_con_venta: n(u.reuniones_con_venta),
    oportunidades_con_reunion: n(u.oportunidades_con_reunion),
    ventas: n(u.ventas),
    ingresos: n(u.ingresos),
    /** De sus reuniones hechas en el período, qué % terminó en venta. */
    tasa_cierre: pct(n(u.reuniones_con_venta), n(u.reuniones)),
    /** De sus leads que entraron en el período, qué % agendó. */
    tasa_agenda: pct(n(u.oportunidades_con_reunion), n(u.oportunidades)),
  }));
}

/**
 * Calidad de la atribución: cuánto de lo que dice el panel es fiable.
 * Sirve para no tomar decisiones de contenido sobre datos inventados.
 * Con rango, cuenta solo los toques y los leads de ese período.
 */
export async function calidadAtribucion(cuentaId: string, f: Filtros = {}) {
  const rango = [cuentaId, f.desde ?? null, f.hasta ?? null];
  const [t] = await query(
    `SELECT
       COUNT(*)                                          AS toques,
       COUNT(*) FILTER (WHERE confianza = 'alta')        AS alta,
       COUNT(*) FILTER (WHERE confianza = 'media')       AS media,
       COUNT(*) FILTER (WHERE confianza = 'baja')        AS baja,
       COUNT(*) FILTER (WHERE confianza = 'ninguna')     AS ninguna,
       COUNT(*) FILTER (WHERE metodo = 'ig_media_id')    AS por_media_id,
       COUNT(*) FILTER (WHERE metodo = 'palabra_clave')  AS por_palabra
       FROM toques WHERE cuenta_id = $1 AND ${enRango('ocurrido_en')}`,
    rango,
  );
  const total = n(t?.toques);

  // Por lead: cada lead que entró en el período, según su primer toque.
  const [l] = await query(
    `WITH base AS (
       SELECT l.id FROM leads l WHERE l.cuenta_id = $1 AND ${enRango('l.primer_contacto_en')}
     ),
     primero AS (
       SELECT DISTINCT ON (t.lead_id) t.lead_id, t.confianza
         FROM toques t JOIN base b ON b.id = t.lead_id
        ORDER BY t.lead_id, t.ocurrido_en ASC, t.id ASC
     )
     SELECT (SELECT COUNT(*) FROM base) AS leads,
            (SELECT COUNT(*) FROM primero WHERE confianza IN ('alta', 'media')) AS seguros,
            (SELECT COUNT(*) FROM primero WHERE confianza = 'baja') AS dudosos`,
    rango,
  );
  const leads = n(l?.leads);
  const seguros = n(l?.seguros);
  const dudosos = n(l?.dudosos);

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
    alta: n(t?.alta),
    media: n(t?.media),
    baja: n(t?.baja),
    ninguna: n(t?.ninguna),
    porcentaje_fiable: pct(n(t?.alta) + n(t?.media), total),
    por_media_id: n(t?.por_media_id),
    por_palabra: n(t?.por_palabra),
    /** Leads del período según su primer toque: origen seguro, dudoso o sin origen. */
    leads: {
      total: leads,
      seguros,
      dudosos,
      sin_origen: Math.max(leads - seguros - dudosos, 0),
      porcentaje_seguros: pct(seguros, leads),
    },
    palabras_ambiguas: palabrasAmbiguas,
    automatizaciones_sin_contenido: sinEnlazar,
  };
}

/**
 * Leads estancados: oportunidades abiertas sin movimiento (ni de etapa ni de
 * mensajes) en los últimos `dias`. Primero los que todavía se pueden salvar:
 * las etapas más avanzadas y, dentro de cada una, los que menos días llevan
 * quietos.
 */
export async function leadsEstancados(
  cuentaId: string,
  dias = 7,
  limite = 10,
  opciones: { etapaId?: string | null; propietarioId?: string | null } = {},
) {
  const etapaId = opciones.etapaId && UUID.test(opciones.etapaId) ? opciones.etapaId : null;
  const propietarioId = opciones.propietarioId && UUID.test(opciones.propietarioId) ? opciones.propietarioId : null;
  const quietos = `
    WITH ult AS (
       SELECT o.id AS oportunidad_id, l.id AS lead_id, l.nombre, l.ig_username, l.avatar_url,
              e.id AS etapa_id, e.nombre AS etapa, e.orden AS etapa_orden,
              p.id AS pipeline_id, p.nombre AS pipeline, p.es_predeterminado AS pipeline_predeterminado,
              u.nombre AS responsable, COALESCE(o.propietario_id, l.propietario_id) AS responsable_id,
              GREATEST(o.abierta_en,
                       COALESCE((SELECT max(h.cambiado_en) FROM etapa_historial h WHERE h.oportunidad_id = o.id), o.abierta_en),
                       COALESCE(l.ultimo_mensaje_en, o.abierta_en)) AS ultimo_movimiento
         FROM oportunidades o
         JOIN leads l ON l.id = o.lead_id
         JOIN etapas e ON e.id = o.etapa_id
         JOIN pipelines p ON p.id = o.pipeline_id
         LEFT JOIN usuarios u ON u.id = COALESCE(o.propietario_id, l.propietario_id)
        WHERE o.cuenta_id = $1 AND o.estado = 'abierta' AND e.tipo = 'abierta'
     ),
     quietos AS (
       SELECT *, EXTRACT(DAY FROM now() - ultimo_movimiento)::int AS dias_quieto
         FROM ult
        WHERE ultimo_movimiento < now() - make_interval(days => $2)
          AND ($3::uuid IS NULL OR responsable_id = $3::uuid)
     )`;
  const [filas, conteos] = await Promise.all([
    query(
      `${quietos}
       SELECT * FROM quietos
        WHERE ($4::uuid IS NULL OR etapa_id = $4::uuid)
        ORDER BY pipeline_predeterminado DESC, etapa_orden DESC, ultimo_movimiento DESC
        LIMIT $5`,
      [cuentaId, dias, propietarioId, etapaId, limite],
    ),
    query(
      `${quietos}
       SELECT etapa_id, etapa, etapa_orden, pipeline_id, pipeline, pipeline_predeterminado, COUNT(*) AS n
         FROM quietos
        GROUP BY etapa_id, etapa, etapa_orden, pipeline_id, pipeline, pipeline_predeterminado
        ORDER BY pipeline_predeterminado DESC, etapa_orden DESC`,
      [cuentaId, dias, propietarioId],
    ),
  ]);
  const porEtapa = conteos.map((c: any) => ({
    etapa_id: c.etapa_id, etapa: c.etapa, orden: c.etapa_orden, pipeline_id: c.pipeline_id,
    pipeline: c.pipeline, pipeline_predeterminado: c.pipeline_predeterminado, n: n(c.n),
  }));
  const total = porEtapa.reduce((a, c) => a + c.n, 0);
  return { total, dias, leads: filas.map((f: any) => ({ ...f, total })), por_etapa: porEtapa };
}
