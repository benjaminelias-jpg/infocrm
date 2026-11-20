import { useEffect, useMemo, useReducer } from 'react';
import { api, token } from '../../api';

// Estado de las conexiones para cualquier pantalla (Configuración, y un
// Banner en Panel, Chat, Contenidos o Finanzas). Una sola consulta compartida
// con caché: si varias pantallas lo piden a la vez, se pide una vez.
// Reglas:
//  · Un error de red NUNCA se muestra como "Sin conectar": queda
//    'desconocido' (no pudimos comprobarlo) y se conserva el último estado bueno.
//  · Si vuelve la conexión (evento online), se reintenta solo.

export type ClaveApp = 'instagram' | 'manychat' | 'agenda' | 'pagos' | 'zapier' | 'claude';
export type EstadoConexion = 'conectado' | 'esperando' | 'atencion' | 'desconectado' | 'desconocido';
export type Motivo = 'vence' | 'renovacion' | 'cortado' | 'error' | 'fallos' | 'errores_datos';

export interface EstadoApp {
  estado: EstadoConexion;
  motivo?: Motivo;
  /** Días que faltan para que venza la conexión (Instagram). */
  dias?: number | null;
  /** Cuándo se configuró (para "Lo configuraste el 20 nov"). */
  configuradoEn?: string | null;
  recibidos?: number;
  ultimo?: string | null;
}

export interface Endpoint {
  id: string; nombre: string; slug: string; fuente: string; evento_defecto: string; url: string;
  total_recibidos: number | string; total_errores: number | string; ultimo_evento_en: string | null;
  activo: boolean; configurado_en: string | null; verificada: boolean;
}
export interface Resumen {
  instagram: { dms_7d: number; ultimo_dm_en: string | null } | null;
  endpoints: Endpoint[];
  salientes: { n: number; activos: number; con_fallos: number; fallos: number; ultimo_envio_en: string | null } | null;
  claves: { n: number; ultimo_uso_en: string | null; creado_en: string | null } | null;
  otras_claves: { n: number } | null;
  conexiones: {
    calendly: { conectado: boolean; email: string | null; nombre: string | null; tipos_evento: number | null } | null;
    stripe: { conectado: boolean; modo: 'real' | 'prueba' } | null;
  };
  api_url: string;
}
export interface EstadoIg {
  tiene_app: boolean; app_id: string | null; config_id: string | null; ig_user_id: string | null;
  app_de_plataforma: boolean; puede_conectar: boolean; conectado: boolean; username: string | null;
  token_expira_en: string | null; se_renueva_sola: boolean;
  renovacion: { ok: boolean; en: string | null; error: string | null } | null;
  pasos: { profesional: boolean; permiso_mensajes: boolean };
  avisos_suscritos: boolean; ultimo_aviso_meta_en: string | null; dms_7d: number; ultimo_dm_en: string | null;
  webhook_url: string; webhook_verify_token: string; redirect_uri: string; ultimo_error: string | null;
}

interface Cache {
  resumen: Resumen | null; ig: EstadoIg | null;
  errorResumen: Error | null; errorIg: Error | null;
  en: number; cargando: boolean; sesion: string | null;
}
const VACIO: Cache = { resumen: null, ig: null, errorResumen: null, errorIg: null, en: 0, cargando: false, sesion: null };
let cache: Cache = { ...VACIO };
const oyentes = new Set<() => void>();
let enCurso: Promise<void> | null = null;
const avisar = () => oyentes.forEach((f) => f());

/** Vuelve a pedir el estado (comparte el pedido si ya hay uno en curso). */
export function recargarConexiones(): Promise<void> {
  if (enCurso) return enCurso;
  const sesion = token();
  // Otra sesión (otra cuenta): no mezclar datos.
  if (cache.sesion && cache.sesion !== sesion) cache = { ...VACIO };
  cache = { ...cache, cargando: true, sesion };
  avisar();
  enCurso = (async () => {
    const [r, i] = await Promise.allSettled([
      api<Resumen>('/ux/integraciones/resumen'),
      api<EstadoIg>('/instagram/estado'),
    ]);
    cache = {
      // Se conserva el último estado bueno si este pedido falló.
      resumen: r.status === 'fulfilled' ? r.value : cache.resumen,
      ig: i.status === 'fulfilled' ? i.value : cache.ig,
      errorResumen: r.status === 'rejected' ? (r.reason instanceof Error ? r.reason : new Error(String(r.reason))) : null,
      errorIg: i.status === 'rejected' ? (i.reason instanceof Error ? i.reason : new Error(String(i.reason))) : null,
      en: Date.now(), cargando: false, sesion,
    };
  })().finally(() => { enCurso = null; avisar(); });
  return enCurso;
}

const num = (v: unknown) => Number(v ?? 0) || 0;
export const diasPara = (fecha?: string | null) =>
  fecha ? Math.ceil((new Date(fecha).getTime() - Date.now()) / 86_400_000) : null;

