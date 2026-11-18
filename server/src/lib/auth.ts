import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'node:crypto';
import { config } from '../config.js';
import { queryOne } from '../db/pool.js';
import { noAutorizado } from './errores.js';

export interface Sesion {
  usuarioId: string;
  cuentaId: string;
  email: string;
  rol: string;
  nombre: string;
}

export async function hashPassword(plano: string): Promise<string> {
  return bcrypt.hash(plano, 10);
}

export async function verificarPassword(plano: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plano, hash);
}

export function firmarToken(sesion: Sesion): string {
  return jwt.sign(sesion, config.jwtSecret, { expiresIn: config.jwtExpiresInSegundos });
}

export function verificarToken(token: string): Sesion {
  try {
    return jwt.verify(token, config.jwtSecret) as Sesion;
  } catch {
    throw noAutorizado('Token inválido o caducado');
  }
}

// --- Claves de API ---------------------------------------------------

export function generarApiKey(): { clave: string; prefijo: string; hash: string } {
  const prefijo = `ic_${randomBytes(4).toString('hex')}`;
  const secreto = randomBytes(24).toString('hex');
  const clave = `${prefijo}_${secreto}`;
  const hash = createHash('sha256').update(clave).digest('hex');
  return { clave, prefijo, hash };
}

export function hashApiKey(clave: string): string {
  return createHash('sha256').update(clave).digest('hex');
}

export async function resolverApiKey(clave: string): Promise<Sesion | null> {
  const prefijo = clave.split('_').slice(0, 2).join('_');
  const fila = await queryOne<{ id: string; cuenta_id: string; hash: string }>(
    `SELECT id, cuenta_id, hash FROM api_keys
     WHERE prefijo = $1 AND revocado_en IS NULL`,
    [prefijo],
  );
  if (!fila) return null;
  if (hashApiKey(clave) !== fila.hash) return null;
  await queryOne('UPDATE api_keys SET ultimo_uso_en = now() WHERE id = $1', [fila.id]);
  return {
    usuarioId: 'api-key',
    cuentaId: fila.cuenta_id,
    email: 'api-key',
    rol: 'admin',
    nombre: 'Clave de API',
  };
}

export function generarTokenWebhook(): string {
  return `whk_${randomBytes(18).toString('hex')}`;
}
