// Modelo de la pizarra de automensajes (sin la librería del lienzo): tipos,
// pasos disponibles, disparadores y funciones puras. Así la LISTA de
// automensajes no descarga React Flow; el lienzo se baja al abrir uno.

export type Paso = { id: string; tipo: string; x?: number; y?: number; siguiente?: string | null; [k: string]: any };
export interface Ctx { generarAgenda?: (nodoId: string) => void; recursos: any[]; etapas: any[]; etiquetas: string[]; contenidos: any[]; campos?: string[]; recargarRecursos?: () => Promise<any[]> }

export const uid = () => Math.random().toString(36).slice(2, 10);
export const MAX_TEXTO = 1000;
export const MAX_BOTONES = 13;
export const MAX_TITULO = 20;

export const NODOS: Record<string, { etiqueta: string; icono: string; color: string; grupo: 'Mensajes' | 'Lógica' | 'El lead'; ayuda: string }> = {
  enviar_dm: { etiqueta: 'Mandar mensaje', icono: '💬', color: '#2a78d6', grupo: 'Mensajes', ayuda: 'Un mensaje de texto por DM' },
  enviar_recurso: { etiqueta: 'Mandar audio o recurso', icono: '🎙️', color: '#0d9488', grupo: 'Mensajes', ayuda: 'Le llega como nota de voz / archivo' },
  enviar_calendario: { etiqueta: 'Mandar calendario', icono: '📅', color: '#dc2626', grupo: 'Mensajes', ayuda: 'Manda tu link de agenda y marca al lead en rojo «Calendario enviado»' },
  responder_comentario: { etiqueta: 'Responder el comentario', icono: '💭', color: '#2a78d6', grupo: 'Mensajes', ayuda: 'Respuesta pública debajo del reel' },
  pregunta: { etiqueta: 'Pregunta con botones', icono: '❓', color: '#e76f51', grupo: 'Lógica', ayuda: 'Cada botón sale por su propia flecha' },
  condicion: { etiqueta: 'Condición (sí / no)', icono: '🔀', color: '#264653', grupo: 'Lógica', ayuda: 'Una flecha si se cumple y otra si no' },
  router: { etiqueta: 'Router (repartir al azar)', icono: '🎲', color: '#5c6b7a', grupo: 'Lógica', ayuda: 'Manda a cada uno por una rama distinta, al azar o con el % que elijas' },
  esperar_agenda: { etiqueta: 'Esperar a que agende', icono: '📅', color: '#16a34a', grupo: 'Lógica', ayuda: 'Pausa hasta que agende en tu calendario (y si no, sigue por el seguimiento)' },
  esperar_respuesta: { etiqueta: 'Esperar su respuesta', icono: '✍️', color: '#8d99ae', grupo: 'Lógica', ayuda: 'Pausa hasta que escriba (y guarda lo que dice)' },
  esperar: { etiqueta: 'Esperar un tiempo', icono: '⏳', color: '#8d99ae', grupo: 'Lógica', ayuda: 'Sigue solo después de minutos, horas o días' },
  etiquetar: { etiqueta: 'Poner etiqueta', icono: '🏷️', color: '#f4a261', grupo: 'El lead', ayuda: 'Para filtrarlo después' },
  quitar_etiqueta: { etiqueta: 'Quitar etiqueta', icono: '🏷️', color: '#f4a261', grupo: 'El lead', ayuda: '' },
  sumar: { etiqueta: 'Sumar puntos', icono: '➕', color: '#0d9488', grupo: 'El lead', ayuda: 'Lead scoring: suma (o resta) puntos al lead' },
  mover_etapa: { etiqueta: 'Mover de etapa', icono: '➡️', color: '#2a9d8f', grupo: 'El lead', ayuda: 'Lo mueve en tu pipeline' },
  asignar: { etiqueta: 'Asignar al equipo', icono: '👤', color: '#2a9d8f', grupo: 'El lead', ayuda: 'Al setter o closer con menos carga' },
  notificar: { etiqueta: 'Avisar al equipo', icono: '🔔', color: '#e9c46a', grupo: 'El lead', ayuda: 'Lo marca en el Chat para que lo atiendan' },
  webhook: { etiqueta: 'Avisar a otra app', icono: '🔗', color: '#8d99ae', grupo: 'El lead', ayuda: 'Zapier, Make, tu email… (webhook)' },
};
export const GRUPOS = ['Mensajes', 'Lógica', 'El lead'] as const;

