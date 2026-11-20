import { fmtDinero, hace } from '../../../api';

// Textos y reglas compartidas por la configuración del pipeline: qué eventos
// mueven una etapa, qué acciones existen y cómo se dicen en simple.

export interface Etapa {
  id: string; nombre: string; slug: string; color: string; tipo: 'abierta' | 'ganada' | 'perdida';
  orden: number; evento_asociado?: string | null; acciones?: any[]; pipeline_id: string;
}
export interface Pipe { id: string; nombre: string; es_predeterminado?: boolean; etapas: Etapa[] }
export interface Conexion {
  id: string; nombre: string; url: string; eventos?: string[]; activo: boolean;
  total_enviados?: number; total_fallos?: number; ultimo_envio_en?: string | null; ultimo_error?: string | null;
}

/** Lo que hace el lead (para "se mueve sola cuando el lead…" y "cuando el lead…"). */
export const EVENTOS: Array<{ id: string; lead: string; corto: string }> = [
  { id: 'lead_creado', lead: 'entra como lead nuevo', corto: 'entra' },
  { id: 'recurso_entregado', lead: 'recibe el recurso', corto: 'recibe el recurso' },
  { id: 'respondio_dm', lead: 'responde por DM', corto: 'responde' },
  { id: 'reunion_agendada', lead: 'agenda una llamada', corto: 'agenda' },
  { id: 'reunion_realizada', lead: 'hace la llamada', corto: 'hace la llamada' },
  { id: 'reunion_no_asistio', lead: 'no se presenta a la llamada', corto: 'no se presenta' },
  { id: 'reunion_cancelada', lead: 'cancela la llamada', corto: 'cancela' },
  { id: 'venta', lead: 'compra', corto: 'compra' },
  { id: 'reembolso', lead: 'pide la devolución', corto: 'pide la devolución' },
];
export const textoEvento = (id?: string | null) => EVENTOS.find((e) => e.id === id)?.lead ?? id ?? '';

export const PALETA = ['#6366f1', '#0ea5e9', '#8b5cf6', '#f59e0b', '#14b8a6', '#ec4899', '#84cc16', '#f97316', '#64748b', '#22c55e', '#ef4444', '#94a3b8'];

/** Acciones de etapa, agrupadas como en el menú "+ Agregar acción". */
export const GRUPOS_ACCION: Array<{ grupo: string; acciones: Array<{ tipo: string; icono: string; etiqueta: string; ayuda?: string }> }> = [
  {
    grupo: 'Instagram',
    acciones: [
      { tipo: 'dm', icono: '💬', etiqueta: 'Mandarle un DM', ayuda: 'Llega si te escribió en las últimas 24 h' },
      { tipo: 'recurso', icono: '🎙️', etiqueta: 'Mandarle un audio o archivo' },
      { tipo: 'flujo', icono: '⚡', etiqueta: 'Arrancar un automensaje' },
    ],
  },
  {
    grupo: 'Organizar',
    acciones: [
      { tipo: 'etiquetar', icono: '🏷️', etiqueta: 'Ponerle una etiqueta' },
      { tipo: 'quitar_etiqueta', icono: '🏷️', etiqueta: 'Sacarle una etiqueta' },
      { tipo: 'asignar', icono: '👤', etiqueta: 'Asignarlo a alguien del equipo' },
      { tipo: 'nota', icono: '📝', etiqueta: 'Dejar una nota' },
    ],
  },
  {
    grupo: 'Otras apps',
    acciones: [
      { tipo: 'email', icono: '📧', etiqueta: 'Sumarlo a una secuencia de email', ayuda: 'ActiveCampaign, Mailchimp, Brevo… vía Zapier o Make' },
      { tipo: 'webhook', icono: '🔗', etiqueta: 'Avisar a otra app', ayuda: 'Zapier, Make, n8n, Slack…' },
    ],
  },
];
export const metaAccion = (tipo: string) => GRUPOS_ACCION.flatMap((g) => g.acciones).find((a) => a.tipo === tipo);

