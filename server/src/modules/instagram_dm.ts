import { pool, query, queryOne } from '../db/pool.js';
import { config } from '../config.js';
import { integracionInstagram, credsUsables } from './instagram.js';
import { moverEtapa, oportunidadAbierta } from './pipeline.js';
import { esLinkDeAgenda, marcarAgendaEnviada } from './agenda.js';

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
  cuentaId: string, destino: Destino, mensaje: Record<string, unknown>, opts: { tag?: 'HUMAN_AGENT' } = {},
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
      body: JSON.stringify({
        recipient, message: mensaje, access_token: canal.token,
        // Una persona del equipo puede responder hasta 7 días (no 24 h) con la etiqueta de agente humano.
        ...(opts.tag ? { messaging_type: 'MESSAGE_TAG', tag: opts.tag } : {}),
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const d: any = await res.json().catch(() => ({}));
    if (!res.ok || d.error) return { ok: false, error: d?.error?.message ?? `HTTP ${res.status}` };
    return { ok: true, mid: d.message_id };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/** Muestra «escribiendo…» en el chat del lead (best-effort). */
export async function escribiendo(cuentaId: string, igId: string): Promise<boolean> {
  const canal = await canalMensajes(cuentaId);
  if ('error' in canal) return false;
  return fetch(canal.url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ recipient: { id: igId }, sender_action: 'typing_on', access_token: canal.token }),
    signal: AbortSignal.timeout(5_000),
  }).then(() => true).catch(() => false);
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
    `SELECT id, nombre, tipo, texto, url, token, es_agenda, (datos IS NOT NULL) AS tiene_archivo
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
// Pizarra libre (grafo)
// ---------------------------------------------------------------------
//
// Un flujo es un GRAFO, como en n8n: cada paso tiene posición (x, y) en la
// pizarra y apunta al siguiente por id. El nodo "inicio" es el disparador.
//   - pasos normales:  siguiente
//   - pregunta:        opciones[].siguiente (una flecha por botón)
//   - condición:       siguiente_si / siguiente_no
// Varias flechas pueden llegar al mismo paso (ramas que se juntan) y se
// puede volver atrás (seguimientos), siempre que el círculo tenga una espera.

export type Paso = { id: string; tipo: string; x?: number; y?: number; siguiente?: string | null; [k: string]: any };

/** Pasos que pausan la ejecución (cortan cualquier círculo). */
const PAUSAN = new Set(['pregunta', 'esperar_respuesta', 'esperar']);

export const ETIQUETA_PASO: Record<string, string> = {
  enviar_dm: 'Mandar mensaje', entregar_recurso: 'Mandar mensaje', enviar_recurso: 'Mandar audio o recurso', enviar_calendario: 'Mandar calendario',
  responder_comentario: 'Responder el comentario', pregunta: 'Pregunta con botones', condicion: 'Condición', router: 'Router (repartir al azar)',
  esperar_respuesta: 'Esperar su respuesta', esperar: 'Esperar un tiempo', etiquetar: 'Poner etiqueta',
  quitar_etiqueta: 'Quitar etiqueta', mover_etapa: 'Mover de etapa', asignar: 'Asignar al equipo',
  notificar: 'Avisar al equipo', webhook: 'Avisar a otra app', inicio: 'Disparador',
};

/** Ids a los que apunta un paso. */
export function salidas(n: Paso): Array<string | null | undefined> {
  const sin = (n.tipo === 'pregunta' || n.tipo === 'esperar_respuesta') && n.limite_min ? [n.siguiente_sin_respuesta] : [];
  if (n.tipo === 'pregunta') return [...(n.opciones ?? []).map((o: any) => o.siguiente), ...sin];
  if (n.tipo === 'condicion') return [n.siguiente_si, n.siguiente_no];
  if (n.tipo === 'esperar_respuesta') return [n.siguiente, ...sin, ...(Array.isArray(n.tambien) ? n.tambien : [])];
  const extra = Array.isArray(n.tambien) ? n.tambien : [];
  if (n.tipo === 'router') return [...(n.ramas ?? []).map((r: any) => r.siguiente), ...extra];
  return [n.siguiente, ...extra];
}

/**
 * Router: elige una rama al azar. Con modo «pesos» respeta el % de cada una
 * (ej. 50/30/20); si no, todas por igual. Sirve para variar mensajes
 * (10 ganchos distintos) y que no parezca spam, o para probar versiones.
 */
export function elegirRama(n: Paso, azar: () => number = Math.random): any | null {
  const ramas = (n.ramas ?? []).filter((r: any) => r && r.siguiente);
  if (!ramas.length) return null;
  const pesos = ramas.map((r: any) => (n.modo === 'pesos' ? Math.max(0, Number(r.peso) || 0) : 1));
  const total = pesos.reduce((a: number, b: number) => a + b, 0);
  if (total <= 0) return ramas[Math.floor(azar() * ramas.length)];
  let x = azar() * total;
  for (let i = 0; i < ramas.length; i++) { x -= pesos[i]; if (x < 0) return ramas[i]; }
  return ramas[ramas.length - 1];
}

/** Convierte un flujo viejo (árbol con ramas anidadas) en grafo. */
function arbolAGrafo(pasos: any[]): Paso[] {
  const nodos: Paso[] = [];
  const usados = new Set<string>(['inicio']);
  const unico = (sug: string) => {
    let id = sug; let k = 1;
    while (usados.has(id)) id = `${sug}_${k++}`;
    usados.add(id);
    return id;
  };
  // `continuacion`: a dónde seguía el motor viejo al terminar una rama.
  const secuencia = (lista: any[], prefijo: string, continuacion: string | null): string | null => {
    const validos = (Array.isArray(lista) ? lista : []).filter((p) => p && typeof p.tipo === 'string');
    const ids = validos.map((p, i) => unico(p.id ? String(p.id) : `${prefijo}${i}`));
    validos.forEach((p, i) => {
      const id = ids[i];
      const despues = i + 1 < validos.length ? ids[i + 1] : continuacion;
      const { si, no, opciones, pasos: _pasos, ...resto } = p;
      const n: Paso = { ...resto, id, tipo: p.tipo };
      if (p.tipo === 'pregunta') {
        n.opciones = (Array.isArray(opciones) ? opciones : []).map((o: any, j: number) => {
          const oid = o?.id ? String(o.id) : `${id}o${j}`;
          return { id: oid, titulo: String(o?.titulo ?? ''), siguiente: secuencia(o?.pasos ?? [], `${oid}n`, despues) };
        });
      } else if (p.tipo === 'condicion') {
        n.siguiente_si = secuencia(si ?? [], `${id}s`, despues);
        n.siguiente_no = secuencia(no ?? [], `${id}x`, despues);
      } else {
        n.siguiente = despues;
      }
      nodos.push(n);
    });
    return ids[0] ?? continuacion;
  };
  const inicio: Paso = { id: 'inicio', tipo: 'inicio', siguiente: null };
  inicio.siguiente = secuencia(pasos, 'n', null);
  return [inicio, ...nodos];
}

/**
 * Acomoda los pasos en columnas de izquierda a derecha según su distancia al
 * disparador. Solo si a alguno le falta posición (o si se pide "ordenar").
 */
export function ordenarGrafo(nodos: Paso[], forzar = false): Paso[] {
  if (!forzar && nodos.every((n) => typeof n.x === 'number' && typeof n.y === 'number')) return nodos;
  const mapa = new Map(nodos.map((n) => [n.id, n]));
  const nivel = new Map<string, number>();
  const inicio = nodos.find((n) => n.tipo === 'inicio');
  const cola: string[] = [];
  if (inicio) { nivel.set(inicio.id, 0); cola.push(inicio.id); }
  while (cola.length) {
    const id = cola.shift()!;
    for (const s of salidas(mapa.get(id)!)) {
      if (s && mapa.has(s) && !nivel.has(s)) { nivel.set(s, nivel.get(id)! + 1); cola.push(s); }
    }
  }
  const columnas = new Map<number, Paso[]>();
  const sueltos: Paso[] = [];
  for (const n of nodos) {
    const nv = nivel.get(n.id);
    if (nv === undefined) { sueltos.push(n); continue; }
    if (!columnas.has(nv)) columnas.set(nv, []);
    columnas.get(nv)!.push(n);
  }
  const ANCHO = 360; const ALTO = 200;
  let maxY = 0;
  const pos = new Map<string, { x: number; y: number }>();
  for (const [nv, col] of columnas) {
    col.forEach((n, i) => {
      const y = Math.round((i - (col.length - 1) / 2) * ALTO);
      pos.set(n.id, { x: nv * ANCHO, y });
      maxY = Math.max(maxY, y);
    });
  }
  sueltos.forEach((n, i) => pos.set(n.id, { x: i * ANCHO, y: maxY + 2 * ALTO }));
  return nodos.map((n) => ({ ...n, ...(forzar || typeof n.x !== 'number' || typeof n.y !== 'number' ? pos.get(n.id) : {}) }));
}

/**
 * Normaliza un flujo a grafo: ids, punteros a pasos inexistentes fuera,
 * botones al límite de Meta, un único disparador y posiciones. Acepta el
 * formato viejo (árbol) y lo convierte, así ningún flujo existente se rompe.
 */
export function normalizarFlujo(pasos: any): Paso[] {
  const lista = Array.isArray(pasos)
    ? pasos.filter((p) => p && typeof p === 'object' && typeof p.tipo === 'string')
    : [];
  const esGrafo = lista.some((p: any) => p.tipo === 'inicio');
  const base: Paso[] = esGrafo
    ? lista.map((p: any, i: number) => ({ ...p, id: String(p.id ?? `n${i}`) }))
    : arbolAGrafo(lista);
  const ids = new Set(base.map((n) => n.id));
  const ok = (v: any) => (v && ids.has(String(v)) ? String(v) : null);
  let vistoInicio = false;
  const limpio: Paso[] = [];
  for (const n of base) {
    if (n.tipo === 'inicio') { if (vistoInicio) continue; vistoInicio = true; }
    const m: Paso = { ...n };
    if (m.tipo === 'pregunta') {
      m.opciones = (Array.isArray(m.opciones) ? m.opciones : []).slice(0, MAX_BOTONES).map((o: any, j: number) => ({
        ...o,
        id: String(o?.id ?? `${m.id}o${j}`),
        titulo: String(o?.titulo ?? '').slice(0, MAX_TITULO_BOTON),
        siguiente: ok(o?.siguiente),
      }));
      delete m.siguiente;
    } else if (m.tipo === 'condicion') {
      m.siguiente_si = ok(m.siguiente_si);
      m.siguiente_no = ok(m.siguiente_no);
      delete m.siguiente;
    } else if (m.tipo === 'router') {
      m.modo = m.modo === 'pesos' ? 'pesos' : 'azar';
      m.ramas = (Array.isArray(m.ramas) ? m.ramas : []).slice(0, 20).map((r: any, j: number) => ({
        id: String(r?.id ?? `${m.id}r${j}`),
        nombre: String(r?.nombre ?? '').slice(0, 40),
        peso: Math.max(0, Math.min(100, Number(r?.peso) || 0)),
        siguiente: ok(r?.siguiente),
      }));
      delete m.siguiente;
    } else {
      m.siguiente = ok(m.siguiente);
    }
    // «Si no responde en X»: salida de seguimiento (pregunta y esperar respuesta).
    if (m.tipo === 'pregunta' || m.tipo === 'esperar_respuesta') {
      const lim = Math.round(Number(m.limite_min) || 0);
      if (lim > 0) { m.limite_min = Math.min(lim, 7 * 1440); m.siguiente_sin_respuesta = ok(m.siguiente_sin_respuesta); }
      else { delete m.limite_min; delete m.siguiente_sin_respuesta; }
    }
    // «Y también»: otros pasos que arrancan desde acá además del siguiente.
    if (m.tipo === 'pregunta' || m.tipo === 'condicion') delete m.tambien;
    else {
      const t = [...new Set((Array.isArray(m.tambien) ? m.tambien : []).map(ok).filter(Boolean) as string[])]
        .filter((x) => x !== m.siguiente).slice(0, 10);
      if (t.length) m.tambien = t; else delete m.tambien;
    }
    limpio.push(m);
  }
  if (!vistoInicio) limpio.unshift({ id: 'inicio', tipo: 'inicio', siguiente: null });
  return ordenarGrafo(limpio);
}
/** Compatibilidad con el nombre anterior. */
export const normalizarPasos = normalizarFlujo;

function alcanzablesDesde(mapa: Map<string, Paso>, desde?: string | null): Set<string> {
  const vistos = new Set<string>();
  const pila = desde ? [desde] : [];
  while (pila.length) {
    const id = pila.pop()!;
    if (vistos.has(id) || !mapa.has(id)) continue;
    vistos.add(id);
    for (const s of salidas(mapa.get(id)!)) if (s) pila.push(s);
  }
  return vistos;
}

/** ¿Hay un círculo que no pase por ninguna espera? Se repetiría sin parar. */
function hayCirculoSinPausa(mapa: Map<string, Paso>, alcanzables: Set<string>): boolean {
  const color = new Map<string, number>();
  const corre = (id: string) => { const n = mapa.get(id); return !!n && !PAUSAN.has(n.tipo); };
  const dfs = (id: string): boolean => {
    color.set(id, 1);
    for (const s of salidas(mapa.get(id)!)) {
      if (!s || !corre(s)) continue;
      const c = color.get(s) ?? 0;
      if (c === 1) return true;
      if (c === 0 && dfs(s)) return true;
    }
    color.set(id, 2);
    return false;
  };
  for (const id of alcanzables) {
    if (corre(id) && (color.get(id) ?? 0) === 0 && dfs(id)) return true;
  }
  return false;
}

/**
 * Revisa que el flujo no se vaya a romper. Devuelve cada problema con el
 * paso afectado (para marcarlo en rojo en la pizarra). Los pasos sueltos (sin
 * flecha que llegue) no son un problema: simplemente no se ejecutan.
 */
export function validarFlujoDetallado(nodos: Paso[]): Array<{ nodo: string | null; texto: string }> {
  const problemas: Array<{ nodo: string | null; texto: string }> = [];
  const mapa = new Map(nodos.map((n) => [n.id, n]));
  const inicio = nodos.find((n) => n.tipo === 'inicio');
  if (!inicio?.siguiente) {
    problemas.push({ nodo: inicio?.id ?? null, texto: 'Conectá el disparador («Cuando…») con el primer paso.' });
  }
  const alcanzables = alcanzablesDesde(mapa, inicio?.id);
  for (const p of nodos) {
    if (p.tipo === 'inicio' || !alcanzables.has(p.id)) continue;
    const mal = (msg: string) => problemas.push({ nodo: p.id, texto: `${ETIQUETA_PASO[p.tipo] ?? p.tipo}: ${msg}` });
    switch (p.tipo) {
      case 'enviar_dm':
      case 'entregar_recurso':
        if (!String(p.texto ?? p.recurso ?? '').trim()) mal('escribí el mensaje.');
        else if (String(p.texto ?? p.recurso).length > MAX_TEXTO_DM) mal(`pasa de ${MAX_TEXTO_DM} caracteres (límite de Instagram).`);
        break;
      case 'enviar_recurso':
        if (!p.recurso_id) mal('elegí qué audio o recurso mandar.');
        break;
      case 'enviar_calendario':
        if (!/^https?:\/\/\S+/i.test(String(p.url ?? '').trim())) mal('pegá el link de tu calendario (Calendly, Cal.com…).');
        break;
      case 'responder_comentario':
        if (!String(p.texto ?? '').trim()) mal('escribí la respuesta al comentario.');
        break;
      case 'etiquetar':
      case 'quitar_etiqueta':
        if (!String(p.etiqueta ?? '').trim()) mal('escribí la etiqueta.');
        break;
      case 'mover_etapa':
        if (!p.etapa_slug && !p.etapa_id) mal('elegí la etapa.');
        break;
      case 'webhook':
        if (!/^https?:\/\//.test(String(p.url ?? ''))) mal('pegá una URL válida (https://…).');
        break;
      case 'pregunta':
        if (!String(p.texto ?? '').trim()) mal('escribí la pregunta.');
        if (!(p.opciones ?? []).length) mal('necesita al menos un botón.');
        (p.opciones ?? []).forEach((o: any, j: number) => {
          if (!String(o.titulo ?? '').trim()) mal(`el botón ${j + 1} no tiene texto.`);
        });
        break;
      case 'router': {
        const conectadas = (p.ramas ?? []).filter((r: any) => r.siguiente);
        if (conectadas.length < 2) mal('conectá al menos 2 ramas (cada una a su mensaje).');
        else if (p.modo === 'pesos' && conectadas.reduce((a: number, r: any) => a + (Number(r.peso) || 0), 0) <= 0) mal('poné el % de cada rama.');
        break;
      }
      case 'condicion':
        if (!p.campo) mal('elegí qué revisar.');
        else if (['etiqueta', 'etapa', 'texto'].includes(p.campo) && !String(p.valor ?? '').trim()) mal('completá el valor.');
        else if (p.campo === 'campo' && !String(p.campo_nombre ?? '').trim()) mal('elegí qué campo revisar.');
        else if (p.campo === 'campo' && p.operador && p.operador !== 'tiene' && !String(p.valor ?? '').trim()) mal('completá el valor.');
        break;
    }
  }
  if (hayCirculoSinPausa(mapa, alcanzables)) {
    problemas.push({ nodo: null, texto: 'Hay un círculo sin ninguna espera: se repetiría sin parar. Poné un «Esperar» o una pregunta dentro del círculo.' });
  }
  return problemas;
}

export function validarFlujo(nodos: Paso[]): string[] {
  return validarFlujoDetallado(nodos).map((p) => p.texto);
}

const MANDAN_MENSAJE = new Set(['enviar_dm', 'entregar_recurso', 'enviar_recurso', 'enviar_calendario', 'pregunta']);

/**
 * Avisos (no errores: no frenan el guardado ni la activación) sobre cosas que
 * van a fallar en la práctica. Hoy: la ventana de 24 h de Instagram. Si un
 * "Esperar" de 23 h o más termina en un mensaje sin que el lead escriba en el
 * medio, ese mensaje no va a llegar (Instagram solo deja escribir 24 h desde
 * su último mensaje).
 */
export function advertenciasFlujo(nodos: Paso[]): Array<{ nodo: string | null; texto: string }> {
  const mapa = new Map(nodos.map((n) => [n.id, n]));
  const out: Array<{ nodo: string | null; texto: string }> = [];
  for (const p of nodos) {
    const conLimite = (p.tipo === 'esperar_respuesta' || p.tipo === 'pregunta') && Number(p.limite_min) > 0;
    const min = conLimite ? Number(p.limite_min) : Number(p.minutos) || 0;
    if ((p.tipo !== 'esperar' && !conLimite) || min < 23 * 60) continue;
    const pila: Array<string | null | undefined> = [conLimite ? p.siguiente_sin_respuesta : p.siguiente];
    const vistos = new Set<string>();
    let manda = false;
    while (pila.length && !manda) {
      const id = pila.pop();
      if (!id || vistos.has(id)) continue;
      vistos.add(id);
      const n = mapa.get(id);
      if (!n) continue;
      if (MANDAN_MENSAJE.has(n.tipo)) { manda = true; break; }
      if (n.tipo === 'esperar_respuesta') continue; // si el lead escribe, la ventana se reabre
      pila.push(...salidas(n));
    }
    if (manda) {
      out.push({
        nodo: p.id,
        texto: `${conLimite ? 'Si no responde en' : 'Esperar'} ${fmtMin(min)}: Instagram no deja escribirle pasadas 24 h desde su último mensaje, así que el mensaje que sigue no va a llegar. Usá hasta 23 horas, o hacé que te responda antes (con una pregunta con botón).`,
      });
    }
  }
  return out;
}

/**
 * Prueba de lo que se ve en la pizarra, SIN guardar: recorre los pasos en
 * memoria (no crea ni activa el automensaje, no manda nada, no toca leads).
 */
export async function simularPasos(cuentaId: string, pasos: any[], ctx: Omit<ContextoFlujo, 'simular'> = {}, nombre = 'Prueba') {
  const nodos = normalizarFlujo(pasos ?? []);
  const c: Corrida = {
    cuentaId, flujo: { id: null, nombre }, grafo: new Map(nodos.map((n) => [n.id, n])), ejecucionId: null,
    ctx: { ...ctx, simular: true },
    resultados: [], fallos: 0, envios: 0, pasosCorridos: 0, nodoActual: null,
  };
  const inicio = nodos.find((n) => n.tipo === 'inicio');
  c.nodoActual = inicio?.id ?? null;
  await correr(c, inicio?.id);
  return { resultados: c.resultados, estado: 'simulado' as const };
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

function rellenar(texto: string, lead: any, simular = false): string {
  const nombre = (lead?.nombre ? String(lead.nombre).split(' ')[0] : '') || lead?.ig_username
    || (simular ? '[nombre]' : '');
  const usuario = lead?.ig_username ? `@${lead.ig_username}` : (simular ? '[@usuario]' : '');
  return String(texto ?? '')
    .replace(/\{\{\s*nombre\s*\}\}/gi, nombre)
    .replace(/\{\{\s*usuario\s*\}\}/gi, usuario)
    .replace(/\{\{\s*campo\.([^}]+?)\s*\}\}/gi, (_m, k) => {
      const v = (lead?.campos ?? {})[String(k).trim()];
      return v !== undefined && v !== null && v !== '' ? String(v) : (simular ? `[${String(k).trim()}]` : '');
    })
    // Si el lead no tiene nombre, que no quede "¡Hola !"
    .replace(/ +([!?.,;:])/g, '$1');
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
    case 'sigue': return '¿Te sigue en Instagram?';
    case 'agendo': return '¿Agendó la llamada?';
    case 'campo': return p.operador === 'igual' ? `¿«${p.campo_nombre}» es «${p.valor}»?` : p.operador === 'contiene' ? `¿«${p.campo_nombre}» dice «${p.valor}»?` : `¿Ya tenemos «${p.campo_nombre}»?`;
    case 'horario': return `¿Es horario de atención (${p.desde ?? '09:00'}–${p.hasta ?? '18:00'})?`;
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
  /** Ramas «Y también» que quedan por correr cuando termina la actual. */
  cola?: string[];
}

interface Corrida {
  cuentaId: string;
  flujo: any;
  grafo: Map<string, Paso>;
  ejecucionId: number | null;
  ctx: ContextoFlujo;
  resultados: any[];
  fallos: number;
  envios: number;
  pasosCorridos: number;
  /** Paso que se está ejecutando (para pintar el recorrido en la pizarra). */
  nodoActual: string | null;
  /** Segundos de «escribiendo…» ya usados en esta corrida (tope para no colgar el servidor). */
  demora?: number;
}

const MAX_ENVIOS_POR_CORRIDA = 15; // tope anti-spam por ejecución
const ENVIAN = new Set(['enviar_dm', 'entregar_recurso', 'enviar_recurso', 'enviar_calendario', 'pregunta']);

function anotar(c: Corrida, paso: string, texto: string, extra: Record<string, unknown> = {}) {
  c.resultados.push({ paso, texto, nodo: c.nodoActual, ...extra });
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
    case 'sigue': return lead.ig_user_id ? (await sigueALaCuenta(c.cuentaId, String(lead.ig_user_id))) === true : false;
    case 'campo': {
      const v = String((lead.campos ?? {})[String(p.campo_nombre ?? '').trim()] ?? '');
      if (p.operador === 'igual') return normalizar(v) === normalizar(p.valor);
      if (p.operador === 'contiene') return !!String(p.valor ?? '').trim() && normalizar(v).includes(normalizar(p.valor));
      return v.trim() !== '';
    }
    case 'agendo': {
      if ((lead.etiquetas ?? []).includes('Reunión agendada')) return true;
      const ev = await queryOne(`SELECT 1 FROM eventos WHERE cuenta_id = $1 AND lead_id = $2 AND tipo = 'reunion_agendada' LIMIT 1`, [c.cuentaId, lead.id]);
      return Boolean(ev);
    }
    case 'horario': return await enHorario(c.cuentaId, p);
    default: return false;
  }
}

/** ¿Ahora es horario de atención? (zona horaria de la cuenta; días 0=domingo…6=sábado). */
export async function enHorario(cuentaId: string, p: Paso, ahora = new Date()): Promise<boolean> {
  const cta = await queryOne(`SELECT zona_horaria FROM cuentas WHERE id = $1`, [cuentaId]);
  const zona = cta?.zona_horaria || 'UTC';
  let partes: Record<string, string> = {};
  try {
    partes = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zona, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(ahora).map((x) => [x.type, x.value]));
  } catch { partes = { weekday: 'Mon', hour: String(ahora.getUTCHours()), minute: String(ahora.getUTCMinutes()) }; }
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(partes.weekday);
  const dias: number[] = Array.isArray(p.dias) && p.dias.length ? p.dias.map(Number) : [1, 2, 3, 4, 5];
  if (!dias.includes(dia)) return false;
  const min = (Number(partes.hour) % 24) * 60 + Number(partes.minute);
  const aMin = (h: string, def: number) => { const m = String(h ?? '').match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : def; };
  const desde = aMin(p.desde, 9 * 60); const hasta = aMin(p.hasta, 18 * 60);
  return desde <= hasta ? min >= desde && min < hasta : min >= desde || min < hasta;
}

/**
 * ¿Esta persona sigue a la cuenta? (is_user_follow_business). Instagram solo lo
 * responde si la persona ya le escribió o comentó. Con token de Facebook hace
 * falta el token de la página vinculada: se busca y se reintenta.
 * Devuelve null si no se pudo saber.
 */
export async function sigueALaCuenta(cuentaId: string, igsid: string): Promise<boolean | null> {
  const integ = await integracionInstagram(cuentaId);
  const { base, token, igId } = credsUsables(integ?.credenciales ?? {});
  if (!token) return null;
  const consultar = async (t: string) => {
    const r = await fetch(`${base}/${encodeURIComponent(igsid)}?fields=is_user_follow_business&access_token=${encodeURIComponent(t)}`,
      { signal: AbortSignal.timeout(8000) });
    const d: any = await r.json().catch(() => ({}));
    return r.ok && !d.error && typeof d.is_user_follow_business === 'boolean' ? d.is_user_follow_business as boolean : null;
  };
  try {
    const directo = await consultar(token);
    if (directo !== null) return directo;
    if (!base.includes('facebook.com') || !igId) return null;
    const r = await fetch(`${base}/me/accounts?fields=access_token,instagram_business_account&limit=100&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(8000) });
    const d: any = await r.json().catch(() => ({}));
    const pagina = (d.data ?? []).find((p: any) => String(p.instagram_business_account?.id ?? '') === String(igId));
    return pagina?.access_token ? await consultar(pagina.access_token) : null;
  } catch { return null; }
}

