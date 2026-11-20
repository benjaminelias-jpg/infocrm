import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDeslizar, useEsMovil } from '../../ui';

// Panel a la derecha en escritorio y hoja de pantalla completa en el
// celular, con cabecera y pie fijos y el medio que se desplaza. Lo usan la
// ficha del lead y la ficha del contenido.
//  - Escape o tocar afuera (escritorio) cierra; en el celular, arrastrar la
//    cabecera hacia abajo también cierra.
//  - Con onAnterior/onSiguiente: deslizar el dedo a los costados o las
//    flechas ← → del teclado pasan al anterior/siguiente.

export type Animacion = 'abrir' | 'siguiente' | 'anterior' | 'nada';

const ESTILOS = `
@keyframes cl-panel-der { from { transform: translateX(48px); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes cl-panel-izq { from { transform: translateX(-48px); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes cl-panel-abrir { from { transform: translateX(100%) } to { transform: none } }
@keyframes cl-fondo { from { opacity: 0 } to { opacity: 1 } }
.cl-anim-abrir { animation: cl-panel-abrir 220ms cubic-bezier(.2,.8,.2,1) }
.cl-anim-siguiente { animation: cl-panel-der 160ms ease-out }
.cl-anim-anterior { animation: cl-panel-izq 160ms ease-out }
.cl-anim-fondo { animation: cl-fondo 200ms ease-out }
@media (prefers-reduced-motion: reduce) { .cl-anim-abrir, .cl-anim-siguiente, .cl-anim-anterior, .cl-anim-fondo { animation: none } }
`;

/** Paneles abiertos, de abajo hacia arriba: Escape y las flechas son solo del de arriba. */
const pila: number[] = [];
let proximoId = 1;

/** ¿Hay otra capa encima (otro panel, un diálogo o un menú abierto)? Entonces Escape y las flechas son de ella. */
function hayOtraCapa(miId: number) {
  if (pila[pila.length - 1] !== miId) return true;
  if (document.querySelector('[role="menu"]')) return true;
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).some((d) => d.dataset.clPanel === undefined);
}

function escribiendo(el: Element | null) {
  if (!el) return false;
  const t = el.tagName;
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || (el as HTMLElement).isContentEditable;
}