export const esPago = (e: Endpoint) => e.fuente === 'stripe' || e.fuente === 'hotmart' || e.evento_defecto === 'venta';
export const esAgenda = (e: Endpoint) => e.fuente === 'calendly' || e.evento_defecto === 'reunion_agendada';
export const esManychat = (e: Endpoint) => e.fuente === 'manychat';
export const esZapier = (e: Endpoint) => e.slug === 'zapier-leads';

/** Estado de un grupo de direcciones: datos buenos → conectado; solo errores → revisar; configurado → esperando. */
function estadoDeEntradas(eps: Endpoint[], conectadoPorClave = false): EstadoApp {
  const recibidos = eps.reduce((s, e) => s + num(e.total_recibidos), 0);
  const errores = eps.reduce((s, e) => s + num(e.total_errores), 0);
  const fechas = eps.map((e) => e.ultimo_evento_en).filter(Boolean).sort() as string[];
  const configurado = eps.map((e) => e.configurado_en).filter(Boolean).sort()[0] ?? null;
  const ultimo = fechas[fechas.length - 1] ?? null;
  if (recibidos - errores > 0) return { estado: 'conectado', recibidos, ultimo };
  if (errores > 0) return { estado: 'atencion', motivo: 'errores_datos', recibidos, ultimo };
  if (configurado || conectadoPorClave) return { estado: 'esperando', configuradoEn: configurado, recibidos: 0 };
  return { estado: 'desconectado', recibidos: 0 };
}

/** De los datos crudos al estado de cada tarjeta (función pura, también para tests). */
export function estadosDe(resumen: Resumen | null, ig: EstadoIg | null, errorResumen: Error | null, errorIg: Error | null): Record<ClaveApp, EstadoApp> {
  const desconocido: EstadoApp = { estado: 'desconocido' };
  // Instagram
  let instagram: EstadoApp = desconocido;
  if (ig) {
    const dias = diasPara(ig.token_expira_en);
    if (ig.conectado) {
      if (dias !== null && dias < 0) instagram = { estado: 'atencion', motivo: 'cortado', dias };
      else if (ig.renovacion && !ig.renovacion.ok && dias !== null && dias <= 15) instagram = { estado: 'atencion', motivo: 'renovacion', dias };
      else if (!ig.se_renueva_sola && dias !== null && dias <= 10) instagram = { estado: 'atencion', motivo: 'vence', dias };
      else instagram = { estado: 'conectado', dias };
    } else if (ig.ultimo_error) instagram = { estado: 'atencion', motivo: 'error' };
    else instagram = { estado: 'desconectado' };
  } else if (!errorIg) instagram = desconocido;

  if (!resumen) {
    return { instagram, manychat: desconocido, agenda: desconocido, pagos: desconocido, zapier: desconocido, claude: desconocido };
  }
  void errorResumen;
  const eps = resumen.endpoints ?? [];
  const manychat = estadoDeEntradas(eps.filter(esManychat));
  const agenda = estadoDeEntradas(eps.filter(esAgenda), Boolean(resumen.conexiones?.calendly?.conectado));
  const pagos = estadoDeEntradas(eps.filter(esPago), Boolean(resumen.conexiones?.stripe?.conectado));

  const sal = resumen.salientes;
  const entradaZapier = estadoDeEntradas(eps.filter(esZapier));
  let zapier: EstadoApp;
  if (num(sal?.con_fallos) > 0) zapier = { estado: 'atencion', motivo: 'fallos' };
  else if (num(sal?.activos) > 0 || entradaZapier.estado === 'conectado') zapier = { estado: 'conectado', ultimo: sal?.ultimo_envio_en ?? entradaZapier.ultimo };
  else zapier = entradaZapier;

  const cl = resumen.claves;
  const claude: EstadoApp = num(cl?.n) > 0
    ? (cl?.ultimo_uso_en ? { estado: 'conectado', ultimo: cl.ultimo_uso_en } : { estado: 'esperando', configuradoEn: cl?.creado_en ?? null })
    : { estado: 'desconectado' };

  return { instagram, manychat, agenda, pagos, zapier, claude };
}

/**
 * Estado de las conexiones con caché. `maxEdadMs`: si lo que hay en memoria es
 * más viejo, se vuelve a pedir al montar.
 */
export function useConexiones({ maxEdadMs = 60_000 }: { maxEdadMs?: number } = {}) {
  const [vuelta, forzar] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    oyentes.add(forzar);
    if (Date.now() - cache.en > maxEdadMs || (cache.sesion && cache.sesion !== token())) void recargarConexiones();
    const online = () => { void recargarConexiones(); };
    window.addEventListener('online', online);
    return () => { oyentes.delete(forzar); window.removeEventListener('online', online); };
  }, [maxEdadMs]);
  const c = cache;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const estados = useMemo(() => estadosDe(c.resumen, c.ig, c.errorResumen, c.errorIg), [c.resumen, c.ig, c.errorResumen, c.errorIg, vuelta]);
  return {
    resumen: c.resumen, ig: c.ig, errorResumen: c.errorResumen, errorIg: c.errorIg,
    cargando: c.cargando, primeraVez: c.en === 0, estados, recargar: recargarConexiones,
  };
}
