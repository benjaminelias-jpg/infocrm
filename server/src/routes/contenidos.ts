import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db/pool.js';
import { conflicto, noEncontrado } from '../lib/errores.js';
import {
  listarContenidos, sincronizarInstagram, completarPublicaciones, probarConexion, guardarCredenciales, integracionInstagram, credsUsables,
} from '../modules/instagram.js';
import { reatribuir } from '../modules/atribucion.js';
import { calidadAtribucion, rendimientoPorContenido } from '../modules/analitica.js';
import { etapaEmbudoDe, ANGULOS, clasificarRoles } from '../modules/infoproduccion.js';

/** Una fecha que se pueda leer, o null (nada de mandarle basura a la base). */
function fechaValida(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  return Number.isNaN(Date.parse(v)) ? null : v;
}

/** Los roles se juzgan con los últimos 90 días (con 7 días un reel que vende puede parecer que "no rinde"). */
const DIAS_ROL = 90;

/**
 * ¿Está Instagram conectado de verdad? (con lo necesario para traer los
 * reels). Para que la pantalla no ofrezca "Sincronizar" si no se puede.
 */
async function estadoInstagram(cuentaId: string) {
  const integ = await integracionInstagram(cuentaId);
  const cred = integ?.credenciales ?? {};
  const { token, igId } = credsUsables(cred);
  return {
    conectado: Boolean(integ && token && igId),
    usuario: cred.username ?? integ?.config?.perfil?.username ?? null,
    ultimo_sync_en: integ?.ultimo_sync_en ?? null,
    con_error: integ?.estado === 'error',
  };
}

