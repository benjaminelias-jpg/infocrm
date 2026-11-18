export class AppError extends Error {
  statusCode: number;
  codigo: string;
  detalles?: unknown;

  constructor(statusCode: number, codigo: string, mensaje: string, detalles?: unknown) {
    super(mensaje);
    this.statusCode = statusCode;
    this.codigo = codigo;
    this.detalles = detalles;
  }
}

export const noEncontrado = (que: string) =>
  new AppError(404, 'no_encontrado', `${que} no encontrado`);

export const noAutorizado = (mensaje = 'No autorizado') =>
  new AppError(401, 'no_autorizado', mensaje);

export const prohibido = (mensaje = 'No tienes permiso para esto') =>
  new AppError(403, 'prohibido', mensaje);

export const peticionInvalida = (mensaje: string, detalles?: unknown) =>
  new AppError(400, 'peticion_invalida', mensaje, detalles);

export const conflicto = (mensaje: string) =>
  new AppError(409, 'conflicto', mensaje);
