import { Children, useCallback, useEffect, useRef, useState } from 'react';

// Todo lo que se pasa con el dedo: carruseles, pestañas deslizables, gesto
// de deslizar para cambiar de pestaña y filas con acciones al deslizar.
// Se apoya en CSS scroll-snap (nativo, fluido, accesible) y en eventos
// táctiles simples. Nada de librerías.

// ---------------------------------------------------------------------
// Gesto de deslizar
// ---------------------------------------------------------------------

/** ¿El toque empezó dentro de algo que ya se desplaza de costado (carrusel, tabla)? */
function dentroDeScrollHorizontal(objetivo: EventTarget | null, limite: HTMLElement) {
  let el = objetivo as HTMLElement | null;
  while (el && el !== limite) {
    if (el.dataset?.noDeslizar !== undefined) return true;
    const st = window.getComputedStyle(el);
    if ((st.overflowX === 'auto' || st.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 2) return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * Detecta un deslizamiento horizontal con el dedo sobre un elemento.
 * Ignora los gestos verticales (scroll) y los que empiezan dentro de un
 * carrusel o una tabla que se desplaza.
 */
export function useDeslizar<T extends HTMLElement>(
  { onIzquierda, onDerecha }: { onIzquierda?: () => void; onDerecha?: () => void },
  umbral = 60,
) {
  const ref = useRef<T>(null);
  const cb = useRef({ onIzquierda, onDerecha });
  cb.current = { onIzquierda, onDerecha };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let x0 = 0; let y0 = 0; let t0 = 0; let valido = false;
    const ini = (e: TouchEvent) => {
      if (e.touches.length !== 1) { valido = false; return; }
      valido = !dentroDeScrollHorizontal(e.target, el);
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = performance.now();
    };
    const fin = (e: TouchEvent) => {
      if (!valido) return;
      valido = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0; const dy = t.clientY - y0;
      if (Math.abs(dx) < umbral || Math.abs(dy) > Math.abs(dx) * 0.6 || performance.now() - t0 > 700) return;
      if (dx < 0) cb.current.onIzquierda?.(); else cb.current.onDerecha?.();
    };
    el.addEventListener('touchstart', ini, { passive: true });
    el.addEventListener('touchend', fin, { passive: true });
    return () => { el.removeEventListener('touchstart', ini); el.removeEventListener('touchend', fin); };
  }, [umbral]);
  return ref;
}

// ---------------------------------------------------------------------
// Pestañas
// ---------------------------------------------------------------------

export interface Pestana<T extends string> { id: T; etiqueta: React.ReactNode; icono?: React.ReactNode; contador?: number | string }

/**
 * Pestañas que en el celular se deslizan de costado (la activa siempre a la
 * vista). Con flechas del teclado se cambia de pestaña.
 */
export function Pestanas<T extends string>({ pestanas, actual, onCambiar, className = '' }: {
  pestanas: Array<Pestana<T>>; actual: T; onCambiar: (id: T) => void; className?: string;
}) {
  const fila = useRef<HTMLDivElement>(null);
  // La pestaña activa siempre a la vista, moviendo SOLO la fila (scrollIntoView
  // también bajaba la página entera si las pestañas estaban más abajo).
  useEffect(() => {
    const f = fila.current;
    const el = f?.querySelector<HTMLElement>(`[data-pestana="${actual}"]`);
    if (!f || !el || f.scrollWidth <= f.clientWidth) return;
    f.scrollTo({ left: el.offsetLeft - f.clientWidth / 2 + el.offsetWidth / 2, behavior: 'smooth' });
  }, [actual]);
  function tecla(e: React.KeyboardEvent) {
    const i = pestanas.findIndex((p) => p.id === actual);
    if (e.key === 'ArrowRight' && i < pestanas.length - 1) onCambiar(pestanas[i + 1].id);
    if (e.key === 'ArrowLeft' && i > 0) onCambiar(pestanas[i - 1].id);
  }
  return (
    <div ref={fila} role="tablist" onKeyDown={tecla} data-no-deslizar
      className={`sin-barra -mx-4 flex snap-x gap-1 overflow-x-auto border-b border-[var(--border-hairline)] px-4 md:mx-0 md:px-0 ${className}`}>
      {pestanas.map((p) => {
        const activa = p.id === actual;
        return (
          <button key={p.id} type="button" role="tab" aria-selected={activa} data-pestana={p.id} tabIndex={activa ? 0 : -1}
            onClick={() => onCambiar(p.id)}
            className={`ui-foco -mb-px flex shrink-0 snap-start items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] transition-colors ${activa ? 'border-[var(--series-1)] font-semibold text-[var(--text-primary)]' : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
            {p.icono && <span className="text-[14px]">{p.icono}</span>}
            {p.etiqueta}
            {p.contador !== undefined && p.contador !== null && p.contador !== 0 && (
              <span className="cifras rounded px-1.5 text-[10px] font-medium" style={{ background: 'var(--gridline)', color: activa ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                {p.contador}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Contenido de pestañas que se cambia deslizando el dedo a los costados. */
export function ContenidoDeslizable<T extends string>({ pestanas, actual, onCambiar, children, className = '' }: {
  pestanas: Array<{ id: T }>; actual: T; onCambiar: (id: T) => void; children: React.ReactNode; className?: string;
}) {
  const i = pestanas.findIndex((p) => p.id === actual);
  const ref = useDeslizar<HTMLDivElement>({
    onIzquierda: () => { if (i < pestanas.length - 1) onCambiar(pestanas[i + 1].id); },
    onDerecha: () => { if (i > 0) onCambiar(pestanas[i - 1].id); },
  });
  // El key va en el div de adentro: el de afuera (con los gestos) no se recrea,
  // así deslizar sigue andando después del primer cambio de pestaña.
  return <div ref={ref} className={className}><div className="ui-fundido" key={actual}>{children}</div></div>;
}

// ---------------------------------------------------------------------
// Carrusel
// ---------------------------------------------------------------------

const GRID: Record<number, string> = {
  2: 'md:grid-cols-2', 3: 'md:grid-cols-2 lg:grid-cols-3', 4: 'md:grid-cols-2 lg:grid-cols-4',
  5: 'md:grid-cols-3 lg:grid-cols-5', 6: 'md:grid-cols-3 xl:grid-cols-6',
};

/**
 * Fila de tarjetas que se pasa con el dedo (scroll-snap) con puntitos que
 * indican dónde estás. En escritorio, flechas; o con `soloMovil`, se vuelve
 * una grilla normal en pantallas medianas en adelante.
 */
export function Carrusel({
  children, etiqueta, anchoItem = 'min(82vw, 300px)', soloMovil = false, columnas = 3, puntos = true, className = '',
}: {
  children: React.ReactNode; etiqueta?: string; anchoItem?: string; soloMovil?: boolean;
  columnas?: 2 | 3 | 4 | 5 | 6; puntos?: boolean; className?: string;
}) {
  const fila = useRef<HTMLDivElement>(null);
  const items = Children.toArray(children).filter(Boolean);
  const [activo, setActivo] = useState(0);
  const [desborda, setDesborda] = useState(false);
  const [bordes, setBordes] = useState({ ini: true, fin: false });

  const medir = useCallback(() => {
    const el = fila.current;
    if (!el) return;
    const desb = el.scrollWidth > el.clientWidth + 4;
    setDesborda(desb);
    setBordes({ ini: el.scrollLeft < 8, fin: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 });
    const hijos = Array.from(el.children) as HTMLElement[];
    if (!hijos.length) return;
    const centro = el.scrollLeft + el.clientWidth / 2;
    let mejor = 0; let dist = Infinity;
    hijos.forEach((h, i) => {
      const d = Math.abs(h.offsetLeft + h.offsetWidth / 2 - centro);
      if (d < dist) { dist = d; mejor = i; }
    });
    setActivo(el.scrollLeft < 8 ? 0 : bordesFin(el) ? hijos.length - 1 : mejor);
  }, []);
  const bordesFin = (el: HTMLElement) => el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;

  useEffect(() => {
    medir();
    const el = fila.current;
    if (!el) return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [medir, items.length]);

  const ir = (i: number) => {
    const el = fila.current;
    const h = el?.children[i] as HTMLElement | undefined;
    if (h && el) el.scrollTo({ left: h.offsetLeft - el.offsetLeft - 16, behavior: 'smooth' });
  };
  const mover = (d: -1 | 1) => fila.current?.scrollBy({ left: d * fila.current.clientWidth * 0.85, behavior: 'smooth' });

  return (
    <div className={`relative ${className}`} role="region" aria-label={etiqueta} aria-roledescription="carrusel">
      <div ref={fila} onScroll={medir} data-no-deslizar
        className={`sin-barra -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 ${soloMovil ? `md:mx-0 md:grid md:overflow-visible md:px-0 ${GRID[columnas] ?? GRID[3]}` : ''}`}>
        {items.map((h, i) => (
          <div key={i} className={`shrink-0 snap-start ${soloMovil ? 'w-[var(--ancho-item)] md:w-auto' : 'w-[var(--ancho-item)]'}`}
            style={{ ['--ancho-item' as any]: anchoItem }}>
            <div className="h-full">{h}</div>
          </div>
        ))}
      </div>
      {desborda && !soloMovil && (
        <>
          {!bordes.ini && (
            <button type="button" onClick={() => mover(-1)} aria-label="Anterior"
              className="ui-foco absolute left-0 top-1/2 hidden h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full shadow-md md:flex"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-hairline)' }}>‹</button>
          )}
          {!bordes.fin && (
            <button type="button" onClick={() => mover(1)} aria-label="Siguiente"
              className="ui-foco absolute right-0 top-1/2 hidden h-9 w-9 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full shadow-md md:flex"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-hairline)' }}>›</button>
          )}
        </>
      )}
      {puntos && desborda && items.length > 1 && (
        <div className={`mt-2 flex justify-center gap-1.5 ${soloMovil ? 'md:hidden' : ''}`} aria-hidden>
          {items.map((_, i) => (
            <button key={i} type="button" tabIndex={-1} onClick={() => ir(i)}
              className="h-1.5 rounded-full transition-all"
              style={{ width: i === activo ? 16 : 6, background: i === activo ? 'var(--series-1)' : 'var(--baseline)' }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Fila con acciones al deslizar
// ---------------------------------------------------------------------

export interface AccionFila { etiqueta: string; icono?: React.ReactNode; color: string; onClick: () => void }

/** Abrir una fila cierra la que estaba abierta (como en Mail o WhatsApp). */
const EVENTO_FILA = 'infocrm:fila-abierta';

/**
 * Fila de lista con acciones al deslizar (celular): hacia la izquierda deja
 * ver `acciones` (a la derecha) y hacia la derecha `accionesInicio` (a la
 * izquierda), p. ej. «Leído». Con `completo`, deslizar casi toda la fila
 * ejecuta la primera acción de ese lado (con una vibración corta). En
 * escritorio las acciones aparecen al pasar el mouse; con `compacto`, solo
 * los íconos (para columnas angostas).
 */
export function FilaDeslizable({ children, acciones, accionesInicio = [], completo = false, compacto = false, fondo = 'var(--page-plane)', className = '' }: {
  children: React.ReactNode; acciones: AccionFila[]; accionesInicio?: AccionFila[];
  completo?: boolean; compacto?: boolean; fondo?: string; className?: string;
}) {
  const anchoFin = acciones.length * 76;
  const anchoIni = accionesInicio.length * 76;
  const [dx, setDxEstado] = useState(0);
  // El último desplazamiento también en una ref: al soltar se lee de acá (el
  // estado puede no haberse redibujado todavía si los toques vienen rápido).
  const dxRef = useRef(0);
  const setDx = (v: number) => { dxRef.current = v; setDxEstado(v); };
  const [arrastrando, setArrastrando] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const id = useRef(Math.random().toString(36).slice(2));
  const ini = useRef<{ x: number; y: number; base: number; eje: 'x' | 'y' | null }>({ x: 0, y: 0, base: 0, eje: null });

  useEffect(() => {
    const f = (e: Event) => { if ((e as CustomEvent).detail !== id.current && dxRef.current !== 0) { dxRef.current = 0; setDxEstado(0); } };
    window.addEventListener(EVENTO_FILA, f);
    return () => window.removeEventListener(EVENTO_FILA, f);
  }, []);

  const anchoFila = () => caja.current?.offsetWidth ?? 360;
  const umbralCompleto = () => anchoFila() * 0.6;

  function empezar(e: React.TouchEvent) {
    const t = e.touches[0];
    ini.current = { x: t.clientX, y: t.clientY, base: dxRef.current, eje: null };
    setArrastrando(true);
  }
  function mover(e: React.TouchEvent) {
    const t = e.touches[0];
    const mx = t.clientX - ini.current.x; const my = t.clientY - ini.current.y;
    if (!ini.current.eje) {
      if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
      ini.current.eje = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (ini.current.eje === 'x') window.dispatchEvent(new CustomEvent(EVENTO_FILA, { detail: id.current }));
    }
    if (ini.current.eje !== 'x') return;
    const max = completo ? anchoFila() : 0;
    const izq = -(completo && acciones.length ? max : anchoFin + 24);
    const der = accionesInicio.length ? (completo ? max : anchoIni + 24) : 0;
    setDx(Math.max(acciones.length ? izq : 0, Math.min(der, ini.current.base + mx)));
  }
  function soltar() {
    setArrastrando(false);
    if (ini.current.eje !== 'x') return;
    const dx = dxRef.current;
    if (completo && Math.abs(dx) > umbralCompleto()) {
      const a = dx < 0 ? acciones[0] : accionesInicio[0];
      if (a) {
        try { navigator.vibrate?.(10); } catch { /* sin vibración */ }
        a.onClick();
      }
      setDx(0);
      return;
    }
    if (dx < 0) setDx(dx < -anchoFin / 2 ? -anchoFin : 0);
    else setDx(dx > anchoIni / 2 ? anchoIni : 0);
  }

  const lleno = completo && Math.abs(dx) > umbralCompleto();
  const boton = (a: AccionFila, i: number, lado: 'ini' | 'fin') => (
    <button key={a.etiqueta} type="button" tabIndex={dx === 0 ? -1 : 0}
      onClick={() => { a.onClick(); setDx(0); }}
      className="flex min-w-[76px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-white transition-[flex-grow] duration-150"
      style={{ background: a.color, flexGrow: lleno && i === 0 && ((lado === 'fin' && dx < 0) || (lado === 'ini' && dx > 0)) ? 1 : 0 }}>
      {a.icono && <span className="text-[16px]">{a.icono}</span>}
      {a.etiqueta}
    </button>
  );

  return (
    <div ref={caja} className={`group relative overflow-hidden ${className}`} data-no-deslizar>
      {accionesInicio.length > 0 && dx > 0 && (
        <div className="absolute inset-y-0 left-0 flex" style={{ width: Math.max(anchoIni, dx) }} aria-hidden={dx === 0}>
          {accionesInicio.map((a, i) => boton(a, i, 'ini'))}
        </div>
      )}
      {acciones.length > 0 && dx < 0 && (
        <div className={`absolute inset-y-0 right-0 flex ${completo ? 'flex-row-reverse' : ''}`} style={{ width: Math.max(anchoFin, -dx) }} aria-hidden={dx === 0}>
          {acciones.map((a, i) => boton(a, i, 'fin'))}
        </div>
      )}
      <div onTouchStart={empezar} onTouchMove={mover} onTouchEnd={soltar}
        className="relative"
        style={{ transform: `translateX(${dx}px)`, transition: arrastrando ? 'none' : 'transform .2s ease', background: fondo }}>
        {children}
        {/* Escritorio: acciones al pasar el mouse */}
        <div className="pointer-events-none absolute inset-y-0 right-2 hidden items-center gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 md:flex">
          {[...accionesInicio, ...acciones].map((a) => (
            <button key={a.etiqueta} type="button" onClick={(e) => { e.stopPropagation(); a.onClick(); }} title={a.etiqueta} aria-label={a.etiqueta}
              className={`ui-foco flex h-7 items-center gap-1 rounded-md text-[11px] font-semibold text-white shadow-sm ${compacto ? 'w-7 justify-center' : 'px-2'}`} style={{ background: a.color }}>
              {a.icono}{!compacto && <span className="hidden lg:inline">{a.etiqueta}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
