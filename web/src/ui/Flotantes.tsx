import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Todo lo que flota: menús desplegables, popovers, diálogos (que en el
// celular son hojas que suben desde abajo) y el selector con "+".

export function useEsMovil(px = 640) {
  const [movil, setMovil] = useState(() => typeof window !== 'undefined' && window.innerWidth < px);
  useEffect(() => {
    const f = () => setMovil(window.innerWidth < px);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, [px]);
  return movil;
}

/** Cierra con clic afuera o Escape. */
function useCerrarFuera(abierto: boolean, refs: Array<React.RefObject<HTMLElement>>, cerrar: () => void, esArriba?: () => boolean) {
  useEffect(() => {
    if (!abierto) return;
    const abajo = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (refs.some((r) => r.current?.contains(t))) return;
      cerrar();
    };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape' && (!esArriba || esArriba())) cerrar(); };
    document.addEventListener('mousedown', abajo);
    document.addEventListener('touchstart', abajo, { passive: true });
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', abajo);
      document.removeEventListener('touchstart', abajo);
      document.removeEventListener('keydown', tecla);
    };
  }, [abierto, cerrar, refs]);
}

function bloquearScroll(activo: boolean) {
  if (!activo) return () => {};
  const prev = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  return () => { document.body.style.overflow = prev; };
}

/**
 * Capas abiertas (diálogos y hojas), de abajo hacia arriba. Escape cierra
 * solo la de arriba: con un diálogo dentro de otro no se cierran los dos.
 */
const capas: string[] = [];
function useCapa(abierta: boolean) {
  const id = useId();
  useEffect(() => {
    if (!abierta) return;
    capas.push(id);
    return () => { const i = capas.lastIndexOf(id); if (i >= 0) capas.splice(i, 1); };
  }, [abierta, id]);
  return () => capas[capas.length - 1] === id;
}

/**
 * En el celular, arrastrar el encabezado de una hoja hacia abajo la sigue con
 * el dedo; si se suelta pasado el 30 % de su alto (o con un tirón) se cierra,
 * si no vuelve a su lugar.
 */
function useArrastrarParaCerrar(hoja: React.RefObject<HTMLElement>, cerrar: () => void, activo: boolean) {
  const a = useRef<{ y0: number; t0: number; dy: number; id: number } | null>(null);
  if (!activo) return {};
  const fin = (e: React.PointerEvent) => {
    const x = a.current; a.current = null;
    const el = hoja.current;
    if (!x || !el || x.id !== e.pointerId) return;
    const v = x.dy / Math.max(1, performance.now() - x.t0);
    el.style.transition = 'transform 180ms ease-out';
    if (x.dy > el.offsetHeight * 0.3 || (v > 0.5 && x.dy > 40)) {
      el.style.transform = 'translateY(100%)';
      window.setTimeout(() => { cerrar(); window.setTimeout(() => { el.style.transform = ''; el.style.transition = ''; }, 300); }, 170);
    } else {
      el.style.transform = '';
    }
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('button, a, input, textarea, select')) return;
      a.current = { y0: e.clientY, t0: performance.now(), dy: 0, id: e.pointerId };
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* sin captura */ }
      if (hoja.current) hoja.current.style.transition = 'none';
    },
    onPointerMove: (e: React.PointerEvent) => {
      const x = a.current;
      if (!x || x.id !== e.pointerId || !hoja.current) return;
      x.dy = Math.max(0, e.clientY - x.y0);
      hoja.current.style.transform = x.dy ? `translateY(${x.dy}px)` : '';
    },
    onPointerUp: fin,
    onPointerCancel: fin,
    style: { touchAction: 'none' } as React.CSSProperties,
  };
}

// ---------------------------------------------------------------------
// Hoja / diálogo
// ---------------------------------------------------------------------

/**
 * Diálogo: en escritorio, tarjeta centrada; en el celular, hoja que sube
 * desde abajo (alcanzable con el pulgar). Escape o tocar afuera cierra.
 */
