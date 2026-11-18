import { pool, query, queryOne } from '../db/pool.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

interface CredencialesIG {
  access_token?: string;
  ig_user_id?: string;
}

export async function integracionInstagram(cuentaId: string) {
  return queryOne(
    `SELECT * FROM integraciones WHERE cuenta_id = $1 AND tipo = 'instagram' AND activo
     ORDER BY creado_en ASC LIMIT 1`,
    [cuentaId],
  );
}

export async function guardarCredenciales(
  cuentaId: string,
  credenciales: CredencialesIG,
) {
  const existente = await integracionInstagram(cuentaId);
  if (existente) {
    return queryOne(
      `UPDATE integraciones
          SET credenciales = credenciales || $2::jsonb,
              estado = CASE WHEN $3 THEN 'conectado' ELSE 'sin_configurar' END,
              ultimo_error = NULL
        WHERE id = $1 RETURNING id, tipo, nombre, estado, ultimo_sync_en`,
      [existente.id, JSON.stringify(credenciales), Boolean(credenciales.access_token)],
    );
  }
  return queryOne(
    `INSERT INTO integraciones (cuenta_id, tipo, nombre, credenciales, estado)
     VALUES ($1,'instagram','Instagram Business',$2::jsonb,$3)
     RETURNING id, tipo, nombre, estado, ultimo_sync_en`,
    [cuentaId, JSON.stringify(credenciales), credenciales.access_token ? 'conectado' : 'sin_configurar'],
  );
}

export interface ResultadoSync {
  ok: boolean;
  mensaje: string;
  creados: number;
  actualizados: number;
}

/**
 * Trae los reels y posts de la cuenta de Instagram Business y los guarda
 * en `contenidos`. Si un contenido ya existía (porque lo creó un webhook
 * con su ig_media_id), lo enriquece sin perder la atribución acumulada.
 *
 * Requiere una cuenta de Instagram Business vinculada a una página de
 * Facebook y un token con permisos instagram_basic + instagram_manage_insights.
 */