export const DISPAROS: Array<{ v: string; t: string; icono: string; palabra: boolean; ph: string; ayuda: string }> = [
  { v: 'comentario', t: 'Comenta en un reel, post o vivo', icono: '💭', palabra: true, ph: 'ej. GUIA', ayuda: 'Varias palabras separadas por coma. Vacío = cualquier comentario.' },
  { v: 'dm', t: 'Te escribe por DM', icono: '✉️', palabra: true, ph: 'ej. INFO', ayuda: 'Vacío = cualquier mensaje (respuesta automática de bienvenida).' },
  { v: 'historia', t: 'Responde a una historia', icono: '⭕', palabra: true, ph: 'opcional', ayuda: 'Vacío = cualquier respuesta a tus historias.' },
  { v: 'mencion', t: 'Te menciona en su historia', icono: '@', palabra: false, ph: '', ayuda: 'Cada vez que alguien te etiqueta en una historia.' },
  { v: 'reaccion', t: 'Reacciona a un mensaje', icono: '❤️', palabra: false, ph: '', ayuda: 'Cuando reacciona con un emoji a un mensaje tuyo.' },
  { v: 'boton', t: 'Toca un botón', icono: '👉', palabra: true, ph: 'texto o código del botón', ayuda: 'Botones de Instagram (menú, rompehielos).' },
  { v: 'anuncio', t: 'Entra por un link de DM o un anuncio', icono: '🔗', palabra: true, ph: 'ej. GUIA (el ref del link)', ayuda: 'Tu link: ig.me/m/TU_USUARIO?ref=GUIA — ponelo en la bio, historias o anuncios. Cada ref dispara su automensaje.' },
  { v: 'por_defecto', t: 'Respuesta por defecto', icono: '💤', palabra: false, ph: '', ayuda: 'Cuando escribe algo que no coincide con ningún otro automensaje (máx. 1 vez cada 24 h por persona).' },
];

// ---------------------------------------------------------------------
// Grafo: utilidades (mismo modelo que el motor del servidor)
// ---------------------------------------------------------------------

/** Salidas de un paso: [id de la salida, paso al que apunta]. */
export function salidas(n: Paso): Array<[string, string | null | undefined]> {
  const sin: Array<[string, string]> = (n.tipo === 'pregunta' || n.tipo === 'esperar_respuesta' || n.tipo === 'esperar_agenda') && n.limite_min ? [['sin', n.siguiente_sin_respuesta]] : [];
  if (n.tipo === 'pregunta') return [...(n.opciones ?? []).map((o: any) => [`op:${o.id}`, o.siguiente] as [string, string]), ...sin];
  if (n.tipo === 'esperar_respuesta' || n.tipo === 'esperar_agenda') {
    return [['out', n.siguiente], ...sin, ...(Array.isArray(n.tambien) ? n.tambien : []).map((d: string) => [`y:${d}`, d] as [string, string])];
  }
  if (n.tipo === 'condicion') return [['si', n.siguiente_si], ['no', n.siguiente_no]];
  const extra: Array<[string, string]> = (Array.isArray(n.tambien) ? n.tambien : []).map((d: string) => [`y:${d}`, d]);
  if (n.tipo === 'router') return [...(n.ramas ?? []).map((r: any) => [`ra:${r.id}`, r.siguiente] as [string, string]), ...extra];
  return [['out', n.siguiente], ...extra];
}

