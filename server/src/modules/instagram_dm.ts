import { pool, query, queryOne } from '../db/pool.js';
import { config } from '../config.js';
import { integracionInstagram, credsUsables } from './instagram.js';
import { moverEtapa, oportunidadAbierta } from './pipeline.js';

// =====================================================================
// "ManyChat propio": envío de mensajes por Instagram + motor de flujos.
//
// Un flujo es un ÁRBOL de pasos:
//   - pasos de acción (mandar mensaje, mandar audio/recurso, etiquetar…)
//   - "pregunta": manda un mensaje con botones (hasta 13) y cada botón
//     abre su propia rama. El flujo se PAUSA hasta que el lead toca uno.
//   - "condicion": rama Sí / rama No según el lead (etiqueta, etapa…).
//   - "esperar_respuesta": pausa hasta que el lead escribe (y guarda lo
//     que dice: email, teléfono…).
//   - "esperar": pausa un tiempo y sigue sola.
// Cada nodo lleva un id estable; una ejecución en pausa guarda el id del
// nodo donde quedó y se reanuda exactamente ahí, aunque pasen horas.
// =====================================================================

const IG_GRAPH = 'https://graph.instagram.com';
const FB_GRAPH = 'https://graph.facebook.com/v21.0';

export const MAX_BOTONES = 13;          // límite de Meta para respuestas rápidas
export const MAX_TITULO_BOTON = 20;     // límite de Meta para el texto del botón
export const MAX_TEXTO_DM = 1000;       // límite de Meta para un mensaje de texto
const MAX_PASOS_POR_CORRIDA = 200;      // corta bucles por seguridad

// ---------------------------------------------------------------------
// Envío
// ---------------------------------------------------------------------

export interface Destino {
  igId?: string;        // IGSID del lead (conversación abierta)
  commentId?: string;   // respuesta privada a un comentario (1er mensaje)
}
export interface ResultadoEnvio { ok: boolean; error?: string; mid?: string; simulado?: boolean }

/** Endpoint de mensajes y token según cómo se conectó la cuenta. */
async function canalMensajes(cuentaId: string): Promise<{ url: string; token: string } | { error: string }> {
  const integ = await integracionInstagram(cuentaId);
  const cred = integ?.credenciales ?? {};
  if (cred.tipo_login === 'facebook_lectura') {
    return { error: 'Conexión solo-lectura: para mandar DMs hace falta la aprobación de Meta.' };
  }
  if (cred.tipo_login === 'facebook' || cred.page_token) {
    if (!cred.page_token || !cred.page_id) return { error: 'Instagram no está conectado' };
    return { url: `${FB_GRAPH}/${cred.page_id}/messages`, token: cred.page_token };
  }
  if (cred.tipo_login === 'facebook_directo') {
    if (!cred.user_token || !cred.ig_user_id) return { error: 'Instagram no está conectado' };
    return { url: `${FB_GRAPH}/${cred.ig_user_id}/messages`, token: cred.user_token };
  }
  if (!cred.access_token || !cred.ig_user_id) return { error: 'Instagram no está conectado' };
  return { url: `${IG_GRAPH}/${cred.ig_user_id}/messages`, token: cred.access_token };
}

/**
 * Manda un mensaje por Instagram (texto, adjunto o texto con botones).
 * Nunca lanza: si Meta lo rechaza devuelve ok:false con el motivo, para
 * que la pantalla pueda decir la verdad ("no salió a Instagram").
 */
export async function enviarMensajeIG(
  cuentaId: string, destino: Destino, mensaje: Record<string, unknown>,
): Promise<ResultadoEnvio> {
  const recipient = destino.commentId ? { comment_id: destino.commentId }
    : destino.igId ? { id: destino.igId } : null;
  if (!recipient) return { ok: false, error: 'El lead no tiene usuario de Instagram vinculado' };
  const canal = await canalMensajes(cuentaId);
  if ('error' in canal) return { ok: false, error: canal.error };
  try {
    const res = await fetch(canal.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recipient, message: mensaje, access_token: canal.token }),
      signal: AbortSignal.timeout(12_000),
    });
    const d: any = await res.json().catch(() => ({}));
    if (!res.ok || d.error) return { ok: false, error: d?.error?.message ?? `HTTP ${res.status}` };
    return { ok: true, mid: d.message_id };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/** Compatibilidad: manda un texto a un IGSID. */
export async function enviarDM(cuentaId: string, destinatarioIgId: string, texto: string) {
  return enviarMensajeIG(cuentaId, { igId: destinatarioIgId }, { text: texto });
}

