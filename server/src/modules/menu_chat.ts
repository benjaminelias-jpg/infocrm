import { pool } from '../db/pool.js';
import { credsUsables, integracionInstagram } from './instagram.js';

// «Preguntas frecuentes» al abrir el chat (ice breakers) y «menú fijo» del
// chat (persistent menu) de Instagram. Cada botón manda un código (payload)
// que dispara el automensaje «Toca un botón» con esa palabra clave.

export interface Pregunta { pregunta: string; palabra: string }
export interface ItemMenu { titulo: string; palabra?: string; url?: string }
export interface MenuChat { preguntas: Pregunta[]; menu: ItemMenu[] }

async function tokenParaPerfil(cuentaId: string): Promise<{ url: string; token: string } | { error: string }> {
  const integ = await integracionInstagram(cuentaId);
  const cred = integ?.credenciales ?? {};
  const { base, token, igId } = credsUsables(cred);
  if (!integ || !token) return { error: 'Instagram no está conectado.' };
  if (!base.includes('facebook.com')) return { url: `${base}/me/messenger_profile`, token };
  if (cred.page_token) return { url: `${base}/me/messenger_profile`, token: cred.page_token };
  // Conectado con token de usuario de Facebook: hace falta el de la página vinculada.
  const r = await fetch(`${base}/me/accounts?fields=access_token,instagram_business_account&limit=100&access_token=${encodeURIComponent(token)}`,
    { signal: AbortSignal.timeout(10_000) });
  const d: any = await r.json().catch(() => ({}));
  const pagina = (d.data ?? []).find((p: any) => String(p.instagram_business_account?.id ?? '') === String(igId));
  if (!pagina?.access_token) return { error: 'No encontré la página de Facebook vinculada a tu Instagram (hace falta para configurar el chat).' };
  return { url: `${base}/me/messenger_profile`, token: pagina.access_token };
}

export async function leerMenuChat(cuentaId: string): Promise<MenuChat> {
  const integ = await integracionInstagram(cuentaId);
  const m = integ?.config?.menu_chat ?? {};
  return { preguntas: m.preguntas ?? [], menu: m.menu ?? [] };
}

export async function guardarMenuChat(cuentaId: string, datos: MenuChat): Promise<{ ok: boolean; mensaje: string }> {
  const preguntas = datos.preguntas.filter((p) => p.pregunta.trim() && p.palabra.trim()).slice(0, 4);
  const menu = datos.menu.filter((m) => m.titulo.trim() && (m.palabra?.trim() || m.url?.trim())).slice(0, 5);
  await pool.query(
    `UPDATE integraciones SET config = config || jsonb_build_object('menu_chat', $2::jsonb)
      WHERE cuenta_id = $1 AND tipo = 'instagram' AND activo`, [cuentaId, JSON.stringify({ preguntas, menu })]);
  const canal = await tokenParaPerfil(cuentaId);
  if ('error' in canal) return { ok: false, mensaje: `Lo guardé, pero no lo pude subir a Instagram: ${canal.error}` };
  const cuerpo: any = { platform: 'instagram' };
  cuerpo.ice_breakers = preguntas.length
    ? [{ locale: 'default', call_to_actions: preguntas.map((p) => ({ question: p.pregunta.slice(0, 80), payload: p.palabra.trim().toUpperCase() })) }]
    : [];
  cuerpo.persistent_menu = menu.length
    ? [{ locale: 'default', composer_input_disabled: false, call_to_actions: menu.map((m) => (m.url?.trim()
      ? { type: 'web_url', title: m.titulo.slice(0, 30), url: m.url.trim() }
      : { type: 'postback', title: m.titulo.slice(0, 30), payload: String(m.palabra).trim().toUpperCase() })) }]
    : [];
  try {
    // Lo vacío se borra (si no, Instagram mantiene lo anterior).
    const borrar = [...(!preguntas.length ? ['ice_breakers'] : []), ...(!menu.length ? ['persistent_menu'] : [])];
    if (borrar.length) {
      await fetch(`${canal.url}?platform=instagram&access_token=${encodeURIComponent(canal.token)}`, {
        method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: borrar }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);
    }
    const subir = { platform: 'instagram', ...(preguntas.length ? { ice_breakers: cuerpo.ice_breakers } : {}), ...(menu.length ? { persistent_menu: cuerpo.persistent_menu } : {}) };
    if (preguntas.length || menu.length) {
      const r = await fetch(`${canal.url}?access_token=${encodeURIComponent(canal.token)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(subir),
        signal: AbortSignal.timeout(10_000),
      });
      const d: any = await r.json().catch(() => ({}));
      if (!r.ok || d.error) return { ok: false, mensaje: `Lo guardé, pero Instagram no lo aceptó: ${d?.error?.message ?? `HTTP ${r.status}`}` };
    }
    return { ok: true, mensaje: 'Listo: ya aparece en tu chat de Instagram (puede tardar unos minutos).' };
  } catch (e: any) {
    return { ok: false, mensaje: `Lo guardé, pero no pude hablar con Instagram: ${e?.message ?? e}` };
  }
}
