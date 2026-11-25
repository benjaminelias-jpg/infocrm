import type { FastifyInstance } from 'fastify';
import {
  resumen, rendimientoPorContenido, embudo, serieTemporal, granularidadAuto, pipelinesConLeads,
  rendimientoClosers, calidadAtribucion, leadsEstancados, type Filtros,
} from '../modules/analitica.js';
import {
  rendimientoPorAngulo, mezclaContenido, clasificarRoles, metasProgreso,
} from '../modules/infoproduccion.js';

/** Una fecha que se pueda leer, o null (nada de mandarle basura a la base). */
function fecha(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  return Number.isNaN(Date.parse(v)) ? null : v;
}

function filtros(q: Record<string, string>): Filtros {
  return {
    desde: fecha(q.desde),
    hasta: fecha(q.hasta),
    pipelineId: q.pipeline_id || null,
    modelo: q.modelo === 'ultimo_toque' ? 'ultimo_toque' : 'primer_toque',
  };
}

/** dia | semana | mes; con "auto" se elige según el largo del período. */
async function granularidad(cuentaId: string, valor: string | undefined, f: Filtros) {
  if (valor === 'semana' || valor === 'mes' || valor === 'dia') return valor;
  if (valor === 'auto') return granularidadAuto(cuentaId, f);
  return 'dia' as const;
}

