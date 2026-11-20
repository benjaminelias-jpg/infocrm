import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne, pool } from '../db/pool.js';
import { conflicto, noEncontrado, peticionInvalida } from '../lib/errores.js';

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'etapa';

/**
 * Etapas con las que nace un pipeline nuevo. Cada una ya sabe con qué evento
 * se mueve sola (si no, las tarjetas de los pipelines creados con «+» no se
 * movían nunca cuando el lead respondía o agendaba).
 */
const ETAPAS_DEFECTO = [
  { nombre: 'Interesado', tipo: 'abierta', color: '#6366f1', evento: 'lead_creado' },
  { nombre: 'En conversación', tipo: 'abierta', color: '#0ea5e9', evento: 'respondio_dm' },
  { nombre: 'Llamada agendada', tipo: 'abierta', color: '#f59e0b', evento: 'reunion_agendada', marca_reunion: true },
  { nombre: 'Cliente', tipo: 'ganada', color: '#10b981', evento: 'venta', marca_venta: true },
  { nombre: 'Perdido', tipo: 'perdida', color: '#ef4444', evento: null },
];

/** Colores para etapas nuevas: se usa el primero que el pipeline todavía no tenga. */
export const PALETA_ETAPAS = ['#6366f1', '#0ea5e9', '#8b5cf6', '#f59e0b', '#14b8a6', '#ec4899', '#84cc16', '#f97316', '#64748b'];

async function nombreLibre(cuentaId: string, nombre: string, excepto?: string) {
  const otro = await queryOne(
    `SELECT id FROM pipelines WHERE cuenta_id = $1 AND activo AND lower(trim(nombre)) = lower(trim($2))
        AND ($3::uuid IS NULL OR id <> $3::uuid)`, [cuentaId, nombre, excepto ?? null]);
  if (otro) throw conflicto(`Ya tenés un pipeline que se llama «${nombre.trim()}».`);
}

