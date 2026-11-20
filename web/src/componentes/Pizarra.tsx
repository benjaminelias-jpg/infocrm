import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap, Panel,
  Handle, Position, MarkerType, BaseEdge, EdgeLabelRenderer, getBezierPath, applyNodeChanges, useReactFlow,
  type Node, type Edge, type NodeChange, type EdgeChange, type Connection, type NodeProps, type EdgeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// =====================================================================
// Pizarra libre de automensajes, estilo n8n: lienzo infinito punteado,
// cajas que se mueven a cualquier lado y flechas que se conectan
// arrastrando desde el punto de salida de un paso hasta otro.
//   - pasos normales:  siguiente
//   - pregunta:        opciones[].siguiente (una salida por botón)
//   - condición:       siguiente_si / siguiente_no
// =====================================================================

export type Paso = { id: string; tipo: string; x?: number; y?: number; siguiente?: string | null; [k: string]: any };
export interface Ctx { recursos: any[]; etapas: any[]; etiquetas: string[]; contenidos: any[] }

export const uid = () => Math.random().toString(36).slice(2, 10);
const MAX_TEXTO = 1000;
const MAX_BOTONES = 13;
const MAX_TITULO = 20;

export const NODOS: Record<string, { etiqueta: string; icono: string; color: string; grupo: 'Mensajes' | 'Lógica' | 'El lead'; ayuda: string }> = {
  enviar_dm: { etiqueta: 'Mandar mensaje', icono: '💬', color: '#2a78d6', grupo: 'Mensajes', ayuda: 'Un mensaje de texto por DM' },
  enviar_recurso: { etiqueta: 'Mandar audio o recurso', icono: '🎙️', color: '#9b5de5', grupo: 'Mensajes', ayuda: 'Le llega como nota de voz / archivo' },
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
const GRUPOS = ['Mensajes', 'Lógica', 'El lead'] as const;

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

function conectar(nodos: Paso[], origen: string, salida: string, destino: string | null): Paso[] {
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

function quitarNodo(nodos: Paso[], id: string): Paso[] {
  const limpiar = (v: any) => (v === id ? null : v);
  return nodos.filter((n) => n.id !== id).map((n) => ({
    ...n,
    ...('siguiente' in n ? { siguiente: limpiar(n.siguiente) } : {}),
    ...(n.tipo === 'condicion' ? { siguiente_si: limpiar(n.siguiente_si), siguiente_no: limpiar(n.siguiente_no) } : {}),
    ...(n.tipo === 'pregunta' ? { opciones: (n.opciones ?? []).map((o: any) => ({ ...o, siguiente: limpiar(o.siguiente) })) } : {}),
  }));
}

function alcanzables(nodos: Paso[]): Set<string> {
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
function lugarLibre(nodos: Paso[], p: { x: number; y: number }) {
  let q = { x: Math.round(p.x), y: Math.round(p.y) };
  for (let i = 0; i < 40; i++) {
    const choca = nodos.some((n) => Math.abs((n.x ?? 0) - q.x) < 280 && Math.abs((n.y ?? 0) - q.y) < 150);
    if (!choca) return q;
    q = { x: q.x, y: q.y + 160 };
  }
  return q;
}

function fmtMin(min: number) {
  if (!min) return '—';
  if (min % 1440 === 0) return `${min / 1440} día${min === 1440 ? '' : 's'}`;
  if (min % 60 === 0) return `${min / 60} h`;
  return `${min} min`;
}

function describirCondicion(p: Paso) {
  switch (p.campo) {
    case 'etiqueta': return `¿Tiene la etiqueta «${p.valor || '…'}»?`;
    case 'etapa': return `¿Está en la etapa «${p.valor || '…'}»?`;
    case 'email': return '¿Ya tenemos su email?';
    case 'telefono': return '¿Ya tenemos su teléfono?';
    case 'texto': return `¿Su mensaje dice «${p.valor || '…'}»?`;
    default: return '¿Se cumple?';
  }
}

function resumen(p: Paso, ctx: Ctx): string {
  switch (p.tipo) {
    case 'enviar_dm': case 'entregar_recurso': return String(p.texto ?? p.recurso ?? '') || 'Escribí el mensaje…';
    case 'responder_comentario': case 'notificar': return String(p.texto ?? '') || 'Escribí el texto…';
    case 'enviar_recurso': return ctx.recursos.find((r) => r.id === p.recurso_id)?.nombre ?? 'Elegí qué mandar…';
    case 'etiquetar': case 'quitar_etiqueta': return p.etiqueta ? `«${p.etiqueta}»` : 'Escribí la etiqueta…';
    case 'mover_etapa': return ctx.etapas.find((e) => e.slug === p.etapa_slug)?.nombre ?? (p.etapa_slug || 'Elegí la etapa…');
    case 'asignar': return p.rol === 'closer' ? 'A un closer' : p.rol === 'setter' ? 'A un setter' : 'A quien tenga menos leads';
    case 'webhook': return p.url ? String(p.url).replace(/^https?:\/\//, '').slice(0, 40) : 'Pegá la URL…';
    case 'esperar': return fmtMin(Number(p.minutos) || 0);
    case 'esperar_respuesta': return p.guardar_en ? `y guardar como ${p.guardar_en}` : 'Pausa hasta que escriba';
    default: return '';
  }
}

// ---------------------------------------------------------------------
// Nodos y flechas
// ---------------------------------------------------------------------

type DatosNodo = {
  paso: Paso; ctx: Ctx; disparo?: string;
  marcado: boolean; enRecorrido: boolean; suelto: boolean;
  conectadas: string[]; onMas: (salida: string) => void;
};

const estiloPunto = (color: string): React.CSSProperties => ({
  width: 13, height: 13, background: color, border: '2.5px solid var(--surface-1, #fff)',
});

function BotonMas({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} title="Agregar el paso siguiente"
      className="nodrag nopan absolute -right-9 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border text-[14px] leading-none hover:scale-110"
      style={{ background: 'var(--surface-1)', borderColor: 'var(--baseline)', color: 'var(--text-secondary)' }}>+</button>
  );
}

function Caja({ d, selected, color, ancho = 260, children }: { d: DatosNodo; selected?: boolean; color: string; ancho?: number; children: React.ReactNode }) {
  return (
    <div className="text-[12px]" style={{
      width: ancho, background: 'var(--surface-1)', borderRadius: 12,
      border: `1.5px solid ${d.marcado ? 'var(--status-critical)' : selected ? 'var(--series-1)' : 'var(--border-hairline)'}`,
      borderLeft: `5px solid ${color}`,
      boxShadow: d.enRecorrido ? '0 0 0 4px rgba(12,163,12,.30)' : selected ? '0 0 0 4px rgba(42,120,214,.18)' : '0 1px 3px rgba(0,0,0,.08)',
      opacity: d.suelto ? 0.55 : 1,
    }}>
      {children}
      {d.suelto && <div className="px-3 pb-1.5 text-[10px] text-[var(--text-muted)]">Suelto: ninguna flecha llega acá, no se ejecuta</div>}
    </div>
  );
}

function Titulo({ p }: { p: Paso }) {
  const m = NODOS[p.tipo] ?? { icono: '•', etiqueta: p.tipo };
  return <div className="px-3 pt-2.5 text-[12px] font-semibold">{m.icono} {m.etiqueta}</div>;
}

const NodoInicio = memo(({ data, selected }: NodeProps<Node<DatosNodo>>) => {
  const d = data;
  return (
    <div className="relative text-[12px]" style={{
      width: 250, background: 'var(--surface-1)', borderRadius: 14, border: '2px solid var(--status-good)',
      boxShadow: d.enRecorrido ? '0 0 0 4px rgba(12,163,12,.30)' : selected ? '0 0 0 4px rgba(12,163,12,.2)' : '0 1px 3px rgba(0,0,0,.08)',
    }}>
      <div className="px-3 pt-2.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--status-good)' }}>⚡ Cuando…</div>
      <div className="px-3 pb-3 pt-1 text-[13px] font-medium leading-snug">{d.disparo}</div>
      <Handle type="source" position={Position.Right} id="out" style={estiloPunto('var(--status-good)')} />
      {!d.conectadas.includes('out') && <BotonMas onClick={() => d.onMas('out')} />}
    </div>
  );
});

const NodoPaso = memo(({ data, selected }: NodeProps<Node<DatosNodo>>) => {
  const d = data;
  const m = NODOS[d.paso.tipo] ?? NODOS.enviar_dm;
  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} id="in" style={estiloPunto('var(--baseline)')} />
      <Caja d={d} selected={selected} color={m.color}>
        <Titulo p={d.paso} />
        <div className="line-clamp-3 whitespace-pre-wrap px-3 pb-2.5 pt-1 text-[11px] text-[var(--text-secondary)]">{resumen(d.paso, d.ctx)}</div>
      </Caja>
      <Handle type="source" position={Position.Right} id="out" style={estiloPunto(m.color)} />
      {!d.conectadas.includes('out') && <BotonMas onClick={() => d.onMas('out')} />}
    </div>
  );
});

function FilaSalida({ d, id, color, children }: { d: DatosNodo; id: string; color: string; children: React.ReactNode }) {
  return (
    <div className="relative border-t border-[var(--border-hairline)] px-3 py-1.5 text-[11px]">
      {children}
      <Handle type="source" position={Position.Right} id={id} style={{ ...estiloPunto(color), right: -7 }} />
      {!d.conectadas.includes(id) && <BotonMas onClick={() => d.onMas(id)} />}
    </div>
  );
}

const NodoPregunta = memo(({ data, selected }: NodeProps<Node<DatosNodo>>) => {
  const d = data;
  const p = d.paso;
  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} id="in" style={estiloPunto('var(--baseline)')} />
      <Caja d={d} selected={selected} color={NODOS.pregunta.color}>
        <Titulo p={p} />
        <div className="line-clamp-3 whitespace-pre-wrap px-3 pb-2 pt-1 text-[11px] text-[var(--text-secondary)]">{p.texto || 'Escribí la pregunta…'}</div>
        {(p.opciones ?? []).map((o: any, j: number) => (
          <FilaSalida key={o.id} d={d} id={`op:${o.id}`} color={NODOS.pregunta.color}>
            👉 {o.titulo || `Botón ${j + 1}`}
          </FilaSalida>
        ))}
      </Caja>
    </div>
  );
});

