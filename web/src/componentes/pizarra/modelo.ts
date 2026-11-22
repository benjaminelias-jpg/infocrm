// Modelo de la pizarra de automensajes (sin la librería del lienzo): tipos,
// pasos disponibles, disparadores y funciones puras. Así la LISTA de
// automensajes no descarga React Flow; el lienzo se baja al abrir uno.

export type Paso = { id: string; tipo: string; x?: number; y?: number; siguiente?: string | null; [k: string]: any };
export interface Ctx { recursos: any[]; etapas: any[]; etiquetas: string[]; contenidos: any[]; recargarRecursos?: () => Promise<any[]> }

export const uid = () => Math.random().toString(36).slice(2, 10);
export const MAX_TEXTO = 1000;
export const MAX_BOTONES = 13;
export const MAX_TITULO = 20;

export const NODOS: Record<string, { etiqueta: string; icono: string; color: string; grupo: 'Mensajes' | 'Lógica' | 'El lead'; ayuda: string }> = {
  enviar_dm: { etiqueta: 'Mandar mensaje', icono: '💬', color: '#2a78d6', grupo: 'Mensajes', ayuda: 'Un mensaje de texto por DM' },
  enviar_recurso: { etiqueta: 'Mandar audio o recurso', icono: '🎙️', color: '#0d9488', grupo: 'Mensajes', ayuda: 'Le llega como nota de voz / archivo' },
  responder_comentario: { etiqueta: 'Responder el comentario', icono: '💭', color: '#2a78d6', grupo: 'Mensajes', ayuda: 'Respuesta pública debajo del reel' },
  pregunta: { etiqueta: 'Pregunta con botones', icono: '❓', color: '#e76f51', grupo: 'Lógica', ayuda: 'Cada botón sale por su propia flecha' },
  condicion: { etiqueta: 'Condición (sí / no)', icono: '🔀', color: '#264653', grupo: 'Lógica', ayuda: 'Una flecha si se cumple y otra si no' },
  esperar_respuesta: { etiqueta: 'Esperar su respuesta', icono: '✍️', color: '#8d99ae', grupo: 'Lógica', ayuda: 'Pausa hasta que escriba (y guarda lo que dice)' },
  esperar: { etiqueta: 'Esperar un tiempo', icono: '⏳', color: '#8d99ae', grupo: 'Lógica', ayuda: 'Sigue solo después de minutos, horas o días' },
  etiquetar: { etiqueta: 'Poner etiqueta', icono: '🏷️', color: '#f4a261', grupo: 'El lead', ayuda: 'Para filtrarlo después' },
  quitar_etiqueta: { etiqueta: 'Quitar etiqueta', icono: '🏷️', color: '#f4a261', grupo: 'El lead', ayuda: '' },
  mover_etapa: { etiqueta: 'Mover de etapa', icono: '➡️', color: '#2a9d8f', grupo: 'El lead', ayuda: 'Lo mueve en tu pipeline' },
  asignar: { etiqueta: 'Asignar al equipo', icono: '👤', color: '#2a9d8f', grupo: 'El lead', ayuda: 'Al setter o closer con menos carga' },
  notificar: { etiqueta: 'Avisar al equipo', icono: '🔔', color: '#e9c46a', grupo: 'El lead', ayuda: 'Lo marca en el Chat para que lo atiendan' },
  webhook: { etiqueta: 'Avisar a otra app', icono: '🔗', color: '#8d99ae', grupo: 'El lead', ayuda: 'Zapier, Make, tu email… (webhook)' },
};
export const GRUPOS = ['Mensajes', 'Lógica', 'El lead'] as const;

