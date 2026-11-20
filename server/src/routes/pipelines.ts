import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne, pool } from '../db/pool.js';
import { noEncontrado, peticionInvalida } from '../lib/errores.js';

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'etapa';

const ETAPAS_DEFECTO = [
  { nombre: 'Interesado', tipo: 'abierta', color: '#6366f1' },
  { nombre: 'En conversación', tipo: 'abierta', color: '#0ea5e9' },
  { nombre: 'Llamada agendada', tipo: 'abierta', color: '#f59e0b', marca_reunion: true },
  { nombre: 'Cliente', tipo: 'ganada', color: '#10b981', marca_venta: true },
  { nombre: 'Perdido', tipo: 'perdida', color: '#ef4444' },
];

export default async function rutasPipelines(app: FastifyInstance) {
  // Crear pipeline (con etapas por defecto para que sea usable al instante).
  app.post('/pipelines', async (req, reply) => {
    const d = z.object({ nombre: z.string().min(1), vacio: z.boolean().optional() }).parse(req.body);
    const c = req.sesion.cuentaId;
    const ord = (await queryOne(`SELECT COALESCE(MAX(orden),0)+1 n FROM pipelines WHERE cuenta_id=$1`, [c]))?.n ?? 0;
    let s = slug(d.nombre);
    if (await queryOne(`SELECT 1 FROM pipelines WHERE cuenta_id=$1 AND slug=$2`, [c, s])) s = `${s}-${Date.now().toString(36)}`;
    const p = await queryOne(
      `INSERT INTO pipelines (cuenta_id, nombre, slug, orden) VALUES ($1,$2,$3,$4) RETURNING *`,
      [c, d.nombre, s, ord]);
    if (!d.vacio) {
      for (const [i, e] of ETAPAS_DEFECTO.entries()) {
        await pool.query(
          `INSERT INTO etapas (cuenta_id, pipeline_id, nombre, slug, orden, tipo, color, marca_reunion, marca_venta)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [c, p!.id, e.nombre, slug(e.nombre), i, e.tipo, e.color, !!e.marca_reunion, !!e.marca_venta]);
      }
    }
    return reply.code(201).send(p);
  });

  app.patch('/pipelines/:id', async (req) => {
    const { id } = req.params as { id: string };
    const d = z.object({ nombre: z.string().optional(), es_predeterminado: z.boolean().optional() }).parse(req.body);
    const c = req.sesion.cuentaId;
    if (d.es_predeterminado) await pool.query(`UPDATE pipelines SET es_predeterminado=false WHERE cuenta_id=$1`, [c]);
    const campos = Object.keys(d); if (!campos.length) throw peticionInvalida('Nada que actualizar');
    const params: any[] = [c, id];
    const sets = campos.map((k) => { params.push((d as any)[k]); return `${k}=$${params.length}`; });
    const fila = await queryOne(`UPDATE pipelines SET ${sets.join(', ')} WHERE cuenta_id=$1 AND id=$2 RETURNING *`, params);
    if (!fila) throw noEncontrado('Pipeline');
    return fila;
  });

  app.delete('/pipelines/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = req.sesion.cuentaId;
    const n = (await queryOne(`SELECT COUNT(*)::int n FROM pipelines WHERE cuenta_id=$1 AND activo`, [c]))?.n ?? 0;
    if (n <= 1) throw peticionInvalida('No puedes borrar tu único pipeline.');
    await pool.query(`UPDATE pipelines SET activo=false WHERE cuenta_id=$1 AND id=$2`, [c, id]);
    return reply.code(204).send();
  });

  // Crear etapa al final de un pipeline.
  app.post('/pipelines/:id/etapas', async (req, reply) => {
    const { id } = req.params as { id: string };
    const d = z.object({ nombre: z.string().min(1), tipo: z.enum(['abierta', 'ganada', 'perdida']).default('abierta'), color: z.string().optional() }).parse(req.body);
    const c = req.sesion.cuentaId;
    const pipe = await queryOne(`SELECT 1 FROM pipelines WHERE cuenta_id=$1 AND id=$2`, [c, id]);
    if (!pipe) throw noEncontrado('Pipeline');
    const ord = (await queryOne(`SELECT COALESCE(MAX(orden),0)+1 n FROM etapas WHERE pipeline_id=$1`, [id]))?.n ?? 0;
    let s = slug(d.nombre);
    if (await queryOne(`SELECT 1 FROM etapas WHERE pipeline_id=$1 AND slug=$2`, [id, s])) s = `${s}-${ord}`;
    const fila = await queryOne(
      `INSERT INTO etapas (cuenta_id, pipeline_id, nombre, slug, orden, tipo, color)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [c, id, d.nombre, s, ord, d.tipo, d.color ?? '#6366f1']);
    return reply.code(201).send(fila);
  });

  app.delete('/etapas/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = req.sesion.cuentaId;
    const et = await queryOne(`SELECT pipeline_id, tipo FROM etapas WHERE cuenta_id=$1 AND id=$2`, [c, id]);
    if (!et) throw noEncontrado('Etapa');
    const abiertas = (await queryOne(`SELECT COUNT(*)::int n FROM etapas WHERE pipeline_id=$1 AND tipo='abierta'`, [et.pipeline_id]))?.n ?? 0;
    if (et.tipo === 'abierta' && abiertas <= 1) throw peticionInvalida('El pipeline necesita al menos una etapa abierta.');
    // Mueve las oportunidades de esa etapa a la primera abierta del pipeline.
    const destino = await queryOne(`SELECT id FROM etapas WHERE pipeline_id=$1 AND tipo='abierta' AND id<>$2 ORDER BY orden LIMIT 1`, [et.pipeline_id, id]);
    if (destino) await pool.query(`UPDATE oportunidades SET etapa_id=$1 WHERE etapa_id=$2`, [destino.id, id]);
    await pool.query(`DELETE FROM etapas WHERE cuenta_id=$1 AND id=$2`, [c, id]);
    return reply.code(204).send();
  });

  // Duplicar una etapa (con sus acciones).
  app.post('/etapas/:id/duplicar', async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = req.sesion.cuentaId;
    const e = await queryOne(`SELECT * FROM etapas WHERE cuenta_id=$1 AND id=$2`, [c, id]);
    if (!e) throw noEncontrado('Etapa');
    const fila = await queryOne(
      `INSERT INTO etapas (cuenta_id, pipeline_id, nombre, slug, orden, tipo, color, marca_reunion, marca_venta, acciones)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING *`,
      [c, e.pipeline_id, `${e.nombre} (copia)`, `${e.slug}-copia-${Date.now().toString(36)}`,
       e.orden + 1, e.tipo, e.color, e.marca_reunion, e.marca_venta, JSON.stringify(e.acciones ?? [])]);
    return reply.code(201).send(fila);
  });

  // Reordenar etapas de un pipeline.
  app.post('/pipelines/:id/reordenar', async (req) => {
    const { id } = req.params as { id: string };
    const d = z.object({ orden: z.array(z.string().uuid()) }).parse(req.body);
    const c = req.sesion.cuentaId;
    for (let i = 0; i < d.orden.length; i++) {
      await pool.query(`UPDATE etapas SET orden=$1 WHERE cuenta_id=$2 AND id=$3 AND pipeline_id=$4`, [i, c, d.orden[i], id]);
    }
    return query(`SELECT * FROM etapas WHERE pipeline_id=$1 ORDER BY orden`, [id]);
  });
}