const NodoCondicion = memo(({ data, selected }: NodeProps<Node<DatosNodo>>) => {
  const d = data;
  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} id="in" style={estiloPunto('var(--baseline)')} />
      <Caja d={d} selected={selected} color={NODOS.condicion.color}>
        <Titulo p={d.paso} />
        <div className="px-3 pb-2 pt-1 text-[11px] text-[var(--text-secondary)]">{describirCondicion(d.paso)}</div>
        <FilaSalida d={d} id="si" color="var(--status-good)">✅ Sí</FilaSalida>
        <FilaSalida d={d} id="no" color="var(--status-critical)">❌ No</FilaSalida>
      </Caja>
    </div>
  );
});

function FlechaBorrable({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, selected, data }: EdgeProps) {
  const [camino, lx, ly] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={camino} style={style} markerEnd={markerEnd} interactionWidth={24} />
      {selected && (
        <EdgeLabelRenderer>
          <button className="nodrag nopan absolute flex h-6 w-6 items-center justify-center rounded-full text-[11px] text-white shadow"
            style={{ transform: `translate(-50%,-50%) translate(${lx}px,${ly}px)`, background: 'var(--status-critical)', pointerEvents: 'all' }}
            onClick={() => (data as any)?.onBorrar?.()} title="Quitar flecha">✕</button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const TIPOS_NODO = { inicio: NodoInicio, paso: NodoPaso, pregunta: NodoPregunta, condicion: NodoCondicion };
const TIPOS_FLECHA = { borrable: FlechaBorrable };
const tipoNodo = (t: string) => (t === 'inicio' || t === 'pregunta' || t === 'condicion' ? t : 'paso');

// ---------------------------------------------------------------------
// Pizarra
// ---------------------------------------------------------------------

export interface PropsPizarra {
  form: any;
  setForm: (f: (x: any) => any) => void;
  ctx: Ctx;
  marcados: string[];
  recorrido: string[];
}

export default function Pizarra(props: PropsPizarra) {
  return <ReactFlowProvider><Lienzo {...props} /></ReactFlowProvider>;
}

function modoColor(): 'light' | 'dark' | 'system' {
  const t = document.documentElement.getAttribute('data-theme');
  return t === 'dark' ? 'dark' : t === 'light' ? 'light' : 'system';
}

function Lienzo({ form, setForm, ctx, marcados, recorrido }: PropsPizarra) {
  const rf = useReactFlow();
  const caja = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [selFlecha, setSelFlecha] = useState<string | null>(null);
  const [paleta, setPaleta] = useState<null | { desde?: { nodo: string; salida: string } }>(null);
  const nodos: Paso[] = form.pasos;

  const setNodos = useCallback((f: (n: Paso[]) => Paso[]) => setForm((x: any) => ({ ...x, pasos: f(x.pasos) })), [setForm]);

  const disp = DISPAROS.find((d) => d.v === form.disparo) ?? DISPAROS[0];
  const textoDisparo = `${disp.icono} ${disp.t}${disp.palabra && form.palabra_clave ? ` «${form.palabra_clave}»` : ''}`;
  const vivos = useMemo(() => alcanzables(nodos), [nodos]);
  const enRecorrido = useMemo(() => new Set(recorrido), [recorrido]);
  const tramosRecorrido = useMemo(() => {
    const s = new Set<string>();
    const r = ['inicio', ...recorrido];
    for (let i = 0; i + 1 < r.length; i++) s.add(`${r[i]}>${r[i + 1]}`);
    return s;
  }, [recorrido]);
  const marcadosSet = useMemo(() => new Set(marcados), [marcados]);

  const desconectar = useCallback((origen: string, salida: string) => setNodos((ns) => conectar(ns, origen, salida, null)), [setNodos]);

  const flechas: Edge[] = useMemo(() => {
    const ids = new Set(nodos.map((n) => n.id));
    const out: Edge[] = [];
    for (const n of nodos) {
      for (const [salida, destino] of salidas(n)) {
        if (!destino || !ids.has(destino)) continue;
        const id = `${n.id}|${salida}`;
        const pintada = tramosRecorrido.has(`${n.id}>${destino}`);
        out.push({
          id, source: n.id, sourceHandle: salida, target: destino, targetHandle: 'in', type: 'borrable',
          selected: selFlecha === id, animated: pintada,
          style: { stroke: pintada ? '#0ca30c' : '#9a9a94', strokeWidth: pintada ? 2.6 : 1.8 },
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: pintada ? '#0ca30c' : '#9a9a94' },
          data: { onBorrar: () => { desconectar(n.id, salida); setSelFlecha(null); } },
        });
      }
    }
    return out;
  }, [nodos, tramosRecorrido, selFlecha, desconectar]);

  const conectadasDe = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of flechas) m.set(e.source, [...(m.get(e.source) ?? []), String(e.sourceHandle)]);
    return m;
  }, [flechas]);

  const datos = useCallback((n: Paso): DatosNodo => ({
    paso: n, ctx, disparo: textoDisparo,
    marcado: marcadosSet.has(n.id), enRecorrido: enRecorrido.has(n.id) || (n.tipo === 'inicio' && recorrido.length > 0),
    suelto: n.tipo !== 'inicio' && !vivos.has(n.id),
    conectadas: conectadasDe.get(n.id) ?? [],
    onMas: (salida: string) => { setPaleta({ desde: { nodo: n.id, salida } }); setSel(null); },
  }), [ctx, textoDisparo, marcadosSet, enRecorrido, recorrido.length, vivos, conectadasDe]);

  // Estado propio de React Flow (medidas, arrastre, selección) sincronizado
  // con los pasos del flujo, que son la fuente de verdad.
  const [rfNodos, setRfNodos] = useState<Node[]>([]);
  useEffect(() => {
    setRfNodos((prev) => {
      const ant = new Map(prev.map((p) => [p.id, p]));
      return nodos.map((n) => {
        const p = ant.get(n.id);
        return {
          id: n.id, type: tipoNodo(n.tipo), position: p?.dragging ? p.position : { x: n.x ?? 0, y: n.y ?? 0 },
          deletable: n.tipo !== 'inicio', data: datos(n) as any,
          ...(p ? { measured: p.measured, dragging: p.dragging } : {}),
          selected: sel === n.id,
        } as Node;
      });
    });
  }, [nodos, datos, sel]);

  const nodosRef = useRef<Paso[]>(nodos);
  nodosRef.current = nodos;

  /** Encuadra el comienzo del flujo en un zoom legible (como n8n): el
   *  disparador y las primeras columnas; el resto se recorre arrastrando. */
  const encuadrar = useCallback((duracion = 0) => {
    const xs = nodosRef.current.map((n) => n.x ?? 0);
    const minX = xs.length ? Math.min(...xs) : 0;
    const primeros = nodosRef.current.filter((n) => (n.x ?? 0) <= minX + 700).map((n) => ({ id: n.id }));
    const angosta = (caja.current?.clientWidth ?? 1000) < 700;
    rf.fitView({ nodes: primeros.length ? primeros : undefined, padding: 0.25, maxZoom: 1, minZoom: angosta ? 0.55 : 0.85, duration: duracion });
  }, [rf]);
  useEffect(() => { const t = setTimeout(() => encuadrar(), 120); return () => clearTimeout(t); }, [encuadrar]);

  const onNodesChange = useCallback((cambios: NodeChange[]) => {
    setRfNodos((nds) => applyNodeChanges(cambios.filter((c) => !(c.type === 'remove' && c.id === 'inicio')), nds));
    const fin = cambios.filter((c): c is Extract<NodeChange, { type: 'position' }> => c.type === 'position' && !!c.position && c.dragging === false);
    const borrar = cambios.filter((c) => c.type === 'remove' && c.id !== 'inicio').map((c: any) => c.id as string);
    if (fin.length || borrar.length) {
      setNodos((ns) => {
        let r = ns.map((n) => {
          const c = fin.find((x) => x.id === n.id);
          return c ? { ...n, x: Math.round(c.position!.x), y: Math.round(c.position!.y) } : n;
        });
        for (const id of borrar) r = quitarNodo(r, id);
        return r;
      });
      if (borrar.includes(sel ?? '')) setSel(null);
    }
  }, [setNodos, sel]);

  const onEdgesChange = useCallback((cambios: EdgeChange[]) => {
    for (const c of cambios) {
      if (c.type === 'select') setSelFlecha(c.selected ? c.id : null);
      if (c.type === 'remove') {
        const [origen, salida] = c.id.split('|');
        desconectar(origen, salida);
      }
    }
  }, [desconectar]);

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || !c.sourceHandle || c.target === 'inicio') return;
    setNodos((ns) => conectar(ns, c.source, c.sourceHandle!, c.target));
  }, [setNodos]);

  function centroVisible() {
    const r = caja.current?.getBoundingClientRect();
    return rf.screenToFlowPosition({ x: (r?.left ?? 0) + (r?.width ?? 800) / 2 - 130, y: (r?.top ?? 0) + (r?.height ?? 600) / 2 - 50 });
  }

  function agregar(tipo: string, pos?: { x: number; y: number }) {
    const desde = paleta?.desde;
    let p = pos;
    if (!p) {
      if (desde) {
        const o = nodos.find((n) => n.id === desde.nodo);
        const i = Math.max(0, salidas(o ?? { id: '', tipo: 'x' }).findIndex(([s]) => s === desde.salida));
        p = lugarLibre(nodos, { x: (o?.x ?? 0) + 340, y: (o?.y ?? 0) + i * 70 });
      } else {
        p = lugarLibre(nodos, centroVisible());
      }
    }
    const n = nuevoPaso(tipo, { x: Math.round(p.x), y: Math.round(p.y) });
    setNodos((ns) => {
      const conNuevo = [...ns, n];
      return desde ? conectar(conNuevo, desde.nodo, desde.salida, n.id) : conNuevo;
    });
    setPaleta(null);
    setSel(n.id);
    // Que el paso nuevo quede a la vista (no escondido detrás del panel).
    setTimeout(() => rf.setCenter((n.x ?? 0) + 130, (n.y ?? 0) + 50, { zoom: Math.max(rf.getZoom(), 0.85), duration: 300 }), 40);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const tipo = e.dataTransfer.getData('application/infocrm-paso');
    if (!tipo || !NODOS[tipo]) return;
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    agregar(tipo, { x: p.x - 130, y: p.y - 30 });
  }

  function acomodar() {
    setNodos((ns) => ordenar(ns));
    setTimeout(() => encuadrar(300), 60);
  }

  function duplicar(id: string) {
    const o = nodos.find((n) => n.id === id);
    if (!o || o.tipo === 'inicio') return;
    const copia: Paso = {
      ...JSON.parse(JSON.stringify(o)), id: uid(), x: (o.x ?? 0) + 40, y: (o.y ?? 0) + 60,
      ...(o.tipo === 'pregunta' ? { opciones: (o.opciones ?? []).map((x: any) => ({ ...x, id: uid(), siguiente: null })) } : {}),
      ...(o.tipo === 'condicion' ? { siguiente_si: null, siguiente_no: null } : { siguiente: null }),
    };
    if (o.tipo === 'pregunta') delete copia.siguiente;
    setNodos((ns) => [...ns, copia]);
    setSel(copia.id);
  }

  const seleccionado = nodos.find((n) => n.id === sel) ?? null;
  const actualizar = (p: Paso) => setNodos((ns) => ns.map((n) => (n.id === p.id ? p : n)));
  const panelAbierto = !!paleta || !!seleccionado;

  return (
    <div className="flex h-full min-h-0">
      <div ref={caja} className="relative min-w-0 flex-1" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }} onDrop={onDrop}>
        <ReactFlow
          nodes={rfNodos} edges={flechas} nodeTypes={TIPOS_NODO} edgeTypes={TIPOS_FLECHA}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
          onNodeClick={(_, n) => { setSel(n.id); setPaleta(null); setSelFlecha(null); }}
          onPaneClick={() => { setSel(null); setPaleta(null); setSelFlecha(null); }}
          isValidConnection={(c) => c.target !== 'inicio' && c.source !== c.target}
          deleteKeyCode={['Backspace', 'Delete']} snapToGrid snapGrid={[20, 20]}
          minZoom={0.15} maxZoom={1.8} colorMode={modoColor()}
          defaultEdgeOptions={{ type: 'borrable' }} connectionRadius={36}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.6} />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap pannable zoomable position="bottom-right" className="!hidden md:!block"
            nodeColor={(n) => (n.id === 'inicio' ? '#0ca30c' : NODOS[(n.data as any)?.paso?.tipo]?.color ?? '#999')} />
          <Panel position="top-left">
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => { setPaleta({}); setSel(null); }} className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white shadow" style={{ background: 'var(--series-1)' }}>+ Paso</button>
              <button onClick={acomodar} className="rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] shadow-sm" style={{ background: 'var(--surface-1)' }}>✨ Ordenar</button>
            </div>
          </Panel>
          {nodos.length <= 1 && (
            <Panel position="top-center">
              <div className="mt-12 max-w-[320px] rounded-lg border border-[var(--border-hairline)] p-3 text-center text-[12px] shadow-sm" style={{ background: 'var(--surface-1)' }}>
                Tocá el <b>+</b> al lado del disparador para agregar el primer paso, o arrastrá pasos desde «+ Paso».
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>

      {/* Panel lateral (abajo en el celular) */}
      <aside className={`${panelAbierto ? 'fixed inset-x-0 bottom-0 z-40 max-h-[60vh] rounded-t-xl shadow-2xl md:static md:max-h-none md:rounded-none md:shadow-none' : 'hidden'} w-full overflow-y-auto border-l border-[var(--border-hairline)] md:w-[320px] md:shrink-0`}
        style={{ background: 'var(--page-plane)' }}>
        {paleta || !seleccionado ? (
          <Paleta titulo={paleta?.desde ? '¿Qué pasa después?' : 'Agregar paso'} alElegir={(t) => agregar(t)}
            alCerrar={() => setPaleta(null)} />
        ) : (
          <div className="p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-[13px] font-semibold">
                {seleccionado.tipo === 'inicio' ? '⚡ Cuando… (disparador)' : `${NODOS[seleccionado.tipo]?.icono ?? ''} ${NODOS[seleccionado.tipo]?.etiqueta ?? seleccionado.tipo}`}
              </div>
              <button onClick={() => setSel(null)} className="rounded px-2 py-1 text-[12px] hover:bg-[var(--surface-1)]" aria-label="Cerrar">✕</button>
            </div>
            {seleccionado.tipo === 'inicio'
              ? <CamposDisparador form={form} setForm={setForm} ctx={ctx} />
              : <CamposPaso p={seleccionado} onChange={actualizar} ctx={ctx} />}
            {seleccionado.tipo !== 'inicio' && (
              <div className="mt-4 flex gap-2 border-t border-[var(--border-hairline)] pt-3">
                <button onClick={() => duplicar(seleccionado.id)} className="rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] hover:bg-[var(--surface-1)]">⧉ Duplicar</button>
                <button onClick={() => { setNodos((ns) => quitarNodo(ns, seleccionado.id)); setSel(null); }}
                  className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white" style={{ background: 'var(--status-critical)' }}>Eliminar paso</button>
              </div>
            )}
            <p className="mt-3 text-[11px] text-[var(--text-muted)]">
              Para conectar: arrastrá desde el punto ● de la derecha de un paso hasta otro paso. Para quitar una flecha, tocala y apretá ✕.
            </p>
          </div>
        )}
      </aside>
      <datalist id="etiquetas-existentes">{ctx.etiquetas.map((e) => <option key={e} value={e} />)}</datalist>
    </div>
  );
}

