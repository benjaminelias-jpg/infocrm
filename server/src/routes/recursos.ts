import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { query, queryOne, pool } from '../db/pool.js';
import { noEncontrado, peticionInvalida } from '../lib/errores.js';

/** URL pública de un recurso con binario (la que Meta descarga para adjuntarlo). */
function urlPublica(r: any): string | null {
  if (r.url) return r.url;
  if (r.token && r.tiene_archivo) return `${config.apiUrl}/recursos/pub/${r.token}`;
  return null;
}

const MAX_BYTES = 3_200_000; // ~100 s de nota de voz; cabe en el límite de 4,5 MB de Vercel

const PASOS = z.array(z.object({
  recurso_id: z.string().uuid(),
  espera_seg: z.number().int().min(0).max(7 * 86400).default(0),
})).min(1, 'Agregá al menos un atajo a la secuencia').max(10, 'Una secuencia puede tener hasta 10 atajos');

/** Los pasos tienen que ser atajos de esta cuenta y no otras secuencias. */
async function pasosValidos(cuentaId: string, pasos: Array<{ recurso_id: string; espera_seg: number }> | undefined, propio?: string) {
  if (!pasos?.length) throw peticionInvalida('Agregá al menos un atajo a la secuencia.');
  const ids = [...new Set(pasos.map((p) => p.recurso_id))];
  const filas = await query(`SELECT id, tipo FROM recursos WHERE cuenta_id = $1 AND id = ANY($2)`, [cuentaId, ids]);
  if (filas.length !== ids.length) throw peticionInvalida('Uno de los atajos de la secuencia ya no existe.');
  if (filas.some((f: any) => f.tipo === 'secuencia' || f.id === propio)) throw peticionInvalida('Una secuencia no puede tener otra secuencia adentro.');
  return pasos.map((p, i) => ({ recurso_id: p.recurso_id, espera_seg: i === 0 ? 0 : p.espera_seg }));
}

export default async function rutasRecursos(app: FastifyInstance) {
  // Lista (sin el binario; con la URL pública lista para usar).
  app.get('/api/recursos', async (req) => {
    const filas = await query(
      `SELECT id, nombre, tipo, descripcion, mime, url, texto, token, etiquetas, veces_usado,
              creado_en, (datos IS NOT NULL) AS tiene_archivo, pasos, es_agenda
         FROM recursos WHERE cuenta_id = $1 ORDER BY orden ASC NULLS LAST, creado_en DESC`,
      [req.sesion.cuentaId]);
    return filas.map((r: any) => ({ ...r, url_publica: urlPublica(r) }));
  });

  // Crear recurso. Un audio/archivo llega como base64 (archivo_base64 + mime).
  app.post('/api/recursos', async (req, reply) => {
    const d = z.object({
      nombre: z.string().min(1),
      tipo: z.enum(['audio', 'pdf', 'imagen', 'video', 'texto', 'link', 'secuencia']).default('audio'),
      pasos: PASOS.optional(),
      es_agenda: z.boolean().optional(),
      descripcion: z.string().optional(),
      url: z.string().url().optional(),
      texto: z.string().optional(),
      archivo_base64: z.string().optional(),
      mime: z.string().optional(),
    }).parse(req.body);

    let datos: Buffer | null = null;
    if (d.archivo_base64) {
      const limpio = d.archivo_base64.replace(/^data:[^;]+;base64,/, '');
      datos = Buffer.from(limpio, 'base64');
      if (datos.length > MAX_BYTES) {
        throw peticionInvalida('El archivo supera ~3 MB. Grabá un audio más corto o pegá un enlace.');
      }
    }
    if (d.tipo === 'secuencia') d.pasos = await pasosValidos(req.sesion.cuentaId, d.pasos);
    else if (!datos && !d.url && !d.texto) {
      throw peticionInvalida('Subí un archivo, pegá un enlace o escribí un texto.');
    }

    // Lo nuevo sale primero en los atajos del Chat.
    const fila = await queryOne(
      `INSERT INTO recursos (cuenta_id, nombre, tipo, descripcion, mime, datos, url, texto, creado_por, orden, pasos, es_agenda)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
               COALESCE((SELECT MIN(orden) FROM recursos WHERE cuenta_id = $1), 0) - 1, $10, $11)
       RETURNING id, nombre, tipo, descripcion, mime, url, texto, token, etiquetas, veces_usado,
                 creado_en, (datos IS NOT NULL) AS tiene_archivo, pasos, es_agenda`,
      [req.sesion.cuentaId, d.nombre, d.tipo, d.descripcion ?? null, d.mime ?? null,
       datos, d.url ?? null, d.texto ?? null,
       req.sesion.usuarioId === 'api-key' ? null : req.sesion.usuarioId,
       d.tipo === 'secuencia' ? JSON.stringify(d.pasos) : null, d.es_agenda ?? false]);
    return reply.code(201).send({ ...fila, url_publica: urlPublica(fila) });
  });

  // Renombrar.
  app.patch('/api/recursos/:id', async (req) => {
    const { id } = req.params as { id: string };
    const d = z.object({
      nombre: z.string().min(1).max(80).optional(),
      pasos: PASOS.optional(),
      es_agenda: z.boolean().optional(),
    }).parse(req.body);
    const pasos = d.pasos ? JSON.stringify(await pasosValidos(req.sesion.cuentaId, d.pasos, id)) : null;
    const fila = await queryOne(
      `UPDATE recursos SET nombre = COALESCE($3, nombre),
              pasos = CASE WHEN tipo = 'secuencia' AND $4::jsonb IS NOT NULL THEN $4::jsonb ELSE pasos END,
              es_agenda = COALESCE($5, es_agenda)
        WHERE cuenta_id = $1 AND id = $2 RETURNING id, nombre, pasos, es_agenda`,
      [req.sesion.cuentaId, id, d.nombre?.trim() ?? null, pasos, d.es_agenda ?? null]);
    if (!fila) throw noEncontrado('Recurso');
    return fila;
  });

  // Ordenar: recibe los ids en el orden en que deben salir en el Chat.
  app.post('/api/recursos/reordenar', async (req) => {
    const d = z.object({ ids: z.array(z.string().uuid()).max(500) }).parse(req.body);
    await pool.query(
      `UPDATE recursos r SET orden = x.pos
         FROM unnest($2::uuid[]) WITH ORDINALITY AS x(id, pos)
        WHERE r.id = x.id AND r.cuenta_id = $1`, [req.sesion.cuentaId, d.ids]);
    return { ok: true };
  });

  app.delete('/api/recursos/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await queryOne(`DELETE FROM recursos WHERE cuenta_id=$1 AND id=$2 RETURNING id`,
      [req.sesion.cuentaId, id]);
    return reply.code(204).send();
  });

  // Servir el binario en una URL pública (el token es el secreto).
  app.get('/recursos/pub/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const r: any = await queryOne(
      `SELECT datos, mime FROM recursos WHERE token = $1 AND datos IS NOT NULL`, [token]);
    if (!r) return reply.code(404).send({ error: 'no_encontrado' });
    await pool.query(`UPDATE recursos SET veces_usado = veces_usado + 1 WHERE token = $1`, [token]);
    return reply.type(r.mime || 'application/octet-stream').send(r.datos);
  });
}