export function conectar(nodos: Paso[], origen: string, salida: string, destino: string | null): Paso[] {
  return nodos.map((n) => {
    if (n.id !== origen) return n;
    if (salida.startsWith('op:')) {
      const opId = salida.slice(3);
      return { ...n, opciones: (n.opciones ?? []).map((o: any) => (o.id === opId ? { ...o, siguiente: destino } : o)) };
    }
    if (salida.startsWith('y:')) {
      // «Y también»: quitar esa flecha extra (o cambiar su destino).
      const viejo = salida.slice(2);
      const lista = (n.tambien ?? []).filter((x: string) => x !== viejo);
      return { ...n, tambien: destino ? [...lista, destino] : lista };
    }
    if (salida === 'mas') {
      // Agregar otra flecha desde el mismo punto (hace esto Y esto).
      return { ...n, tambien: destino && !(n.tambien ?? []).includes(destino) ? [...(n.tambien ?? []), destino] : (n.tambien ?? []) };
    }
    if (salida.startsWith('ra:')) {
      const rId = salida.slice(3);
      return { ...n, ramas: (n.ramas ?? []).map((r: any) => (r.id === rId ? { ...r, siguiente: destino } : r)) };
    }
    if (salida === 'sin') return { ...n, siguiente_sin_respuesta: destino };
    if (salida === 'si') return { ...n, siguiente_si: destino };
    if (salida === 'no') return { ...n, siguiente_no: destino };
    return { ...n, siguiente: destino };
  });
}

export function quitarNodo(nodos: Paso[], id: string): Paso[] {
  const limpiar = (v: any) => (v === id ? null : v);
  return nodos.filter((n) => n.id !== id).map((n) => ({
    ...n,
    ...('siguiente' in n ? { siguiente: limpiar(n.siguiente) } : {}),
    ...(n.tipo === 'condicion' ? { siguiente_si: limpiar(n.siguiente_si), siguiente_no: limpiar(n.siguiente_no) } : {}),
    ...('siguiente_sin_respuesta' in n ? { siguiente_sin_respuesta: limpiar(n.siguiente_sin_respuesta) } : {}),
    ...(n.tipo === 'pregunta' ? { opciones: (n.opciones ?? []).map((o: any) => ({ ...o, siguiente: limpiar(o.siguiente) })) } : {}),
    ...(n.tipo === 'router' ? { ramas: (n.ramas ?? []).map((r: any) => ({ ...r, siguiente: limpiar(r.siguiente) })) } : {}),
    ...(Array.isArray(n.tambien) ? { tambien: n.tambien.filter((x: string) => x !== id) } : {}),
  }));
}

/** Borra un paso y, si tenía una sola entrada y una sola salida, une lo de antes con lo de después (como n8n). */
export function quitarYUnir(nodos: Paso[], id: string): Paso[] {
  const borrado = nodos.find((n) => n.id === id);
  if (!borrado || borrado.tipo === 'inicio') return nodos;
  const sale = salidas(borrado).map(([, d]) => d).filter((d): d is string => !!d && d !== id);
  const entradas: Array<[string, string]> = [];
  for (const n of nodos) for (const [salida, destino] of salidas(n)) if (destino === id && n.id !== id) entradas.push([n.id, salida]);
  let r = quitarNodo(nodos, id);
  if (entradas.length === 1 && sale.length === 1 && borrado.tipo !== 'pregunta' && borrado.tipo !== 'condicion' && borrado.tipo !== 'router') {
    r = conectar(r, entradas[0][0], entradas[0][1], sale[0]);
  }
  return r;
}

export function alcanzables(nodos: Paso[]): Set<string> {
  const mapa = new Map(nodos.map((n) => [n.id, n]));
  const vistos = new Set<string>();
  const pila = ['inicio'];
  while (pila.length) {
    const id = pila.pop()!;
    if (vistos.has(id) || !mapa.has(id)) continue;
    vistos.add(id);
    for (const [, s] of salidas(mapa.get(id)!)) if (s) pila.push(s);
  }
  return vistos;
}