export default async function rutasAnalitica(app: FastifyInstance) {
  app.get('/resumen', async (req) =>
    resumen(req.sesion.cuentaId, filtros(req.query as any)));

  /** La pantalla estrella: de qué contenido viene cada lead, reunión y venta.
      Cada contenido llega clasificado por su ROL (prospector/closer/…). */
  app.get('/contenidos', async (req) => {
    const filas = await rendimientoPorContenido(req.sesion.cuentaId, filtros(req.query as any));
    return clasificarRoles(filas as any);
  });

  /** De qué ÁNGULO (no solo de qué reel) viene cada lead, reunión y venta. */
  app.get('/angulos', async (req) =>
    rendimientoPorAngulo(req.sesion.cuentaId, filtros(req.query as any)));

  /** Objetivo del mes y progreso real. */
  app.get('/metas', async (req) => metasProgreso(req.sesion.cuentaId));

  /** Embudo de un pipeline (pipeline_id opcional: sin él, el predeterminado). */
  app.get('/embudo', async (req) =>
    embudo(req.sesion.cuentaId, filtros(req.query as any)));

  app.get('/serie', async (req) => {
    const q = req.query as Record<string, string>;
    const f = filtros(q);
    return serieTemporal(req.sesion.cuentaId, await granularidad(req.sesion.cuentaId, q.granularidad, f), f);
  });

  app.get('/closers', async (req) =>
    rendimientoClosers(req.sesion.cuentaId, filtros(req.query as any)));

  app.get('/calidad-atribucion', async (req) =>
    calidadAtribucion(req.sesion.cuentaId, filtros(req.query as any)));

  /**
   * Todo lo que necesita el dashboard en una sola llamada.
   * Parámetros opcionales: desde, hasta, granularidad (dia|semana|mes|auto),
   * pipeline_id (embudo; sin él, el predeterminado), anterior_desde y
   * anterior_hasta (con qué período comparar; sin ellos, el inmediatamente
   * anterior del mismo largo).
   */
  app.get('/panel', async (req) => {
    const cuentaId = req.sesion.cuentaId;
    const q = req.query as Record<string, string>;
    const f = filtros(q);
    const gran = await granularidad(cuentaId, q.granularidad, f);

    // El embudo es de un solo pipeline: el pedido (si existe) o el predeterminado.
    const pipelines = await pipelinesConLeads(cuentaId);
    const embudoPipelineId = pipelines.find((p) => p.id === f.pipelineId)?.id ?? pipelines[0]?.id ?? null;

    // Los roles de cada contenido se juzgan siempre con los últimos 90 días
    // (con 7 días un reel que factura puede parecer "lastre" por falta de datos).
    const desde90 = new Date(Date.now() - 90 * 86_400_000).toISOString();

    const [kpis, contenidosRaw, contenidos90, pasos, serie, closers, calidad, angulos, mezcla, metas] = await Promise.all([
      resumen(cuentaId, f),
      rendimientoPorContenido(cuentaId, f),
      rendimientoPorContenido(cuentaId, { ...f, desde: desde90, hasta: null }),
      embudoPipelineId ? embudo(cuentaId, { ...f, pipelineId: embudoPipelineId }) : Promise.resolve([]),
      serieTemporal(cuentaId, gran, f),
      rendimientoClosers(cuentaId, f),
      calidadAtribucion(cuentaId, f),
      rendimientoPorAngulo(cuentaId, f),
      mezclaContenido(cuentaId),
      metasProgreso(cuentaId),
    ]);
    const roles90 = new Map(
      clasificarRoles(contenidos90 as any).map((c: any) => [c.id, { rol: c.rol, leads: c.leads }]),
    );
    const contenidos = clasificarRoles(contenidosRaw as any).map((c: any) => ({
      ...c,
      rol_90d: c.id ? (roles90.get(c.id)?.rol ?? 'explorador') : 'sin_atribuir',
      leads_90d: c.id ? (roles90.get(c.id)?.leads ?? 0) : 0,
    }));

    // "Un número nunca va solo": contra qué período se compara.
    let anteriorRango: { desde: string; hasta: string } | null = null;
    const ad = fecha(q.anterior_desde);
    const ah = fecha(q.anterior_hasta);
    if (ad && ah) {
      anteriorRango = { desde: ad, hasta: ah };
    } else if (f.desde) {
      const desde = new Date(f.desde).getTime();
      const hasta = f.hasta ? new Date(f.hasta).getTime() : Date.now();
      anteriorRango = { desde: new Date(desde - (hasta - desde)).toISOString(), hasta: new Date(desde).toISOString() };
    }
    const anterior = anteriorRango ? await resumen(cuentaId, { ...f, ...anteriorRango }) : null;
    // La misma serie, pero del período anterior (para comparar barra con barra).
    const serieAnterior = anteriorRango ? await serieTemporal(cuentaId, gran, { ...f, ...anteriorRango }).catch(() => null) : null;

    // Contenido mudo: publicado en el periodo (hace más de 3 días, para darle
    // tiempo) que no trajo ni un lead.
    const limiteMudo = Date.now() - 3 * 86_400_000;
    const desdeMudo = f.desde ? new Date(f.desde).getTime() : Date.now() - 90 * 86_400_000;
    const mudos = (contenidosRaw as any[])
      .filter((c) => c.id && Number(c.leads) === 0 && c.publicado_en
        && new Date(c.publicado_en).getTime() >= desdeMudo && new Date(c.publicado_en).getTime() <= limiteMudo)
      .sort((a, b) => new Date(b.publicado_en).getTime() - new Date(a.publicado_en).getTime())
      .slice(0, 8)
      .map((c) => ({
        id: c.id, titulo: c.titulo, tipo: c.tipo, publicado_en: c.publicado_en, permalink: c.permalink,
        alcance: c.ig_alcance, reproducciones: c.ig_reproducciones,
      }));
    // ¿Se publicó algo en el período? (para no felicitar por "nada mudo" si no hubo nada)
    const publicados = (contenidosRaw as any[])
      .filter((c) => c.id && c.publicado_en && new Date(c.publicado_en).getTime() >= desdeMudo).length;

    const estancados = await leadsEstancados(cuentaId, 7, 8);

    return {
      kpis, anterior, anterior_rango: anteriorRango,
      contenidos, embudo: pasos, embudo_pipeline_id: embudoPipelineId, pipelines,
      serie, serie_granularidad: gran, serie_anterior: serieAnterior,
      closers, calidad, angulos, mezcla, metas, mudos, publicados, estancados,
    };
  });
}