export async function sincronizarInstagram(
  cuentaId: string,
  opts: { limite?: number } = {},
): Promise<ResultadoSync> {
  const integracion = await integracionInstagram(cuentaId);
  const cred: CredencialesIG = integracion?.credenciales ?? {};

  if (!integracion || !cred.access_token || !cred.ig_user_id) {
    return {
      ok: false,
      creados: 0,
      actualizados: 0,
      mensaje:
        'Instagram no está conectado. Guarda un access_token y el ig_user_id de tu cuenta Business en Integraciones. ' +
        'Mientras tanto, los contenidos se siguen creando solos con el ig_media_id que manda ManyChat.',
    };
  }

  const campos = [
    'id', 'caption', 'media_type', 'media_product_type', 'permalink',
    'thumbnail_url', 'media_url', 'timestamp',
    'like_count', 'comments_count',
  ].join(',');

  const url = `${GRAPH}/${cred.ig_user_id}/media?fields=${campos}&limit=${opts.limite ?? 50}&access_token=${encodeURIComponent(cred.access_token)}`;

  let datos: any;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    datos = await res.json();
    if (!res.ok || datos.error) {
      const msg = datos?.error?.message ?? `HTTP ${res.status}`;
      await pool.query(
        `UPDATE integraciones SET estado='error', ultimo_error=$2 WHERE id=$1`,
        [integracion.id, msg],
      );
      return { ok: false, creados: 0, actualizados: 0, mensaje: `Instagram devolvió un error: ${msg}` };
    }
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    await pool.query(`UPDATE integraciones SET estado='error', ultimo_error=$2 WHERE id=$1`,
      [integracion.id, msg]);
    return { ok: false, creados: 0, actualizados: 0, mensaje: `No se pudo contactar con Instagram: ${msg}` };
  }

  let creados = 0;
  let actualizados = 0;

  for (const m of datos.data ?? []) {
    const tipo = m.media_product_type === 'REELS' ? 'reel'
      : m.media_type === 'CAROUSEL_ALBUM' ? 'carrusel'
      : m.media_type === 'VIDEO' ? 'reel' : 'post';

    const titulo = (m.caption ?? '').split('\n')[0].slice(0, 120) || `Contenido ${m.id}`;

    const fila = await queryOne(
      `INSERT INTO contenidos (cuenta_id, ig_media_id, tipo, titulo, caption, permalink,
                               thumbnail_url, publicado_en, ig_likes, ig_comentarios, ig_metricas_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       ON CONFLICT (cuenta_id, ig_media_id) WHERE ig_media_id IS NOT NULL
       DO UPDATE SET
         tipo = EXCLUDED.tipo,
         titulo = CASE WHEN contenidos.titulo LIKE 'Contenido %' THEN EXCLUDED.titulo ELSE contenidos.titulo END,
         caption = COALESCE(EXCLUDED.caption, contenidos.caption),
         permalink = COALESCE(EXCLUDED.permalink, contenidos.permalink),
         thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, contenidos.thumbnail_url),
         publicado_en = COALESCE(EXCLUDED.publicado_en, contenidos.publicado_en),
         ig_likes = EXCLUDED.ig_likes,
         ig_comentarios = EXCLUDED.ig_comentarios,
         ig_metricas_en = now(),
         notas = NULL
       RETURNING (xmax = 0) AS insertado`,
      [
        cuentaId, m.id, tipo, titulo, m.caption ?? null, m.permalink ?? null,
        m.thumbnail_url ?? m.media_url ?? null,
        m.timestamp ? new Date(m.timestamp) : null,
        m.like_count ?? null, m.comments_count ?? null,
      ],
    );
    if (fila?.insertado) creados++; else actualizados++;
  }

  await pool.query(
    `UPDATE integraciones SET estado='conectado', ultimo_sync_en=now(), ultimo_error=NULL WHERE id=$1`,
    [integracion.id],
  );

  return {
    ok: true, creados, actualizados,
    mensaje: `Sincronizados ${creados + actualizados} contenidos de Instagram (${creados} nuevos).`,
  };
}

/** Comprueba el token sin importar nada. */
export async function probarConexion(cuentaId: string) {
  const integracion = await integracionInstagram(cuentaId);
  const cred: CredencialesIG = integracion?.credenciales ?? {};
  if (!integracion || !cred.access_token || !cred.ig_user_id) {
    return { ok: false, mensaje: 'Faltan access_token o ig_user_id.' };
  }
  try {
    const res = await fetch(
      `${GRAPH}/${cred.ig_user_id}?fields=username,followers_count,media_count&access_token=${encodeURIComponent(cred.access_token)}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    const datos: any = await res.json();
    if (datos.error) return { ok: false, mensaje: datos.error.message };
    await pool.query(`UPDATE integraciones SET estado='conectado', ultimo_error=NULL WHERE id=$1`,
      [integracion.id]);
    return { ok: true, cuenta: datos };
  } catch (err: any) {
    return { ok: false, mensaje: String(err?.message ?? err) };
  }
}

export async function listarContenidos(cuentaId: string, filtros: { q?: string; tipo?: string } = {}) {
  return query(
    `SELECT c.*,
            (SELECT COUNT(*) FROM leads l WHERE l.primer_contenido_id = c.id) AS leads,
            (SELECT COUNT(*) FROM automatizaciones a WHERE a.contenido_id = c.id) AS automatizaciones
       FROM contenidos c
      WHERE c.cuenta_id = $1 AND c.activo
        AND ($2::text IS NULL OR c.titulo ILIKE '%'||$2||'%' OR c.caption ILIKE '%'||$2||'%')
        AND ($3::text IS NULL OR c.tipo = $3)
      ORDER BY c.publicado_en DESC NULLS LAST, c.creado_en DESC`,
    [cuentaId, filtros.q ?? null, filtros.tipo ?? null],
  );
}
