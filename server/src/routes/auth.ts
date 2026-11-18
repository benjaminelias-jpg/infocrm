import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db/pool.js';
import { verificarPassword, firmarToken } from '../lib/auth.js';
import { crearCuenta } from '../modules/cuentas.js';
import { noAutorizado, conflicto } from '../lib/errores.js';

const esquemaLogin = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const esquemaRegistro = z.object({
  cuenta: z.string().min(2),
  nombre: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
  ig_username: z.string().optional(),
  moneda: z.string().length(3).optional(),
  zona_horaria: z.string().optional(),
});

export default async function rutasAuth(app: FastifyInstance) {
  app.post('/login', async (req) => {
    const { email, password } = esquemaLogin.parse(req.body);

    const usuario = await queryOne(
      `SELECT u.*, c.nombre AS cuenta_nombre, c.moneda, c.zona_horaria
         FROM usuarios u JOIN cuentas c ON c.id = u.cuenta_id
        WHERE lower(u.email) = lower($1) AND u.activo AND c.activo
        LIMIT 1`,
      [email],
    );
    if (!usuario) throw noAutorizado('Email o contraseña incorrectos');

    const ok = await verificarPassword(password, usuario.password_hash);
    if (!ok) throw noAutorizado('Email o contraseña incorrectos');

    await queryOne(`UPDATE usuarios SET ultimo_acceso_en = now() WHERE id = $1`, [usuario.id]);

    const sesion = {
      usuarioId: usuario.id,
      cuentaId: usuario.cuenta_id,
      email: usuario.email,
      rol: usuario.rol,
      nombre: usuario.nombre,
    };

    return {
      token: firmarToken(sesion),
      usuario: {
        id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol,
      },
      cuenta: {
        id: usuario.cuenta_id, nombre: usuario.cuenta_nombre,
        moneda: usuario.moneda, zona_horaria: usuario.zona_horaria,
      },
    };
  });

  /** Alta de cuenta. Hoy la usas tú; el día que vendas el CRM, es el registro. */
  app.post('/registro', async (req, reply) => {
    const datos = esquemaRegistro.parse(req.body);

    const existe = await queryOne(`SELECT id FROM usuarios WHERE lower(email) = lower($1)`, [datos.email]);
    if (existe) throw conflicto('Ya existe un usuario con ese email');

    const { cuenta, usuario, endpoints } = await crearCuenta({
      nombre: datos.cuenta,
      igUsername: datos.ig_username,
      moneda: datos.moneda,
      zonaHoraria: datos.zona_horaria,
      owner: { nombre: datos.nombre, email: datos.email, password: datos.password },
    });

    const sesion = {
      usuarioId: usuario.id, cuentaId: cuenta.id, email: usuario.email,
      rol: usuario.rol, nombre: usuario.nombre,
    };

    return reply.code(201).send({
      token: firmarToken(sesion),
      usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol },
      cuenta: { id: cuenta.id, nombre: cuenta.nombre, moneda: cuenta.moneda },
      webhooks: endpoints.map((e: any) => ({ nombre: e.nombre, slug: e.slug, token: e.token })),
    });
  });

  app.get('/yo', async (req) => {
    const { cuentaId, usuarioId } = req.sesion;
    const [usuario] = await query(
      `SELECT u.id, u.nombre, u.email, u.rol, c.id AS cuenta_id, c.nombre AS cuenta_nombre,
              c.moneda, c.zona_horaria, c.ig_username
         FROM usuarios u JOIN cuentas c ON c.id = u.cuenta_id
        WHERE u.cuenta_id = $1 AND (u.id::text = $2 OR $2 = 'api-key')
        LIMIT 1`,
      [cuentaId, usuarioId],
    );
    return usuario ?? { cuenta_id: cuentaId, rol: req.sesion.rol, nombre: req.sesion.nombre };
  });
}
