import type { FastifyInstance } from 'fastify';

// Rutas propias de la zona "global" (mejoras de UX). Montadas en /api/ux/global.
// Requieren sesión (cuelgan de /api). Usar req.sesion.cuentaId en TODAS las
// consultas: nada de datos de otra cuenta.
export default async function rutasUx_global(app: FastifyInstance) {
  void app;
}
