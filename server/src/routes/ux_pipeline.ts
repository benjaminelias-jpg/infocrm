import type { FastifyInstance } from 'fastify';

// Rutas propias de la zona "pipeline" (mejoras de UX). Montadas en /api/ux/pipeline.
// Requieren sesión (cuelgan de /api). Usar req.sesion.cuentaId en TODAS las
// consultas: nada de datos de otra cuenta.
export default async function rutasUx_pipeline(app: FastifyInstance) {
  void app;
}
