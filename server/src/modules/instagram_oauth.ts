import { importarConversaciones } from './instagram_chats.js';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { pool, query, queryOne } from '../db/pool.js';
import { integracionInstagram, sincronizarInstagram } from './instagram.js';

// =====================================================================
// "Conectar Instagram": login OAuth. Soporta DOS flujos de Meta:
//
//  (A) Instagram API con Instagram Login  -> cuando NO hay config_id.
//      client_id = Instagram app ID. Tokens de Instagram (graph.instagram.com).
//
//  (B) Facebook Login for Business (login unificado) -> cuando hay config_id.
//      client_id = App ID general de la app + config_id de la configuración.
//      Devuelve token de usuario de Facebook; de ahí sacamos la Página y su
//      token, y la cuenta de Instagram Business conectada. Los DMs van por la
//      Messenger Platform (graph.facebook.com/{page}/messages).
//
// App de PLATAFORMA: si la cuenta no cargó una app propia, se usa la app de
// Meta del dueño del CRM (META_APP_ID / META_APP_SECRET y, si existe,
// META_CONFIG_ID del entorno). Así el infoproductor solo toca "Conectar con
// Instagram". La app propia queda como opción avanzada (integraciones.config).
// =====================================================================

const V = 'v21.0';

/** Cliente HTTP inyectable (en los tests se reemplaza por uno falso). */
export type ClienteHttp = (url: string, init?: RequestInit) => Promise<Response>;
let http: ClienteHttp = (url, init) => fetch(url, init);
export function usarClienteHttpInstagram(c?: ClienteHttp) { http = c ?? ((url, init) => fetch(url, init)); }

/** La app de Meta del CRM (para todas las cuentas), si está configurada. */
export function appPlataforma(): { appId: string; appSecret: string; configId?: string } | null {
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  return { appId, appSecret, configId: process.env.META_CONFIG_ID?.trim() || undefined };
}

// Flujo A (Instagram Login)
const IG_AUTORIZAR = 'https://www.instagram.com/oauth/authorize';
const IG_TOKEN = 'https://api.instagram.com/oauth/access_token';
const IG_GRAPH = 'https://graph.instagram.com';
const IG_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
].join(',');

// Flujo B (Facebook Login for Business)
const FB_DIALOG = 'https://www.facebook.com/dialog/oauth';
const FB_GRAPH = `https://graph.facebook.com/${V}`;

export function redirectUri(): string {
  // Ruta pública (Meta llama sin sesión). Regístrala igual en la App de Meta.
  return `${config.apiUrl}/instagram/callback`;
}

interface AppMeta { appId?: string; appSecret?: string; configId?: string; igUserId?: string; plataforma?: boolean }