/** Responde un comentario EN PÚBLICO (debajo del reel). */
export async function responderComentario(
  cuentaId: string, commentId: string, texto: string,
): Promise<ResultadoEnvio> {
  const integ = await integracionInstagram(cuentaId);
  const { base, token } = credsUsables(integ?.credenciales ?? {});
  if (!token) return { ok: false, error: 'Instagram no está conectado' };
  try {
    const res = await fetch(`${base}/${encodeURIComponent(commentId)}/replies`, {
      method: 'POST',
      body: new URLSearchParams({ message: texto, access_token: token }),
      signal: AbortSignal.timeout(12_000),
    });
    const d: any = await res.json().catch(() => ({}));
    if (!res.ok || d.error) return { ok: false, error: d?.error?.message ?? `HTTP ${res.status}` };
    return { ok: true, mid: d.id };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

// ---------------------------------------------------------------------
// Recursos (audios del founder, PDFs, imágenes…)
// ---------------------------------------------------------------------

export function urlPublicaRecurso(r: any): string | null {
  if (r.url) return r.url;
  if (r.token && (r.tiene_archivo || r.tiene)) return `${config.apiUrl}/recursos/pub/${r.token}`;
  return null;
}

const ADJUNTO_IG: Record<string, string> = { audio: 'audio', imagen: 'image', video: 'video', pdf: 'file' };
const ICONO_RECURSO: Record<string, string> = {
  audio: '🎙️', imagen: '🖼️', video: '🎬', pdf: '📄', texto: '📝', link: '🔗',
};

/**
 * Convierte un recurso en el mensaje de Instagram adecuado: un audio sale
 * como NOTA DE VOZ (adjunto), no como enlace — así el lead lo escucha como
 * si el founder le hablara.
 */
export function mensajeDeRecurso(r: any): { mensaje: Record<string, unknown>; descripcion: string; cuerpo: string } {
  const url = urlPublicaRecurso(r);
  const icono = ICONO_RECURSO[r.tipo] ?? '📎';
  const tipoAdj = ADJUNTO_IG[r.tipo];
  if (tipoAdj && url) {
    return {
      mensaje: { attachment: { type: tipoAdj, payload: { url } } },
      descripcion: `${icono} ${r.tipo === 'audio' ? 'Audio' : 'Archivo'} «${r.nombre}»`,
      cuerpo: `${icono} ${r.nombre}`,
    };
  }
  const texto = r.texto || (url ? `${r.nombre}: ${url}` : r.nombre);
  return { mensaje: { text: texto }, descripcion: `${icono} «${r.nombre}»`, cuerpo: texto };
}

async function recursoPorId(cuentaId: string, id?: string) {
  if (!id) return null;
  return queryOne(
    `SELECT id, nombre, tipo, texto, url, token, (datos IS NOT NULL) AS tiene_archivo
       FROM recursos WHERE cuenta_id=$1 AND id=$2`, [cuentaId, id]);
}

/** Guarda un mensaje saliente en el Chat con su estado real. */
export async function registrarSaliente(
  cuentaId: string, leadId: string, cuerpo: string, recursoId: string | null,
  r: ResultadoEnvio, enviadoPor: string | null = null,
) {
  const fila = await queryOne(
    `INSERT INTO mensajes (cuenta_id, lead_id, direccion, canal, cuerpo, recurso_id, enviado_por,
                           estado, externo_id, error)
     VALUES ($1,$2,'saliente','instagram_dm',$3,$4,$5,$6,$7,$8)
     ON CONFLICT DO NOTHING
     RETURNING id, direccion, cuerpo AS texto, estado, error, creado_en`,
    [cuentaId, leadId, cuerpo, recursoId, enviadoPor,
     r.simulado ? 'simulado' : r.ok ? 'enviado' : 'no_enviado', r.mid ?? null,
     r.simulado ? 'Prueba: no se mandó a Instagram' : r.ok ? null : (r.error ?? null)]);
  await pool.query(`UPDATE leads SET ultimo_mensaje_en = now() WHERE id = $1`, [leadId]);
  return fila;
}

// ---------------------------------------------------------------------
// Árbol de pasos
// ---------------------------------------------------------------------

export type Paso = { id?: string; tipo: string; [k: string]: any };
type Marco = { seq: Paso[]; idx: number };

const RAMIFICAN = new Set(['pregunta', 'condicion']);

/** Ramas hijas de un nodo. */
function ramas(p: Paso): Paso[][] {
  if (p.tipo === 'pregunta') return (p.opciones ?? []).map((o: any) => o.pasos ?? []);
  if (p.tipo === 'condicion') return [p.si ?? [], p.no ?? []];
  return [];
}

/**
 * Normaliza un árbol: ids estables donde falten, botones recortados al
 * límite de Meta, ramas siempre como listas. Se aplica al guardar y al
 * ejecutar, así un flujo viejo (lista plana) sigue funcionando igual.
 */
export function normalizarPasos(pasos: any, prefijo = 'n'): Paso[] {
  if (!Array.isArray(pasos)) return [];
  return pasos
    .filter((p) => p && typeof p === 'object' && typeof p.tipo === 'string')
    .map((p: any, i: number) => {
      const n: Paso = { ...p, id: p.id ? String(p.id) : `${prefijo}${i}` };
      if (n.tipo === 'pregunta') {
        n.opciones = (Array.isArray(p.opciones) ? p.opciones : [])
          .slice(0, MAX_BOTONES)
          .map((o: any, j: number) => {
            const oid = o?.id ? String(o.id) : `${n.id}o${j}`;
            return {
              ...o,
              id: oid,
              titulo: String(o?.titulo ?? `Opción ${j + 1}`).slice(0, MAX_TITULO_BOTON),
              pasos: normalizarPasos(o?.pasos ?? [], `${oid}n`),
            };
          });
      }
      if (n.tipo === 'condicion') {
        n.si = normalizarPasos(p.si ?? [], `${n.id}s`);
        n.no = normalizarPasos(p.no ?? [], `${n.id}x`);
      }
      return n;
    });
}

/**
 * Revisa que el flujo no se vaya a romper. Devuelve los problemas en
 * lenguaje normal; si hay alguno, el flujo se guarda en pausa.
 */
export function validarFlujo(pasos: Paso[]): string[] {
  const problemas: string[] = [];
  const ver = (seq: Paso[], donde: string) => {
    seq.forEach((p, i) => {
      const lugar = `${donde}paso ${i + 1}`;
      switch (p.tipo) {
        case 'enviar_dm':
        case 'entregar_recurso':
          if (!String(p.texto ?? p.recurso ?? '').trim()) problemas.push(`${lugar}: escribe el mensaje.`);
          else if (String(p.texto ?? p.recurso).length > MAX_TEXTO_DM) problemas.push(`${lugar}: el mensaje pasa de ${MAX_TEXTO_DM} caracteres (límite de Instagram).`);
          break;
        case 'enviar_recurso':
          if (!p.recurso_id) problemas.push(`${lugar}: elegí qué audio o recurso mandar.`);
          break;
        case 'responder_comentario':
          if (!String(p.texto ?? '').trim()) problemas.push(`${lugar}: escribe la respuesta al comentario.`);
          break;
        case 'etiquetar':
        case 'quitar_etiqueta':
          if (!String(p.etiqueta ?? '').trim()) problemas.push(`${lugar}: escribe la etiqueta.`);
          break;
        case 'mover_etapa':
          if (!p.etapa_slug && !p.etapa_id) problemas.push(`${lugar}: elegí la etapa.`);
          break;
        case 'webhook':
          if (!/^https?:\/\//.test(String(p.url ?? ''))) problemas.push(`${lugar}: pega una URL válida (https://…).`);
          break;
        case 'pregunta':
          if (!String(p.texto ?? '').trim()) problemas.push(`${lugar}: escribe la pregunta.`);
          if (!(p.opciones ?? []).length) problemas.push(`${lugar}: la pregunta necesita al menos un botón.`);
          (p.opciones ?? []).forEach((o: any, j: number) => {
            if (!String(o.titulo ?? '').trim()) problemas.push(`${lugar}: el botón ${j + 1} no tiene texto.`);
          });
          break;
        case 'condicion':
          if (!p.campo) problemas.push(`${lugar}: elegí qué revisar en la condición.`);
          else if (['etiqueta', 'etapa', 'texto'].includes(p.campo) && !String(p.valor ?? '').trim()) {
            problemas.push(`${lugar}: completá el valor de la condición.`);
          }
          break;
      }
      if (p.tipo === 'pregunta') {
        (p.opciones ?? []).forEach((o: any) => ver(o.pasos ?? [], `${donde}botón «${o.titulo}» → `));
      } else if (p.tipo === 'condicion') {
        ver(p.si ?? [], `${donde}rama Sí → `);
        ver(p.no ?? [], `${donde}rama No → `);
      }
    });
  };
  ver(pasos, '');
  return problemas;
}

/** Camino de marcos desde la raíz hasta el nodo con ese id. */
function rutaHasta(seq: Paso[], id: string): Marco[] | null {
  for (let i = 0; i < seq.length; i++) {
    const p = seq[i];
    if (p.id === id) return [{ seq, idx: i }];
    for (const sub of ramas(p)) {
      const r = rutaHasta(sub, id);
      if (r) return [{ seq, idx: i }, ...r];
    }
  }
  return null;
}

// ---------------------------------------------------------------------
// Utilidades de texto
// ---------------------------------------------------------------------

export function normalizar(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ¿El texto contiene alguna de las palabras clave (separadas por coma)? */
export function coincidePalabra(texto: string, palabras: string | null | undefined): boolean {
  const lista = String(palabras ?? '').split(',').map(normalizar).filter(Boolean);
  if (!lista.length) return true;               // sin palabra clave = cualquier mensaje
  const t = ` ${normalizar(texto)} `;
  return lista.some((p) => t.includes(` ${p} `));
}

function corto(s: string, n = 60) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function rellenar(texto: string, lead: any): string {
  const nombre = (lead?.nombre ? String(lead.nombre).split(' ')[0] : '') || lead?.ig_username || '';
  return String(texto ?? '')
    .replace(/\{\{\s*nombre\s*\}\}/gi, nombre)
    .replace(/\{\{\s*usuario\s*\}\}/gi, lead?.ig_username ? `@${lead.ig_username}` : '');
}

function fmtMin(min: number) {
  if (min >= 1440 && min % 1440 === 0) return `${min / 1440} día${min === 1440 ? '' : 's'}`;
  if (min >= 60 && min % 60 === 0) return `${min / 60} h`;
  return `${min} min`;
}

/** Elige el botón según lo que escribió el lead (por si escribe en vez de tocar). */
function opcionPorTexto(opciones: any[], texto?: string) {
  const t = normalizar(texto ?? '');
  if (!t) return null;
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= opciones.length) return opciones[n - 1];
  return opciones.find((o) => normalizar(o.titulo) === t)
    ?? opciones.find((o) => {
      const ot = normalizar(o.titulo);
      return ot && (t.includes(ot) || ot.includes(t));
    })
    ?? null;
}

export function describirCondicion(p: Paso): string {
  switch (p.campo) {
    case 'etiqueta': return `¿Tiene la etiqueta «${p.valor}»?`;
    case 'etapa': return `¿Está en la etapa «${p.valor}»?`;
    case 'email': return '¿Ya tenemos su email?';
    case 'telefono': return '¿Ya tenemos su teléfono?';
    case 'texto': return `¿Su mensaje dice «${p.valor}»?`;
    default: return '¿Se cumple la condición?';
  }
}

// ---------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------

export interface ContextoFlujo {
  leadId?: string;
  destinatarioIgId?: string;
  /** Si lo disparó un comentario: el 1er mensaje va como respuesta privada. */
  commentId?: string;
  /** Texto que lo disparó (comentario o DM), para las condiciones. */
  texto?: string;
  simular?: boolean;
  /** Prueba: rama elegida por nodo (opcionId, o 'si'/'no'). */
  respuestas?: Record<string, string>;
  /**
   * Prueba EN VIVO: todo pasa de verdad en el CRM (Chat, etiquetas, pausas)
   * pero no se llama a Instagram; los mensajes quedan como "simulado".
   */
  sinInstagram?: boolean;
}

interface Corrida {
  cuentaId: string;
  flujo: any;
  ejecucionId: number | null;
  ctx: ContextoFlujo;
  resultados: any[];
  fallos: number;
  envios: number;
  pasosCorridos: number;
}

function anotar(c: Corrida, paso: string, texto: string, extra: Record<string, unknown> = {}) {
  c.resultados.push({ paso, texto, ...extra });
}

async function cargarLead(cuentaId: string, leadId?: string) {
  if (!leadId) return null;
  return queryOne(
    `SELECT l.*,
            (SELECT e.slug FROM oportunidades o JOIN etapas e ON e.id = o.etapa_id
              WHERE o.lead_id = l.id AND o.estado = 'abierta' ORDER BY o.creado_en DESC LIMIT 1) AS etapa_slug,
            (SELECT e.nombre FROM oportunidades o JOIN etapas e ON e.id = o.etapa_id
              WHERE o.lead_id = l.id AND o.estado = 'abierta' ORDER BY o.creado_en DESC LIMIT 1) AS etapa_nombre
       FROM leads l WHERE l.cuenta_id = $1 AND l.id = $2`, [cuentaId, leadId]);
}

async function evaluarCondicion(c: Corrida, p: Paso): Promise<boolean> {
  if (p.campo === 'texto') {
    return coincidePalabra(c.ctx.texto ?? '', String(p.valor ?? '')) && !!String(p.valor ?? '').trim();
  }
  const lead = await cargarLead(c.cuentaId, c.ctx.leadId);
  if (!lead) return false;
  switch (p.campo) {
    case 'etiqueta':
      return (lead.etiquetas ?? []).some((e: string) => normalizar(e) === normalizar(p.valor));
    case 'etapa': {
      const v = normalizar(p.valor);
      return normalizar(lead.etapa_slug ?? '') === v || normalizar(lead.etapa_nombre ?? '') === v;
    }
    case 'email': return !!lead.email;
    case 'telefono': return !!lead.telefono;
    default: return false;
  }
}

/** Manda un mensaje dentro de una corrida, lo guarda en el Chat y lo anota. */
async function enviar(
  c: Corrida, mensaje: Record<string, unknown>, descripcion: string,
  cuerpo: string, recursoId: string | null = null,
): Promise<boolean> {
  if (c.ctx.simular) {
    anotar(c, 'enviar', `${descripcion} (prueba: no se manda)`);
    return true;
  }
  // Instagram solo deja escribir a quien comentó con UNA respuesta privada
  // al comentario; los siguientes mensajes van cuando el lead contesta.
  const destino: Destino = c.ctx.commentId && c.envios === 0
    ? { commentId: c.ctx.commentId }
    : { igId: c.ctx.destinatarioIgId };
  const r: ResultadoEnvio = c.ctx.sinInstagram
    ? { ok: true, simulado: true }
    : await enviarMensajeIG(c.cuentaId, destino, mensaje);
  c.envios++;
  if (!r.ok) c.fallos++;
  if (c.ctx.leadId) await registrarSaliente(c.cuentaId, c.ctx.leadId, cuerpo, recursoId, r).catch(() => {});
  anotar(c, 'enviar',
    r.simulado ? `${descripcion} (simulado, no salió a Instagram)`
      : r.ok ? `${descripcion} ✓` : `${descripcion} — no salió a Instagram: ${r.error}`,
    { ok: r.ok });
  return r.ok;
}

async function guardarRespuesta(c: Corrida, p: Paso, texto: string) {
  const destino = p.guardar_en as string | undefined;
  if (c.ctx.simular || !c.ctx.leadId) {
    anotar(c, 'respuesta', `✍️ (prueba) el lead responde «${corto(texto)}»${destino ? ` → se guardaría como ${destino}` : ''}`);
    return;
  }
  let guardado = '';
  if (destino === 'email') {
    const m = texto.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (m) {
      await pool.query(`UPDATE leads SET email = $2 WHERE id = $1`, [c.ctx.leadId, m[0].toLowerCase()]);
      guardado = ` → email guardado (${m[0]})`;
    } else guardado = ' → ⚠ no parece un email, no lo guardé';
  } else if (destino === 'telefono') {
    const tel = texto.replace(/[^\d+]/g, '');
    if (tel.replace(/\D/g, '').length >= 7) {
      await pool.query(`UPDATE leads SET telefono = $2 WHERE id = $1`, [c.ctx.leadId, tel]);
      guardado = ' → teléfono guardado';
    } else guardado = ' → ⚠ no parece un teléfono, no lo guardé';
  } else if (destino === 'nombre') {
    await pool.query(`UPDATE leads SET nombre = $2 WHERE id = $1`, [c.ctx.leadId, texto.trim().slice(0, 80)]);
    guardado = ' → nombre guardado';
  } else if (destino === 'nota') {
    await pool.query(`INSERT INTO notas (cuenta_id, lead_id, cuerpo) VALUES ($1,$2,$3)`,
      [c.cuentaId, c.ctx.leadId, `✍️ Respondió: ${texto}`]);
    guardado = ' → guardado como nota';
  }
  anotar(c, 'respuesta', `✍️ Respondió «${corto(texto)}»${guardado}`);
}

async function etiquetar(cuentaId: string, leadId: string, etiqueta: string, quitar = false) {
  if (quitar) {
    await pool.query(
      `UPDATE leads SET etiquetas = array_remove(etiquetas, $2) WHERE id = $1 AND cuenta_id = $3`,
      [leadId, etiqueta, cuentaId]);
  } else {
    await pool.query(
      `UPDATE leads SET etiquetas = (SELECT array_agg(DISTINCT x) FROM unnest(etiquetas || ARRAY[$2]) x)
        WHERE id = $1 AND cuenta_id = $3`, [leadId, etiqueta, cuentaId]);
  }
}

/** Ejecuta un paso de acción (los que no ramifican ni pausan). */
async function accion(c: Corrida, p: Paso) {
  const sim = !!c.ctx.simular;
  const leadId = c.ctx.leadId;
  switch (p.tipo) {
    case 'enviar_dm':
    case 'entregar_recurso': {
      const lead = await cargarLead(c.cuentaId, leadId);
      const texto = rellenar(String(p.texto ?? p.recurso ?? ''), lead).slice(0, MAX_TEXTO_DM);
      if (!texto.trim()) { anotar(c, p.tipo, '⚠ Mensaje vacío: lo salteo'); return; }
      await enviar(c, { text: texto }, `💬 «${corto(texto)}»`, texto);
      return;
    }
    case 'enviar_recurso': {
      const rec = await recursoPorId(c.cuentaId, p.recurso_id);
      if (!rec) { anotar(c, p.tipo, '⚠ No encontré el audio/recurso elegido (¿lo borraron?)'); return; }
      const { mensaje, descripcion, cuerpo } = mensajeDeRecurso(rec);
      await enviar(c, mensaje, descripcion, cuerpo, rec.id);
      return;
    }
    case 'responder_comentario': {
      const lead = await cargarLead(c.cuentaId, leadId);
      const texto = rellenar(String(p.texto ?? ''), lead);
      if (sim) { anotar(c, p.tipo, `💭 Respondería el comentario en público: «${corto(texto)}» (prueba)`); return; }
      if (c.ctx.sinInstagram) { anotar(c, p.tipo, `💭 Respuesta pública «${corto(texto)}» (simulado, no salió a Instagram)`); return; }
      if (!c.ctx.commentId) { anotar(c, p.tipo, '💭 No vino de un comentario: no hay nada que responder'); return; }
      const r = await responderComentario(c.cuentaId, c.ctx.commentId, texto);
      if (!r.ok) c.fallos++;
      anotar(c, p.tipo, r.ok ? `💭 Comentario respondido en público ✓` : `💭 No se pudo responder el comentario: ${r.error}`, { ok: r.ok });
      return;
    }
    case 'etiquetar':
    case 'quitar_etiqueta': {
      const et = String(p.etiqueta ?? '').trim();
      const quitar = p.tipo === 'quitar_etiqueta';
      if (!sim && leadId && et) await etiquetar(c.cuentaId, leadId, et, quitar);
      anotar(c, p.tipo, `🏷️ ${quitar ? 'Quitar' : 'Poner'} etiqueta «${et}»${sim ? ' (prueba)' : ''}`);
      return;
    }
    case 'mover_etapa': {
      let destino = p.etapa_slug ?? p.etapa_id;
      if (!sim && leadId) {
        const opp = await oportunidadAbierta(c.cuentaId, leadId, pool);
        const etapa = await queryOne(
          `SELECT id, nombre FROM etapas WHERE pipeline_id = $1 AND (slug = $2 OR id::text = $2) LIMIT 1`,
          [opp.pipeline_id, String(destino ?? '')]);
        if (etapa) {
          await moverEtapa(c.cuentaId, opp.id, etapa.id, pool, { origen: 'regla' });
          destino = etapa.nombre;
        }
      }
      anotar(c, p.tipo, `➡️ Mover a la etapa «${destino}»${sim ? ' (prueba)' : ''}`);
      return;
    }
    case 'asignar': {
      // Reparte entre el equipo (setters/closers) al que tenga menos leads abiertos.
      const roles = p.rol === 'closer' ? ['closer'] : p.rol === 'setter' ? ['setter'] : ['setter', 'closer'];
      if (sim || !leadId) { anotar(c, p.tipo, `👤 Asignar a un ${p.rol ?? 'miembro del equipo'} (prueba)`); return; }
      let usuarioId = p.usuario_id as string | undefined;
      if (!usuarioId) {
        const fila = await queryOne(
          `SELECT u.id, u.nombre, COUNT(l.id) AS carga
             FROM usuarios u
             LEFT JOIN leads l ON l.propietario_id = u.id
            WHERE u.cuenta_id = $1 AND u.activo AND u.rol = ANY($2)
            GROUP BY u.id ORDER BY carga ASC, u.creado_en ASC LIMIT 1`, [c.cuentaId, roles]);
        usuarioId = fila?.id;
      }
      if (!usuarioId) { anotar(c, p.tipo, '👤 No hay nadie del equipo con ese rol: lo dejo sin asignar'); return; }
      await pool.query(`UPDATE leads SET propietario_id = $2 WHERE id = $1 AND cuenta_id = $3`,
        [leadId, usuarioId, c.cuentaId]);
      await pool.query(`UPDATE oportunidades SET propietario_id = $2 WHERE lead_id = $1 AND estado = 'abierta'`,
        [leadId, usuarioId]);
      anotar(c, p.tipo, '👤 Lead asignado al equipo ✓');
      return;
    }
    case 'notificar': {
      const texto = String(p.texto ?? 'Atender este lead');
      if (!sim && leadId) {
        await pool.query(`INSERT INTO notas (cuenta_id, lead_id, cuerpo) VALUES ($1,$2,$3)`,
          [c.cuentaId, leadId, `🔔 ${texto}`]);
        // Lo sube arriba en el Chat como "sin leer" para que el setter lo vea.
        await pool.query(
          `UPDATE leads SET mensajes_sin_leer = mensajes_sin_leer + 1, ultimo_mensaje_en = now() WHERE id = $1`,
          [leadId]);
      }
      anotar(c, p.tipo, `🔔 Avisar al equipo: «${corto(texto)}»${sim ? ' (prueba)' : ''}`);
      return;
    }
    case 'webhook': {
      const url = String(p.url ?? '');
      if (sim) { anotar(c, p.tipo, `🔗 Avisaría a ${corto(url, 40)} (prueba)`); return; }
      const lead = await cargarLead(c.cuentaId, leadId);
      const r = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          evento: 'flujo', flujo: c.flujo.nombre,
          lead: lead && {
            id: lead.id, nombre: lead.nombre, ig_username: lead.ig_username, email: lead.email,
            telefono: lead.telefono, etiquetas: lead.etiquetas, etapa: lead.etapa_nombre,
          },
        }),
        signal: AbortSignal.timeout(10_000),
      }).then((x) => x.ok).catch(() => false);
      if (!r) c.fallos++;
      anotar(c, p.tipo, r ? `🔗 Aviso enviado a ${corto(url, 40)} ✓` : `🔗 ${corto(url, 40)} no respondió bien`, { ok: r });
      return;
    }
    default:
      anotar(c, p.tipo, `(paso «${p.tipo}» no reconocido: lo salteo)`);
  }
}

