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

export default async function rutasRecursos(app: FastifyInstance) {
  // Lista (sin el binario; con la URL pública lista para usar).
  app.get('/api/recursos', async (req) => {
    const filas = await query(
      `SELECT id, nombre, tipo, descripcion, mime, url, texto, token, etiquetas, veces_usado,
              creado_en, (datos IS NOT NULL) AS tiene_archivo
         FROM recursos WHERE cuenta_id = $1 ORDER BY creado_en DESC`,
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
      if (datos.length > 1_800_000) {
        throw peticionInvalida('El archivo supera ~1,8 MB. Graba un audio más corto o usa una URL.');
      }
    }
    if (!datos && !d.url && !d.texto) {
      throw peticionInvalida('Sube un archivo, pega una URL o escribe un texto.');
    }

    const fila = await queryOne(
      `INSERT INTO recursos (cuenta_id, nombre, tipo, descripcion, mime, datos, url, texto, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, nombre, tipo, descripcion, mime, url, texto, token, etiquetas, veces_usado,
                 creado_en, (datos IS NOT NULL) AS tiene_archivo`,
      [req.sesion.cuentaId, d.nombre, d.tipo, d.descripcion ?? null, d.mime ?? null,
       datos, d.url ?? null, d.texto ?? null,
       req.sesion.usuarioId === 'api-key' ? null : req.sesion.usuarioId]);
    return reply.code(201).send({ ...fila, url_publica: urlPublica(fila) });
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