/** Guarda App ID / App Secret (+ config_id e ig_user_id opcionales) de la app de Meta. */
export async function guardarApp(
  cuentaId: string, appId: string, appSecret: string, configId?: string, igUserId?: string,
) {
  const integ = await integracionInstagram(cuentaId);
  const cfg = JSON.stringify({
    app_id: appId, app_secret: appSecret, config_id: configId || null, ig_user_id: igUserId || null,
  });
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

/** Deja de usar la app propia: vuelve a la app de la plataforma. */
export async function olvidarAppPropia(cuentaId: string) {
  const integ = await integracionInstagram(cuentaId);
  if (!integ) return null;
  return queryOne(
    `UPDATE integraciones SET config = config - 'app_id' - 'app_secret' - 'config_id' WHERE id = $1
     RETURNING id`, [integ.id]);
}

/**
 * Confirmaciones de la guía ("Ya es profesional", "Ya activé el permiso")
 * guardadas en la cuenta, no en el navegador: valen en cualquier celular,
 * compu o para cualquier persona del equipo.
 */
export async function guardarPasosInstagram(cuentaId: string, pasos: { profesional?: boolean; permiso_mensajes?: boolean }) {
  const limpio = Object.fromEntries(Object.entries(pasos).filter(([, v]) => typeof v === 'boolean'));
  const integ = await integracionInstagram(cuentaId);
  if (integ) {
    await pool.query(
      `UPDATE integraciones SET config = jsonb_set(config, '{pasos}', COALESCE(config->'pasos', '{}'::jsonb) || $2::jsonb)
        WHERE id = $1`, [integ.id, JSON.stringify(limpio)]);
  } else {
    await pool.query(
      `INSERT INTO integraciones (cuenta_id, tipo, nombre, config)
       VALUES ($1,'instagram','Instagram Business', jsonb_build_object('pasos', $2::jsonb))`,
      [cuentaId, JSON.stringify(limpio)]);
  }
  const fila = await integracionInstagram(cuentaId);
  return fila?.config?.pasos ?? {};
}

async function appDe(cuentaId: string): Promise<AppMeta> {
  const integ = await integracionInstagram(cuentaId);
  const cfg = integ?.config ?? {};
  // La app propia manda (si tiene identificador y clave); si no, la del CRM.
  if (cfg.app_id && cfg.app_secret) {
    return {
      appId: cfg.app_id, appSecret: cfg.app_secret,
      configId: cfg.config_id || undefined, igUserId: cfg.ig_user_id || undefined, plataforma: false,
    };
  }
  const p = appPlataforma();
  if (p) return { ...p, igUserId: cfg.ig_user_id || undefined, plataforma: true };
  return {
    appId: cfg.app_id, appSecret: cfg.app_secret,
    configId: cfg.config_id || undefined, igUserId: cfg.ig_user_id || undefined, plataforma: false,
  };
}

/** URL a la que mandar al usuario para que autorice (la abre el botón). */
export async function urlAutorizacion(cuentaId: string): Promise<{ url: string } | { error: string }> {
  const { appId, configId } = await appDe(cuentaId);
  if (!appId) {
    return { error: 'Faltan los datos de tu app de Meta: completalos antes de conectar.' };
  }
  // El state firma la cuenta para recuperarla en el callback sin sesión.
  // 30 min: el flujo de Meta (crear portfolio, añadir IG, permisos) es largo.
  const state = jwt.sign({ cuentaId }, config.jwtSecret, { expiresIn: 1800 });

  if (configId) {
    // Flujo B: Facebook Login for Business con configuración.
    const url = `${FB_DIALOG}?client_id=${encodeURIComponent(appId)}` +
      `&config_id=${encodeURIComponent(configId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri())}` +
      `&response_type=code&override_default_response_type=true&state=${encodeURIComponent(state)}`;
    return { url };
  }
  // Flujo A: Instagram Login.
  const url = `${IG_AUTORIZAR}?client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri())}` +
    `&response_type=code&scope=${encodeURIComponent(IG_SCOPES)}&state=${encodeURIComponent(state)}`;
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

type Resultado = { ok: boolean; mensaje: string; username?: string };

/** Procesa el callback según el flujo configurado. */
export async function manejarCallback(cuentaId: string, code: string): Promise<Resultado> {
  const { appId, appSecret, configId } = await appDe(cuentaId);
  if (!appId || !appSecret) return { ok: false, mensaje: 'Faltan las credenciales de la App de Meta.' };
  try {
    const r = configId
      ? await callbackFacebook(cuentaId, code, appId, appSecret)
      : await callbackInstagram(cuentaId, code, appId, appSecret);
    if (!r.ok) await marcarError(cuentaId, r.mensaje);
    return r;
  } catch (err: any) {
    await marcarError(cuentaId, String(err?.message ?? err));
    return { ok: false, mensaje: `Error conectando con Instagram: ${err?.message ?? err}` };
  }
}

// ---------------- Flujo B: Facebook Login for Business ----------------

async function callbackFacebook(cuentaId: string, code: string, appId: string, appSecret: string): Promise<Resultado> {
  // 1. code -> token de usuario (corto)
  const r1 = await http(
    `${FB_GRAPH}/oauth/access_token?client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(appSecret)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri())}&code=${encodeURIComponent(code)}`,
    { signal: AbortSignal.timeout(15000) });
  const d1: any = await r1.json();
  if (!r1.ok || d1.error || !d1.access_token) {
    return err(`Facebook rechazó el código: ${d1?.error?.message ?? JSON.stringify(d1)}`);
  }

  // 2. token corto -> token de usuario largo (60 días)
  const r2 = await http(
    `${FB_GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(appSecret)}&fb_exchange_token=${encodeURIComponent(d1.access_token)}`,
    { signal: AbortSignal.timeout(15000) });
  const d2: any = await r2.json();
  const userToken = d2.access_token ?? d1.access_token;

  const diag: Record<string, any> = {};

  // 3a. Vía Página (lo ideal: da token de Página y permite DMs).
  const r3 = await http(
    `${FB_GRAPH}/me/accounts?limit=100&fields=name,access_token,` +
    `instagram_business_account{id,username},connected_instagram_account{id,username}` +
    `&access_token=${encodeURIComponent(userToken)}`,
    { signal: AbortSignal.timeout(15000) });
  const d3: any = await r3.json();
  diag.paginas = (d3.data ?? []).length;
  if (d3.error) diag.paginasError = d3.error.message;
  const pagina = (d3.data ?? []).find(
    (p: any) => p.instagram_business_account || p.connected_instagram_account);
  if (pagina) {
    const ig = pagina.instagram_business_account ?? pagina.connected_instagram_account;
    // El token de Página que sale de un token de usuario largo no vence.
    await guardarConexion(cuentaId, {
      tipo_login: 'facebook', user_token: userToken,
      page_id: pagina.id, page_token: pagina.access_token,
      ig_user_id: String(ig.id), username: ig.username ?? null,
      token_expira_en: null,
    });
    return { ok: true, mensaje: `Instagram conectado como @${ig.username ?? ig.id}`, username: ig.username };
  }

  // 3b. Flujo "Instagram API con Facebook login" sin página: la cuenta de
  //     Instagram se comparte directa y el token lleva instagram_manage_messages.
  //     Se descubre el IG id desde el propio token con debug_token (granular_scopes),
  //     sin necesitar permisos de página ni de negocio.
  let igId: string | undefined, igName: string | undefined;
  let expiraEn: string | null = null;
  try {
    const appToken = `${appId}|${appSecret}`;
    const rd = await http(
      `${FB_GRAPH}/debug_token?input_token=${encodeURIComponent(userToken)}&access_token=${encodeURIComponent(appToken)}`,
      { signal: AbortSignal.timeout(15000) });
    const dd: any = await rd.json();
    const exp = dd?.data?.expires_at;
    if (typeof exp === 'number' && exp > 0) expiraEn = new Date(exp * 1000).toISOString();
    const scopes: any[] = dd?.data?.granular_scopes ?? [];
    diag.scopes = scopes.length;
    for (const s of scopes) {
      if (String(s.scope).startsWith('instagram') && Array.isArray(s.target_ids) && s.target_ids.length) {
        igId = String(s.target_ids[0]);
        break;
      }
    }
    if (dd?.data?.error) diag.debugError = dd.data.error.message;
  } catch (e: any) { diag.debugExcepcion = String(e?.message ?? e); }

  // Si Meta no devuelve el IG id en el token, usamos el que el usuario pegó a mano.
  if (!igId) {
    const { igUserId } = await appDe(cuentaId);
    if (igUserId) { igId = igUserId; diag.igManual = true; }
  }

  if (igId) {
    // Nombre de usuario (best-effort)
    try {
      const ru = await http(
        `${FB_GRAPH}/${igId}?fields=username&access_token=${encodeURIComponent(userToken)}`,
        { signal: AbortSignal.timeout(12000) });
      const du: any = await ru.json();
      igName = du?.username;
    } catch { /* opcional */ }

    await guardarConexion(cuentaId, {
      tipo_login: 'facebook_directo', user_token: userToken,
      ig_user_id: igId, username: igName ?? null,
      token_expira_en: expiraEn,
    });
    return {
      ok: true, username: igName,
      mensaje: `Instagram conectado como @${igName ?? igId}.`,
    };
  }

  return err(
    'Autoricé tu cuenta pero no pude identificar tu Instagram desde el token. ' +
    `Diagnóstico Meta: ${JSON.stringify(diag)}`);
}

// ---------------- Flujo A: Instagram Login ----------------

async function callbackInstagram(cuentaId: string, code: string, appId: string, appSecret: string): Promise<Resultado> {
  const form = new URLSearchParams({
    client_id: appId, client_secret: appSecret, grant_type: 'authorization_code',
    redirect_uri: redirectUri(), code,
  });
  const r1 = await http(IG_TOKEN, { method: 'POST', body: form, signal: AbortSignal.timeout(15000) });
  const d1: any = await r1.json();
  const corto = d1.access_token ?? d1.data?.[0]?.access_token;
  const uid = d1.user_id ?? d1.data?.[0]?.user_id;
  if (!r1.ok || d1.error_message || !corto) {
    return err(`Instagram rechazó el código: ${d1.error_message ?? JSON.stringify(d1)}`);
  }

  const r2 = await http(
    `${IG_GRAPH}/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(appSecret)}&access_token=${encodeURIComponent(corto)}`,
    { signal: AbortSignal.timeout(15000) });
  const d2: any = await r2.json();
  const largo = d2.access_token ?? corto;
  // El token largo de Instagram dura ~60 días: guardamos cuándo vence para
  // renovarlo solo antes de que corte (renovarTokensPorVencer).
  const vence = d2.access_token && Number(d2.expires_in) > 0
    ? new Date(Date.now() + Number(d2.expires_in) * 1000).toISOString() : null;

  const r3 = await http(
    `${IG_GRAPH}/me?fields=user_id,username&access_token=${encodeURIComponent(largo)}`,
    { signal: AbortSignal.timeout(15000) });
  const d3: any = await r3.json();
  const username = d3.username ?? null;
  const igId = String(d3.user_id ?? uid ?? '');

  await guardarConexion(cuentaId, {
    tipo_login: 'instagram',
    access_token: largo,
    ig_user_id: igId,
    username,
    token_expira_en: vence,
  });
  // Que Meta mande los DMs y comentarios de ESTA cuenta (con la app de la
  // plataforma, los avisos se configuran una vez para todas las cuentas,
  // pero cada cuenta se suscribe). Best-effort: no frena la conexión.
  await suscribirAvisos(cuentaId, igId, largo).catch(() => null);
  return { ok: true, mensaje: `Instagram conectado como @${username ?? uid}`, username };
}

const CAMPOS_AVISOS = ['comments,live_comments,messages,messaging_postbacks,message_reactions,messaging_referral', 'comments,messages,messaging_postbacks,messaging_referral', 'comments,messages'];

/** Suscribe la cuenta de Instagram a los avisos de la app (DMs y comentarios al instante). */
async function suscribirAvisos(cuentaId: string, igId: string, token: string) {
  if (!igId) return false;
  // Token de Instagram (graph.instagram.com) o de Facebook (graph.facebook.com): se prueban los dos.
  for (const base of [IG_GRAPH, 'https://graph.facebook.com']) for (const campos of CAMPOS_AVISOS) {
    const r = await http(
      `${base}/${V}/${encodeURIComponent(igId)}/subscribed_apps?subscribed_fields=${encodeURIComponent(campos)}` +
      `&access_token=${encodeURIComponent(token)}`,
      { method: 'POST', signal: AbortSignal.timeout(15000) });
    const d: any = await r.json().catch(() => ({}));
    if (r.ok && (d.success === true || d.success === undefined) && !d.error) {
      await pool.query(
        `UPDATE integraciones SET config = config || jsonb_build_object('avisos_suscritos', true)
          WHERE cuenta_id = $1 AND tipo = 'instagram' AND activo`, [cuentaId]);
      return true;
    }
  }
  return false;
}

// ---------------- Helpers ----------------

async function guardarConexion(cuentaId: string, cred: Record<string, any>) {
  const integ = await integracionInstagram(cuentaId);
  const json = JSON.stringify(cred);
  if (integ) {
    // Conectar de nuevo limpia cualquier error anterior (también el de renovación).
    await pool.query(
      `UPDATE integraciones SET credenciales = credenciales || $2::jsonb,
              config = config - 'renovacion',
              estado='conectado', ultimo_error=NULL WHERE id=$1`, [integ.id, json]);
  } else {
    await pool.query(
      `INSERT INTO integraciones (cuenta_id, tipo, nombre, credenciales, estado)
       VALUES ($1,'instagram','Instagram Business',$2::jsonb,'conectado')`, [cuentaId, json]);
  }
  if (cred.username) {
    await pool.query(`UPDATE cuentas SET ig_username = COALESCE(ig_username, $2) WHERE id=$1`,
      [cuentaId, cred.username]);
  }
}

async function marcarError(cuentaId: string, mensaje: string) {
  const integ = await integracionInstagram(cuentaId);
  if (integ) {
    await pool.query(`UPDATE integraciones SET estado='error', ultimo_error=$2 WHERE id=$1`,
      [integ.id, mensaje.slice(0, 500)]);
  }
}

function err(mensaje: string): Resultado { return { ok: false, mensaje }; }

/**
 * Canjea un token de usuario de Facebook por uno de larga duración y
 * averigua cuándo vence (null = no vence, p. ej. usuario del sistema).
 * Best-effort: si algo falla, se queda el token original.
 */
async function tokenLargo(cuentaId: string, token: string): Promise<{ token: string; expiraEn: string | null }> {
  const { appId, appSecret } = await appDe(cuentaId);
  if (!appId || !appSecret) return { token, expiraEn: null };
  let final = token;
  try {
    const r = await http(
      `${FB_GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(appId)}` +
      `&client_secret=${encodeURIComponent(appSecret)}&fb_exchange_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(15_000) });
    const d: any = await r.json().catch(() => ({}));
    if (r.ok && d.access_token) final = d.access_token;
  } catch { /* nos quedamos con el original */ }
  let expiraEn: string | null = null;
  try {
    const r = await http(
      `${FB_GRAPH}/debug_token?input_token=${encodeURIComponent(final)}` +
      `&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`,
      { signal: AbortSignal.timeout(15_000) });
    const d: any = await r.json().catch(() => ({}));
    const exp = d?.data?.expires_at;
    if (typeof exp === 'number' && exp > 0) expiraEn = new Date(exp * 1000).toISOString();
  } catch { /* sin fecha */ }
  return { token: final, expiraEn };
}

/**
 * Conexión directa con un token puesto a mano (p. ej. un token de usuario del
 * sistema / SUAT generado en el dashboard) + el IG user id. Valida que el token
 * puede leer la cuenta de Instagram y la guarda como facebook_directo (DMs por
 * graph.facebook.com/{ig}/messages). Es el método fiable para apps de login
 * unificado con SUAT.
 */
export async function conectarConToken(cuentaId: string, token: string, igId: string): Promise<Resultado> {
  try {
    const r = await http(
      `${FB_GRAPH}/${encodeURIComponent(igId)}?fields=username,name&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(15000) });
    const d: any = await r.json();
    if (!r.ok || d.error) {
      return { ok: false, mensaje: `Meta rechazó el token o el ID: ${d?.error?.message ?? `HTTP ${r.status}`}` };
    }
    // Un token del Explorador dura ~1 hora: si tenemos la App, lo canjeamos
    // por uno de larga duración (~60 días) para que no haya que reconectar.
    const largo = await tokenLargo(cuentaId, token);
    await guardarConexion(cuentaId, {
      tipo_login: 'facebook_directo', user_token: largo.token,
      ig_user_id: String(igId), username: d.username ?? null,
      token_expira_en: largo.expiraEn,
    });
    // Sincroniza el contenido con sus métricas nada más conectar.
    const sync = await sincronizarInstagram(cuentaId, { limite: 15 }).catch(() => null);
    const chats = await importarConversaciones(cuentaId, { limite: 100 }).catch(() => null);
    // Avisos de Meta al instante (DMs nuevos y comentarios). Best-effort.
    await suscribirAvisos(cuentaId, String(igId), largo.token).catch(() => null);
    const extra = (sync?.ok ? ` · ${sync.creados + sync.actualizados} contenidos sincronizados` : '')
      + (chats?.ok && chats.conversaciones ? ` · ${chats.conversaciones} chats traídos` : '');
    return { ok: true, mensaje: `Instagram conectado como @${d.username ?? igId}${extra}`, username: d.username };
  } catch (e: any) {
    return { ok: false, mensaje: `Error validando el token: ${e?.message ?? e}` };
  }
}

// =====================================================================
// Renovación automática de la conexión
// =====================================================================
// El token largo de Instagram dura ~60 días. Antes de que venza (faltan
// menos de 15 días) el proceso periódico del servidor lo renueva solo y
// guarda el nuevo vencimiento. Solo si la renovación FALLA queda marcado
// (config.renovacion.ok = false) para avisar al usuario con un Banner.
// =====================================================================

export const DIAS_PARA_RENOVAR = 15;
/** Entre dos intentos fallidos se espera un rato (no martillar a Meta). */
const HORAS_ENTRE_INTENTOS = 6;

export type ResultadoRenovacion = { ok: boolean; renovado: boolean; mensaje: string; expiraEn?: string | null };

async function anotarRenovacion(integId: string, r: { ok: boolean; error?: string }) {
  await pool.query(
    `UPDATE integraciones SET config = config || jsonb_build_object('renovacion', $2::jsonb) WHERE id = $1`,
    [integId, JSON.stringify({ ok: r.ok, en: new Date().toISOString(), ...(r.error ? { error: r.error.slice(0, 300) } : {}) })]);
}

/**
 * Renueva el token de UNA cuenta. Login de Instagram: refresh_access_token.
 * Token de usuario de Facebook (conectado con token): se vuelve a canjear y
 * solo cuenta como renovado si Meta da un vencimiento más lejano.
 */
export async function renovarTokenInstagram(cuentaId: string): Promise<ResultadoRenovacion> {
  const integ = await integracionInstagram(cuentaId);
  const cred = integ?.credenciales ?? {};
  if (!integ || integ.estado !== 'conectado') return { ok: false, renovado: false, mensaje: 'Instagram no está conectado.' };
  const antes = cred.token_expira_en ? new Date(cred.token_expira_en).getTime() : null;
  try {
    if (cred.tipo_login === 'instagram' && cred.access_token) {
      const r = await http(
        `${IG_GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(cred.access_token)}`,
        { signal: AbortSignal.timeout(15000) });
      const d: any = await r.json().catch(() => ({}));
      if (!r.ok || d.error || !d.access_token) {
        throw new Error(d?.error?.message ?? d?.error_message ?? `Meta respondió ${r.status}`);
      }
      const expiraEn = Number(d.expires_in) > 0 ? new Date(Date.now() + Number(d.expires_in) * 1000).toISOString() : null;
      await pool.query(
        `UPDATE integraciones SET credenciales = credenciales || $2::jsonb WHERE id = $1`,
        [integ.id, JSON.stringify({ access_token: d.access_token, token_expira_en: expiraEn, renovado_en: new Date().toISOString() })]);
      await anotarRenovacion(integ.id, { ok: true });
      return { ok: true, renovado: true, mensaje: 'Conexión renovada.', expiraEn };
    }
    if (cred.tipo_login === 'facebook_directo' && cred.user_token) {
      const largo = await tokenLargo(cuentaId, cred.user_token);
      const despues = largo.expiraEn ? new Date(largo.expiraEn).getTime() : null;
      if (despues === null && antes !== null) {
        // Meta no informa vencimiento: lo damos por renovado solo si el token cambió.
        if (largo.token === cred.user_token) throw new Error('Meta no deja renovar este tipo de conexión sola.');
      } else if (antes !== null && despues !== null && despues <= antes + 86_400_000) {
        throw new Error('Meta no deja renovar este tipo de conexión sola.');
      }
      await pool.query(
        `UPDATE integraciones SET credenciales = credenciales || $2::jsonb WHERE id = $1`,
        [integ.id, JSON.stringify({ user_token: largo.token, token_expira_en: largo.expiraEn, renovado_en: new Date().toISOString() })]);
      await anotarRenovacion(integ.id, { ok: true });
      return { ok: true, renovado: true, mensaje: 'Conexión renovada.', expiraEn: largo.expiraEn };
    }
    return { ok: true, renovado: false, mensaje: 'Esta conexión no vence.' };
  } catch (e: any) {
    const mensaje = String(e?.message ?? e);
    await anotarRenovacion(integ.id, { ok: false, error: mensaje });
    return { ok: false, renovado: false, mensaje };
  }
}

/** ¿Toca intentar renovar? (vence en menos de 15 días y no se intentó hace poco) */
export function tocaRenovar(integ: any, ahora = Date.now()): boolean {
  const cred = integ?.credenciales ?? {};
  if (!integ || integ.estado !== 'conectado' || !cred.token_expira_en) return false;
  if (!['instagram', 'facebook_directo'].includes(cred.tipo_login)) return false;
  const vence = new Date(cred.token_expira_en).getTime();
  if (!(vence - ahora < DIAS_PARA_RENOVAR * 86_400_000)) return false;
  const ultimo = integ.config?.renovacion?.en ? new Date(integ.config.renovacion.en).getTime() : 0;
  return ahora - ultimo > HORAS_ENTRE_INTENTOS * 3_600_000;
}

/**
 * Proceso periódico (lo llama el cron del servidor): renueva todas las
 * conexiones de Instagram que vencen en menos de 15 días.
 */
export async function renovarTokensPorVencer(limite = 50) {
  const filas = await query<any>(
    `SELECT * FROM integraciones
      WHERE tipo = 'instagram' AND activo AND estado = 'conectado'
        AND credenciales ? 'token_expira_en' AND credenciales->>'token_expira_en' IS NOT NULL
        AND (credenciales->>'token_expira_en')::timestamptz < now() + make_interval(days => $1)
      ORDER BY (credenciales->>'token_expira_en')::timestamptz ASC
      LIMIT $2`, [DIAS_PARA_RENOVAR, limite]);
  let renovadas = 0; let fallidas = 0;
  for (const integ of filas) {
    if (!tocaRenovar(integ)) continue;
    const r = await renovarTokenInstagram(integ.cuenta_id);
    if (r.renovado) renovadas++; else if (!r.ok) fallidas++;
  }
  return { revisadas: filas.length, renovadas, fallidas };
}