export const DISPAROS: Array<{ v: string; t: string; icono: string; palabra: boolean; ph: string; ayuda: string }> = [
  { v: 'comentario', t: 'Comenta en un reel o post', icono: '💭', palabra: true, ph: 'ej. GUIA', ayuda: 'Varias palabras separadas por coma. Vacío = cualquier comentario.' },
  { v: 'dm', t: 'Te escribe por DM', icono: '✉️', palabra: true, ph: 'ej. INFO', ayuda: 'Vacío = cualquier mensaje (respuesta automática de bienvenida).' },
  { v: 'historia', t: 'Responde a una historia', icono: '⭕', palabra: true, ph: 'opcional', ayuda: 'Vacío = cualquier respuesta a tus historias.' },
  { v: 'mencion', t: 'Te menciona en su historia', icono: '@', palabra: false, ph: '', ayuda: 'Cada vez que alguien te etiqueta en una historia.' },
  { v: 'reaccion', t: 'Reacciona a un mensaje', icono: '❤️', palabra: false, ph: '', ayuda: 'Cuando reacciona con un emoji a un mensaje tuyo.' },
  { v: 'boton', t: 'Toca un botón', icono: '👉', palabra: true, ph: 'texto o código del botón', ayuda: 'Botones de Instagram (menú, rompehielos).' },
  { v: 'anuncio', t: 'Viene de un anuncio', icono: '📣', palabra: true, ph: 'ref del anuncio (opcional)', ayuda: 'Anuncios de "enviar mensaje" o enlaces ig.me/…?ref=' },
];

// ---------------------------------------------------------------------
// Grafo: utilidades (mismo modelo que el motor del servidor)
// ---------------------------------------------------------------------

/** Salidas de un paso: [id de la salida, paso al que apunta]. */
export function salidas(n: Paso): Array<[string, string | null | undefined]> {
  if (n.tipo === 'pregunta') return (n.opciones ?? []).map((o: any) => [`op:${o.id}`, o.siguiente]);
  if (n.tipo === 'condicion') return [['si', n.siguiente_si], ['no', n.siguiente_no]];
  return [['out', n.siguiente]];
}

export function conectar(nodos: Paso[], origen: string, salida: string, destino: string | null): Paso[] {
  return nodos.map((n) => {
    if (n.id !== origen) return n;
    if (salida.startsWith('op:')) {
      const opId = salida.slice(3);
      return { ...n, opciones: (n.opciones ?? []).map((o: any) => (o.id === opId ? { ...o, siguiente: destino } : o)) };
    }
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
    ...(n.tipo === 'pregunta' ? { opciones: (n.opciones ?? []).map((o: any) => ({ ...o, siguiente: limpiar(o.siguiente) })) } : {}),
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
  if (entradas.length === 1 && sale.length === 1 && borrado.tipo !== 'pregunta' && borrado.tipo !== 'condicion') {
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
  if (tipo === 'condicion') { base.campo = base.campo ?? 'etiqueta'; base.siguiente_si = null; base.siguiente_no = null; }
  else if (tipo !== 'pregunta' && !('siguiente' in base)) base.siguiente = null;
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
      const { si, no, opciones, pasos: _p, ...resto } = p;
      const n: Paso = { ...resto, id: ids[i], tipo: p.tipo };
      if (p.tipo === 'pregunta') {
        n.opciones = (opciones ?? []).map((o: any) => ({ id: String(o.id ?? uid()), titulo: o.titulo ?? '', siguiente: secuencia(o.pasos ?? [], despues) }));
      } else if (p.tipo === 'condicion') {
        n.siguiente_si = secuencia(si ?? [], despues);
        n.siguiente_no = secuencia(no ?? [], despues);
      } else n.siguiente = despues;
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
  const cola = ['inicio'];
  while (cola.length) {
    const id = cola.shift()!;
    const n = mapa.get(id);
    if (!n) continue;
    for (const [, s] of salidas(n)) {
      if (s && mapa.has(s) && !nivel.has(s)) { nivel.set(s, nivel.get(id)! + 1); cola.push(s); }
    }
  }
  const columnas = new Map<number, Paso[]>();
  const sueltos: Paso[] = [];
  for (const n of nodos) {
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

export function describirCondicion(p: Paso) {
  switch (p.campo) {
    case 'etiqueta': return `¿Tiene la etiqueta «${p.valor || '…'}»?`;
    case 'etapa': return `¿Está en la etapa «${p.valor || '…'}»?`;
    case 'email': return '¿Ya tenemos su email?';
    case 'telefono': return '¿Ya tenemos su teléfono?';
    case 'texto': return `¿Su mensaje dice «${p.valor || '…'}»?`;
    case 'sigue': return '¿Te sigue en Instagram?';
    default: return '¿Se cumple?';
  }
}

/** {{nombre}} → [Nombre] para leerlo como persona (en la pizarra y la prueba). */
export function conVariables(t: string) {
  return t.replace(/\{\{\s*nombre\s*\}\}/gi, '[Nombre]').replace(/\{\{\s*usuario\s*\}\}/gi, '[@usuario]');
}

