import type { FastifyInstance } from 'fastify';

// Rutas propias de la zona "finanzas" (mejoras de UX). Montadas en /api/ux/finanzas.
// Requieren sesión (cuelgan de /api). Usar req.sesion.cuentaId en TODAS las
// consultas: nada de datos de otra cuenta.
export default async function rutasUx_finanzas(app: FastifyInstance) {
  void app;
}