/** Manda un mensaje dentro de una corrida, lo guarda en el Chat y lo anota. */
async function enviar(
  c: Corrida, mensaje: Record<string, unknown>, descripcion: string,
  cuerpo: string, recursoId: string | null = null,
): Promise<boolean> {
  if (c.ctx.simular) {
    // `cuerpo`: el texto tal cual le llegaría (para mostrar la prueba como un chat).
    anotar(c, 'enviar', `${descripcion} (prueba: no se manda)`, { cuerpo });
    return true;
  }
  // Instagram solo deja escribir a quien comentó con UNA respuesta privada
  // al comentario; los siguientes mensajes van cuando el lead contesta.
  const destino: Destino = c.ctx.commentId && c.envios === 0
    ? { commentId: c.ctx.commentId }
    : { igId: c.ctx.destinatarioIgId };
  // «Escribiendo…» y una pausa natural antes de cada DM (no en la respuesta al comentario).
  if (!c.ctx.sinInstagram && destino.igId) {
    const paso = c.nodoActual ? c.grafo.get(c.nodoActual) : undefined;
    const seg = Math.max(0, Math.min(8, Number(paso?.demora_seg ?? 2)));
    const usar = Math.min(seg, 12 - (c.demora ?? 0));
    if (usar > 0 && await escribiendo(c.cuentaId, destino.igId)) {
      await new Promise((r) => setTimeout(r, usar * 1000));
      c.demora = (c.demora ?? 0) + usar;
    }
  }
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
  if (destino?.startsWith('campo:')) {
    const nombre = destino.slice(6).trim().slice(0, 40);
    await pool.query(`UPDATE leads SET campos = campos || jsonb_build_object($2::text, $3::text) WHERE id = $1`,
      [c.ctx.leadId, nombre, texto.trim().slice(0, 500)]);
    anotar(c, 'respuesta', `✍️ Respondió «${corto(texto)}» → guardado en «${nombre}»`);
    return;
  }
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
      const texto = rellenar(String(p.texto ?? p.recurso ?? ''), lead, c.ctx.simular).slice(0, MAX_TEXTO_DM);
      if (!texto.trim()) { anotar(c, p.tipo, '⚠ Mensaje vacío: lo salteo'); return; }
      await enviar(c, { text: texto }, `💬 «${corto(texto)}»`, texto);
      return;
    }
    case 'enviar_recurso': {
      if (!p.recurso_id) { anotar(c, p.tipo, '⚠ Falta elegir qué audio o recurso mandar: lo salteo'); return; }
      const rec = await recursoPorId(c.cuentaId, p.recurso_id);
      if (!rec) { anotar(c, p.tipo, '⚠ El audio/recurso elegido ya no existe (¿lo borraron?): lo salteo'); return; }
      const { mensaje, descripcion, cuerpo } = mensajeDeRecurso(rec);
      const salio = await enviar(c, mensaje, descripcion, cuerpo, rec.id);
      if (salio && !c.ctx.simular && c.ctx.leadId && esLinkDeAgenda(rec)) await marcarAgendaEnviada(c.cuentaId, c.ctx.leadId);
      return;
    }
    case 'enviar_calendario': {
      const url = String(p.url ?? '').trim();
      if (!url) { anotar(c, p.tipo, '⚠ Falta el link del calendario: lo salteo'); return; }
      const lead = await cargarLead(c.cuentaId, leadId);
      const intro = rellenar(String(p.texto ?? ''), lead, c.ctx.simular).trim();
      const texto = (intro ? `${intro}\n${url}` : url).slice(0, MAX_TEXTO_DM);
      const salio = await enviar(c, { text: texto }, `📅 Calendario «${corto(texto)}»`, texto);
      if (salio && !c.ctx.simular && leadId) await marcarAgendaEnviada(c.cuentaId, leadId);
      return;
    }
    case 'responder_comentario': {
      const lead = await cargarLead(c.cuentaId, leadId);
      // Varias versiones: se elige una al azar para no repetir siempre lo mismo (anti-spam).
      const versiones = [p.texto, ...(Array.isArray(p.variantes) ? p.variantes : [])].map((x) => String(x ?? '').trim()).filter(Boolean);
      const texto = rellenar(versiones.length ? versiones[Math.floor(Math.random() * versiones.length)] : '', lead, c.ctx.simular);
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
      let respuesta: any = null;
      const r = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          evento: 'flujo', flujo: c.flujo.nombre,
          lead: lead && {
            id: lead.id, nombre: lead.nombre, ig_username: lead.ig_username, email: lead.email,
            telefono: lead.telefono, etiquetas: lead.etiquetas, etapa: lead.etapa_nombre, campos: lead.campos ?? {},
          },
        }),
        signal: AbortSignal.timeout(10_000),
      }).then(async (x) => { respuesta = await x.json().catch(() => null); return x.ok; }).catch(() => false);
      if (!r) c.fallos++;
      // Usar lo que responde la otra app: guardarlo en campos del lead.
      const guardados: string[] = [];
      if (r && respuesta && leadId && Array.isArray(p.guardar)) {
        for (const g of p.guardar.slice(0, 10)) {
          const valor = String(g?.ruta ?? '').split('.').filter(Boolean).reduce((o: any, k: string) => (o == null ? o : o[k]), respuesta);
          const campo = String(g?.campo ?? '').trim().slice(0, 40);
          if (!campo || valor === undefined || valor === null || typeof valor === 'object') continue;
          await pool.query(`UPDATE leads SET campos = campos || jsonb_build_object($2::text, $3::text) WHERE id = $1`, [leadId, campo, String(valor).slice(0, 500)]);
          guardados.push(campo);
        }
      }
      anotar(c, p.tipo, r ? `🔗 Aviso enviado a ${corto(url, 40)} ✓${guardados.length ? ` · guardé ${guardados.join(', ')}` : ''}` : `🔗 ${corto(url, 40)} no respondió bien`, { ok: r });
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
            resultado = $5::jsonb, contexto = $6::jsonb, actualizado_en = now()
      WHERE id = $1`,
    [c.ejecucionId, tipo, nodoId, reanudarEn, JSON.stringify(c.resultados), JSON.stringify(contextoPersistible(c.ctx))]);
}

/** Recorre el grafo desde un paso hasta terminar o pausar. */
async function correr(c: Corrida, desde: string | null | undefined): Promise<'fin' | 'pausa'> {
  let id: string | null = desde ?? null;
  for (;;) {
    // Terminó una rama: sigue la próxima «Y también» pendiente.
    if (!id) {
      id = c.ctx.cola?.shift() ?? null;
      if (!id) break;
      anotar(c, 'tambien', '➕ Y también…');
    }
    if (++c.pasosCorridos > MAX_PASOS_POR_CORRIDA) {
      anotar(c, 'limite', '⚠ El flujo es demasiado largo: se cortó por seguridad.');
      return 'fin';
    }
    const p: Paso | undefined = c.grafo.get(id);
    if (!p) {
      anotar(c, 'fin', '⚠ Una flecha apunta a un paso que ya no existe: terminó aquí.');
      return 'fin';
    }
    c.nodoActual = p.id;
    if (Array.isArray(p.tambien) && p.tambien.length) c.ctx.cola = [...p.tambien, ...(c.ctx.cola ?? [])];
    if (ENVIAN.has(p.tipo) && c.envios >= MAX_ENVIOS_POR_CORRIDA) {
      anotar(c, 'limite', `⚠ Ya se mandaron ${MAX_ENVIOS_POR_CORRIDA} mensajes seguidos: corté para no hacer spam.`);
      return 'fin';
    }
    try {
      if (p.tipo === 'inicio') { id = p.siguiente ?? null; continue; }
      if (p.tipo === 'router') {
        const forzada = c.ctx.respuestas?.[p.id];
        const rama = (forzada && (p.ramas ?? []).find((r: any) => r.id === forzada && r.siguiente)) || elegirRama(p);
        const i = (p.ramas ?? []).indexOf(rama);
        anotar(c, 'router', rama ? `🎲 Router → ${rama.nombre || `Rama ${i + 1}`}` : '🎲 Router sin ramas conectadas: termina acá');
        id = rama?.siguiente ?? null;
        continue;
      }
      if (p.tipo === 'condicion') {
        const forzada = c.ctx.respuestas?.[p.id];
        const si = forzada ? forzada === 'si' : (c.ctx.simular && !c.ctx.leadId ? true : await evaluarCondicion(c, p));
        anotar(c, 'condicion', `🔀 ${describirCondicion(p)} → ${si ? 'Sí' : 'No'}${c.ctx.simular ? ' (prueba)' : ''}`);
        id = (si ? p.siguiente_si : p.siguiente_no) ?? null;
        continue;
      }
      if (p.tipo === 'pregunta') {
        const opciones = (p.opciones ?? []).slice(0, MAX_BOTONES);
        const lead = await cargarLead(c.cuentaId, c.ctx.leadId);
        const texto = rellenar(String(p.texto ?? ''), lead, c.ctx.simular).slice(0, MAX_TEXTO_DM);
        const salio = await enviar(c, {
          text: texto,
          quick_replies: opciones.map((o: any) => ({
            content_type: 'text',
            title: String(o.titulo).slice(0, MAX_TITULO_BOTON),
            payload: `fx:${c.ejecucionId ?? 0}:${p.id}:${o.id}`,
          })),
        }, `❓ «${corto(texto)}» con ${opciones.length} botón${opciones.length === 1 ? '' : 'es'}`,
        `${texto}\n${opciones.map((o: any) => `[${o.titulo}]`).join(' ')}`);
        if (!opciones.length) return 'fin';
        if (!salio) {
          anotar(c, 'pausa', '⚠ La pregunta no llegó al lead, así que el flujo se detiene aquí (no espera un botón que nunca vio).');
          return 'fin';
        }
        if (c.ctx.simular) {
          const elegida = opciones.find((o: any) => o.id === c.ctx.respuestas?.[p.id]) ?? opciones[0];
          anotar(c, 'respuesta', `👉 (prueba) el lead toca «${elegida.titulo}»`);
          id = elegida.siguiente ?? null;
          continue;
        }
        const lim = Number(p.limite_min) || 0;
        await pausar(c, p.id, 'respuesta', lim > 0 ? new Date(Date.now() + lim * 60_000) : null,
          lim > 0 ? `⏸ Esperando a que toque un botón (si no, en ${fmtMin(lim)} sigue por «No respondió»)` : '⏸ Esperando a que el lead toque un botón');
        return 'pausa';
      }
      if (p.tipo === 'esperar_respuesta') {
        if (c.ctx.simular && c.ctx.respuestas?.[p.id] === 'sin' && p.limite_min) {
          anotar(c, 'esperar', `⏰ (prueba) no respondió en ${fmtMin(Number(p.limite_min))}`);
          id = p.siguiente_sin_respuesta ?? null;
          continue;
        }
        if (c.ctx.simular) {
          await guardarRespuesta(c, p, p.guardar_en === 'email' ? 'ejemplo@correo.com' : 'respuesta de ejemplo');
          id = p.siguiente ?? null;
          continue;
        }
        const lim = Number(p.limite_min) || 0;
        await pausar(c, p.id, 'respuesta', lim > 0 ? new Date(Date.now() + lim * 60_000) : null,
          lim > 0 ? `⏸ Esperando su respuesta (si no responde en ${fmtMin(lim)}, sigue por «No respondió»)` : '⏸ Esperando la respuesta del lead');
        return 'pausa';
      }
      if (p.tipo === 'esperar') {
        const min = Math.max(0, Math.round(Number(p.minutos) || 0));
        if (c.ctx.simular || min === 0) {
          anotar(c, 'esperar', `⏳ Esperar ${fmtMin(min)}${c.ctx.simular ? ' (prueba: sigo de inmediato)' : ''}`);
          id = p.siguiente ?? null;
          continue;
        }
        await pausar(c, p.id, 'tiempo', new Date(Date.now() + min * 60_000), `⏳ Esperando ${fmtMin(min)}`);
        return 'pausa';
      }
      await accion(c, p);
      id = p.siguiente ?? null;
    } catch (err: any) {
      c.fallos++;
      anotar(c, p.tipo, `⚠ Error: ${String(err?.message ?? err)}`, { ok: false });
      id = p.siguiente ?? null;
    }
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
    cola: ctx.cola ?? [],
  };
}

/**
 * Arranca un flujo sobre un lead. En modo simular (prueba en seco) recorre
 * el árbol entero sin mandar nada ni tocar la base.
 */
export async function ejecutarFlujo(cuentaId: string, flujoId: string, ctx: ContextoFlujo) {
  const flujo = await queryOne(`SELECT * FROM flujos WHERE cuenta_id=$1 AND id=$2`, [cuentaId, flujoId]);
  if (!flujo) return null;
  const nodos = normalizarFlujo(flujo.pasos ?? []);
  const c: Corrida = {
    cuentaId, flujo, grafo: new Map(nodos.map((n) => [n.id, n])), ejecucionId: null, ctx,
    resultados: [], fallos: 0, envios: 0, pasosCorridos: 0, nodoActual: null,
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
  const inicio = nodos.find((n) => n.tipo === 'inicio');
  c.nodoActual = inicio?.id ?? null;
  const fin = await correr(c, inicio?.id);
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

/** Reanuda una ejecución ya reclamada desde el paso donde quedó. */
async function reanudar(fila: any, entrada: Entrada) {
  const flujo = await queryOne(`SELECT * FROM flujos WHERE id = $1`, [fila.flujo_id]);
  const ctxGuardado = fila.contexto ?? {};
  const nodos = normalizarFlujo(flujo?.pasos ?? []);
  const c: Corrida = {
    cuentaId: fila.cuenta_id, flujo: flujo ?? { id: fila.flujo_id, nombre: '' },
    grafo: new Map(nodos.map((n) => [n.id, n])), ejecucionId: fila.id,
    ctx: {
      leadId: fila.lead_id ?? undefined,
      destinatarioIgId: ctxGuardado.destinatarioIgId ?? undefined,
      texto: entrada.tipo === 'respuesta' ? entrada.texto : (ctxGuardado.texto ?? undefined),
      sinInstagram: !!ctxGuardado.sinInstagram,
      cola: Array.isArray(ctxGuardado.cola) ? ctxGuardado.cola : [],
    },
    resultados: Array.isArray(fila.resultado) ? fila.resultado : [],
    fallos: 0, envios: 1, pasosCorridos: 0, nodoActual: fila.nodo_id ?? null,
  };
  const nodo = flujo ? c.grafo.get(fila.nodo_id) : undefined;
  if (!nodo) {
    anotar(c, 'reanudar', '⚠ El flujo cambió y ese paso ya no existe: terminó aquí.');
    return cerrar(c, 'fin');
  }
  let siguiente: string | null = null;
  if (entrada.tipo === 'opcion' && nodo.tipo === 'pregunta') {
    const op = (nodo.opciones ?? []).find((o: any) => o.id === entrada.opcionId);
    if (!op) {
      anotar(c, 'respuesta', '⚠ Ese botón ya no existe en el flujo: terminó aquí.');
      return cerrar(c, 'fin');
    }
    anotar(c, 'respuesta', `👉 El lead tocó «${op.titulo}»`);
    siguiente = op.siguiente ?? null;
  } else if (entrada.tipo === 'respuesta' && nodo.tipo === 'esperar_respuesta') {
    await guardarRespuesta(c, nodo, entrada.texto);
    siguiente = nodo.siguiente ?? null;
  } else if (entrada.tipo === 'tiempo' && (nodo.tipo === 'esperar_respuesta' || nodo.tipo === 'pregunta')) {
    anotar(c, 'esperar', `⏰ No respondió en ${fmtMin(Number(nodo.limite_min) || 0)}: sigo con el seguimiento`);
    siguiente = nodo.siguiente_sin_respuesta ?? null;
  } else if (entrada.tipo === 'tiempo' && nodo.tipo === 'esperar') {
    anotar(c, 'esperar', '⏰ Terminó la espera, sigo');
    siguiente = nodo.siguiente ?? null;
  } else {
    anotar(c, 'reanudar', '⚠ El paso cambió de tipo: terminó aquí.');
    return cerrar(c, 'fin');
  }
  const fin = await correr(c, siguiente);
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
  const nodo = normalizarFlujo(flujo?.pasos ?? []).find((n) => n.id === fila.nodo_id) ?? null;
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
         WHERE estado = 'esperando' AND esperando IN ('tiempo', 'respuesta') AND reanudar_en <= now()
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