function Paleta({ titulo, alElegir, alCerrar }: { titulo: string; alElegir: (t: string) => void; alCerrar?: () => void }) {
  return (
    <div className="p-3">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-[13px] font-semibold">{titulo}</div>
        {alCerrar && <button onClick={alCerrar} className="rounded px-2 py-1 text-[12px] hover:bg-[var(--surface-1)]" aria-label="Cerrar">✕</button>}
      </div>
      <p className="mb-2 text-[11px] text-[var(--text-muted)]">Tocá uno, o arrastralo a la pizarra donde quieras.</p>
      {GRUPOS.map((g) => (
        <div key={g} className="mb-2">
          <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{g}</div>
          {Object.entries(NODOS).filter(([, m]) => m.grupo === g).map(([t, m]) => (
            <button key={t} draggable onDragStart={(e) => { e.dataTransfer.setData('application/infocrm-paso', t); e.dataTransfer.effectAllowed = 'move'; }}
              onClick={() => alElegir(t)}
              className="mb-1 flex w-full cursor-grab items-start gap-2 rounded-lg border px-2.5 py-2 text-left hover:border-[var(--series-1)] active:cursor-grabbing"
              style={{ background: 'var(--surface-1)', borderColor: 'var(--border-hairline)', borderLeft: `4px solid ${m.color}` }}>
              <span className="w-5 text-center text-[14px]">{m.icono}</span>
              <span>
                <span className="block text-[12px] font-medium">{m.etiqueta}</span>
                {m.ayuda && <span className="block text-[10px] text-[var(--text-muted)]">{m.ayuda}</span>}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

const inp = 'w-full rounded-md border border-[var(--border-hairline)] bg-transparent px-2 py-1.5 text-[12px] outline-none';
const sel = 'w-full rounded-md border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1.5 text-[12px] outline-none';

function CamposDisparador({ form, setForm, ctx }: { form: any; setForm: (f: (x: any) => any) => void; ctx: Ctx }) {
  const disp = DISPAROS.find((d) => d.v === form.disparo) ?? DISPAROS[0];
  return (
    <div className="space-y-2">
      <select value={form.disparo} onChange={(e) => setForm((f) => ({ ...f, disparo: e.target.value }))} className={sel}>
        {DISPAROS.map((d) => <option key={d.v} value={d.v}>{d.icono}  {d.t}</option>)}
      </select>
      {disp.palabra && (
        <input value={form.palabra_clave ?? ''} onChange={(e) => setForm((f) => ({ ...f, palabra_clave: e.target.value }))}
          placeholder={`palabra clave (${disp.ph})`} className={inp} />
      )}
      {(form.disparo === 'comentario' || form.disparo === 'historia') && ctx.contenidos.length > 0 && (
        <select value={form.contenido_id ?? ''} onChange={(e) => setForm((f) => ({ ...f, contenido_id: e.target.value }))} className={sel}>
          <option value="">en cualquier publicación</option>
          {ctx.contenidos.filter((c: any) => c.ig_media_id).map((c: any) => <option key={c.id} value={c.id}>solo en: {String(c.titulo).slice(0, 50)}</option>)}
        </select>
      )}
      <div className="text-[11px] text-[var(--text-muted)]">{disp.ayuda}</div>
      {form.disparo === 'comentario' && (
        <div className="rounded-md px-2 py-1.5 text-[11px]" style={{ background: 'var(--surface-1)' }}>
          💡 Instagram deja mandarle <b>un solo mensaje</b> a quien comenta hasta que te responda. Conviene que el primer DM sea una <b>pregunta con botón</b>: cuando lo toca, ya podés mandarle todo lo demás.
        </div>
      )}
    </div>
  );
}

function CamposPaso({ p, onChange, ctx }: { p: Paso; onChange: (p: Paso) => void; ctx: Ctx }) {
  const set = (k: string, v: any) => onChange({ ...p, [k]: v });
  switch (p.tipo) {
    case 'enviar_dm':
    case 'entregar_recurso':
      return (
        <div>
          <textarea autoFocus value={p.texto ?? p.recurso ?? ''} onChange={(e) => onChange({ ...p, tipo: 'enviar_dm', texto: e.target.value })}
            rows={5} placeholder="Hola {{nombre}} 👋 …" className={`${inp} resize-y`} />
          <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--text-muted)]">
            <button onClick={() => set('texto', `${p.texto ?? ''}{{nombre}}`)} className="underline">+ nombre del lead</button>
            <span style={{ color: String(p.texto ?? '').length > MAX_TEXTO ? 'var(--status-critical)' : undefined }}>{String(p.texto ?? '').length}/{MAX_TEXTO}</span>
          </div>
        </div>
      );
    case 'responder_comentario':
    case 'notificar':
      return <input autoFocus value={p.texto ?? ''} onChange={(e) => set('texto', e.target.value)} className={inp}
        placeholder={p.tipo === 'notificar' ? 'Qué tiene que saber el equipo' : '¡Te lo mandé por DM! 📩'} />;
    case 'enviar_recurso': {
      const lista = ctx.recursos.filter((r) => r.tipo !== 'texto');
      return (
        <div>
          <select value={p.recurso_id ?? ''} onChange={(e) => set('recurso_id', e.target.value)} className={sel}>
            <option value="">Elegí qué mandar…</option>
            {lista.map((r) => <option key={r.id} value={r.id}>{r.tipo === 'audio' ? '🎙️' : r.tipo === 'pdf' ? '📄' : r.tipo === 'imagen' ? '🖼️' : r.tipo === 'video' ? '🎬' : '🔗'} {r.nombre}</option>)}
          </select>
          {lista.length === 0 && <div className="mt-1 text-[11px] text-[var(--text-muted)]">No tenés recursos todavía: grabalos en Chat → 🎙️ Recursos.</div>}
        </div>
      );
    }
    case 'etiquetar':
    case 'quitar_etiqueta':
      return <input autoFocus value={p.etiqueta ?? ''} onChange={(e) => set('etiqueta', e.target.value)} list="etiquetas-existentes" placeholder="ej. pidió-guía" className={inp} />;
    case 'mover_etapa':
      return (
        <select value={p.etapa_slug ?? ''} onChange={(e) => set('etapa_slug', e.target.value)} className={sel}>
          <option value="">Elegí la etapa…</option>
          {ctx.etapas.map((e) => <option key={e.slug} value={e.slug}>{e.nombre}</option>)}
        </select>
      );
    case 'asignar':
      return (
        <select value={p.rol ?? ''} onChange={(e) => set('rol', e.target.value)} className={sel}>
          <option value="">A quien tenga menos leads</option>
          <option value="setter">A un setter</option>
          <option value="closer">A un closer</option>
        </select>
      );
    case 'webhook':
      return <input autoFocus value={p.url ?? ''} onChange={(e) => set('url', e.target.value)} placeholder="https://hook.make.com/…" className={inp} />;
    case 'esperar': {
      const min = Number(p.minutos) || 0;
      const unidad = min && min % 1440 === 0 ? 1440 : min && min % 60 === 0 ? 60 : 1;
      return (
        <div className="flex gap-2">
          <input type="number" min={1} value={min ? min / unidad : ''} onChange={(e) => set('minutos', Math.max(0, Number(e.target.value)) * unidad)} className={`${inp} w-24`} placeholder="1" />
          <select value={unidad} onChange={(e) => set('minutos', (min ? min / unidad : 1) * Number(e.target.value))} className={sel}>
            <option value={1}>minutos</option><option value={60}>horas</option><option value={1440}>días</option>
          </select>
        </div>
      );
    }
    case 'esperar_respuesta':
      return (
        <div>
          <select value={p.guardar_en ?? ''} onChange={(e) => set('guardar_en', e.target.value)} className={sel}>
            <option value="">Solo esperar (no guardar nada)</option>
            <option value="email">Guardar lo que escribe como su EMAIL</option>
            <option value="telefono">Guardar como su TELÉFONO</option>
            <option value="nombre">Guardar como su NOMBRE</option>
            <option value="nota">Guardarlo como nota en su ficha</option>
          </select>
          <div className="mt-1 text-[11px] text-[var(--text-muted)]">El automensaje se pausa acá hasta que el lead escriba, aunque pasen horas.</div>
        </div>
      );
    case 'pregunta': {
      const opciones = p.opciones ?? [];
      return (
        <div className="space-y-1.5">
          <textarea autoFocus value={p.texto ?? ''} onChange={(e) => set('texto', e.target.value)} rows={3} placeholder="¿Te paso la guía?" className={`${inp} resize-y`} />
          <div className="text-[11px] font-medium text-[var(--text-secondary)]">Botones (cada uno sale por su propia flecha)</div>
          {opciones.map((o: any, j: number) => (
            <div key={o.id} className="flex items-center gap-1.5">
              <span className="text-[11px] text-[var(--text-muted)]">{j + 1}.</span>
              <input value={o.titulo} maxLength={MAX_TITULO} placeholder={`Botón ${j + 1}`}
                onChange={(e) => onChange({ ...p, opciones: opciones.map((x: any) => (x.id === o.id ? { ...x, titulo: e.target.value } : x)) })}
                className={`${inp} flex-1`} />
              <span className="w-9 text-right text-[10px] text-[var(--text-muted)]">{o.titulo.length}/{MAX_TITULO}</span>
              {opciones.length > 1 && (
                <button onClick={() => onChange({ ...p, opciones: opciones.filter((x: any) => x.id !== o.id) })}
                  className="rounded px-1 text-[11px]" style={{ color: 'var(--status-critical)' }} aria-label="Quitar botón">✕</button>
              )}
            </div>
          ))}
          {opciones.length < MAX_BOTONES && (
            <button onClick={() => onChange({ ...p, opciones: [...opciones, { id: uid(), titulo: '', siguiente: null }] })}
              className="text-[11px] underline text-[var(--text-secondary)]">+ otro botón ({opciones.length}/{MAX_BOTONES})</button>
          )}
          <div className="text-[10px] text-[var(--text-muted)]">Si escribe en vez de tocar, igual se entiende si coincide con un botón.</div>
        </div>
      );
    }
    case 'condicion':
      return (
        <div className="space-y-1.5">
          <select value={p.campo ?? 'etiqueta'} onChange={(e) => onChange({ ...p, campo: e.target.value, valor: '' })} className={sel}>
            <option value="etiqueta">¿Tiene la etiqueta…?</option>
            <option value="etapa">¿Está en la etapa…?</option>
            <option value="texto">¿Su mensaje dice…?</option>
            <option value="email">¿Ya tenemos su email?</option>
            <option value="telefono">¿Ya tenemos su teléfono?</option>
          </select>
          {p.campo === 'etapa' ? (
            <select value={p.valor ?? ''} onChange={(e) => set('valor', e.target.value)} className={sel}>
              <option value="">Elegí la etapa…</option>
              {ctx.etapas.map((e) => <option key={e.slug} value={e.slug}>{e.nombre}</option>)}
            </select>
          ) : (p.campo === 'etiqueta' || p.campo === 'texto' || !p.campo) ? (
            <input value={p.valor ?? ''} onChange={(e) => set('valor', e.target.value)} list={p.campo === 'texto' ? undefined : 'etiquetas-existentes'}
              placeholder={p.campo === 'texto' ? 'ej. precio, cuánto' : 'ej. cliente'} className={inp} />
          ) : null}
          <div className="text-[10px] text-[var(--text-muted)]">Conectá la salida ✅ Sí y la ❌ No a lo que corresponda.</div>
        </div>
      );
    default:
      return null;
  }
}
