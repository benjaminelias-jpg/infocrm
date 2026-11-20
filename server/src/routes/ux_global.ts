import type { FastifyInstance } from 'fastify';
import { queryOne } from '../db/pool.js';

// Rutas propias de la zona "global" (mejoras de UX). Montadas en /api/ux/global.
// Requieren sesión (cuelgan de /api). Usar req.sesion.cuentaId en TODAS las
// consultas: nada de datos de otra cuenta.
export default async function rutasUx_global(app: FastifyInstance) {
  /** Para el globito del Chat en el menú: conversaciones con mensajes sin leer. */
  app.get('/no-leidos', async (req) => {
    const r = await queryOne(
      `SELECT COUNT(*)::int AS conversaciones, COALESCE(SUM(mensajes_sin_leer), 0)::int AS mensajes
         FROM leads WHERE cuenta_id = $1 AND mensajes_sin_leer > 0`,
      [req.sesion.cuentaId]);
    return { conversaciones: r?.conversaciones ?? 0, mensajes: r?.mensajes ?? 0 };
  });
}