export default async function rutasPipelines(app: FastifyInstance) {
  // Crear pipeline: con las etapas básicas, copiando las de otro, o vacío.
  app.post('/pipelines', async (req, reply) => {
    const d = z.object({
      nombre: z.string().trim().min(1, 'Escribí el nombre del pipeline'),
      vacio: z.boolean().optional(),
      copiar_de: z.string().uuid().optional(),
    }).parse(req.body);
    const c = req.sesion.cuentaId;
    await nombreLibre(c, d.nombre);
    const origen = d.copiar_de
      ? await queryOne(`SELECT id FROM pipelines WHERE cuenta_id = $1 AND id = $2 AND activo`, [c, d.copiar_de])
      : null;
    if (d.copiar_de && !origen) throw noEncontrado('Pipeline a copiar');

    const ord = (await queryOne(`SELECT COALESCE(MAX(orden),0)+1 n FROM pipelines WHERE cuenta_id=$1`, [c]))?.n ?? 0;
    let s = slug(d.nombre);
    if (await queryOne(`SELECT 1 FROM pipelines WHERE cuenta_id=$1 AND slug=$2`, [c, s])) s = `${s}-${Date.now().toString(36)}`;
    const p = await queryOne(
      `INSERT INTO pipelines (cuenta_id, nombre, slug, orden) VALUES ($1,$2,$3,$4) RETURNING *`,
      [c, d.nombre, s, ord]);

    if (origen) {
      // Misma estructura: nombres, colores, tipo, evento que las mueve y acciones.
      await pool.query(
        `INSERT INTO etapas (cuenta_id, pipeline_id, nombre, slug, orden, tipo, color, probabilidad,
                             evento_asociado, marca_reunion, marca_venta, acciones)
         SELECT cuenta_id, $2, nombre, slug, orden, tipo, color, probabilidad,
                evento_asociado, marca_reunion, marca_venta, acciones
           FROM etapas WHERE pipeline_id = $1 ORDER BY orden`, [origen.id, p!.id]);
    } else if (!d.vacio) {
      for (const [i, e] of ETAPAS_DEFECTO.entries()) {
        await pool.query(
          `INSERT INTO etapas (cuenta_id, pipeline_id, nombre, slug, orden, tipo, color, evento_asociado, marca_reunion, marca_venta)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [c, p!.id, e.nombre, slug(e.nombre), i, e.tipo, e.color, e.evento, !!e.marca_reunion, !!e.marca_venta]);
      }
    } else {
      // "Vacío" igual necesita una etapa abierta para poder cargar leads.
      await pool.query(
        `INSERT INTO etapas (cuenta_id, pipeline_id, nombre, slug, orden, tipo, color)
         VALUES ($1,$2,'Nueva etapa','nueva-etapa',0,'abierta',$3)`, [c, p!.id, PALETA_ETAPAS[0]]);
    }
    return reply.code(201).send(p);
  });

  app.patch('/pipelines/:id', async (req) => {
    const { id } = req.params as { id: string };
    const d = z.object({
      nombre: z.string().trim().min(1, 'El pipeline necesita un nombre').optional(),
      es_predeterminado: z.boolean().optional(),
    }).parse(req.body);
    const c = req.sesion.cuentaId;
    if (d.nombre) await nombreLibre(c, d.nombre, id);
    const campos = Object.keys(d); if (!campos.length) throw peticionInvalida('Nada que actualizar');
    if (d.es_predeterminado) {
      const existe = await queryOne(`SELECT 1 FROM pipelines WHERE cuenta_id=$1 AND id=$2 AND activo`, [c, id]);
      if (!existe) throw noEncontrado('Pipeline');
      await pool.query(`UPDATE pipelines SET es_predeterminado=false WHERE cuenta_id=$1`, [c]);
    }
    const params: any[] = [c, id];
    const sets = campos.map((k) => { params.push((d as any)[k]); return `${k}=$${params.length}`; });
    const fila = await queryOne(`UPDATE pipelines SET ${sets.join(', ')} WHERE cuenta_id=$1 AND id=$2 RETURNING *`, params);
    if (!fila) throw noEncontrado('Pipeline');
    return fila;
  });

  /**
   * Borrar un pipeline SIN esconder sus leads: los abiertos pasan a otro
   * pipeline (a la etapa con el mismo nombre, o a la primera abierta). Si era
   * el predeterminado, otro pasa a recibir los leads nuevos. Devuelve lo
   * necesario para "Deshacer".
   */
  app.delete('/pipelines/:id', async (req) => {
    const { id } = req.params as { id: string };
    const q = z.object({
      mover_a: z.string().uuid().optional(),
      predeterminado: z.string().uuid().optional(),
    }).parse(req.query ?? {});
    const c = req.sesion.cuentaId;
    const pipe = await queryOne(`SELECT * FROM pipelines WHERE cuenta_id=$1 AND id=$2 AND activo`, [c, id]);
    if (!pipe) throw noEncontrado('Pipeline');
    const otros = await query(
      `SELECT id, nombre, es_predeterminado FROM pipelines WHERE cuenta_id=$1 AND activo AND id<>$2
        ORDER BY es_predeterminado DESC, orden ASC`, [c, id]);
    if (!otros.length) throw peticionInvalida('No podés borrar tu único pipeline.');

    const elegido = (x?: string) => (x ? otros.find((o: any) => o.id === x) : undefined);
    if (q.mover_a && !elegido(q.mover_a)) throw peticionInvalida('Elegí a qué pipeline pasar los leads.');
    if (q.predeterminado && !elegido(q.predeterminado)) throw peticionInvalida('Elegí a qué pipeline entran los leads nuevos.');
    const destino = elegido(q.mover_a) ?? otros[0];

    const etapasDestino = await query(
      `SELECT id, slug, tipo FROM etapas WHERE pipeline_id = $1 ORDER BY orden`, [destino.id]);
    const primeraAbierta = etapasDestino.find((e: any) => e.tipo === 'abierta') ?? etapasDestino[0];

    const cliente = await pool.connect();
    const movidas: Array<{ id: string; pipeline_id: string; etapa_id: string }> = [];
    let yaEstaban = 0;
    let nuevoPredeterminado: string | null = null;
    try {
      await cliente.query('BEGIN');
      const abiertas = (await cliente.query(
        `SELECT o.id, o.lead_id, o.etapa_id, e.slug
           FROM oportunidades o JOIN etapas e ON e.id = o.etapa_id
          WHERE o.cuenta_id = $1 AND o.pipeline_id = $2 AND o.estado = 'abierta'`, [c, id])).rows;
      for (const o of abiertas) {
        // Si el lead ya tiene una oportunidad abierta en el destino, ya se ve ahí.
        const ya = (await cliente.query(
          `SELECT 1 FROM oportunidades WHERE lead_id = $1 AND pipeline_id = $2 AND estado = 'abierta' LIMIT 1`,
          [o.lead_id, destino.id])).rows[0];
        if (ya) { yaEstaban++; continue; }
        const etapa = etapasDestino.find((e: any) => e.slug === o.slug && e.tipo === 'abierta') ?? primeraAbierta;
        if (!etapa) continue;
        await cliente.query(`UPDATE oportunidades SET pipeline_id = $2, etapa_id = $3 WHERE id = $1`, [o.id, destino.id, etapa.id]);
        await cliente.query(
          `INSERT INTO etapa_historial (cuenta_id, oportunidad_id, etapa_desde_id, etapa_hasta_id, origen, usuario_id)
           VALUES ($1,$2,$3,$4,'manual',$5)`,
          [c, o.id, o.etapa_id, etapa.id, req.sesion.usuarioId && req.sesion.usuarioId !== 'api-key' ? req.sesion.usuarioId : null]);
        movidas.push({ id: o.id, pipeline_id: id, etapa_id: o.etapa_id });
      }
      await cliente.query(`UPDATE pipelines SET activo=false, es_predeterminado=false WHERE cuenta_id=$1 AND id=$2`, [c, id]);
      if (pipe.es_predeterminado) {
        nuevoPredeterminado = (elegido(q.predeterminado) ?? destino).id;
        await cliente.query(`UPDATE pipelines SET es_predeterminado = (id = $2) WHERE cuenta_id = $1`, [c, nuevoPredeterminado]);
      }
      await cliente.query('COMMIT');
    } catch (err) {
      await cliente.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      cliente.release();
    }
    return {
      borrado: { id, nombre: pipe.nombre, era_predeterminado: !!pipe.es_predeterminado },
      destino: { id: destino.id, nombre: destino.nombre },
      movidas, ya_estaban: yaEstaban,
      predeterminado_id: nuevoPredeterminado,
    };
  });

  /** "Deshacer" del borrado: lo vuelve a activar y devuelve sus leads a donde estaban. */
  app.post('/pipelines/:id/restaurar', async (req) => {
    const { id } = req.params as { id: string };
    const d = z.object({
      movidas: z.array(z.object({ id: z.string().uuid(), etapa_id: z.string().uuid() })).max(5000).default([]),
      era_predeterminado: z.boolean().optional(),
    }).parse(req.body ?? {});
    const c = req.sesion.cuentaId;
    const pipe = await queryOne(`UPDATE pipelines SET activo = true WHERE cuenta_id=$1 AND id=$2 RETURNING *`, [c, id]);
    if (!pipe) throw noEncontrado('Pipeline');
    let devueltas = 0;
    for (const m of d.movidas) {
      // Solo etapas de ESTE pipeline y oportunidades de esta cuenta que sigan abiertas.
      const r = await pool.query(
        `UPDATE oportunidades o SET pipeline_id = $3, etapa_id = $4
          WHERE o.cuenta_id = $1 AND o.id = $2 AND o.estado = 'abierta'
            AND EXISTS (SELECT 1 FROM etapas e WHERE e.id = $4 AND e.pipeline_id = $3)`,
        [c, m.id, id, m.etapa_id]);
      devueltas += r.rowCount ?? 0;
    }
    if (d.era_predeterminado) {
      await pool.query(`UPDATE pipelines SET es_predeterminado = (id = $2) WHERE cuenta_id = $1`, [c, id]);
    }
    return { ...pipe, es_predeterminado: d.era_predeterminado ? true : pipe.es_predeterminado, devueltas };
  });

  /**
   * Crear etapa. Por defecto entra ANTES de las de cierre (venta/perdido), no
   * al final; con `antes_de` se inserta justo ahí. Usa un color libre.
   */
  app.post('/pipelines/:id/etapas', async (req, reply) => {
    const { id } = req.params as { id: string };
    const d = z.object({
      nombre: z.string().trim().min(1, 'Escribí el nombre de la etapa'),
      tipo: z.enum(['abierta', 'ganada', 'perdida']).default('abierta'),
      color: z.string().optional(),
      antes_de: z.string().uuid().nullable().optional(),
      evento_asociado: z.string().nullable().optional(),
    }).parse(req.body);
    const c = req.sesion.cuentaId;
    const pipe = await queryOne(`SELECT 1 FROM pipelines WHERE cuenta_id=$1 AND id=$2`, [c, id]);
    if (!pipe) throw noEncontrado('Pipeline');
    const etapas = await query(`SELECT id, orden, tipo, color, slug FROM etapas WHERE pipeline_id=$1 ORDER BY orden`, [id]);

    let pos: number;
    const ref = d.antes_de ? etapas.find((e: any) => e.id === d.antes_de) : null;
    if (d.antes_de && !ref) throw peticionInvalida('Esa etapa no es de este pipeline.');
    if (ref) pos = ref.orden;
    else {
      const cierre = d.tipo === 'abierta' && d.antes_de !== null ? etapas.find((e: any) => e.tipo !== 'abierta') : null;
      pos = cierre ? cierre.orden : (etapas.length ? Math.max(...etapas.map((e: any) => e.orden)) + 1 : 0);
    }
    await pool.query(`UPDATE etapas SET orden = orden + 1 WHERE pipeline_id = $1 AND orden >= $2`, [id, pos]);

    let s = slug(d.nombre);
    if (etapas.some((e: any) => e.slug === s)) s = `${s}-${Date.now().toString(36).slice(-4)}`;
    const usados = new Set(etapas.map((e: any) => String(e.color).toLowerCase()));
    const color = d.color ?? PALETA_ETAPAS.find((x) => !usados.has(x)) ?? PALETA_ETAPAS[etapas.length % PALETA_ETAPAS.length];
    const fila = await queryOne(
      `INSERT INTO etapas (cuenta_id, pipeline_id, nombre, slug, orden, tipo, color, evento_asociado, marca_venta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [c, id, d.nombre, s, pos, d.tipo, color, d.evento_asociado ?? null, d.tipo === 'ganada']);
    return reply.code(201).send(fila);
  });

  /**
   * Borrar etapa: sus leads pasan a otra (la elegida en `mover_a`, o la
   * abierta anterior, o la primera abierta). Devuelve a dónde y cuántos.
   */
  app.delete('/etapas/:id', async (req) => {
    const { id } = req.params as { id: string };
    const q = z.object({ mover_a: z.string().uuid().optional() }).parse(req.query ?? {});
    const c = req.sesion.cuentaId;
    const et = await queryOne(`SELECT pipeline_id, tipo, orden, nombre FROM etapas WHERE cuenta_id=$1 AND id=$2`, [c, id]);
    if (!et) throw noEncontrado('Etapa');
    const abiertas = (await queryOne(`SELECT COUNT(*)::int n FROM etapas WHERE pipeline_id=$1 AND tipo='abierta'`, [et.pipeline_id]))?.n ?? 0;
    if (et.tipo === 'abierta' && abiertas <= 1) throw peticionInvalida('El pipeline necesita al menos una etapa abierta.');
    let destino = q.mover_a
      ? await queryOne(`SELECT id, nombre FROM etapas WHERE id=$1 AND pipeline_id=$2 AND id<>$3`, [q.mover_a, et.pipeline_id, id])
      : null;
    if (q.mover_a && !destino) throw peticionInvalida('Elegí otra etapa de este pipeline para sus leads.');
    destino ??= await queryOne(
      `SELECT id, nombre FROM etapas WHERE pipeline_id=$1 AND tipo='abierta' AND id<>$2 AND orden < $3 ORDER BY orden DESC LIMIT 1`,
      [et.pipeline_id, id, et.orden]);
    destino ??= await queryOne(
      `SELECT id, nombre FROM etapas WHERE pipeline_id=$1 AND tipo='abierta' AND id<>$2 ORDER BY orden LIMIT 1`, [et.pipeline_id, id]);
    let movidas = 0;
    if (destino) {
      const r = await pool.query(`UPDATE oportunidades SET etapa_id=$1 WHERE etapa_id=$2`, [destino.id, id]);
      movidas = r.rowCount ?? 0;
    }
    await pool.query(`DELETE FROM etapas WHERE cuenta_id=$1 AND id=$2`, [c, id]);
    return { borrada: { id, nombre: et.nombre }, destino, movidas };
  });

  // Duplicar una etapa (con sus acciones), justo debajo de la original.
  app.post('/etapas/:id/duplicar', async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = req.sesion.cuentaId;
    const e = await queryOne(`SELECT * FROM etapas WHERE cuenta_id=$1 AND id=$2`, [c, id]);
    if (!e) throw noEncontrado('Etapa');
    await pool.query(`UPDATE etapas SET orden = orden + 1 WHERE pipeline_id = $1 AND orden > $2`, [e.pipeline_id, e.orden]);
    const fila = await queryOne(
      `INSERT INTO etapas (cuenta_id, pipeline_id, nombre, slug, orden, tipo, color, marca_reunion, marca_venta, acciones)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING *`,
      [c, e.pipeline_id, `${e.nombre} (copia)`, `${e.slug}-copia-${Date.now().toString(36)}`,
       e.orden + 1, e.tipo, e.color, e.marca_reunion, e.marca_venta, JSON.stringify(e.acciones ?? [])]);
    return reply.code(201).send(fila);
  });

  // Reordenar etapas de un pipeline (un solo pedido al soltar).
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