/** Qué le falta a una acción de etapa para poder guardarse (null = está completa). */
export function faltaEnAccion(a: any): string | null {
  switch (a.tipo) {
    case 'dm': return String(a.texto ?? '').trim() ? null : 'Escribí el mensaje';
    case 'nota': return String(a.texto ?? '').trim() ? null : 'Escribí la nota';
    case 'etiquetar': case 'quitar_etiqueta': return String(a.etiqueta ?? '').trim() ? null : 'Escribí la etiqueta';
    case 'recurso': return a.recurso_id ? null : 'Elegí el audio o archivo';
    case 'flujo': return a.flujo_id ? null : 'Elegí el automensaje';
    case 'email':
      if (!a.suscripcion_id && !urlValida(a.url)) return 'Elegí a qué app avisamos';
      return String(a.secuencia ?? '').trim() ? null : 'Escribí el nombre de la secuencia';
    case 'webhook': return a.suscripcion_id || urlValida(a.url) ? null : 'Elegí a qué app avisamos';
    default: return null;
  }
}

export function urlValida(u?: unknown) {
  try { const x = new URL(String(u ?? '').trim()); return (x.protocol === 'https:' || x.protocol === 'http:') && !!x.hostname; } catch { return false; }
}

export function nombrePorUrl(url: string) {
  if (/zapier\.com/i.test(url)) return 'Zapier';
  if (/make\.com|integromat/i.test(url)) return 'Make';
  if (/n8n/i.test(url)) return 'n8n';
  if (/slack\.com/i.test(url)) return 'Slack';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Mi app'; }
}

/** "funcionando · último aviso hace 2 h" / "falló el último aviso" / "sin avisos todavía". */
export function estadoConexion(c: Conexion): { tono: 'bien' | 'mal' | 'nada' | 'pausa'; texto: string } {
  if (!c.activo) return { tono: 'pausa', texto: 'en pausa' };
  if (c.ultimo_error) return { tono: 'mal', texto: 'falló el último aviso' };
  if (c.ultimo_envio_en) return { tono: 'bien', texto: `funcionando · último aviso ${hace(c.ultimo_envio_en)}` };
  return { tono: 'nada', texto: 'sin avisos todavía' };
}

// ---------------------------------------------------------------------
// Reglas automáticas
// ---------------------------------------------------------------------

export const ACCIONES_REGLA: Array<{ tipo: string; etiqueta: string; campo?: string; ph?: string }> = [
  { tipo: 'etiquetar', etiqueta: 'ponerle una etiqueta', campo: 'etiqueta', ph: 'ej. caliente' },
  { tipo: 'quitar_etiqueta', etiqueta: 'sacarle una etiqueta', campo: 'etiqueta', ph: 'ej. frío' },
  { tipo: 'mover_etapa', etiqueta: 'moverlo a una etapa', campo: 'etapa_slug' },
  { tipo: 'asignar', etiqueta: 'asignarlo al closer con menos leads' },
  { tipo: 'crear_nota', etiqueta: 'dejarle una nota', campo: 'texto', ph: 'ej. Llamarlo hoy' },
  { tipo: 'webhook_saliente', etiqueta: 'avisar a otra app', campo: 'conexion' },
  { tipo: 'marcar_perdido', etiqueta: 'marcarlo como perdido', campo: 'motivo', ph: 'ej. No le interesa' },
];

const CAMPOS: Record<string, string> = {
  'evento.valor': 'la venta', 'lead.etiquetas': 'el lead', 'lead.score': 'el puntaje del lead', 'lead.pais': 'el país del lead',
  'contenido.etapa_embudo': 'el contenido de origen', 'lead.calificacion': 'la calificación del lead',
};

