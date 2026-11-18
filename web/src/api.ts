const CLAVE_TOKEN = 'infocrm_token';
const CLAVE_USUARIO = 'infocrm_usuario';

export function guardarSesion(token: string, usuario: any, cuenta: any) {
  localStorage.setItem(CLAVE_TOKEN, token);
  localStorage.setItem(CLAVE_USUARIO, JSON.stringify({ usuario, cuenta }));
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
  return localStorage.getItem(CLAVE_TOKEN);
}

export function cerrarSesion() {
  localStorage.removeItem(CLAVE_TOKEN);
  localStorage.removeItem(CLAVE_USUARIO);
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

  const res = await fetch(`/api${ruta}`, {
    ...resto,
    headers: cabeceras,
    body: json !== undefined ? JSON.stringify(json) : resto.body,
  });

  if (res.status === 401) {
    cerrarSesion();
    throw new ErrorApi(401, 'no_autorizado', 'Sesión caducada');
  }
  if (res.status === 204) return undefined as T;

  const cuerpo = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ErrorApi(
      res.status,
      cuerpo.error ?? 'error',
      cuerpo.mensaje ?? 'Algo ha fallado',
      cuerpo.detalles,
    );
  }
  return cuerpo as T;
}

// --- Formateo -------------------------------------------------------

export const fmtNum = (n: number | null | undefined) =>
  (Number(n ?? 0)).toLocaleString('es-ES');

export const fmtDinero = (n: number | null | undefined, moneda = 'EUR') =>
  (Number(n ?? 0)).toLocaleString('es-ES', {
    style: 'currency',
    currency: moneda,
    maximumFractionDigits: 0,
  });

export const fmtPct = (n: number | null | undefined) =>
  `${(Number(n ?? 0)).toLocaleString('es-ES', { maximumFractionDigits: 1 })}%`;

export function fmtFecha(valor: string | null | undefined, conHora = false) {
  if (!valor) return '—';
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    ...(conHora ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function hace(valor: string | null | undefined) {
  if (!valor) return '—';
  const ms = Date.now() - new Date(valor).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `hace ${d} d`;
  return fmtFecha(valor);
}
