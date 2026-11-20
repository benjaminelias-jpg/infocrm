import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { simularPasos, advertenciasFlujo, normalizarPasos, validarFlujoDetallado } from '../modules/instagram_dm.js';

// Rutas propias de Automensajes (mejoras de UX). Montadas en /api/ux/automensajes.

export default async function rutasUx_automensajes(app: FastifyInstance) {
  /**
   * Probar lo que se ve en la pizarra SIN guardar: no crea el automensaje, no
   * lo activa, no manda nada y no toca leads. `respuestas` elige qué botón
   * "toca" el lead en cada pregunta (o 'si'/'no' en las condiciones) y
   * `texto` es lo que "escribe" (para condiciones y "esperar su respuesta").
   */
  app.post('/simular', async (req) => {
    const d = z.object({
      pasos: z.array(z.object({ tipo: z.string() }).passthrough()).max(200),
      respuestas: z.record(z.string()).optional(),
      texto: z.string().max(1000).optional(),
      nombre: z.string().max(120).optional(),
    }).parse(req.body);
    const r = await simularPasos(req.sesion.cuentaId, d.pasos, { respuestas: d.respuestas, texto: d.texto }, d.nombre ?? 'Prueba');
    const pasos = normalizarPasos(d.pasos);
    return {
      ...r,
      // Lo que habría que completar antes de activarlo (para mostrarlo en la prueba).
      problemas: validarFlujoDetallado(pasos),
      advertencias: advertenciasFlujo(pasos),
    };
  });
}
