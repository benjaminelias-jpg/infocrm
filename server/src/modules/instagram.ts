import { pool, query, queryOne } from '../db/pool.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
const IG_GRAPH = 'https://graph.instagram.com';

interface CredencialesIG {
  access_token?: string;
  user_token?: string;
  page_token?: string;
  ig_user_id?: string;
  tipo_login?: string;
}

/**
 * Resuelve qué base de API y qué token usar según cómo se conectó la cuenta:
 *  - facebook_directo / facebook (página): graph.facebook.com con el token de
 *    usuario o de página.
 *  - instagram (login de Instagram): graph.instagram.com con su access_token.
 */
export function credsUsables(cred: CredencialesIG): { base: string; token?: string; igId?: string } {
  if (cred.tipo_login === 'facebook_directo') {
    return { base: GRAPH, token: cred.user_token, igId: cred.ig_user_id };
  }
  if (cred.tipo_login === 'facebook' || cred.page_token) {
    return { base: GRAPH, token: cred.page_token, igId: cred.ig_user_id };
  }
  return { base: IG_GRAPH, token: cred.access_token, igId: cred.ig_user_id };
}

/** Trae las métricas (insights) de un contenido. Best-effort: si falla, {}. */
async function traerInsights(
  base: string, mediaId: string, token: string, esVideo: boolean,
): Promise<Record<string, number>> {
  const intentos = esVideo
    ? ['reach,saved,shares,total_interactions,plays', 'reach,saved,shares', 'reach,saved']
    : ['reach,saved,shares,total_interactions', 'reach,saved,shares', 'reach,saved'];
  for (const metric of intentos) {
    try {
      const r = await fetch(
        `${base}/${mediaId}/insights?metric=${metric}&access_token=${encodeURIComponent(token)}`,
        { signal: AbortSignal.timeout(12_000) });
      const d: any = await r.json();
      if (d.error) continue;
      const map: Record<string, number> = {};
      for (const it of d.data ?? []) {
        const v = it.values?.[0]?.value ?? it.total_value?.value;
        if (typeof v === 'number') map[it.name] = v;
      }
      return map;
    } catch { /* probar el siguiente set */ }
  }
  return {};
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
  const { base, token, igId } = credsUsables(cred);

  if (!integracion || !token || !igId) {
    return {
      ok: false,
      creados: 0,
      actualizados: 0,
      mensaje:
        'Instagram no está conectado. Conecta tu cuenta en Conexiones. ' +
        'Mientras tanto, los contenidos se siguen creando solos con el ig_media_id que manda ManyChat.',
    };
  }

  const campos = [
    'id', 'caption', 'media_type', 'media_product_type', 'permalink',
    'thumbnail_url', 'media_url', 'timestamp',
    'like_count', 'comments_count',
  ].join(',');

  const url = `${base}/${igId}/media?fields=${campos}&limit=${opts.limite ?? 50}&access_token=${encodeURIComponent(token)}`;

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
    const esVideo = m.media_product_type === 'REELS' || m.media_type === 'VIDEO';
    const tipo = m.media_product_type === 'REELS' ? 'reel'
      : m.media_type === 'CAROUSEL_ALBUM' ? 'carrusel'
      : m.media_type === 'VIDEO' ? 'reel' : 'post';

    const titulo = (m.caption ?? '').split('\n')[0].slice(0, 120) || `Contenido ${m.id}`;

    // Métricas (insights). Si Meta no las da (cuenta sin permiso de insights o
    // contenido muy antiguo), se guardan likes/comentarios igual.
    const ins = await traerInsights(base, m.id, token, esVideo);
    const reproducciones = ins.plays ?? ins.views ?? null;

    const fila = await queryOne(
      `INSERT INTO contenidos (cuenta_id, ig_media_id, tipo, titulo, caption, permalink,
                               thumbnail_url, publicado_en, ig_likes, ig_comentarios,
                               ig_alcance, ig_guardados, ig_compartidos, ig_reproducciones, ig_metricas_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
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
         ig_alcance = COALESCE(EXCLUDED.ig_alcance, contenidos.ig_alcance),
         ig_guardados = COALESCE(EXCLUDED.ig_guardados, contenidos.ig_guardados),
         ig_compartidos = COALESCE(EXCLUDED.ig_compartidos, contenidos.ig_compartidos),
         ig_reproducciones = COALESCE(EXCLUDED.ig_reproducciones, contenidos.ig_reproducciones),
         ig_metricas_en = now(),
         notas = NULL
       RETURNING (xmax = 0) AS insertado`,
      [
        cuentaId, m.id, tipo, titulo, m.caption ?? null, m.permalink ?? null,
        m.thumbnail_url ?? m.media_url ?? null,
        m.timestamp ? new Date(m.timestamp) : null,
        m.like_count ?? null, m.comments_count ?? null,
        ins.reach ?? null, ins.saved ?? null, ins.shares ?? null, reproducciones,
      ],
    );
    if (fila?.insertado) creados++; else actualizados++;
  }

  // Guarda el perfil (seguidores) para mostrarlo en el panel.
  try {
    const rp = await fetch(
      `${base}/${igId}?fields=username,followers_count,media_count&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(12_000) });
    const perfil: any = await rp.json();
    if (!perfil.error) {
      await pool.query(
        `UPDATE integraciones SET config = config || $2::jsonb WHERE id=$1`,
        [integracion.id, JSON.stringify({
          perfil: {
            username: perfil.username, seguidores: perfil.followers_count,
            contenidos: perfil.media_count, actualizado_en: new Date().toISOString(),
          },
        })]);
    }
  } catch { /* opcional */ }

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
  const { base, token, igId } = credsUsables(cred);
  if (!integracion || !token || !igId) {
    return { ok: false, mensaje: 'Instagram no está conectado.' };
  }
  try {
    const res = await fetch(
      `${base}/${igId}?fields=username,followers_count,media_count&access_token=${encodeURIComponent(token)}`,
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