const esquemaContenido = z.object({
  titulo: z.string().min(1),
  tipo: z.enum(['reel', 'post', 'carrusel', 'historia', 'live', 'anuncio', 'otro']).default('reel'),
  ig_media_id: z.string().optional(),
  permalink: z.string().optional(),
  caption: z.string().optional(),
  thumbnail_url: z.string().optional(),
  publicado_en: z.string().optional(),
  etiquetas: z.array(z.string()).optional(),
  angulo: z.enum(ANGULOS).nullable().optional(),
  gancho: z.string().nullable().optional(),
  rol_manual: z.enum(['prospector', 'closer', 'caballo', 'calificador', 'abridor', 'lastre', 'explorador'])
    .nullable().optional(),
  objetivo: z.enum(['venta', 'audiencia', 'alcance']).nullable().optional(),
  estado_validacion: z.enum(['probando', 'posible', 'comprobado']).optional(),
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

  /**
   * Pantalla Contenidos: lo de /analitica/contenidos (cohorte del período)
   * más lo que faltaba para que los números no confundan:
   *  - rol juzgado con los últimos 90 días (no cambia por mirar 7 días),
   *    con los leads de esos 90 días para decidir si mostrarlo;
   *  - leads_dudosos: leads DISTINTOS del período cuyo origen es dudoso
   *    (no la suma de toques de toda la historia);
   *  - me gusta, guardados y compartidos de Instagram;
   *  - si Instagram está conectado (para ofrecer sincronizar o conectar).
   */
  app.get('/contenidos/rendimiento', async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const cuentaId = req.sesion.cuentaId;
    const modelo = q.modelo === 'ultimo_toque' ? 'ultimo_toque' : 'primer_toque';
    const col = modelo === 'ultimo_toque' ? 'ultimo_contenido_id' : 'primer_contenido_id';
    const desde = fechaValida(q.desde);
    const hasta = fechaValida(q.hasta);
    const desdeRol = new Date(Date.now() - DIAS_ROL * 86_400_000).toISOString();

    const [filas, filasRol, metricas, dudosos, instagram] = await Promise.all([
      rendimientoPorContenido(cuentaId, { modelo, desde, hasta }),
      rendimientoPorContenido(cuentaId, { modelo, desde: desdeRol, hasta: null }),
      query(
        `SELECT id, ig_likes, ig_guardados, ig_compartidos, ig_metricas_en
           FROM contenidos WHERE cuenta_id = $1`, [cuentaId]),
      query(
        `SELECT t.contenido_id, COUNT(DISTINCT t.lead_id)::int AS n
           FROM toques t
           JOIN leads l ON l.id = t.lead_id AND l.${col} = t.contenido_id
          WHERE t.cuenta_id = $1 AND t.confianza = 'baja'
            AND ($2::timestamptz IS NULL OR l.primer_contacto_en >= $2::timestamptz)
            AND ($3::timestamptz IS NULL OR l.primer_contacto_en <  $3::timestamptz)
          GROUP BY t.contenido_id`,
        [cuentaId, desde, hasta]),
      estadoInstagram(cuentaId),
    ]);

    const roles = new Map(
      clasificarRoles(filasRol as any).filter((c: any) => c.id).map((c: any) => [c.id, c]),
    );
    const extra = new Map(metricas.map((m: any) => [m.id, m]));
    const dudas = new Map(dudosos.map((d: any) => [d.contenido_id, Number(d.n)]));

    return {
      filas: (filas as any[]).map((f) => {
        const r: any = f.id ? roles.get(f.id) : null;
        const m: any = f.id ? extra.get(f.id) : null;
        return {
          ...f,
          ig_likes: m?.ig_likes ?? null,
          ig_guardados: m?.ig_guardados ?? null,
          ig_compartidos: m?.ig_compartidos ?? null,
          ig_metricas_en: m?.ig_metricas_en ?? null,
          rol: f.id ? (r?.rol ?? (f.rol_manual || 'explorador')) : 'sin_atribuir',
          rol_leads: f.id ? Number(r?.leads ?? 0) : 0,
          leads_dudosos: f.id ? (dudas.get(f.id) ?? 0) : 0,
        };
      }),
      instagram,
      dias_rol: DIAS_ROL,
    };
  });

  app.post('/contenidos', async (req, reply) => {
    const d = esquemaContenido.parse(req.body);
    // Cargar un reel a mano dos veces (o uno que ya trajo Instagram) lo partiría en dos filas.
    const link = d.permalink?.trim().split(/[?#]/)[0].replace(/\/+$/, '');
    if (link) {
      const ya = await queryOne(
        `SELECT id, titulo FROM contenidos
          WHERE cuenta_id = $1 AND activo AND rtrim(split_part(permalink, '?', 1), '/') = $2 LIMIT 1`,
        [req.sesion.cuentaId, link]);
      if (ya) throw conflicto(`Ese contenido ya está en tu lista: «${ya.titulo}».`);
      d.permalink = link;
    }
    const fila = await queryOne(
      `INSERT INTO contenidos (cuenta_id, titulo, tipo, ig_media_id, permalink, caption,
                               thumbnail_url, publicado_en, etiquetas, angulo, etapa_embudo, gancho, rol_manual)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        req.sesion.cuentaId, d.titulo, d.tipo, d.ig_media_id ?? null, d.permalink ?? null,
        d.caption ?? null, d.thumbnail_url ?? null,
        d.publicado_en ? new Date(d.publicado_en) : null, d.etiquetas ?? [],
        d.angulo ?? null, etapaEmbudoDe(d.angulo), d.gancho ?? null, d.rol_manual ?? null,
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
    // Si cambia el ángulo, la etapa del embudo se recalcula sola.
    if ('angulo' in d) {
      params.push(etapaEmbudoDe(d.angulo));
      sets.push(`etapa_embudo = $${params.length}`);
    }

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
      mensaje: `Listo: se actualizaron ${res.leads} leads (${res.toques} toques revisados).`,
    };
  });

  app.get('/atribucion/calidad', async (req) => calidadAtribucion(req.sesion.cuentaId));

  // ---------------- Instagram ----------------

  /**
   * Traer los reels de Instagram. Los mensajes se dicen en simple (voseo y
   * sin jerga): `motivo` le dice a la pantalla qué ofrecer (conectar o
   * revisar la conexión) y `detalle` guarda lo técnico por si hace falta.
   */
  // Miniatura + texto de las publicaciones (para elegirlas viéndolas en la pizarra).
  app.post('/contenidos/completar', async (req) => completarPublicaciones(req.sesion.cuentaId));

  app.post('/instagram/sincronizar', async (req) => {
    const limite = Math.min(Math.max(Number((req.query as any)?.limite ?? 50) || 50, 1), 100);
    const r = await sincronizarInstagram(req.sesion.cuentaId, { limite });
    if (r.ok) {
      const total = r.creados + r.actualizados;
      return {
        ...r,
        mensaje: total === 0
          ? 'Listo: no encontramos publicaciones nuevas en tu Instagram.'
          : `Listo: ${r.creados} ${r.creados === 1 ? 'publicación nueva' : 'publicaciones nuevas'} y ${r.actualizados} ${r.actualizados === 1 ? 'actualizada' : 'actualizadas'}.`,
      };
    }
    const { conectado } = await estadoInstagram(req.sesion.cuentaId);
    return {
      ...r,
      motivo: conectado ? 'error_instagram' : 'sin_conexion',
      detalle: r.mensaje,
      mensaje: conectado
        ? 'Instagram no respondió bien. Probá de nuevo en un rato o revisá la conexión en Configuración.'
        : 'Instagram no está conectado. Conectalo en Configuración para traer tus reels con sus números.',
    };
  });

  app.post('/instagram/probar', async (req) => probarConexion(req.sesion.cuentaId));

  app.put('/instagram/credenciales', async (req) => {
    const d = z.object({
      access_token: z.string().min(10),
      ig_user_id: z.string().min(1),
    }).parse(req.body);
    return guardarCredenciales(req.sesion.cuentaId, d);
  });
}