async function pausar(
  c: Corrida, nodoId: string, tipo: 'respuesta' | 'tiempo', reanudarEn: Date | null, texto: string,
) {
  anotar(c, 'pausa', texto);
  if (!c.ejecucionId) return;
  await pool.query(
    `UPDATE flujo_ejecuciones
        SET estado = 'esperando', esperando = $2, nodo_id = $3, reanudar_en = $4,
            resultado = $5::jsonb, actualizado_en = now()
      WHERE id = $1`,
    [c.ejecucionId, tipo, nodoId, reanudarEn, JSON.stringify(c.resultados)]);
}

/** Recorre el árbol desde la pila de marcos hasta terminar o pausar. */
async function correr(c: Corrida, pila: Marco[]): Promise<'fin' | 'pausa'> {
  while (pila.length) {
    if (++c.pasosCorridos > MAX_PASOS_POR_CORRIDA) {
      anotar(c, 'limite', '⚠ El flujo es demasiado largo: se cortó por seguridad.');
      return 'fin';
    }
    const m = pila[pila.length - 1];
    if (m.idx >= m.seq.length) {
      // Fin de una rama: sigue con lo que haya después del nodo que la abrió.
      pila.pop();
      if (pila.length) pila[pila.length - 1].idx++;
      continue;
    }
    const p = m.seq[m.idx];
    try {
      if (p.tipo === 'condicion') {
        const forzada = c.ctx.respuestas?.[p.id!];
        const si = forzada ? forzada === 'si' : (c.ctx.simular && !c.ctx.leadId ? true : await evaluarCondicion(c, p));
        anotar(c, 'condicion', `🔀 ${describirCondicion(p)} → ${si ? 'Sí' : 'No'}${c.ctx.simular ? ' (prueba)' : ''}`);
        pila.push({ seq: si ? (p.si ?? []) : (p.no ?? []), idx: 0 });
        continue;
      }
      if (p.tipo === 'pregunta') {
        const opciones = (p.opciones ?? []).slice(0, MAX_BOTONES);
        const lead = await cargarLead(c.cuentaId, c.ctx.leadId);
        const texto = rellenar(String(p.texto ?? ''), lead).slice(0, MAX_TEXTO_DM);
        const salio = await enviar(c, {
          text: texto,
          quick_replies: opciones.map((o: any) => ({
            content_type: 'text',
            title: String(o.titulo).slice(0, MAX_TITULO_BOTON),
            payload: `fx:${c.ejecucionId ?? 0}:${p.id}:${o.id}`,
          })),
        }, `❓ «${corto(texto)}» con ${opciones.length} botón${opciones.length === 1 ? '' : 'es'}`,
        `${texto}\n${opciones.map((o: any) => `[${o.titulo}]`).join(' ')}`);
        if (!opciones.length) { m.idx++; continue; }
        if (!salio) {
          anotar(c, 'pausa', '⚠ La pregunta no llegó al lead, así que el flujo se detiene aquí (no espera un botón que nunca vio).');
          return 'fin';
        }
        if (c.ctx.simular) {
          const elegida = opciones.find((o: any) => o.id === c.ctx.respuestas?.[p.id!]) ?? opciones[0];
          anotar(c, 'respuesta', `👉 (prueba) el lead toca «${elegida.titulo}»`);
          pila.push({ seq: elegida.pasos ?? [], idx: 0 });
          continue;
        }
        await pausar(c, p.id!, 'respuesta', null, '⏸ Esperando a que el lead toque un botón');
        return 'pausa';
      }
      if (p.tipo === 'esperar_respuesta') {
        if (c.ctx.simular) {
          await guardarRespuesta(c, p, p.guardar_en === 'email' ? 'ejemplo@correo.com' : 'respuesta de ejemplo');
          m.idx++;
          continue;
        }
        await pausar(c, p.id!, 'respuesta', null, '⏸ Esperando la respuesta del lead');
        return 'pausa';
      }
      if (p.tipo === 'esperar') {
        const min = Math.max(0, Math.round(Number(p.minutos) || 0));
        if (c.ctx.simular || min === 0) {
          anotar(c, 'esperar', `⏳ Esperar ${fmtMin(min)}${c.ctx.simular ? ' (prueba: sigo de inmediato)' : ''}`);
          m.idx++;
          continue;
        }
        await pausar(c, p.id!, 'tiempo', new Date(Date.now() + min * 60_000), `⏳ Esperando ${fmtMin(min)}`);
        return 'pausa';
      }
      await accion(c, p);
    } catch (err: any) {
      c.fallos++;
      anotar(c, p.tipo, `⚠ Error: ${String(err?.message ?? err)}`, { ok: false });
    }
    m.idx++;
  }
  return 'fin';
}

