import { Fragment, useRef, useState } from 'react';
import { IconoChat } from './iconos';

// Lista que se ordena arrastrando del asa (⠿), con el mouse o con el dedo.
// Se reordena en pantalla mientras arrastrás y se guarda UNA sola vez al
// soltar. Con el teclado: foco en el asa y ↑ / ↓.

interface Arrastre { id: string; desde: number; y0: number; dy: number; tops: number[]; alturas: number[]; paso: number }

export function ListaOrdenable<T>({ items, clave, onReordenar, render, etiqueta = 'Arrastrá para ordenar' }: {
  items: T[]; clave: (t: T) => string; onReordenar: (ids: string[]) => void;
  render: (t: T, asa: React.ReactNode) => React.ReactNode; etiqueta?: string;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const [a, setA] = useState<Arrastre | null>(null);

  function destinoDe(x: Arrastre) {
    const centro = x.tops[x.desde] + x.alturas[x.desde] / 2 + x.dy;
    let d = x.desde;
    for (let i = 0; i < x.tops.length; i++) {
      const medio = x.tops[i] + x.alturas[i] / 2;
      if (i < x.desde && centro < medio) { d = i; break; }
      if (i > x.desde && centro > medio) d = i;
    }
    return d;
  }

  function empezar(e: React.PointerEvent<HTMLButtonElement>, id: string, i: number) {
    if (e.button !== 0) return;
    const filas = Array.from(caja.current?.querySelectorAll<HTMLElement>(':scope > [data-orden]') ?? []);
    if (filas.length < 2) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rects = filas.map((f) => f.getBoundingClientRect());
    const tops = rects.map((r) => r.top);
    const alturas = rects.map((r) => r.height);
    const hueco = rects.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 4;
    if (e.pointerType === 'touch') navigator.vibrate?.(10);
    setA({ id, desde: i, y0: e.clientY, dy: 0, tops, alturas, paso: alturas[i] + hueco });
  }
  function mover(e: React.PointerEvent) {
    if (!a) return;
    const min = a.tops[0] - a.tops[a.desde];
    const max = a.tops[a.tops.length - 1] + a.alturas[a.alturas.length - 1] - a.tops[a.desde] - a.alturas[a.desde];
    setA({ ...a, dy: Math.max(min - 8, Math.min(max + 8, e.clientY - a.y0)) });
  }
  function soltar() {
    if (!a) return;
    const d = destinoDe(a);
    setA(null);
    if (d === a.desde) return;
    const ids = items.map(clave);
    const [x] = ids.splice(a.desde, 1);
    ids.splice(d, 0, x);
    onReordenar(ids);
  }
  function tecla(e: React.KeyboardEvent, i: number) {
    const d = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : null;
    if (d === null || d < 0 || d >= items.length) return;
    e.preventDefault();
    const ids = items.map(clave);
    const [x] = ids.splice(i, 1);
    ids.splice(d, 0, x);
    onReordenar(ids);
    window.setTimeout(() => caja.current?.querySelector<HTMLElement>(`[data-asa="${x}"]`)?.focus(), 30);
  }

  const destino = a ? destinoDe(a) : -1;
  return (
    <div ref={caja} className="space-y-1">
      {items.map((t, i) => {
        const id = clave(t);
        let y = 0;
        if (a) {
          if (i === a.desde) y = a.dy;
          else if (a.desde < destino && i > a.desde && i <= destino) y = -a.paso;
          else if (a.desde > destino && i < a.desde && i >= destino) y = a.paso;
        }
        const moviendo = a?.id === id;
        const asa = (
          <button type="button" data-asa={id} aria-label={`${etiqueta} (o usá ↑ ↓)`} title={etiqueta}
            onPointerDown={(e) => empezar(e, id, i)} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={() => setA(null)}
            onKeyDown={(e) => tecla(e, i)}
            className="ui-foco flex h-10 w-7 shrink-0 cursor-grab items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--page-plane)] active:cursor-grabbing md:h-8"
            style={{ touchAction: 'none' }}>
            <IconoChat nombre="arrastrar" tam={16} />
          </button>
        );
        return (
          <Fragment key={id}>
            <div data-orden={id} className="relative"
              style={{
                transform: y ? `translateY(${y}px)` : undefined,
                transition: moviendo ? 'none' : a ? 'transform .15s ease' : undefined,
                zIndex: moviendo ? 5 : undefined,
                boxShadow: moviendo ? '0 8px 24px rgba(0,0,0,.18)' : undefined,
                borderRadius: 12,
              }}>
              {render(t, asa)}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
