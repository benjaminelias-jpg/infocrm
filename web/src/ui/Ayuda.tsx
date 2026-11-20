import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Dialogo, useEsMovil } from './Flotantes';

// "ⓘ" que explica algo. Reemplaza a los title= (que en el celular no se ven):
// en escritorio abre un globito al pasar el mouse, al enfocarlo o al tocarlo;
// en el celular, una hoja chica desde abajo. Área táctil de 32 px.

export function Ayuda({ children, titulo, etiqueta = 'Qué significa' }: {
  children: React.ReactNode; titulo?: React.ReactNode; etiqueta?: string;
}) {
  const movil = useEsMovil();
  const [abierto, setAbierto] = useState(false);
  const [fijo, setFijo] = useState(false); // abierto por clic (no se cierra al sacar el mouse)
  const boton = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; arriba: boolean } | null>(null);
  const id = useId();

  useEffect(() => {
    if (!abierto || movil) return;
    const r = boton.current?.getBoundingClientRect();
    if (!r) return;
    const ancho = 280;
    const arriba = r.bottom + 160 > window.innerHeight && r.top > 160;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - ancho / 2, window.innerWidth - ancho - 8));
    setPos({ top: arriba ? r.top - 6 : r.bottom + 6, left, arriba });
    const cerrar = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      if (e.type === 'mousedown' && boton.current?.contains(e.target as Node)) return;
      setAbierto(false); setFijo(false);
    };
    window.addEventListener('scroll', cerrar, true);
    document.addEventListener('keydown', cerrar);
    document.addEventListener('mousedown', cerrar);
    return () => {
      window.removeEventListener('scroll', cerrar, true);
      document.removeEventListener('keydown', cerrar);
      document.removeEventListener('mousedown', cerrar);
    };
  }, [abierto, movil]);

  return (
    <>
      <button ref={boton} type="button" aria-label={etiqueta} aria-expanded={abierto} aria-describedby={abierto && !movil ? id : undefined}
        onClick={(e) => { e.stopPropagation(); if (movil) setAbierto(true); else { setFijo((f) => !f); setAbierto((a) => !(a && fijo)); } }}
        onMouseEnter={() => { if (!movil) setAbierto(true); }}
        onMouseLeave={() => { if (!movil && !fijo) setAbierto(false); }}
        onFocus={() => { if (!movil) setAbierto(true); }}
        onBlur={() => { if (!movil && !fijo) setAbierto(false); }}
        className="ui-foco -m-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full align-middle text-[var(--text-muted)] hover:text-[var(--text-primary)]">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="9.5" /><path d="M12 11v6M12 7.5v.01" />
        </svg>
      </button>
      {abierto && !movil && pos && createPortal(
        <div id={id} role="tooltip" className="ui-aparecer fixed z-[66] w-[280px] rounded-lg p-3 text-[12px] leading-relaxed shadow-xl"
          style={{ top: pos.top, left: pos.left, transform: pos.arriba ? 'translateY(-100%)' : undefined, background: 'var(--surface-1)', border: '1px solid var(--border-hairline)', color: 'var(--text-secondary)' }}>
          {titulo && <div className="mb-1 text-[12px] font-semibold text-[var(--text-primary)]">{titulo}</div>}
          {children}
        </div>,
        document.body,
      )}
      {movil && (
        <Dialogo abierto={abierto} onCerrar={() => setAbierto(false)} titulo={titulo ?? 'Qué significa'} autoFoco={false}>
          <div className="pb-2 text-[14px] leading-relaxed text-[var(--text-secondary)]">{children}</div>
        </Dialogo>
      )}
    </>
  );
}
