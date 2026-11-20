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
function useCerrarFuera(abierto: boolean, refs: Array<React.RefObject<HTMLElement>>, cerrar: () => void) {
  useEffect(() => {
    if (!abierto) return;
    const abajo = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (refs.some((r) => r.current?.contains(t))) return;
      cerrar();
    };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar(); };
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

// ---------------------------------------------------------------------
// Hoja / diálogo
// ---------------------------------------------------------------------

/**
 * Diálogo: en escritorio, tarjeta centrada; en el celular, hoja que sube
 * desde abajo (alcanzable con el pulgar). Escape o tocar afuera cierra.
 */
export function Dialogo({
  abierto, onCerrar, titulo, descripcion, children, pie, ancho = 460,
}: {
  abierto: boolean; onCerrar: () => void; titulo?: React.ReactNode; descripcion?: React.ReactNode;
  children?: React.ReactNode; pie?: React.ReactNode; ancho?: number;
}) {
  const movil = useEsMovil();
  const caja = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => bloquearScroll(abierto), [abierto]);
  useEffect(() => {
    if (!abierto) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    document.addEventListener('keydown', tecla);
    // Foco al primer campo (o al diálogo) para poder escribir de una.
    const t = window.setTimeout(() => {
      const primero = caja.current?.querySelector<HTMLElement>('input,textarea,select,button[data-autofocus]');
      (primero ?? caja.current)?.focus();
    }, 30);
    return () => { document.removeEventListener('keydown', tecla); window.clearTimeout(t); };
  }, [abierto, onCerrar]);
  if (!abierto) return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
      <div className="ui-fundido absolute inset-0 bg-black/35" onClick={onCerrar} aria-hidden />
      <div ref={caja} role="dialog" aria-modal="true" aria-labelledby={titulo ? id : undefined} tabIndex={-1}
        className={`${movil ? 'ui-subir w-full rounded-t-2xl pb-[max(16px,env(safe-area-inset-bottom))]' : 'ui-aparecer rounded-2xl'} relative max-h-[88vh] overflow-y-auto shadow-2xl outline-none`}
        style={{ background: 'var(--surface-1)', width: movil ? '100%' : ancho, border: '1px solid var(--border-hairline)' }}>
        {movil && <div className="mx-auto mt-2 h-1 w-10 rounded-full" style={{ background: 'var(--baseline)' }} aria-hidden />}
        {(titulo || descripcion) && (
          <div className="flex items-start justify-between gap-3 px-5 pb-1 pt-4">
            <div className="min-w-0">
              {titulo && <h2 id={id} className="text-[16px] font-semibold leading-snug">{titulo}</h2>}
              {descripcion && <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">{descripcion}</p>}
            </div>
            <button onClick={onCerrar} aria-label="Cerrar" className="ui-foco -mr-1.5 -mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[14px] text-[var(--text-muted)] hover:bg-[var(--page-plane)]">✕</button>
          </div>
        )}
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
  const cerrar = useCallback(() => setAbierto(false), []);
  useCerrarFuera(abierto && !movil, [envoltura, panel], cerrar);
  useEffect(() => bloquearScroll(abierto && movil), [abierto, movil]);
  useEffect(() => {
    if (!abierto || !movil) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar(); };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [abierto, movil, cerrar]);

  const contenido = (
    <CtxMenu.Provider value={{ cerrar }}>
      <div ref={panel} role="menu" className="flex flex-col gap-0.5 p-1.5">{children}</div>
    </CtxMenu.Provider>
  );

  return (
    <div ref={envoltura} className={`relative inline-flex ${className}`}>
      {disparador({ abierto, alternar: () => setAbierto((v) => !v), ref: boton })}
      {abierto && !movil && (
        <div className={`ui-aparecer absolute top-[calc(100%+6px)] z-50 max-h-[60vh] overflow-y-auto rounded-xl shadow-xl ${alinear === 'derecha' ? 'right-0' : 'left-0'}`}
          style={{ width: ancho, background: 'var(--surface-1)', border: '1px solid var(--border-hairline)' }}>
          {titulo && <div className="px-3 pb-0.5 pt-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{titulo}</div>}
          {contenido}
        </div>
      )}
      {abierto && movil && createPortal(
        <div className="fixed inset-0 z-[60] flex items-end">
          <div className="ui-fundido absolute inset-0 bg-black/35" onClick={cerrar} aria-hidden />
          <div className="ui-subir relative max-h-[75vh] w-full overflow-y-auto rounded-t-2xl pb-[max(12px,env(safe-area-inset-bottom))] shadow-2xl"
            style={{ background: 'var(--surface-1)' }}>
            <div className="mx-auto mt-2 h-1 w-10 rounded-full" style={{ background: 'var(--baseline)' }} aria-hidden />
            {titulo && <div className="px-4 pb-1 pt-3 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{titulo}</div>}
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
  items, actualId, onElegir, onCrear, queEs = 'pipeline', extra, onGestionar, textoGestionar = 'Configurar',
}: {
  items: T[]; actualId: string | null; onElegir: (id: string) => void;
  onCrear?: (nombre: string) => Promise<void> | void; queEs?: string;
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
            {items.length > 1 && <span className="rounded-full px-1.5 text-[10px] font-medium text-[var(--text-muted)]" style={{ background: 'var(--gridline)' }}>{items.length}</span>}
            <svg width="14" height="14" viewBox="0 0 24 24" className={`shrink-0 transition-transform ${abierto ? 'rotate-180' : ''}`} aria-hidden>
              <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}>
        {items.map((i) => (
          <ItemMenu key={i.id} activo={i.id === actual?.id} onClick={() => onElegir(i.id)} descripcion={extra?.(i)}>{i.nombre}</ItemMenu>
        ))}
        {(onCrear || onGestionar) && <SeparadorMenu />}
        {onCrear && <ItemMenu icono="+" onClick={() => setCreando(true)}>Nuevo {queEs}</ItemMenu>}
        {onGestionar && <ItemMenu icono="⚙" onClick={onGestionar}>{textoGestionar}</ItemMenu>}
      </Menu>
      {onCrear && (
        <button type="button" onClick={() => setCreando((v) => !v)} aria-label={`Crear ${queEs}`} title={`Crear ${queEs}`}
          className="ui-foco flex h-10 w-10 items-center justify-center rounded-lg text-[18px] font-medium text-white shadow-sm hover:brightness-110 md:h-9 md:w-9"
          style={{ background: 'var(--series-1)' }}>+</button>
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
            <button type="submit" disabled={!nombre.trim() || ocupado} className="ui-foco h-9 rounded-lg px-3 text-[12px] font-medium text-white disabled:opacity-50" style={{ background: 'var(--series-1)' }}>
              {ocupado ? 'Creando…' : `Crear ${queEs}`}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