/** Persiste el resultado final (o simulado) de una corrida. */
async function cerrar(c: Corrida, fin: 'fin' | 'pausa') {
  if (c.ctx.simular) {
    await pool.query(
      `INSERT INTO flujo_ejecuciones (cuenta_id, flujo_id, lead_id, estado, resultado)
       VALUES ($1,$2,$3,'simulado',$4::jsonb)`,
      [c.cuentaId, c.flujo.id, c.ctx.leadId ?? null, JSON.stringify(c.resultados)]);
    return { resultados: c.resultados, estado: 'simulado', ejecucionId: null };
  }
  if (fin === 'pausa') return { resultados: c.resultados, estado: 'esperando', ejecucionId: c.ejecucionId };
  const estado = c.fallos ? 'pendiente_envio' : 'ok';
  if (c.ejecucionId) {
    await pool.query(
      `UPDATE flujo_ejecuciones
          SET estado = $2, resultado = $3::jsonb, esperando = NULL, nodo_id = NULL,
              reanudar_en = NULL, actualizado_en = now()
        WHERE id = $1`,
      [c.ejecucionId, estado, JSON.stringify(c.resultados)]);
  }
  return { resultados: c.resultados, estado, ejecucionId: c.ejecucionId };
}

/** Lo que se guarda del contexto para poder reanudar más tarde. */
function contextoPersistible(ctx: ContextoFlujo) {
  return {
    destinatarioIgId: ctx.destinatarioIgId ?? null, texto: ctx.texto ?? null,
    sinInstagram: ctx.sinInstagram ?? false,
  };
}

