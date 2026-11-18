export function slugify(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'sin-nombre';
}

/** Lee un valor anidado por ruta de puntos: "custom_fields.palabra_clave" */
export function leerRuta(obj: any, ruta: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  return ruta.split('.').reduce<any>((acc, parte) => {
    if (acc === null || acc === undefined) return undefined;
    return acc[parte];
  }, obj);
}

/**
 * Devuelve el primer valor no vacío encontrado entre varias rutas candidatas.
 * Así un mismo endpoint acepta payloads de ManyChat, Make, Zapier o curl
 * sin que el usuario tenga que normalizar nada.
 */
export function primerValor(obj: any, rutas: string[]): string | undefined {
  for (const ruta of rutas) {
    const v = leerRuta(obj, ruta);
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (typeof v === 'object') continue;
    return String(v).trim();
  }
  return undefined;
}

export function aNumero(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

export function aFecha(v: unknown): Date | undefined {
  if (!v) return undefined;
  if (v instanceof Date) return v;
  // Epoch en segundos o milisegundos
  if (typeof v === 'number' || /^\d{10,13}$/.test(String(v))) {
    const n = Number(v);
    const d = new Date(n < 1e12 ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function limpiarUsername(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const limpio = v.trim().replace(/^@+/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/.*$/, '');
  return limpio || undefined;
}

export function sinDuplicados<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/** Divide un rango de fechas en días/semanas para series temporales */
export function truncar(granularidad: 'dia' | 'semana' | 'mes'): string {
  return granularidad === 'mes' ? 'month' : granularidad === 'semana' ? 'week' : 'day';
}
