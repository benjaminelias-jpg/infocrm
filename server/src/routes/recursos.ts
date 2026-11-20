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

export default async function rutasRecursos(app: FastifyInstance) {
  // Lista (sin el binario; con la URL pública lista para usar).
  app.get('/api/recursos', async (req) => {
    const filas = await query(
      `SELECT id, nombre, tipo, descripcion, mime, url, texto, token, etiquetas, veces_usado,
              creado_en, (datos IS NOT NULL) AS tiene_archivo
         FROM recursos WHERE cuenta_id = $1 ORDER BY orden ASC NULLS LAST, creado_en DESC`,
      [req.sesion.cuentaId]);
    return filas.map((r: any) => ({ ...r, url_publica: urlPublica(r) }));
  });

  // Crear recurso. Un audio/archivo llega como base64 (archivo_base64 + mime).
  app.post('/api/recursos', async (req, reply) => {
    const d = z.object({
      nombre: z.string().min(1),
      tipo: z.enum(['audio', 'pdf', 'imagen', 'video', 'texto', 'link']).default('audio'),
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
    if (!datos && !d.url && !d.texto) {
      throw peticionInvalida('Subí un archivo, pegá un enlace o escribí un texto.');
    }

    // Lo nuevo sale primero en los atajos del Chat.
    const fila = await queryOne(
      `INSERT INTO recursos (cuenta_id, nombre, tipo, descripcion, mime, datos, url, texto, creado_por, orden)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
               COALESCE((SELECT MIN(orden) FROM recursos WHERE cuenta_id = $1), 0) - 1)
       RETURNING id, nombre, tipo, descripcion, mime, url, texto, token, etiquetas, veces_usado,
                 creado_en, (datos IS NOT NULL) AS tiene_archivo`,
      [req.sesion.cuentaId, d.nombre, d.tipo, d.descripcion ?? null, d.mime ?? null,
       datos, d.url ?? null, d.texto ?? null,
       req.sesion.usuarioId === 'api-key' ? null : req.sesion.usuarioId]);
    return reply.code(201).send({ ...fila, url_publica: urlPublica(fila) });
  });

  // Renombrar.
  app.patch('/api/recursos/:id', async (req) => {
    const { id } = req.params as { id: string };
    const d = z.object({ nombre: z.string().min(1).max(80) }).parse(req.body);
    const fila = await queryOne(
      `UPDATE recursos SET nombre = $3 WHERE cuenta_id = $1 AND id = $2 RETURNING id, nombre`,
      [req.sesion.cuentaId, id, d.nombre.trim()]);
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