export function nuevoPaso(tipo: string, datos: Record<string, any> = {}): Paso {
  const base: Paso = { id: uid(), tipo, ...datos };
  if (tipo === 'pregunta' && !base.opciones) base.opciones = [{ id: uid(), titulo: '', siguiente: null }];
  if (tipo === 'router' && !base.ramas) {
    base.modo = 'azar';
    base.ramas = [{ id: uid(), nombre: 'A', peso: 50, siguiente: null }, { id: uid(), nombre: 'B', peso: 50, siguiente: null }];
  }
  // Esperar su respuesta: viene con seguimiento (2 h) ya activado.
  if ((tipo === 'esperar_respuesta' || tipo === 'esperar_agenda') && base.limite_min === undefined) { base.limite_min = 120; base.siguiente_sin_respuesta = null; }
  if (tipo === 'condicion') { base.campo = base.campo ?? 'etiqueta'; base.siguiente_si = null; base.siguiente_no = null; }
  else if (tipo !== 'pregunta' && tipo !== 'router' && !('siguiente' in base)) base.siguiente = null;
  return base;
}

/** Plantillas escritas como árbol → grafo con posiciones. */
export function arbolAGrafo(pasos: any[]): Paso[] {
  const nodos: Paso[] = [];
  const secuencia = (lista: any[], continuacion: string | null): string | null => {
    const validos = (lista ?? []).filter((p) => p && p.tipo);
    const ids = validos.map((p) => String(p.id ?? uid()));
    validos.forEach((p, i) => {
      const despues = i + 1 < validos.length ? ids[i + 1] : continuacion;
      const { si, no, opciones, sin, pasos: _p, ...resto } = p;
      const n: Paso = { ...resto, id: ids[i], tipo: p.tipo };
      if (p.tipo === 'pregunta') {
        n.opciones = (opciones ?? []).map((o: any) => ({ id: String(o.id ?? uid()), titulo: o.titulo ?? '', siguiente: secuencia(o.pasos ?? [], despues) }));
      } else if (p.tipo === 'condicion') {
        n.siguiente_si = secuencia(si ?? [], despues);
        n.siguiente_no = secuencia(no ?? [], despues);
      } else n.siguiente = despues;
      // «Si no responde en X»: su propio camino (termina ahí).
      if ((p.tipo === 'pregunta' || p.tipo === 'esperar_respuesta' || p.tipo === 'esperar_agenda') && Number(p.limite_min) > 0) {
        n.siguiente_sin_respuesta = secuencia(sin ?? [], null);
      }
      nodos.push(n);
    });
    return ids[0] ?? continuacion;
  };
  const inicio: Paso = { id: 'inicio', tipo: 'inicio', siguiente: null };
  inicio.siguiente = secuencia(pasos, null);
  return ordenar([inicio, ...nodos]);
}

/** Acomoda en columnas de izquierda a derecha según la distancia al disparador. */
export function ordenar(nodos: Paso[]): Paso[] {
  const mapa = new Map(nodos.map((n) => [n.id, n]));
  const nivel = new Map<string, number>([['inicio', 0]]);
  // Orden en que se descubre cada paso siguiendo las salidas en orden (botón 1, botón 2…;
  // «Si responde» antes que «Si no responde»): así cada columna respeta ese orden y las flechas no se cruzan.
  const descubierto = new Map<string, number>([['inicio', 0]]);
  const cola = ['inicio'];
  while (cola.length) {
    const id = cola.shift()!;
    const n = mapa.get(id);
    if (!n) continue;
    for (const [, s] of salidas(n)) {
      if (s && mapa.has(s) && !nivel.has(s)) { nivel.set(s, nivel.get(id)! + 1); descubierto.set(s, descubierto.size); cola.push(s); }
    }
  }
  const columnas = new Map<number, Paso[]>();
  const sueltos: Paso[] = [];
  const enOrden = [...nodos].sort((a, b) => (descubierto.get(a.id) ?? Infinity) - (descubierto.get(b.id) ?? Infinity));
  for (const n of enOrden) {
    const nv = nivel.get(n.id);
    if (nv === undefined) sueltos.push(n);
    else { if (!columnas.has(nv)) columnas.set(nv, []); columnas.get(nv)!.push(n); }
  }
  const pos = new Map<string, { x: number; y: number }>();
  let maxY = 0;
  for (const [nv, col] of columnas) {
    col.forEach((n, i) => {
      const y = Math.round((i - (col.length - 1) / 2) * 210);
      pos.set(n.id, { x: nv * 340, y });
      maxY = Math.max(maxY, y);
    });
  }
  sueltos.forEach((n, i) => pos.set(n.id, { x: i * 340, y: maxY + 380 }));
  return nodos.map((n) => ({ ...n, ...pos.get(n.id) }));
}

