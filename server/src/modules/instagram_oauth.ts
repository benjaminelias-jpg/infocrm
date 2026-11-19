import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { pool, queryOne } from '../db/pool.js';
import { integracionInstagram } from './instagram.js';

// =====================================================================
// "Conectar Instagram": login OAuth con la App de Meta de la cuenta.
// =====================================================================
// Usa Instagram API con Instagram Login (no requiere página de Facebook).
// La App ID y el App Secret los pega el usuario una vez (son suyos, de su
// app en developers.facebook.com); se guardan en la integración.

const AUTORIZAR = 'https://www.instagram.com/oauth/authorize';
const TOKEN = 'https://api.instagram.com/oauth/access_token';
const GRAPH = 'https://graph.instagram.com';

// Permisos: lectura básica + (para el ManyChat propio) gestión de mensajes y
// comentarios. Los de mensajería solo funcionan tras la revisión de Meta.
const SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
].join(',');

export function redirectUri(): string {
  // Ruta pública (Meta llama sin sesión). Regístrala igual en la App de Meta.
  return `${config.apiUrl}/instagram/callback`;
}

/** App ID / App Secret de la App de Meta del usuario, guardados en la integración. */
export async function guardarApp(cuentaId: string, appId: string, appSecret: string) {
  const integ = await integracionInstagram(cuentaId);
  const cfg = JSON.stringify({ app_id: appId, app_secret: appSecret });
  if (integ) {
    return queryOne(
      `UPDATE integraciones SET config = config || $2::jsonb WHERE id = $1
       RETURNING id, tipo, estado`, [integ.id, cfg]);
  }
  return queryOne(
    `INSERT INTO integraciones (cuenta_id, tipo, nombre, config)
     VALUES ($1,'instagram','Instagram Business',$2::jsonb)
     RETURNING id, tipo, estado`, [cuentaId, cfg]);
}

async function appDe(cuentaId: string): Promise<{ appId?: string; appSecret?: string }> {
  const integ = await integracionInstagram(cuentaId);
  const cfg = integ?.config ?? {};
  return { appId: cfg.app_id, appSecret: cfg.app_secret };
}

/** URL a la que mandar al usuario para que autorice (la abre el botón). */
export async function urlAutorizacion(cuentaId: string): Promise<{ url: string } | { error: string }> {
  const { appId } = await appDe(cuentaId);
  if (!appId) {
    return { error: 'Falta la App de Meta. Pega tu App ID y App Secret antes de conectar.' };
  }
  // El state firma la cuenta para recuperarla en el callback sin sesión.
  const state = jwt.sign({ cuentaId }, config.jwtSecret, { expiresIn: 600 });
  const url = `${AUTORIZAR}?client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri())}` +
    `&response_type=code&scope=${encodeURIComponent(SCOPES)}&state=${encodeURIComponent(state)}`;
  return { url };
}

export function cuentaDeState(state: string): string | null {
  try {
    const d = jwt.verify(state, config.jwtSecret) as { cuentaId: string };
    return d.cuentaId;
  } catch {
    return null;
  }
}

/** Procesa el callback: intercambia el code por un token largo y guarda todo. */
export async function manejarCallback(cuentaId: string, code: string): Promise<{ ok: boolean; mensaje: string; username?: string }> {
  const { appId, appSecret } = await appDe(cuentaId);
  if (!appId || !appSecret) return { ok: false, mensaje: 'Faltan las credenciales de la App de Meta.' };

  try {
    // 1. code -> token corto + user_id
    const form = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(),
      code,
    });
    const r1 = await fetch(TOKEN, { method: 'POST', body: form, signal: AbortSignal.timeout(15000) });
    const d1: any = await r1.json();
    if (!r1.ok || d1.error_message || !d1.access_token) {
      return { ok: false, mensaje: `Instagram rechazó el código: ${d1.error_message ?? JSON.stringify(d1)}` };
    }
    const tokenCorto = d1.access_token;
    const igUserId = String(d1.user_id ?? d1.user?.id ?? '');

    // 2. token corto -> token largo (60 días)
    const r2 = await fetch(
      `${GRAPH}/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(appSecret)}&access_token=${encodeURIComponent(tokenCorto)}`,
      { signal: AbortSignal.timeout(15000) });
    const d2: any = await r2.json();
    const tokenLargo = d2.access_token ?? tokenCorto;

    // 3. perfil (username)
    const r3 = await fetch(
      `${GRAPH}/me?fields=user_id,username&access_token=${encodeURIComponent(tokenLargo)}`,
      { signal: AbortSignal.timeout(15000) });
    const d3: any = await r3.json();
    const username = d3.username ?? null;
    const userId = String(d3.user_id ?? igUserId);

    // 4. guardar
    const integ = await integracionInstagram(cuentaId);
    const cred = JSON.stringify({ access_token: tokenLargo, ig_user_id: userId, username, tipo_login: 'instagram' });
    if (integ) {
      await pool.query(
        `UPDATE integraciones SET credenciales = credenciales || $2::jsonb,
                estado='conectado', ultimo_error=NULL WHERE id=$1`, [integ.id, cred]);
    } else {
      await pool.query(
        `INSERT INTO integraciones (cuenta_id, tipo, nombre, credenciales, estado)
         VALUES ($1,'instagram','Instagram Business',$2::jsonb,'conectado')`, [cuentaId, cred]);
    }
    if (username) {
      await pool.query(`UPDATE cuentas SET ig_username = COALESCE(ig_username, $2) WHERE id=$1`,
        [cuentaId, username]);
    }
    return { ok: true, mensaje: `Instagram conectado como @${username ?? userId}`, username };
  } catch (err: any) {
    return { ok: false, mensaje: `Error conectando con Instagram: ${err?.message ?? err}` };
  }
}
