import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db/pool.js';
import { conflicto, noEncontrado } from '../lib/errores.js';
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

/** ¿Ya hay otra regla que hace exactamente lo mismo (mismo evento, condiciones y acciones)? */
async function reglaRepetida(cuentaId: string, r: { disparador: unknown; condiciones: unknown; acciones: unknown }, excepto?: string) {
  return queryOne(
    `SELECT id, nombre FROM reglas
      WHERE cuenta_id = $1 AND disparador = $2::jsonb AND condiciones = $3::jsonb AND acciones = $4::jsonb
        AND ($5::uuid IS NULL OR id <> $5::uuid)
      LIMIT 1`,
    [cuentaId, JSON.stringify(r.disparador), JSON.stringify(r.condiciones ?? []), JSON.stringify(r.acciones ?? []), excepto ?? null]);
}

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
    if (await reglaRepetida(req.sesion.cuentaId, d)) throw conflicto('Ya tenés esta regla: hace exactamente lo mismo.');
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
    if (d.disparador || d.condiciones || d.acciones) {
      const actual = await queryOne(`SELECT disparador, condiciones, acciones FROM reglas WHERE cuenta_id = $1 AND id = $2`,
        [req.sesion.cuentaId, id]);
      if (!actual) throw noEncontrado('Regla');
      const nueva = { disparador: d.disparador ?? actual.disparador, condiciones: d.condiciones ?? actual.condiciones, acciones: d.acciones ?? actual.acciones };
      if (await reglaRepetida(req.sesion.cuentaId, nueva, id)) throw conflicto('Ya tenés otra regla que hace exactamente lo mismo.');
    }

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

  // ---------------- Objetivo del mes ----------------

  app.get('/metas', async (req) =>
    query(`SELECT * FROM metas WHERE cuenta_id = $1 ORDER BY mes DESC LIMIT 12`,
      [req.sesion.cuentaId]));

  /** Fija (o actualiza) el objetivo de un mes. mes = 'YYYY-MM' o fecha; se trunca al mes. */
  app.put('/metas', async (req) => {
    const d = z.object({
      mes: z.string().optional(),
      leads_meta: z.number().int().min(0).default(0),
      calificados_meta: z.number().int().min(0).default(0),
      ventas_meta: z.number().int().min(0).default(0),
      ingresos_meta: z.number().min(0).default(0),
    }).parse(req.body);
    const mes = d.mes ? new Date(d.mes) : new Date();
    return queryOne(
      `INSERT INTO metas (cuenta_id, mes, leads_meta, calificados_meta, ventas_meta, ingresos_meta)
       VALUES ($1, date_trunc('month', $2::timestamptz)::date, $3, $4, $5, $6)
       ON CONFLICT (cuenta_id, mes) DO UPDATE SET
         leads_meta = EXCLUDED.leads_meta, calificados_meta = EXCLUDED.calificados_meta,
         ventas_meta = EXCLUDED.ventas_meta, ingresos_meta = EXCLUDED.ingresos_meta
       RETURNING *`,
      [req.sesion.cuentaId, mes, d.leads_meta, d.calificados_meta, d.ventas_meta, d.ingresos_meta]);
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