/** Busca un lugar donde el paso nuevo no tape a otro (baja hasta encontrar hueco). */
export function lugarLibre(nodos: Paso[], p: { x: number; y: number }) {
  let q = { x: Math.round(p.x), y: Math.round(p.y) };
  for (let i = 0; i < 40; i++) {
    const choca = nodos.some((n) => Math.abs((n.x ?? 0) - q.x) < 280 && Math.abs((n.y ?? 0) - q.y) < 150);
    if (!choca) return q;
    q = { x: q.x, y: q.y + 160 };
  }
  return q;
}

export function fmtMin(min: number) {
  if (!min) return '—';
  if (min % 1440 === 0) return `${min / 1440} día${min === 1440 ? '' : 's'}`;
  if (min % 60 === 0) return `${min / 60} h`;
  return `${min} min`;
}

/** Contadores que el CRM lleva solo de cada lead (para condiciones y etiquetas dinámicas). */
export const CONTADORES: Array<{ v: string; t: string }> = [
  { v: 'recursos', t: 'Recursos que recibió' },
  { v: 'reels', t: 'Publicaciones distintas que comentó' },
  { v: 'comentarios', t: 'Comentarios que hizo' },
  { v: 'automensajes', t: 'Automensajes distintos que recorrió' },
  { v: 'mensajes', t: 'Mensajes que te escribió' },
  { v: 'calendarios', t: 'Veces que le mandaste el calendario' },
  { v: 'reuniones', t: 'Reuniones que agendó' },
  { v: 'puntos', t: 'Puntos (lead scoring)' },
  { v: 'dias', t: 'Días desde que llegó' },
];
export const OPERADORES: Record<string, string> = { mayor_igual: '≥', menor_igual: '≤', igual: '=', mayor: '>', menor: '<' };

export function describirCondicion(p: Paso) {
  switch (p.campo) {
    case 'etiqueta': return `¿Tiene la etiqueta «${p.valor || '…'}»?`;
    case 'etapa': return `¿Está en la etapa «${p.valor || '…'}»?`;
    case 'email': return '¿Ya tenemos su email?';
    case 'telefono': return '¿Ya tenemos su teléfono?';
    case 'texto': return `¿Su mensaje dice «${p.valor || '…'}»?`;
    case 'sigue': return '¿Te sigue en Instagram?';
    case 'agendo': return '¿Agendó la llamada?';
    case 'contador': return `¿${CONTADORES.find((x) => x.v === p.contador)?.t ?? 'Contador'} ${OPERADORES[p.operador ?? 'mayor_igual'] ?? '≥'} ${Number(p.valor) || 0}?`;
    case 'campo': return OPERADORES[p.operador] ? `¿«${p.campo_nombre || '…'}» ${OPERADORES[p.operador]} ${Number(p.valor) || 0}?` : p.operador === 'igual' ? `¿«${p.campo_nombre || '…'}» es «${p.valor || '…'}»?` : p.operador === 'contiene' ? `¿«${p.campo_nombre || '…'}» dice «${p.valor || '…'}»?` : `¿Ya tenemos «${p.campo_nombre || '…'}»?`;
    case 'horario': return `¿Es horario de atención (${p.desde ?? '09:00'}–${p.hasta ?? '18:00'})?`;
    default: return '¿Se cumple?';
  }
}

/** {{nombre}} → [Nombre] para leerlo como persona (en la pizarra y la prueba). */
export function conVariables(t: string) {
  return t.replace(/\{\{\s*nombre\s*\}\}/gi, '[Nombre]').replace(/\{\{\s*usuario\s*\}\}/gi, '[@usuario]');
}


