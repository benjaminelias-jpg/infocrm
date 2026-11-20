import type { FastifyInstance } from 'fastify';
import {
  resumen, rendimientoPorContenido, embudo, serieTemporal,
  rendimientoClosers, calidadAtribucion, leadsEstancados, type Filtros,
} from '../modules/analitica.js';
import {
  rendimientoPorAngulo, mezclaContenido, clasificarRoles, metasProgreso,
} from '../modules/infoproduccion.js';

function filtros(q: Record<string, string>): Filtros {
  return {
    desde: q.desde || null,
    hasta: q.hasta || null,
    pipelineId: q.pipeline_id || null,
    modelo: q.modelo === 'ultimo_toque' ? 'ultimo_toque' : 'primer_toque',
  };
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

  app.get('/embudo', async (req) =>
    embudo(req.sesion.cuentaId, filtros(req.query as any)));

  app.get('/serie', async (req) => {
    const q = req.query as Record<string, string>;
    const gran = q.granularidad === 'semana' ? 'semana' : q.granularidad === 'mes' ? 'mes' : 'dia';
    return serieTemporal(req.sesion.cuentaId, gran, filtros(q));
  });

  app.get('/closers', async (req) =>
    rendimientoClosers(req.sesion.cuentaId, filtros(req.query as any)));

  app.get('/calidad-atribucion', async (req) =>
    calidadAtribucion(req.sesion.cuentaId));

  /** Todo lo que necesita el dashboard en una sola llamada. */
  app.get('/panel', async (req) => {
    const f = filtros(req.query as any);
    const q = req.query as Record<string, string>;
    const gran = q.granularidad === 'semana' ? 'semana' : q.granularidad === 'mes' ? 'mes' : 'dia';

    const [kpis, contenidosRaw, pasos, serie, closers, calidad, angulos, mezcla, metas] = await Promise.all([
      resumen(req.sesion.cuentaId, f),
      rendimientoPorContenido(req.sesion.cuentaId, f),
      embudo(req.sesion.cuentaId, f),
      serieTemporal(req.sesion.cuentaId, gran, f),
      rendimientoClosers(req.sesion.cuentaId, f),
      calidadAtribucion(req.sesion.cuentaId),
      rendimientoPorAngulo(req.sesion.cuentaId, f),
      mezclaContenido(req.sesion.cuentaId),
      metasProgreso(req.sesion.cuentaId),
    ]);
    const contenidos = clasificarRoles(contenidosRaw as any);

    // "Un número nunca va solo": el mismo periodo, inmediatamente anterior.
    let anterior = null;
    if (f.desde) {
      const desde = new Date(f.desde).getTime();
      const hasta = f.hasta ? new Date(f.hasta).getTime() : Date.now();
      anterior = await resumen(req.sesion.cuentaId, {
        ...f, desde: new Date(desde - (hasta - desde)).toISOString(), hasta: new Date(desde).toISOString(),
      });
    }

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

    const estancados = await leadsEstancados(req.sesion.cuentaId, 7, 8);

    return { kpis, anterior, contenidos, embudo: pasos, serie, closers, calidad, angulos, mezcla, metas, mudos, estancados };
  });
}
