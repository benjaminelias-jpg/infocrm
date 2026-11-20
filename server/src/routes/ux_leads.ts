import type { FastifyInstance } from 'fastify';

// Rutas propias de la zona "leads" (mejoras de UX). Montadas en /api/ux/leads.
// Requieren sesión (cuelgan de /api). Usar req.sesion.cuentaId en TODAS las
// consultas: nada de datos de otra cuenta.
export default async function rutasUx_leads(app: FastifyInstance) {
  void app;
}
