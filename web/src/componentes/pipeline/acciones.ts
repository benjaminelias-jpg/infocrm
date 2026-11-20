// Qué hace una etapa cuando entra un lead, dicho en simple:
// "le manda el DM «Hola Sofía 👋»", "le pone la etiqueta «vip»".

export interface AccionEtapa { tipo: string; texto?: string; etiqueta?: string; activo?: boolean; [k: string]: unknown }

/** Acciones que salen afuera (le llega algo al lead u otra app): se avisa antes y se puede deshacer. */
const EXTERNAS = new Set(['dm', 'recurso', 'flujo', 'email', 'webhook']);

export function accionesDe(etapa: { acciones?: unknown }): AccionEtapa[] {
  const a = Array.isArray(etapa?.acciones) ? (etapa.acciones as AccionEtapa[]) : [];
  return a.filter((x) => x && typeof x === 'object' && x.activo !== false);
}

export function tieneExternas(etapa: { acciones?: unknown }) {
  return accionesDe(etapa).some((a) => EXTERNAS.has(a.tipo));
}

function corto(s: string, n = 40) {
  const t = s.replace(/\{\{\s*nombre\s*\}\}/gi, '[nombre]').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function resumirAccion(a: AccionEtapa): string {
  switch (a.tipo) {
    case 'dm': return a.texto ? `le manda el DM «${corto(String(a.texto))}»` : 'le manda un DM';
    case 'recurso': return 'le manda un recurso (audio o archivo)';
    case 'flujo': return 'arranca un automensaje';
    case 'etiquetar': return a.etiqueta ? `le pone la etiqueta «${a.etiqueta}»` : 'le pone una etiqueta';
    case 'quitar_etiqueta': return a.etiqueta ? `le saca la etiqueta «${a.etiqueta}»` : 'le saca una etiqueta';
    case 'email': return 'lo suma a una secuencia de email';
    case 'asignar': return 'lo asigna a alguien del equipo';
    case 'nota': return 'deja una nota';
    case 'webhook': return 'avisa a otra app';
    default: return 'hace una acción automática';
  }
}

/** "le manda el DM «Hola…» y le pone la etiqueta «vip»" */
export function resumirAcciones(etapa: { acciones?: unknown }): string {
  const t = accionesDe(etapa).map(resumirAccion);
  if (t.length <= 1) return t[0] ?? '';
  return `${t.slice(0, -1).join(', ')} y ${t[t.length - 1]}`;
}
