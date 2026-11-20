import type { FastifyInstance } from 'fastify';

// Rutas propias de la zona "integraciones" (mejoras de UX). Montadas en /api/ux/integraciones.
// Requieren sesión (cuelgan de /api). Usar req.sesion.cuentaId en TODAS las
// consultas: nada de datos de otra cuenta.
export default async function rutasUx_integraciones(app: FastifyInstance) {
  void app;
}