/**
 * Arranca un flujo sobre un lead. En modo simular (prueba en seco) recorre
 * el árbol entero sin mandar nada ni tocar la base.
 */
export async function ejecutarFlujo(cuentaId: string, flujoId: string, ctx: ContextoFlujo) {
  const flujo = await queryOne(`SELECT * FROM flujos WHERE cuenta_id=$1 AND id=$2`, [cuentaId, flujoId]);
  if (!flujo) return null;
  const pasos = normalizarPasos(flujo.pasos ?? []);
  const c: Corrida = {
    cuentaId, flujo, ejecucionId: null, ctx, resultados: [], fallos: 0, envios: 0, pasosCorridos: 0,
  };
  if (!ctx.simular) {
    const ej = await queryOne(
      `INSERT INTO flujo_ejecuciones (cuenta_id, flujo_id, lead_id, estado, contexto)
       VALUES ($1,$2,$3,'ok',$4::jsonb) RETURNING id`,
      [cuentaId, flujoId, ctx.leadId ?? null, JSON.stringify(contextoPersistible(ctx))]);
    c.ejecucionId = ej?.id ?? null;
    await pool.query(
      `UPDATE flujos SET total_disparos = total_disparos + 1, ultimo_disparo_en = now() WHERE id=$1`,
      [flujoId]);
  }
  const fin = await correr(c, [{ seq: pasos, idx: 0 }]);
  return cerrar(c, fin);
}

