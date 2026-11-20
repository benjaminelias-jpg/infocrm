import type { FastifyInstance } from 'fastify';

// Rutas propias de la zona "panel" (mejoras de UX). Montadas en /api/ux/panel.
// Requieren sesión (cuelgan de /api). Usar req.sesion.cuentaId en TODAS las
// consultas: nada de datos de otra cuenta.
export default async function rutasUx_panel(app: FastifyInstance) {
  void app;
}
