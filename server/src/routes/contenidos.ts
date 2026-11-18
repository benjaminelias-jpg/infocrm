import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db/pool.js';
import { noEncontrado } from '../lib/errores.js';
import { listarContenidos, sincronizarInstagram, probarConexion, guardarCredenciales } from '../modules/instagram.js';
import { reatribuir } from '../modules/atribucion.js';
import { calidadAtribucion } from '../modules/analitica.js';

const esquemaContenido = z.object({
  titulo: z.string().min(1),
  tipo: z.enum(['reel', 'post', 'carrusel', 'historia', 'live', 'anuncio', 'otro']).default('reel'),
  ig_media_id: z.string().optional(),
  permalink: z.string().optional(),
  caption: z.string().optional(),
  thumbnail_url: z.string().optional(),
  publicado_en: z.string().optional(),
  etiquetas: z.array(z.string()).optional(),
});

const esquemaAutomatizacion = z.object({
  nombre: z.string().min(1),
  palabra_clave: z.string().optional(),
  recurso: z.string().optional(),
  contenido_id: z.string().uuid().nullable().optional(),
  manychat_flow_id: z.string().optional(),
  tipo_disparo: z.enum(['comentario', 'dm', 'historia', 'bio_link', 'anuncio', 'otro']).default('comentario'),
  activo: z.boolean().optional(),
});

export default async function rutasContenidos(app: FastifyInstance) {
  // ---------------- Contenidos ----------------

  app.get('/contenidos', async (req) => {
    const q = req.query as Record<string, string>;
    return listarContenidos(req.sesion.cuentaId, { q: q.q, tipo: q.tipo });
  });

  app.post('/contenidos', async (req, reply) => {
    const d = esquemaContenido.parse(req.body);
    const fila = await queryOne(
      `INSERT INTO contenidos (cuenta_id, titulo, tipo, ig_media_id, permalink, caption,
                               thumbnail_url, publicado_en, etiquetas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        req.sesion.cuentaId, d.titulo, d.tipo, d.ig_media_id ?? null, d.permalink ?? null,
        d.caption ?? null, d.thumbnail_url ?? null,
        d.publicado_en ? new Date(d.publicado_en) : null, d.etiquetas ?? [],
      ],
    );
    return reply.code(201).send(fila);
  });

  app.patch('/contenidos/:id', async (req) => {
    const { id } = req.params as { id: string };
    const d = esquemaContenido.partial().parse(req.body);
    const campos = Object.keys(d);
    if (campos.length === 0) throw noEncontrado('Nada que actualizar');

    const params: any[] = [req.sesion.cuentaId, id];
    const sets = campos.map((c) => {
      const v = (d as any)[c];
      params.push(c === 'publicado_en' && v ? new Date(v) : v);
      return `${c} = $${params.length}`;
    });

    const fila = await queryOne(
      `UPDATE contenidos SET ${sets.join(', ')} WHERE cuenta_id = $1 AND id = $2 RETURNING *`, params);
    if (!fila) throw noEncontrado('Contenido');
    return fila;
  });

  app.get('/contenidos/:id', async (req) => {
    const { id } = req.params as { id: string };
    const contenido = await queryOne(
      `SELECT * FROM contenidos WHERE cuenta_id = $1 AND id = $2`, [req.sesion.cuentaId, id]);
    if (!contenido) throw noEncontrado('Contenido');

    const [automatizaciones, leadsRecientes] = await Promise.all([
      query(`SELECT * FROM automatizaciones WHERE contenido_id = $1 ORDER BY creado_en DESC`, [id]),
      query(
        `SELECT l.id, l.nombre, l.ig_username, l.valor_total, l.primer_contacto_en, l.etiquetas
           FROM leads l WHERE l.cuenta_id = $1 AND l.primer_contenido_id = $2
          ORDER BY l.primer_contacto_en DESC LIMIT 50`,
        [req.sesion.cuentaId, id]),
    ]);

    return { ...contenido, automatizaciones, leads_recientes: leadsRecientes };
  });

  // ---------------- Automatizaciones ----------------

  app.get('/automatizaciones', async (req) =>
    query(
      `SELECT a.*, c.titulo AS contenido_titulo, c.permalink AS contenido_permalink,
              (SELECT COUNT(*) FROM toques t WHERE t.automatizacion_id = a.id)::int AS toques,
              (SELECT COUNT(*) FROM leads l WHERE l.primer_automatizacion_id = a.id)::int AS leads
         FROM automatizaciones a
         LEFT JOIN contenidos c ON c.id = a.contenido_id
        WHERE a.cuenta_id = $1
        ORDER BY leads DESC, a.creado_en DESC`,
      [req.sesion.cuentaId],
    ));

  app.post('/automatizaciones', async (req, reply) => {
    const d = esquemaAutomatizacion.parse(req.body);
    const fila = await queryOne(
      `INSERT INTO automatizaciones (cuenta_id, nombre, palabra_clave, recurso, contenido_id,
                                     manychat_flow_id, tipo_disparo, activo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        req.sesion.cuentaId, d.nombre, d.palabra_clave ?? null, d.recurso ?? null,
        d.contenido_id ?? null, d.manychat_flow_id ?? null, d.tipo_disparo, d.activo ?? true,
      ],
    );
    return reply.code(201).send(fila);
  });

  app.patch('/automatizaciones/:id', async (req) => {
    const { id } = req.params as { id: string };
    const d = esquemaAutomatizacion.partial().parse(req.body);
    const campos = Object.keys(d);
    if (campos.length === 0) throw noEncontrado('Nada que actualizar');

    const params: any[] = [req.sesion.cuentaId, id];
    const sets = campos.map((c) => {
      params.push((d as any)[c]);
      return `${c} = $${params.length}`;
    });

    const fila = await queryOne(
      `UPDATE automatizaciones SET ${sets.join(', ')} WHERE cuenta_id = $1 AND id = $2 RETURNING *`,
      params);
    if (!fila) throw noEncontrado('Automatización');
    return fila;
  });

  // ---------------- Atribución ----------------

  /**
   * Recalcula la atribución de los leads que entraron sin contenido.
   * Se usa justo después de enlazar una automatización a un reel.
   */
  app.post('/atribucion/reatribuir', async (req) => {
    const res = await reatribuir(req.sesion.cuentaId);
    return {
      ...res,
      mensaje: `Se han reatribuido ${res.toques} toques y actualizado ${res.leads} leads.`,
    };
  });

  app.get('/atribucion/calidad', async (req) => calidadAtribucion(req.sesion.cuentaId));

  // ---------------- Instagram ----------------

  app.post('/instagram/sincronizar', async (req) =>
    sincronizarInstagram(req.sesion.cuentaId, { limite: Number((req.query as any)?.limite ?? 50) }));

  app.post('/instagram/probar', async (req) => probarConexion(req.sesion.cuentaId));

  app.put('/instagram/credenciales', async (req) => {
    const d = z.object({
      access_token: z.string().min(10),
      ig_user_id: z.string().min(1),
    }).parse(req.body);
    return guardarCredenciales(req.sesion.cuentaId, d);
  });
}
