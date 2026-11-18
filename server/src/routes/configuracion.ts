import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db/pool.js';
import { noEncontrado } from '../lib/errores.js';
import { generarApiKey } from '../lib/auth.js';

const esquemaRegla = z.object({
  nombre: z.string().min(1),
  descripcion: z.string().optional(),
  disparador: z.object({ evento: z.string() }),
  condiciones: z.array(z.object({
    campo: z.string(),
    operador: z.string(),
    valor: z.any().optional(),
  })).default([]),
  acciones: z.array(z.object({ tipo: z.string() }).passthrough()).default([]),
  orden: z.number().int().optional(),
  activo: z.boolean().optional(),
});

export default async function rutasConfiguracion(app: FastifyInstance) {
  // ---------------- Reglas ----------------

  app.get('/reglas', async (req) =>
    query(
      `SELECT r.*,
              (SELECT COUNT(*) FROM regla_ejecuciones x WHERE x.regla_id = r.id AND x.estado='ok')::int AS ejecuciones_ok,
              (SELECT COUNT(*) FROM regla_ejecuciones x WHERE x.regla_id = r.id AND x.estado='error')::int AS ejecuciones_error
         FROM reglas r WHERE r.cuenta_id = $1 ORDER BY r.orden ASC, r.creado_en ASC`,
      [req.sesion.cuentaId],
    ));

  app.post('/reglas', async (req, reply) => {
    const d = esquemaRegla.parse(req.body);
    const fila = await queryOne(
      `INSERT INTO reglas (cuenta_id, nombre, descripcion, disparador, condiciones, acciones, orden, activo)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8) RETURNING *`,
      [req.sesion.cuentaId, d.nombre, d.descripcion ?? null,
       JSON.stringify(d.disparador), JSON.stringify(d.condiciones), JSON.stringify(d.acciones),
       d.orden ?? 100, d.activo ?? true],
    );
    return reply.code(201).send(fila);
  });

  app.patch('/reglas/:id', async (req) => {
    const { id } = req.params as { id: string };
    const d = esquemaRegla.partial().parse(req.body);
    const campos = Object.keys(d);
    if (campos.length === 0) throw noEncontrado('Nada que actualizar');

    const jsonb = new Set(['disparador', 'condiciones', 'acciones']);
    const params: any[] = [req.sesion.cuentaId, id];
    const sets = campos.map((c) => {
      const v = (d as any)[c];
      params.push(jsonb.has(c) ? JSON.stringify(v) : v);
      return jsonb.has(c) ? `${c} = $${params.length}::jsonb` : `${c} = $${params.length}`;
    });

    const fila = await queryOne(
      `UPDATE reglas SET ${sets.join(', ')} WHERE cuenta_id = $1 AND id = $2 RETURNING *`, params);
    if (!fila) throw noEncontrado('Regla');
    return fila;
  });

  app.delete('/reglas/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const fila = await queryOne(
      `DELETE FROM reglas WHERE cuenta_id = $1 AND id = $2 RETURNING id`,
      [req.sesion.cuentaId, id]);
    if (!fila) throw noEncontrado('Regla');
    return reply.code(204).send();
  });

  app.get('/reglas/:id/ejecuciones', async (req) => {
    const { id } = req.params as { id: string };
    return query(
      `SELECT x.*, l.ig_username, l.nombre AS lead_nombre
         FROM regla_ejecuciones x
         LEFT JOIN leads l ON l.id = x.lead_id
        WHERE x.cuenta_id = $1 AND x.regla_id = $2
        ORDER BY x.ejecutado_en DESC LIMIT 100`,
      [req.sesion.cuentaId, id]);
  });

  // ---------------- Integraciones ----------------

  app.get('/integraciones', async (req) =>
    query(
      `SELECT id, tipo, nombre, estado, ultimo_error, ultimo_sync_en, activo, creado_en,
              (credenciales ? 'access_token') AS tiene_token,
              credenciales->>'ig_user_id' AS ig_user_id
         FROM integraciones WHERE cuenta_id = $1 ORDER BY tipo ASC`,
      [req.sesion.cuentaId],
    ));

  // ---------------- Claves de API ----------------

  app.get('/api-keys', async (req) =>
    query(
      `SELECT id, nombre, prefijo, ultimo_uso_en, revocado_en, creado_en
         FROM api_keys WHERE cuenta_id = $1 ORDER BY creado_en DESC`,
      [req.sesion.cuentaId],
    ));

  app.post('/api-keys', async (req, reply) => {
    const { nombre } = z.object({ nombre: z.string().min(1) }).parse(req.body);
    const { clave, prefijo, hash } = generarApiKey();
    const fila = await queryOne(
      `INSERT INTO api_keys (cuenta_id, nombre, prefijo, hash, creado_por)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, nombre, prefijo, creado_en`,
      [req.sesion.cuentaId, nombre, prefijo, hash,
       req.sesion.usuarioId === 'api-key' ? null : req.sesion.usuarioId],
    );
    // La clave en claro solo se muestra una vez
    return reply.code(201).send({ ...fila, clave });
  });

  app.delete('/api-keys/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await queryOne(
      `UPDATE api_keys SET revocado_en = now() WHERE cuenta_id = $1 AND id = $2 RETURNING id`,
      [req.sesion.cuentaId, id]);
    return reply.code(204).send();
  });

  // ---------------- Cuenta ----------------

  app.get('/cuenta', async (req) =>
    queryOne(`SELECT * FROM cuentas WHERE id = $1`, [req.sesion.cuentaId]));

  app.patch('/cuenta', async (req) => {
    const d = z.object({
      nombre: z.string().optional(),
      moneda: z.string().length(3).optional(),
      zona_horaria: z.string().optional(),
      ig_username: z.string().optional(),
    }).parse(req.body);

    const campos = Object.keys(d);
    if (campos.length === 0) throw noEncontrado('Nada que actualizar');
    const params: any[] = [req.sesion.cuentaId];
    const sets = campos.map((c) => {
      params.push((d as any)[c]);
      return `${c} = $${params.length}`;
    });
    return queryOne(`UPDATE cuentas SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
  });
}
