import type { FastifyInstance } from 'fastify';

// Rutas propias de la zona "automensajes" (mejoras de UX). Montadas en /api/ux/automensajes.
// Requieren sesión (cuelgan de /api). Usar req.sesion.cuentaId en TODAS las
// consultas: nada de datos de otra cuenta.
export default async function rutasUx_automensajes(app: FastifyInstance) {
  void app;
}