/**
 * Calendario nativo: después de «Mandar calendario» crea los pasos visibles
 * (y borrables) que antes pasaban por detrás: etiqueta roja al mandarlo,
 * esperar a que agende y, si agenda, sacar la roja + poner la verde + mover
 * de etapa. Lo que seguía después del calendario queda tras «Si agenda».
 */
export function cadenaAgenda(nodos: Paso[], nodoId: string, etapas: Array<{ slug: string; nombre: string }>): Paso[] {
  const n = nodos.find((x) => x.id === nodoId);
  if (!n || nodos.some((x) => x.auto_de === nodoId)) return nodos;
  const x = n.x ?? 0, y = n.y ?? 0;
  const etapa = etapas.find((e) => /reuni|agend|llamada/i.test(`${e.slug} ${e.nombre}`));
  const despues = n.siguiente ?? null;
  const fin = etapa ? nuevoPaso('mover_etapa', { etapa_slug: etapa.slug, auto_de: nodoId, x: x + 1700, y: y - 60, siguiente: despues }) : null;
  const verde = nuevoPaso('etiquetar', { etiqueta: 'Reunión agendada', auto_de: nodoId, x: x + 1360, y: y - 60, siguiente: fin?.id ?? despues });
  const sacar = nuevoPaso('quitar_etiqueta', { etiqueta: 'Calendario enviado', auto_de: nodoId, x: x + 1020, y: y - 60, siguiente: verde.id });
  const espera = nuevoPaso('esperar_agenda', { limite_min: 120, siguiente_sin_respuesta: null, auto_de: nodoId, x: x + 680, y, siguiente: sacar.id });
  const etapaEnviado = etapas.find((e) => /calendario/i.test(`${e.slug} ${e.nombre}`));
  const aEnviado = etapaEnviado ? nuevoPaso('mover_etapa', { etapa_slug: etapaEnviado.slug, auto_de: nodoId, x: x + 340, y: y + 110, siguiente: espera.id }) : null;
  const roja = nuevoPaso('etiquetar', { etiqueta: 'Calendario enviado', auto_de: nodoId, x: x + 340, y, siguiente: aEnviado?.id ?? espera.id });
  if (aEnviado) espera.x = x + 680;
  return [...nodos.map((m) => (m.id === nodoId ? { ...m, siguiente: roja.id } : m)), roja, ...(aEnviado ? [aEnviado] : []), espera, sacar, verde, ...(fin ? [fin] : [])];
}

/**
 * Deja el grafo sano: borra flechas a pasos que ya no existen y, si un paso
 * se quedó sin «siguiente» pero tiene flechas «Y también», la primera pasa a
 * ser la principal (así el disparador nunca queda «sin conectar» con una
 * flecha dibujada).
 */
export function sanear(nodos: Paso[]): Paso[] {
  const ids = new Set(nodos.map((n) => n.id));
  const ok = (v: any) => (v && ids.has(v) ? v : null);
  let cambio = false;
  const r = nodos.map((n) => {
    const m: Paso = { ...n };
    const fijar = (k: string) => { if (k in m && m[k] !== ok(m[k])) { m[k] = ok(m[k]); cambio = true; } };
    fijar('siguiente'); fijar('siguiente_si'); fijar('siguiente_no'); fijar('siguiente_sin_respuesta');
    if (Array.isArray(m.opciones)) m.opciones = m.opciones.map((o: any) => (o.siguiente && !ids.has(o.siguiente) ? ((cambio = true), { ...o, siguiente: null }) : o));
    if (Array.isArray(m.ramas)) m.ramas = m.ramas.map((o: any) => (o.siguiente && !ids.has(o.siguiente) ? ((cambio = true), { ...o, siguiente: null }) : o));
    if (Array.isArray(m.tambien)) {
      const t = m.tambien.filter((x: string) => ids.has(x) && x !== m.siguiente);
      if (t.length !== m.tambien.length) cambio = true;
      m.tambien = t;
      if (!m.siguiente && t.length && m.tipo !== 'pregunta' && m.tipo !== 'condicion' && m.tipo !== 'router') {
        m.siguiente = t[0]; m.tambien = t.slice(1); cambio = true;
      }
    }
    return m;
  });
  return cambio ? r : nodos;
}