type Entrada =
  | { tipo: 'opcion'; opcionId: string }
  | { tipo: 'respuesta'; texto: string }
  | { tipo: 'tiempo' };

/** Reclama una ejecución en pausa (atómico: nunca se reanuda dos veces). */
async function reclamar(cuentaId: string, ejecucionId: number, nodoId: string) {
  return queryOne(
    `UPDATE flujo_ejecuciones SET estado = 'ok', actualizado_en = now()
      WHERE id = $1 AND cuenta_id = $2 AND estado = 'esperando' AND nodo_id = $3
      RETURNING *`, [ejecucionId, cuentaId, nodoId]);
}

/** Reanuda una ejecución ya reclamada desde el nodo donde quedó. */
async function reanudar(fila: any, entrada: Entrada) {
  const flujo = await queryOne(`SELECT * FROM flujos WHERE id = $1`, [fila.flujo_id]);
  const ctxGuardado = fila.contexto ?? {};
  const c: Corrida = {
    cuentaId: fila.cuenta_id, flujo: flujo ?? { id: fila.flujo_id, nombre: '' }, ejecucionId: fila.id,
    ctx: {
      leadId: fila.lead_id ?? undefined,
      destinatarioIgId: ctxGuardado.destinatarioIgId ?? undefined,
      texto: entrada.tipo === 'respuesta' ? entrada.texto : (ctxGuardado.texto ?? undefined),
      sinInstagram: !!ctxGuardado.sinInstagram,
    },
    resultados: Array.isArray(fila.resultado) ? fila.resultado : [],
    fallos: 0, envios: 1, pasosCorridos: 0,
  };
  const pasos = normalizarPasos(flujo?.pasos ?? []);
  const ruta = flujo ? rutaHasta(pasos, fila.nodo_id) : null;
  if (!ruta) {
    anotar(c, 'reanudar', '⚠ El flujo cambió y ese paso ya no existe: terminó aquí.');
    return cerrar(c, 'fin');
  }
  const ultimo = ruta[ruta.length - 1];
  const nodo = ultimo.seq[ultimo.idx];
  if (entrada.tipo === 'opcion' && nodo.tipo === 'pregunta') {
    const op = (nodo.opciones ?? []).find((o: any) => o.id === entrada.opcionId);
    if (!op) {
      anotar(c, 'respuesta', '⚠ Ese botón ya no existe en el flujo: terminó aquí.');
      return cerrar(c, 'fin');
    }
    anotar(c, 'respuesta', `👉 El lead tocó «${op.titulo}»`);
    ruta.push({ seq: op.pasos ?? [], idx: 0 });
  } else if (entrada.tipo === 'respuesta' && nodo.tipo === 'esperar_respuesta') {
    await guardarRespuesta(c, nodo, entrada.texto);
    ultimo.idx++;
  } else if (entrada.tipo === 'tiempo' && nodo.tipo === 'esperar') {
    anotar(c, 'esperar', '⏰ Terminó la espera, sigo');
    ultimo.idx++;
  } else {
    anotar(c, 'reanudar', '⚠ El paso cambió de tipo: terminó aquí.');
    return cerrar(c, 'fin');
  }
  const fin = await correr(c, ruta);
  return cerrar(c, fin);
}

