import type { FastifyInstance } from 'fastify';

// Rutas propias de la zona "chat" (mejoras de UX). Montadas en /api/ux/chat.
// Requieren sesión (cuelgan de /api). Usar req.sesion.cuentaId en TODAS las
// consultas: nada de datos de otra cuenta.
export default async function rutasUx_chat(app: FastifyInstance) {
  void app;
}
