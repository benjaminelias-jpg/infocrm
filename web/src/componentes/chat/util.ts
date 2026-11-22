import { fmtFecha } from '../../api';
import { nombreVisible } from '../../ui';
import { textoDe } from '../../textos';

// Ayudas del Chat: textos de fecha y hora como los de WhatsApp, la ventana de
// 24 h de Instagram, borradores por conversación y preferencias chicas.

export const MAX_TEXTO = 1000; // límite de Instagram por mensaje
export const AVISAR_DESDE = 800; // el contador aparece cerca del límite

/** {{nombre}} y {{usuario}} en las respuestas rápidas. */
export function rellenar(texto: string, lead: any) {
  const nombre = (lead?.nombre ? String(lead.nombre).trim().split(/\s+/)[0] : '') || lead?.ig_username || '';
  return texto.replace(/\{\{\s*nombre\s*\}\}/gi, nombre)
    .replace(/\{\{\s*usuario\s*\}\}/gi, lead?.ig_username ? `@${lead.ig_username}` : '');
}

export const nombreDe = (l: { nombre?: string | null; ig_username?: string | null } | null | undefined) =>
  nombreVisible(l?.nombre, l?.ig_username);

export const primerNombre = (l: { nombre?: string | null; ig_username?: string | null } | null | undefined) =>
  (l?.nombre ?? '').trim().split(/\s+/)[0] || (l?.ig_username ? `@${l.ig_username}` : 'el lead');

const LOCALE = 'es-AR';
const inicioDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const DIA = 86_400_000;

