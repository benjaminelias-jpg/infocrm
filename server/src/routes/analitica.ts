import type { FastifyInstance } from 'fastify';
import {
  resumen, rendimientoPorContenido, embudo, serieTemporal,
  rendimientoClosers, calidadAtribucion, type Filtros,
} from '../modules/analitica.js';

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

  /** La pantalla estrella: de qué contenido viene cada lead, reunión y venta. */
  app.get('/contenidos', async (req) =>
    rendimientoPorContenido(req.sesion.cuentaId, filtros(req.query as any)));

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

    const [kpis, contenidos, pasos, serie, closers, calidad] = await Promise.all([
      resumen(req.sesion.cuentaId, f),
      rendimientoPorContenido(req.sesion.cuentaId, f),
      embudo(req.sesion.cuentaId, f),
      serieTemporal(req.sesion.cuentaId, gran, f),
      rendimientoClosers(req.sesion.cuentaId, f),
      calidadAtribucion(req.sesion.cuentaId),
    ]);

    return { kpis, contenidos, embudo: pasos, serie, closers, calidad };
  });
}