/**
 * Llega un mensaje del lead: si tiene un flujo esperando su respuesta, lo
 * reanuda. Devuelve true si el mensaje lo consumió un flujo (entonces no
 * debe disparar otros).
 */
export async function reanudarPorMensaje(
  cuentaId: string, leadId: string, entrada: { texto?: string; payload?: string },
): Promise<boolean> {
  // 1) Tocó un botón de un flujo: payload fx:<ejecucion>:<nodo>:<opcion>
  if (entrada.payload?.startsWith('fx:')) {
    const [, ej, nodo, op] = entrada.payload.split(':');
    const fila = await reclamar(cuentaId, Number(ej), nodo);
    if (!fila) return true; // botón viejo o ya respondido: no dispara nada más
    await reanudar(fila, { tipo: 'opcion', opcionId: op });
    return true;
  }
  // 2) Escribió: ¿hay un flujo de este lead esperando respuesta? (7 días)
  const fila = await queryOne(
    `SELECT * FROM flujo_ejecuciones
      WHERE cuenta_id = $1 AND lead_id = $2 AND estado = 'esperando' AND esperando = 'respuesta'
        AND actualizado_en > now() - interval '7 days'
      ORDER BY actualizado_en DESC LIMIT 1`, [cuentaId, leadId]);
  if (!fila) return false;
  const flujo = await queryOne(`SELECT pasos FROM flujos WHERE id = $1`, [fila.flujo_id]);
  const ruta = rutaHasta(normalizarPasos(flujo?.pasos ?? []), fila.nodo_id);
  const nodo = ruta ? ruta[ruta.length - 1].seq[ruta[ruta.length - 1].idx] : null;
  if (nodo?.tipo === 'pregunta') {
    // Escribió en vez de tocar: si coincide con un botón, cuenta como tocarlo.
    const op = opcionPorTexto(nodo.opciones ?? [], entrada.texto);
    if (!op) return false; // no coincide: lo atiende el setter; el flujo sigue esperando
    const f = await reclamar(cuentaId, fila.id, fila.nodo_id);
    if (!f) return false;
    await reanudar(f, { tipo: 'opcion', opcionId: op.id });
    return true;
  }
  if (nodo?.tipo === 'esperar_respuesta') {
    const f = await reclamar(cuentaId, fila.id, fila.nodo_id);
    if (!f) return false;
    await reanudar(f, { tipo: 'respuesta', texto: entrada.texto ?? '' });
    return true;
  }
  return false;
}