/** "14:05" */
export function horaCorta(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "Hoy" · "Ayer" · "lun 16 nov" · "16 nov 2025" (separadores del hilo). */
export function etiquetaDia(iso: string) {
  const d = new Date(iso);
  const dias = Math.round((inicioDia(new Date()) - inicioDia(d)) / DIA);
  if (dias === 0) return 'Hoy';
  if (dias === 1) return 'Ayer';
  if (d.getFullYear() !== new Date().getFullYear()) return fmtFecha(d);
  const dia = d.toLocaleDateString(LOCALE, { weekday: 'short' }).replace('.', '');
  return `${dia} ${fmtFecha(d)}`;
}

/** Para las filas de la lista: "14:05" · "ayer" · "lun" · "18 nov". */
export function cuandoCorto(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dias = Math.round((inicioDia(new Date()) - inicioDia(d)) / DIA);
  if (dias <= 0) return horaCorta(iso);
  if (dias === 1) return 'ayer';
  if (dias < 7) return d.toLocaleDateString(LOCALE, { weekday: 'short' }).replace('.', '');
  return fmtFecha(d);
}

export const mismoDia = (a: string, b: string) => inicioDia(new Date(a)) === inicioDia(new Date(b));

/** Fecha y hora completas (para el title de una burbuja). */
export const fechaCompleta = (iso: string) => fmtFecha(iso, true);

/** Lo que queda de la ventana de 24 h: "22 h" / "35 min", con su urgencia. */
export function ventanaRestante(cierraEn: string | null | undefined, ahora = Date.now()) {
  if (!cierraEn) return null;
  const ms = new Date(cierraEn).getTime() - ahora;
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.max(1, Math.floor((ms % 3_600_000) / 60_000));
  return {
    ms,
    corto: h >= 1 ? `${h} h` : `${m} min`,
    largo: h >= 1 ? `${h} h ${m} min` : `${m} min`,
    tono: (ms < 3_600_000 ? 'rojo' : ms < 6 * 3_600_000 ? 'amarillo' : 'verde') as 'rojo' | 'amarillo' | 'verde',
  };
}

/** Divide un texto largo en partes de hasta `max` caracteres, cortando en un espacio o salto de línea. */
export function dividirTexto(texto: string, max = MAX_TEXTO): string[] {
  const partes: string[] = [];
  let resto = texto.trim();
  while (resto.length > max) {
    let corte = Math.max(resto.lastIndexOf('\n', max), resto.lastIndexOf('. ', max) + 1, resto.lastIndexOf(' ', max));
    if (corte < max * 0.5) corte = max;
    partes.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }
  if (resto) partes.push(resto);
  return partes;
}

/** ¿Pantalla táctil? (en el celular Enter baja de línea y se manda con el botón). */
export const esTactil = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

// ---------------------------------------------------------------------
// Borradores por conversación (lo que quedó escrito en cada chat)
// ---------------------------------------------------------------------

const PREFIJO_BORRADOR = 'infocrm_borrador_';
const oyentes = new Set<() => void>();
const memoria = new Map<string, string>();

export function leerBorrador(leadId: string): string {
  if (memoria.has(leadId)) return memoria.get(leadId)!;
  let v = '';
  try { v = localStorage.getItem(PREFIJO_BORRADOR + leadId) ?? ''; } catch { /* sin almacenamiento */ }
  memoria.set(leadId, v);
  return v;
}

export function guardarBorrador(leadId: string, texto: string) {
  const v = texto.trim() ? texto : '';
  if ((memoria.get(leadId) ?? '') === v) return;
  memoria.set(leadId, v);
  try {
    if (v) localStorage.setItem(PREFIJO_BORRADOR + leadId, v);
    else localStorage.removeItem(PREFIJO_BORRADOR + leadId);
  } catch { /* sin almacenamiento: queda en memoria */ }
  oyentes.forEach((f) => f());
}

export function suscribirBorradores(f: () => void) {
  oyentes.add(f);
  return () => { oyentes.delete(f); };
}

// ---------------------------------------------------------------------
// Preferencias chicas (atajos plegados, banner cerrado…)
// ---------------------------------------------------------------------

export function leerPreferencia(clave: string, porDefecto: string, sesion = false): string {
  try { return (sesion ? sessionStorage : localStorage).getItem(`infocrm_chat_${clave}`) ?? porDefecto; } catch { return porDefecto; }
}
export function guardarPreferencia(clave: string, valor: string, sesion = false) {
  try { (sesion ? sessionStorage : localStorage).setItem(`infocrm_chat_${clave}`, valor); } catch { /* nada */ }
}

/** Copiar al portapapeles (true si se pudo). */
export async function copiar(texto: string) {
  try { await navigator.clipboard.writeText(texto); return true; } catch { return false; }
}

// ---------------------------------------------------------------------
// Textos de la lista y del hilo
// ---------------------------------------------------------------------

/** Estados de un mensaje propio que NO llegó al lead. */
export const NO_SALIO = new Set(['no_enviado', 'pendiente', 'error']);

const ICONO_TIPO: Record<string, string> = {
  audio: '🎙️ Audio', imagen: '🖼️ Imagen', video: '🎬 Video', pdf: '📄 PDF', link: '🔗 Enlace',
};

/** Segunda línea de una fila: "Vos: te paso el link…", "🤖 ¿Qué te gustaría…", "hola, quiero info". */
export function vistaPrevia(c: {
  ultimo_texto: string | null; ultimo_dir: string | null; ultimo_autor: string | null;
  ultimo_autor_nombre: string | null; ultimo_recurso_tipo: string | null; ultimo_estado?: string | null;
}): { prefijo: string; texto: string; fallo: boolean } {
  if (!c.ultimo_dir) return { prefijo: '', texto: 'Todavía no hay mensajes', fallo: false };
  const cuerpo = (c.ultimo_recurso_tipo && ICONO_TIPO[c.ultimo_recurso_tipo]) || (c.ultimo_texto ?? '').replace(/\s+/g, ' ').trim() || 'Mensaje';
  const fallo = c.ultimo_dir === 'saliente' && NO_SALIO.has(c.ultimo_estado ?? '');
  if (c.ultimo_dir === 'entrante') return { prefijo: '', texto: cuerpo, fallo };
  if (c.ultimo_autor === 'yo') return { prefijo: 'Vos:', texto: cuerpo, fallo };
  if (c.ultimo_autor === 'equipo') return { prefijo: `${(c.ultimo_autor_nombre ?? 'Equipo').split(' ')[0]}:`, texto: cuerpo, fallo };
  return { prefijo: '🤖', texto: cuerpo, fallo };
}

const ICONO_EVENTO: Record<string, string> = {
  lead_creado: '✨', comentario: '💬', recurso_entregado: '📩', respondio_dm: '↩️', reunion_agendada: '📅',
  reunion_realizada: '✅', reunion_no_asistio: '🚫', reunion_cancelada: '🚫', venta: '💰', reembolso: '↩️', nota: '📝',
};
const FUENTE: Record<string, string> = {
  manychat: 'por ManyChat', instagram: 'por Instagram', calendly: 'por Calendly', stripe: 'por Stripe', hotmart: 'por Hotmart',
};

export function iconoEvento(tipo: string) { return ICONO_EVENTO[tipo] ?? '•'; }
export function fuenteEvento(fuente: string | null | undefined) { return (fuente && FUENTE[fuente]) || ''; }

/** "hace instantes" → para la píldora "te escribió hace 5 min". */
export function haceCorto(iso: string | null | undefined) {
  if (!iso) return '';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return cuandoCorto(iso);
}

/** "Comentó en «Reel viral…»", "Recibió «Guía 30 días»", "Lead nuevo". */
export function fmtEvento(e: { tipo: string; titulo: string | null; contenido: string | null }) {
  const sobre = e.contenido || e.titulo;
  if (e.tipo === 'comentario' && sobre) return `Comentó en «${sobre}»`;
  if (e.tipo === 'lead_creado' && e.contenido) return `Entró por «${e.contenido}»`;
  if (e.tipo === 'recurso_entregado' && sobre) return `Recibió «${sobre}»`;
  if (e.tipo === 'respondio_dm') return 'Respondió por DM';
  return textoDe('evento', e.tipo);
}
