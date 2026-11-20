import { forwardRef, useEffect, useRef, useState } from 'react';

// Botón único para toda la app. Un solo azul de acción (primario); lo
// destructivo en rojo; lo secundario con borde. En el celular los botones
// miden 40 px de alto (dedo); en escritorio 36 px.

export type Variante = 'primario' | 'secundario' | 'peligro' | 'fantasma' | 'exito' | 'tinta';
export type Tamano = 'xs' | 'sm' | 'md';

const BASE = 'ui-foco inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap font-semibold transition-[background,border-color,color,opacity,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-50';

const TAMANOS: Record<Tamano, string> = {
  xs: 'h-7 rounded-[8px] px-2 text-[11px]',
  sm: 'h-9 rounded-[10px] px-3 text-[12px] md:h-8 md:px-2.5',
  md: 'h-10 rounded-[12px] px-4 text-[13px] md:h-9 md:px-3.5',
};

const VARIANTES: Record<Variante, string> = {
  primario: 'bg-[var(--accion)] text-white shadow-[0_6px_14px_-8px_var(--accion)] hover:bg-[var(--accion-hover)] active:brightness-95',
  secundario: 'bg-[var(--surface-2)] text-[var(--text-primary)] hover:bg-[var(--surface-3)]',
  peligro: 'bg-[var(--status-critical)] text-white hover:brightness-110',
  fantasma: 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
  exito: 'bg-[var(--status-good)] text-white hover:brightness-110',
  tinta: 'bg-[var(--ink)] text-[var(--on-ink)] hover:opacity-90',
};

export interface PropsBoton extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  tamano?: Tamano;
  icono?: React.ReactNode;
  cargando?: boolean;
  anchoCompleto?: boolean;
}

export const Boton = forwardRef<HTMLButtonElement, PropsBoton>(function Boton(
  { variante = 'secundario', tamano = 'md', icono, cargando, anchoCompleto, className = '', children, disabled, type = 'button', ...resto },
  ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || cargando} aria-busy={cargando || undefined}
      className={`${BASE} ${TAMANOS[tamano]} ${VARIANTES[variante]} ${anchoCompleto ? 'w-full' : ''} ${className}`} {...resto}>
      {cargando ? <Girando /> : icono ? <span className="flex shrink-0 items-center" aria-hidden>{icono}</span> : null}
      {children}
    </button>
  );
});

export function Girando({ tam = 14 }: { tam?: number }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 24 24" className="animate-spin" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Botón redondo solo-ícono (cerrar, +, flechas). Siempre con etiqueta accesible. */
export const BotonIcono = forwardRef<HTMLButtonElement, PropsBoton & { etiqueta: string }>(function BotonIcono(
  { etiqueta, variante = 'fantasma', tamano = 'sm', className = '', children, type = 'button', ...resto },
  ref,
) {
  const lado = tamano === 'xs' ? 'h-7 w-7 rounded-[8px]' : tamano === 'sm' ? 'h-9 w-9 rounded-[10px] md:h-8 md:w-8' : 'h-10 w-10 rounded-[12px] md:h-9 md:w-9';
  return (
    <button ref={ref} type={type} aria-label={etiqueta} title={etiqueta}
      className={`${BASE} ${lado} ${VARIANTES[variante]} !px-0 text-[15px] ${className}`} {...resto}>
      {children}
    </button>
  );
});

/**
 * Acción destructiva sin ventanas emergentes: el primer toque pide
 * confirmación en el mismo botón ("¿Seguro?") y el segundo ejecuta.
 * Si no se confirma en 4 s, vuelve a su estado normal.
 */
export function BotonConfirmar({
  onConfirmar, children = 'Borrar', confirmar = '¿Seguro? Tocá de nuevo', tamano = 'sm', variante = 'secundario', icono, className = '', soloIcono,
}: {
  onConfirmar: () => void | Promise<void>; children?: React.ReactNode; confirmar?: string;
  tamano?: Tamano; variante?: Variante; icono?: React.ReactNode; className?: string; soloIcono?: boolean;
}) {
  const [armado, setArmado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const t = useRef<number | null>(null);
  useEffect(() => () => { if (t.current) window.clearTimeout(t.current); }, []);
  async function tocar() {
    if (!armado) {
      setArmado(true);
      t.current = window.setTimeout(() => setArmado(false), 4000);
      return;
    }
    if (t.current) window.clearTimeout(t.current);
    setOcupado(true);
    try { await onConfirmar(); } finally { setOcupado(false); setArmado(false); }
  }
  if (armado) {
    return (
      <Boton variante="peligro" tamano={tamano} onClick={tocar} cargando={ocupado} className={className} onBlur={() => !ocupado && setArmado(false)} autoFocus>
        {confirmar}
      </Boton>
    );
  }
  return (
    <Boton variante={variante} tamano={tamano} onClick={tocar} icono={soloIcono ? undefined : icono}
      className={`${variante === 'secundario' || variante === 'fantasma' ? '!text-[var(--status-critical)]' : ''} ${className}`}
      aria-label={soloIcono ? String(children) : undefined} title={soloIcono ? String(children) : undefined}>
      {soloIcono ? (icono ?? '✕') : children}
    </Boton>
  );
}
