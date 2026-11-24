import { pool, query, queryOne } from '../db/pool.js';
import { credsUsables, integracionInstagram } from './instagram.js';
import { procesarEventoInstagram } from './instagram_eventos.js';

// Comentarios «a buscar»: si Meta no manda los avisos (webhooks), el CRM mira
// cada vez que corre el reloj los comentarios nuevos de tus últimas
// publicaciones y los procesa igual que si hubiera llegado el aviso
// (lead + automensaje). Procesar dos veces el mismo comentario no hace nada.

const VENTANA_INICIAL_MIN = 15;

export async function revisarComentarios(cuentaId: string, fetcher: typeof fetch = fetch): Promise<{ ok: boolean; nuevos: number; mensaje?: string }> {
  const integ: any = await integracionInstagram(cuentaId);
  const { base, token, igId } = credsUsables(integ?.credenciales ?? {});
  if (!integ || !token || !igId) return { ok: false, nuevos: 0, mensaje: 'Instagram no está conectado.' };

  const desdeGuardado = integ.config?.comentarios_desde ? new Date(integ.config.comentarios_desde).getTime() : NaN;
  // Primera vez: solo los de los últimos minutos (no responder comentarios viejos).
  const desde = Number.isFinite(desdeGuardado) ? desdeGuardado : Date.now() - VENTANA_INICIAL_MIN * 60_000;

  const campos = 'id,timestamp,comments.limit(50){id,text,timestamp,from,username}';
  let datos: any;
  try {
    const r = await fetcher(`${base}/${igId}/media?fields=${encodeURIComponent(campos)}&limit=10&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(20_000) });
    datos = await r.json();
    if (!r.ok || datos?.error) return { ok: false, nuevos: 0, mensaje: datos?.error?.message ?? `HTTP ${r.status}` };
  } catch (e: any) {
    return { ok: false, nuevos: 0, mensaje: String(e?.message ?? e) };
  }

  const nuevos: Array<{ c: any; mediaId: string; t: number }> = [];
  for (const m of datos?.data ?? []) {
    for (const c of m?.comments?.data ?? []) {
      const t = c?.timestamp ? new Date(c.timestamp).getTime() : NaN;
      if (!Number.isFinite(t) || t <= desde) continue;
      const deQuien = c?.from?.id ? String(c.from.id) : '';
      if (deQuien && deQuien === String(igId)) continue; // la propia cuenta respondiendo
      nuevos.push({ c, mediaId: String(m.id), t });
    }
  }
  nuevos.sort((a, b) => a.t - b.t);

  let procesados = 0;
  let hasta = desde;
  for (const { c, mediaId, t } of nuevos) {
    const username = c?.from?.username ?? c?.username;
    // Mismo lead que el de los DMs (Instagram usa otro id para los comentarios): se busca por usuario.
    const existente = username
      ? await queryOne<{ ig_user_id: string | null }>(
        `SELECT ig_user_id FROM leads WHERE cuenta_id = $1 AND lower(ig_username) = lower($2) AND ig_user_id IS NOT NULL LIMIT 1`, [cuentaId, username])
      : null;
    const igUserId = existente?.ig_user_id ?? (c?.from?.id ? String(c.from.id) : undefined);
    if (!igUserId) { hasta = Math.max(hasta, t); continue; }
    const r = await procesarEventoInstagram(cuentaId, {
      tipo: 'comentario', igUserId, username, texto: c?.text ?? '', mediaId, commentId: String(c.id), ocurridoEn: new Date(t),
    }).catch(() => null);
    if (r && !(r as any).duplicado) procesados++;
    hasta = Math.max(hasta, t);
  }
  await pool.query(
    `UPDATE integraciones SET config = config || jsonb_build_object('comentarios_desde', $2::text)
      WHERE id = $1`, [integ.id, new Date(Math.max(hasta, Number.isFinite(desdeGuardado) ? desdeGuardado : desde)).toISOString()]);
  return { ok: true, nuevos: procesados };
}

/** Todas las cuentas con Instagram conectado (para el reloj). */
export async function revisarComentariosDeTodas(): Promise<number> {
  const cuentas = await query<{ cuenta_id: string }>(
    `SELECT DISTINCT cuenta_id FROM integraciones WHERE tipo = 'instagram' AND activo AND estado = 'conectado'`);
  let n = 0;
  for (const { cuenta_id } of cuentas) n += (await revisarComentarios(cuenta_id).catch(() => ({ nuevos: 0 }))).nuevos;
  return n;
}
