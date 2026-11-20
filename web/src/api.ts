const CLAVE_TOKEN = 'infocrm_token';
const CLAVE_USUARIO = 'infocrm_usuario';

/** Evento que avisa a la app que la sesión venció (la app navega al login sin recargar). */
export const EVENTO_SESION_VENCIDA = 'infocrm:sesion-vencida';

/** Mientras se redirige al login por sesión vencida, los demás 401 no hacen nada. */
let redirigiendoAlLogin = false;

export function guardarSesion(token: string, usuario: any, cuenta: any) {
  localStorage.setItem(CLAVE_TOKEN, token);
  localStorage.setItem(CLAVE_USUARIO, JSON.stringify({ usuario, cuenta }));
  redirigiendoAlLogin = false;
}

export function leerSesion(): { usuario: any; cuenta: any } | null {
  try {
    const bruto = localStorage.getItem(CLAVE_USUARIO);
    return bruto ? JSON.parse(bruto) : null;
  } catch {
    return null;
  }
}

export function token(): string | null {
  try { return localStorage.getItem(CLAVE_TOKEN); } catch { return null; }
}

function borrarSesion() {
  try {
    localStorage.removeItem(CLAVE_TOKEN);
    localStorage.removeItem(CLAVE_USUARIO);
  } catch { /* sin almacenamiento */ }
}

export function cerrarSesion() {
  borrarSesion();
  location.href = '/login';
}

export class ErrorApi extends Error {
  codigo: string;
  estado: number;
  detalles?: any;
  constructor(estado: number, codigo: string, mensaje: string, detalles?: any) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
    this.detalles = detalles;
  }
}

export const MENSAJE_SIN_CONEXION = 'No hay conexión. Revisá tu internet y probá de nuevo.';
export const MENSAJE_ERROR_SERVIDOR = 'Algo falló de nuestro lado. Probá de nuevo en un rato.';

export async function api<T = any>(
  ruta: string,
  opciones: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...resto } = opciones;
  const cabeceras: Record<string, string> = {
    ...(resto.headers as Record<string, string>),
  };
  const t = token();
  if (t) cabeceras.authorization = `Bearer ${t}`;
  if (json !== undefined) cabeceras['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`/api${ruta}`, {
      ...resto,
      headers: cabeceras,
      body: json !== undefined ? JSON.stringify(json) : resto.body,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    // "Failed to fetch" y similares: sin red o el servidor no responde.
    throw new ErrorApi(0, 'sin_conexion', MENSAJE_SIN_CONEXION);
  }

  // Un 401 en una ruta normal = la sesión venció → al login (sin recargar y
  // volviendo después a donde estaba). Un 401 del propio login son
  // credenciales incorrectas: el mensaje real tiene que llegar al formulario.
  if (res.status === 401 && !ruta.startsWith('/auth/')) {
    borrarSesion();
    // Un solo viaje al login aunque fallen varias llamadas a la vez, y nunca
    // "volver" al propio login.
    if (!redirigiendoAlLogin && !location.pathname.startsWith('/login')) {
      redirigiendoAlLogin = true;
      const volver = `${location.pathname}${location.search}`;
      const atendido = !window.dispatchEvent(new CustomEvent(EVENTO_SESION_VENCIDA, { cancelable: true, detail: { volver } }));
      if (!atendido) location.href = `/login?motivo=sesion&volver=${encodeURIComponent(volver)}`;
    }
    // La pantalla se va al login: esta llamada queda sin respuesta a propósito
    // (sin avisos de error ni "cargando…" a medias en una pantalla que se cierra).
    return new Promise<T>(() => {});
  }
  if (res.status === 204) return undefined as T;

  const cuerpo = await res.json().catch(() => ({}));
  if (!res.ok) {
    const generico = !cuerpo.mensaje || /^Algo ha fallado/i.test(cuerpo.mensaje);
    throw new ErrorApi(
      res.status,
      cuerpo.error ?? 'error',
      res.status >= 500 && generico ? MENSAJE_ERROR_SERVIDOR : (cuerpo.mensaje ?? 'Algo falló. Probá de nuevo.'),
      cuerpo.detalles,
    );
  }
  return cuerpo as T;
}

// --- Formateo -------------------------------------------------------
// Español con separador de miles SIEMPRE (5.988, no 5988) y coma decimal.
// La moneda sale de la cuenta (EUR si no está definida).

const LOCALE = 'es-ES';
const cacheFmt = new Map<string, Intl.NumberFormat>();
function nf(clave: string, opciones: Intl.NumberFormatOptions) {
  let f = cacheFmt.get(clave);
  if (!f) {
    // useGrouping 'always': agrupa también los números de 4 cifras.
    f = new Intl.NumberFormat(LOCALE, { useGrouping: 'always' as any, ...opciones });
    cacheFmt.set(clave, f);
  }
  return f;
}

export function monedaCuenta(): string {
  return leerSesion()?.cuenta?.moneda || 'EUR';
}

export const fmtNum = (n: number | string | null | undefined) =>
  nf('num', { maximumFractionDigits: 0 }).format(Number(n ?? 0));

/** Número con decimales: 8,4 días; 1,25. */
export const fmtDecimal = (n: number | string | null | undefined, decimales = 1) =>
  nf(`dec${decimales}`, { maximumFractionDigits: decimales, minimumFractionDigits: 0 }).format(Number(n ?? 0));

export const fmtDinero = (n: number | string | null | undefined, moneda?: string) => {
  const m = moneda || monedaCuenta();
  return nf(`din-${m}`, { style: 'currency', currency: m, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(Number(n ?? 0));
};

/** Plata con centavos solo cuando los hay: 165,67 € pero 1.497 €. */
export const fmtDineroExacto = (n: number | string | null | undefined, moneda?: string) => {
  const v = Number(n ?? 0);
  if (Math.abs(v - Math.round(v)) < 0.005) return fmtDinero(Math.round(v), moneda);
  const m = moneda || monedaCuenta();
  return nf(`dinx-${m}`, { style: 'currency', currency: m, maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(v);
};

export const fmtPct = (n: number | string | null | undefined) =>
  `${nf('pct', { maximumFractionDigits: 1 }).format(Number(n ?? 0))} %`;

/** "1 lead", "3 leads" (con el número formateado). */
export function plural(n: number | string | null | undefined, singular: string, pluralTexto?: string) {
  const v = Number(n ?? 0);
  return `${fmtNum(v)} ${v === 1 ? singular : (pluralTexto ?? `${singular}s`)}`;
}

/** "18 nov" si es de este año; "18 nov 2025" si no. Con hora: "18 nov, 14:05". */
export function fmtFecha(valor: string | Date | null | undefined, conHora = false) {
  if (!valor) return '—';
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return '—';
  const esteAnio = d.getFullYear() === new Date().getFullYear();
  const fecha = d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', ...(esteAnio ? {} : { year: 'numeric' }) }).replace('.', '');
  if (!conHora) return fecha;
  return `${fecha}, ${d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })}`;
}

export function hace(valor: string | Date | null | undefined) {
  if (!valor) return '—';
  const ms = Date.now() - new Date(valor).getTime();
  if (Number.isNaN(ms)) return '—';
  const min = Math.round(ms / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
  return fmtFecha(valor);
}