export function Dialogo({
  abierto, onCerrar, titulo, descripcion, children, pie, ancho = 460, autoFoco = true,
}: {
  abierto: boolean; onCerrar: () => void; titulo?: React.ReactNode; descripcion?: React.ReactNode;
  children?: React.ReactNode; pie?: React.ReactNode; ancho?: number;
  /** false en guías largas: no salta al primer campo (en el celular abriría el teclado). */
  autoFoco?: boolean;
}) {
  const movil = useEsMovil();
  const caja = useRef<HTMLDivElement>(null);
  const id = useId();
  const arriba = useCapa(abierto);
  const arrastre = useArrastrarParaCerrar(caja, onCerrar, movil);
  useEffect(() => bloquearScroll(abierto), [abierto]);
  useEffect(() => {
    if (!abierto) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape' && arriba()) { e.stopPropagation(); onCerrar(); } };
    document.addEventListener('keydown', tecla);
    // Foco al primer campo (o al diálogo) para poder escribir de una.
    const t = window.setTimeout(() => {
      const primero = autoFoco ? caja.current?.querySelector<HTMLElement>('input,textarea,select,button[data-autofocus]') : null;
      (primero ?? caja.current)?.focus({ preventScroll: true });
    }, 30);
    return () => { document.removeEventListener('keydown', tecla); window.clearTimeout(t); };
  }, [abierto, onCerrar, autoFoco]);
  if (!abierto) return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
      <div className="ui-fundido absolute inset-0 bg-black/35" onClick={onCerrar} aria-hidden />
      <div ref={caja} role="dialog" aria-modal="true" aria-labelledby={titulo ? id : undefined} tabIndex={-1}
        className={`${movil ? 'ui-subir w-full rounded-t-2xl pb-[max(16px,env(safe-area-inset-bottom))]' : 'ui-aparecer rounded-2xl'} ui-alto-hoja relative overflow-y-auto overscroll-contain shadow-2xl outline-none`}
        style={{ background: 'var(--surface-1)', width: movil ? '100%' : ancho, border: '1px solid var(--border-hairline)' }}>
        {/* Encabezado fijo: en guías largas el título y la ✕ no se van; en el celular se arrastra para cerrar. */}
        <div {...arrastre} className={`sticky top-0 z-10 ${titulo || descripcion ? '' : 'pb-1'}`} style={{ background: 'var(--surface-1)', ...arrastre.style }}>
          {movil && <div className="mx-auto h-5 pt-2" aria-hidden><div className="mx-auto h-1 w-10 rounded-full" style={{ background: 'var(--baseline)' }} /></div>}
          {(titulo || descripcion) && (
            <div className={`flex items-start justify-between gap-3 px-5 pb-1 ${movil ? 'pt-1.5' : 'pt-4'}`}>
              <div className="min-w-0">
                {titulo && <h2 id={id} className="text-[16px] font-semibold leading-snug">{titulo}</h2>}
                {descripcion && <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">{descripcion}</p>}
              </div>
              <button onClick={onCerrar} aria-label="Cerrar" className="ui-foco -mr-1.5 -mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[14px] text-[var(--text-muted)] hover:bg-[var(--page-plane)] md:h-8 md:w-8">✕</button>
            </div>
          )}
        </div>
        <div className="px-5 py-3">{children}</div>
        {pie && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-hairline)] px-5 py-3">{pie}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------
// Menú desplegable
// ---------------------------------------------------------------------

const CtxMenu = createContext<{ cerrar: () => void }>({ cerrar: () => {} });

/**
 * Menú que se despliega desde un botón. En el celular sale como hoja desde
 * abajo. `disparador` recibe { abierto, alternar } para dibujar el botón.
 */
export function Menu({
  disparador, children, alinear = 'izquierda', ancho = 260, titulo, className = '',
}: {
  disparador: (p: { abierto: boolean; alternar: () => void; ref: React.RefObject<HTMLButtonElement> }) => React.ReactNode;
  children: React.ReactNode; alinear?: 'izquierda' | 'derecha'; ancho?: number; titulo?: string; className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const movil = useEsMovil();
  const envoltura = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const flotante = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; arriba: boolean } | null>(null);
  const cerrar = useCallback(() => setAbierto(false), []);
  const hoja = useRef<HTMLDivElement>(null);
  const arriba = useCapa(abierto);
  const arrastre = useArrastrarParaCerrar(hoja, cerrar, movil);
  useCerrarFuera(abierto && !movil, [envoltura, panel, flotante], cerrar, arriba);

  // En escritorio el menú se dibuja por encima de todo (portal), pegado a su
  // botón: así no lo recorta una columna o una lista que se desplaza.
  useEffect(() => {
    if (!abierto || movil) { setPos(null); return; }
    const ubicar = () => {
      const r = (envoltura.current?.firstElementChild as HTMLElement | null)?.getBoundingClientRect()
        ?? envoltura.current?.getBoundingClientRect();
      if (!r) return;
      const alto = Math.min(window.innerHeight * 0.6, 420);
      const arriba = r.bottom + alto + 12 > window.innerHeight && r.top > alto;
      let left = alinear === 'derecha' ? r.right - ancho : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - ancho - 8));
      setPos({ top: arriba ? r.top - 6 : r.bottom + 6, left, arriba });
    };
    ubicar();
    // Al desplazar, el menú sigue a su botón; solo se cierra si el botón sale
    // de la vista. Los desplazamientos de los primeros 250 ms (el final de un
    // scroll suave justo al tocar) no lo cierran.
    const abiertoEn = performance.now();
    const alDesplazar = (e: Event) => {
      if (flotante.current?.contains(e.target as Node)) return;
      if (performance.now() - abiertoEn < 250) { ubicar(); return; }
      const r = (envoltura.current?.firstElementChild as HTMLElement | null)?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) cerrar();
      else ubicar();
    };
    window.addEventListener('resize', ubicar);
    window.addEventListener('scroll', alDesplazar, true);
    return () => { window.removeEventListener('resize', ubicar); window.removeEventListener('scroll', alDesplazar, true); };
  }, [abierto, movil, alinear, ancho, cerrar]);
  useEffect(() => bloquearScroll(abierto && movil), [abierto, movil]);
  useEffect(() => {
    if (!abierto || !movil) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape' && arriba()) { e.stopPropagation(); cerrar(); } };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [abierto, movil, cerrar]); // eslint-disable-line react-hooks/exhaustive-deps

  const contenido = (
    <CtxMenu.Provider value={{ cerrar }}>
      <div ref={panel} role="menu" className="flex flex-col gap-0.5 p-1.5">{children}</div>
    </CtxMenu.Provider>
  );

  return (
    <div ref={envoltura} className={`relative inline-flex ${className}`}>
      {disparador({ abierto, alternar: () => setAbierto((v) => !v), ref: boton })}
      {abierto && !movil && pos && createPortal(
        <div ref={flotante} className="ui-aparecer fixed z-[65] max-h-[60vh] overflow-y-auto rounded-xl shadow-xl"
          style={{
            width: ancho, left: pos.left, top: pos.top, transform: pos.arriba ? 'translateY(-100%)' : undefined,
            background: 'var(--surface-1)', border: '1px solid var(--border-hairline)',
          }}>
          {titulo && <div className="px-3 pb-0.5 pt-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{titulo}</div>}
          {contenido}
        </div>,
        document.body,
      )}
      {abierto && movil && createPortal(
        <div className="fixed inset-0 z-[60] flex items-end">
          <div className="ui-fundido absolute inset-0 bg-black/35" onClick={cerrar} aria-hidden />
          <div ref={hoja} className="ui-subir relative max-h-[75vh] w-full overflow-y-auto rounded-t-2xl pb-[max(12px,env(safe-area-inset-bottom))] shadow-2xl"
            style={{ background: 'var(--surface-1)' }}>
            <div {...arrastre} className="sticky top-0 z-10" style={{ background: 'var(--surface-1)', ...arrastre.style }}>
              <div className="h-5 pt-2" aria-hidden><div className="mx-auto h-1 w-10 rounded-full" style={{ background: 'var(--baseline)' }} /></div>
              {titulo && <div className="px-4 pb-1 pt-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{titulo}</div>}
            </div>
            {contenido}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export function ItemMenu({
  children, onClick, icono, descripcion, activo, peligro, derecha, deshabilitado, cerrarAlTocar = true,
}: {
  children: React.ReactNode; onClick?: () => void; icono?: React.ReactNode; descripcion?: React.ReactNode;
  activo?: boolean; peligro?: boolean; derecha?: React.ReactNode; deshabilitado?: boolean; cerrarAlTocar?: boolean;
}) {
  const { cerrar } = useContext(CtxMenu);
  return (
    <button type="button" role="menuitem" disabled={deshabilitado}
      onClick={() => { onClick?.(); if (cerrarAlTocar) cerrar(); }}
      className={`ui-foco flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors disabled:opacity-40 ${activo ? 'bg-[var(--page-plane)] font-medium' : 'hover:bg-[var(--page-plane)]'}`}
      style={peligro ? { color: 'var(--status-critical)' } : undefined}>
      {icono !== undefined && <span className="flex w-5 shrink-0 justify-center text-[15px]">{icono}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{children}</span>
        {descripcion && <span className="block truncate text-[11px] font-normal text-[var(--text-muted)]">{descripcion}</span>}
      </span>
      {activo && <span className="text-[13px]" style={{ color: 'var(--series-1)' }} aria-hidden>✓</span>}
      {derecha}
    </button>
  );
}

export function SeparadorMenu() {
  return <div className="my-1 h-px" style={{ background: 'var(--border-hairline)' }} role="separator" />;
}

// ---------------------------------------------------------------------
// Selector con "+"
// ---------------------------------------------------------------------

/**
 * Selector de "cuál" (pipeline, curso, cuenta…) con el botón "+" al lado
 * para crear uno nuevo ahí mismo. Tocando el nombre se despliega la lista.
 */
export function SelectorConMas<T extends { id: string; nombre: string }>({
  items, actualId, onElegir, onCrear, onNuevo, queEs = 'pipeline', extra, onGestionar, textoGestionar = 'Configurar',
}: {
  items: T[]; actualId: string | null; onElegir: (id: string) => void;
  onCrear?: (nombre: string) => Promise<void> | void; queEs?: string;
  /** En vez del mini formulario: el "+" abre tu propio diálogo (con más opciones). */
  onNuevo?: () => void;
  extra?: (item: T) => React.ReactNode; onGestionar?: () => void; textoGestionar?: string;
}) {
  const actual = items.find((i) => i.id === actualId) ?? items[0];
  const [creando, setCreando] = useState(false);
  const [nombre, setNombre] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  useCerrarFuera(creando, [caja], () => { setCreando(false); setNombre(''); });

  async function crear(e?: React.FormEvent) {
    e?.preventDefault();
    if (!nombre.trim() || !onCrear) return;
    setOcupado(true);
    try { await onCrear(nombre.trim()); setNombre(''); setCreando(false); } finally { setOcupado(false); }
  }

  return (
    <div ref={caja} className="relative inline-flex items-center gap-1">
      <Menu titulo={items.length > 1 ? `Tus ${queEs}s` : undefined} ancho={300}
        disparador={({ abierto, alternar, ref }) => (
          <button ref={ref} type="button" onClick={alternar} aria-haspopup="menu" aria-expanded={abierto}
            className="ui-foco inline-flex h-10 max-w-[60vw] items-center gap-1.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 text-[14px] font-semibold hover:bg-[var(--page-plane)] md:h-9 md:text-[13px]">
            <span className="truncate">{actual?.nombre ?? `Elegí un ${queEs}`}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" className={`shrink-0 transition-transform ${abierto ? 'rotate-180' : ''}`} aria-hidden>
              <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}>
        {items.map((i) => (
          <ItemMenu key={i.id} activo={i.id === actual?.id} onClick={() => onElegir(i.id)} descripcion={extra?.(i)}>{i.nombre}</ItemMenu>
        ))}
        {(onCrear || onNuevo || onGestionar) && <SeparadorMenu />}
        {(onCrear || onNuevo) && <ItemMenu icono="+" onClick={() => (onNuevo ? onNuevo() : setCreando(true))}>Nuevo {queEs}</ItemMenu>}
        {onGestionar && <ItemMenu icono="⚙" onClick={onGestionar}>{textoGestionar}</ItemMenu>}
      </Menu>
      {(onCrear || onNuevo) && (
        <button type="button" onClick={() => (onNuevo ? onNuevo() : setCreando((v) => !v))} aria-label={`Crear ${queEs}`} title={`Crear ${queEs}`}
          className="ui-foco flex h-10 w-10 items-center justify-center rounded-lg text-[18px] font-medium text-white shadow-sm hover:brightness-110 md:h-9 md:w-9"
          style={{ background: 'var(--accion)' }}>+</button>
      )}
      {creando && (
        <form onSubmit={crear} className="ui-aparecer absolute left-0 top-[calc(100%+6px)] z-50 flex w-[min(320px,86vw)] flex-col gap-2 rounded-xl p-3 shadow-xl"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-hairline)' }}>
          <label className="text-[12px] font-medium text-[var(--text-secondary)]">Nombre del nuevo {queEs}</label>
          <input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={queEs === 'pipeline' ? 'Ej. Cierre high-ticket' : 'Nombre'}
            onKeyDown={(e) => { if (e.key === 'Escape') { setCreando(false); setNombre(''); } }}
            className="ui-control h-10 w-full rounded-lg px-3 text-[16px] md:h-9 md:text-[13px]" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setCreando(false); setNombre(''); }} className="ui-foco h-9 rounded-lg px-3 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]">Cancelar</button>
            <button type="submit" disabled={!nombre.trim() || ocupado} className="ui-foco h-9 rounded-[10px] px-3 text-[12px] font-semibold text-white disabled:opacity-50" style={{ background: 'var(--accion)' }}>
              {ocupado ? 'Creando…' : `Crear ${queEs}`}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
