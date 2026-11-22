import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { guardarMenuChat, leerMenuChat } from '../modules/menu_chat.js';
import { simularPasos, advertenciasFlujo, normalizarPasos, validarFlujoDetallado } from '../modules/instagram_dm.js';

// Rutas propias de Automensajes (mejoras de UX). Montadas en /api/ux/automensajes.

export default async function rutasUx_automensajes(app: FastifyInstance) {
  /**
   * Probar lo que se ve en la pizarra SIN guardar: no crea el automensaje, no
   * lo activa, no manda nada y no toca leads. `respuestas` elige qué botón
   * "toca" el lead en cada pregunta (o 'si'/'no' en las condiciones) y
   * `texto` es lo que "escribe" (para condiciones y "esperar su respuesta").
   */
  // Estadísticas por paso: a cuántas personas les pasó cada paso (últimos N días).
  app.get('/:id/estadisticas', async (req) => {
    const { id } = req.params as { id: string };
    const dias = Math.min(Math.max(Number((req.query as any)?.dias) || 30, 1), 365);
    const total = await query(
      `SELECT COUNT(*)::int AS n FROM flujo_ejecuciones
        WHERE cuenta_id = $1 AND flujo_id = $2 AND estado <> 'simulado' AND ejecutado_en > now() - make_interval(days => $3)`,
      [req.sesion.cuentaId, id, dias]);
    const porNodo = await query(
      `SELECT r->>'nodo' AS nodo, COUNT(DISTINCT e.id)::int AS n
         FROM flujo_ejecuciones e, jsonb_array_elements(CASE WHEN jsonb_typeof(e.resultado) = 'array' THEN e.resultado ELSE '[]'::jsonb END) r
        WHERE e.cuenta_id = $1 AND e.flujo_id = $2 AND e.estado <> 'simulado'
          AND e.ejecutado_en > now() - make_interval(days => $3) AND r->>'nodo' IS NOT NULL
        GROUP BY 1`, [req.sesion.cuentaId, id, dias]);
    return { dias, total: total[0]?.n ?? 0, nodos: Object.fromEntries(porNodo.map((f: any) => [f.nodo, f.n])) };
  });

  // Preguntas frecuentes al abrir el chat y menú fijo (Instagram).
  app.get('/menu-chat', async (req) => leerMenuChat(req.sesion.cuentaId));
  app.put('/menu-chat', async (req) => {
    const d = z.object({
      preguntas: z.array(z.object({ pregunta: z.string().max(80), palabra: z.string().max(40) })).max(4).default([]),
      menu: z.array(z.object({ titulo: z.string().max(30), palabra: z.string().max(40).optional(), url: z.string().max(500).optional() })).max(5).default([]),
    }).parse(req.body ?? {});
    return guardarMenuChat(req.sesion.cuentaId, d);
  });

  // Nombres de los campos propios que ya existen (para sugerirlos en la pizarra).
  app.get('/campos', async (req) => {
    const filas = await query(
      `SELECT DISTINCT jsonb_object_keys(campos) AS nombre FROM leads WHERE cuenta_id = $1 AND campos <> '{}'::jsonb ORDER BY 1 LIMIT 200`,
      [req.sesion.cuentaId]);
    return filas.map((f: any) => f.nombre);
  });

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