/** "la venta es de más de 1.000 €", "tiene la etiqueta «vip»"… */
export function describirCondicion(c: { campo: string; operador: string; valor?: unknown }) {
  const v = c.valor;
  if (c.campo === 'evento.valor' && c.operador === 'mayor_que') return `la venta es de más de ${fmtDinero(Number(v))}`;
  if (c.campo === 'evento.valor' && c.operador === 'menor_que') return `la venta es de menos de ${fmtDinero(Number(v))}`;
  if (c.campo === 'lead.etiquetas' && c.operador === 'contiene') return `tiene la etiqueta «${v}»`;
  if (c.campo === 'lead.etiquetas' && c.operador === 'no_contiene') return `no tiene la etiqueta «${v}»`;
  const quien = CAMPOS[c.campo] ?? c.campo;
  const op: Record<string, string> = {
    igual: 'es', distinto: 'no es', contiene: 'incluye', no_contiene: 'no incluye', mayor_que: 'es mayor que',
    menor_que: 'es menor que', existe: 'tiene dato', no_existe: 'no tiene dato', empieza_por: 'empieza con',
  };
  return `${quien} ${op[c.operador] ?? c.operador}${v !== undefined && v !== null && v !== '' ? ` «${v}»` : ''}`;
}

export function describirAccionRegla(a: any, ctx: { etapas: Etapa[]; conexiones: Conexion[] }) {
  switch (a.tipo) {
    case 'etiquetar': return a.etiqueta ? `ponerle la etiqueta «${a.etiqueta}»` : 'ponerle una etiqueta';
    case 'quitar_etiqueta': return a.etiqueta ? `sacarle la etiqueta «${a.etiqueta}»` : 'sacarle una etiqueta';
    case 'mover_etapa': {
      const e = ctx.etapas.find((x) => x.slug === a.etapa_slug);
      return e ? `moverlo a «${e.nombre}»` : 'moverlo a una etapa';
    }
    case 'asignar': return 'asignarlo al closer con menos leads';
    case 'crear_nota': return a.texto ? `dejarle la nota «${String(a.texto).slice(0, 40)}»` : 'dejarle una nota';
    case 'webhook_saliente': {
      const c = a.suscripcion_id ? ctx.conexiones.find((x) => x.id === a.suscripcion_id) : null;
      if (c) return `avisar a ${c.nombre}`;
      if (a.url) return `avisar a ${nombrePorUrl(String(a.url))}`;
      return 'avisar a otra app';
    }
    case 'marcar_perdido': return a.motivo ? `marcarlo como perdido («${a.motivo}»)` : 'marcarlo como perdido';
    default: return 'hacer una acción';
  }
}

/** Lo que le falta a una regla para poder activarse (lista vacía = lista para usar). */
export function faltaEnRegla(r: any, ctx: { etapas: Etapa[]; conexiones: Conexion[] }): string[] {
  const f: string[] = [];
  if (!r.disparador?.evento) f.push('cuándo pasa');
  const acciones = Array.isArray(r.acciones) ? r.acciones : [];
  if (!acciones.length) f.push('qué hacer');
  for (const a of acciones) {
    if ((a.tipo === 'etiquetar' || a.tipo === 'quitar_etiqueta') && !String(a.etiqueta ?? '').trim()) f.push('la etiqueta');
    if (a.tipo === 'mover_etapa') {
      if (!a.etapa_slug) f.push('la etapa');
      else if (!ctx.etapas.some((e) => e.slug === a.etapa_slug)) f.push('la etapa (esa ya no existe)');
    }
    if (a.tipo === 'crear_nota' && !String(a.texto ?? '').trim()) f.push('el texto de la nota');
    if (a.tipo === 'webhook_saliente') {
      if (a.suscripcion_id && !ctx.conexiones.some((c) => c.id === a.suscripcion_id)) f.push('la app (esa conexión ya no existe)');
      else if (!a.suscripcion_id && !urlValida(a.url)) f.push('a qué app avisar');
    }
  }
  return f;
}

/** Clave para detectar reglas repetidas (mismo evento, condiciones y acciones). */
export function claveRegla(r: any) {
  const orden = (x: any): any => (Array.isArray(x) ? x.map(orden) : x && typeof x === 'object'
    ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, orden(x[k])])) : x);
  return JSON.stringify(orden([r.disparador?.evento, r.condiciones ?? [], r.acciones ?? []]));
}