/**
 * Reanuda las esperas por tiempo que ya vencieron. Se llama en cada webhook
 * de Instagram, al abrir el Chat y desde el cron, así no hace falta un
 * proceso siempre encendido.
 */
export async function procesarEsperasVencidas(cuentaId?: string, limite = 10): Promise<number> {
  const params: any[] = [limite];
  if (cuentaId) params.push(cuentaId);
  const filas = await query(
    `UPDATE flujo_ejecuciones SET estado = 'ok', actualizado_en = now()
      WHERE id IN (
        SELECT id FROM flujo_ejecuciones
         WHERE estado = 'esperando' AND esperando = 'tiempo' AND reanudar_en <= now()
           ${cuentaId ? 'AND cuenta_id = $2' : ''}
         ORDER BY reanudar_en ASC LIMIT $1
         FOR UPDATE SKIP LOCKED)
      RETURNING *`, params);
  for (const f of filas) await reanudar(f, { tipo: 'tiempo' }).catch(() => {});
  return filas.length;
}

/** Ejecuciones en pausa de un lead (para verlas en su ficha / chat). */
export async function esperasDeLead(cuentaId: string, leadId: string) {
  return query(
    `SELECT e.id, e.esperando, e.reanudar_en, e.actualizado_en, f.nombre AS flujo
       FROM flujo_ejecuciones e JOIN flujos f ON f.id = e.flujo_id
      WHERE e.cuenta_id = $1 AND e.lead_id = $2 AND e.estado = 'esperando'
      ORDER BY e.actualizado_en DESC`, [cuentaId, leadId]);
}

export { RAMIFICAN };