export default function PanelLateral({
  etiqueta, onCerrar, cabecera, pie, children, onAnterior, onSiguiente, z = 50, ancho = 520, animacion = 'abrir',
}: {
  etiqueta: string; onCerrar: () => void; cabecera: React.ReactNode; pie?: React.ReactNode; children: React.ReactNode;
  onAnterior?: (() => void) | null; onSiguiente?: (() => void) | null; z?: number; ancho?: number; animacion?: Animacion;
}) {
  const movil = useEsMovil();
  const panel = useRef<HTMLDivElement>(null);
  const miId = useRef(0);
  if (!miId.current) miId.current = proximoId++;
  const cb = useRef({ onCerrar, onAnterior, onSiguiente });
  cb.current = { onCerrar, onAnterior, onSiguiente };
  const cuerpo = useDeslizar<HTMLDivElement>({
    onIzquierda: () => cb.current.onSiguiente?.(),
    onDerecha: () => cb.current.onAnterior?.(),
  }, 70);

  // En la pila de capas y sin scroll de la página de atrás mientras está abierto.
  useEffect(() => {
    const id = miId.current;
    pila.push(id);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      const i = pila.lastIndexOf(id);
      if (i >= 0) pila.splice(i, 1);
      document.body.style.overflow = prev;
    };
  }, []);

  // Foco adentro al abrir (teclado y lectores de pantalla); al cerrar vuelve a donde estaba.
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null;
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus({ preventScroll: true });
    return () => { if (antes && document.body.contains(antes)) antes.focus?.({ preventScroll: true }); };
  }, []);

  useEffect(() => {
    // Se mira ANTES de que nadie atienda la tecla (fase de captura): si había
    // un menú o un diálogo abierto, Escape y las flechas son de él (aunque
    // para cuando llega acá ya se haya cerrado).
    let otraCapa = false;
    const antes = () => { otraCapa = hayOtraCapa(miId.current); };
    const tecla = (e: KeyboardEvent) => {
      if (e.defaultPrevented || otraCapa || hayOtraCapa(miId.current)) return;
      if (e.key === 'Escape') { cb.current.onCerrar(); return; }
      if (escribiendo(document.activeElement) || e.altKey || e.ctrlKey || e.metaKey) return;
      if ((e.key === 'ArrowRight' || e.key === 'j') && cb.current.onSiguiente) { e.preventDefault(); cb.current.onSiguiente(); }
      if ((e.key === 'ArrowLeft' || e.key === 'k') && cb.current.onAnterior) { e.preventDefault(); cb.current.onAnterior(); }
    };
    window.addEventListener('keydown', antes, true);
    window.addEventListener('keydown', tecla);
    return () => { window.removeEventListener('keydown', antes, true); window.removeEventListener('keydown', tecla); };
  }, []);

  // Celular: arrastrar la cabecera hacia abajo cierra la hoja.
  const arrastre = useRef<{ y0: number; dy: number; t0: number; id: number } | null>(null);
  const arrastrar = movil ? {
    onPointerDown: (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('button, a, input, textarea, select, [data-no-arrastrar]')) return;
      arrastre.current = { y0: e.clientY, dy: 0, t0: performance.now(), id: e.pointerId };
      if (panel.current) panel.current.style.transition = 'none';
    },
    onPointerMove: (e: React.PointerEvent) => {
      const a = arrastre.current;
      if (!a || a.id !== e.pointerId || !panel.current) return;
      a.dy = Math.max(0, e.clientY - a.y0);
      if (a.dy > 6) panel.current.style.transform = `translateY(${a.dy}px)`;
    },
    onPointerUp: (e: React.PointerEvent) => {
      const a = arrastre.current; arrastre.current = null;
      const el = panel.current;
      if (!a || !el || a.id !== e.pointerId) return;
      const rapido = a.dy / Math.max(1, performance.now() - a.t0) > 0.6 && a.dy > 50;
      el.style.transition = 'transform 180ms ease-out';
      if (a.dy > 140 || rapido) {
        el.style.transform = 'translateY(100%)';
        window.setTimeout(() => cb.current.onCerrar(), 160);
      } else {
        el.style.transform = '';
      }
    },
    onPointerCancel: () => { arrastre.current = null; if (panel.current) panel.current.style.transform = ''; },
  } : {};

  const anim = animacion === 'nada' ? '' : `cl-anim-${animacion}`;

  return createPortal(
    <div className="fixed inset-0 flex justify-end" style={{ zIndex: z }} data-panel-lateral>
      <style>{ESTILOS}</style>
      <div className={`absolute inset-0 bg-black/30 ${animacion === 'abrir' ? 'cl-anim-fondo' : ''}`} onClick={onCerrar} aria-hidden />
      <div ref={panel} role="dialog" aria-modal="true" aria-label={etiqueta} tabIndex={-1} data-cl-panel=""
        className={`relative flex h-full w-full flex-col shadow-2xl outline-none ${anim}`}
        style={{ maxWidth: movil ? '100%' : ancho, background: 'var(--surface-1)' }}>
        <div {...arrastrar} className="shrink-0 border-b border-[var(--border-hairline)]"
          style={{ background: 'var(--surface-1)', touchAction: movil ? 'pan-x' : undefined, paddingTop: movil ? 'env(safe-area-inset-top)' : undefined }}>
          {movil && <div className="pt-1.5" aria-hidden><div className="mx-auto h-1 w-9 rounded-full" style={{ background: 'var(--baseline)' }} /></div>}
          {cabecera}
        </div>
        <div ref={cuerpo} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
        {pie && (
          <div className="shrink-0 border-t border-[var(--border-hairline)]"
            style={{ background: 'var(--surface-1)', paddingBottom: movil ? 'env(safe-area-inset-bottom)' : undefined }}>
            {pie}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
