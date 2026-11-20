import { forwardRef, useId } from 'react';

// Campos de formulario con el mismo alto, borde y foco en toda la app.
// En el celular miden 40 px (y 16 px de letra en el input para que iOS no
// haga zoom al tocarlo); en escritorio 36 px.

const CONTROL = 'ui-control w-full rounded-lg px-3 text-[16px] md:text-[13px]';

export function Campo({ etiqueta, ayuda, error, children, className = '', htmlFor }: {
  etiqueta?: React.ReactNode; ayuda?: React.ReactNode; error?: React.ReactNode;
  children: React.ReactNode; className?: string; htmlFor?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {etiqueta && <label htmlFor={htmlFor} className="text-[12px] font-medium text-[var(--text-secondary)]">{etiqueta}</label>}
      {children}
      {error
        ? <p className="text-[11px]" style={{ color: 'var(--status-critical)' }}>{error}</p>
        : ayuda ? <p className="text-[11px] text-[var(--text-muted)]">{ayuda}</p> : null}
    </div>
  );
}

export const Entrada = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalido?: boolean }>(
  function Entrada({ className = '', invalido, ...p }, ref) {
    return (
      <input ref={ref} {...p} aria-invalid={invalido || undefined}
        className={`${CONTROL} h-10 md:h-9 ${invalido ? '!border-[var(--status-critical)]' : ''} ${className}`} />
    );
  },
);

export const AreaTexto = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalido?: boolean }>(
  function AreaTexto({ className = '', invalido, rows = 3, ...p }, ref) {
    return (
      <textarea ref={ref} rows={rows} {...p} aria-invalid={invalido || undefined}
        className={`${CONTROL} resize-y py-2 leading-snug ${invalido ? '!border-[var(--status-critical)]' : ''} ${className}`} />
    );
  },
);

export const Seleccion = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Seleccion({ className = '', children, ...p }, ref) {
    return (
      <select ref={ref} {...p} className={`${CONTROL} h-10 cursor-pointer pr-8 md:h-9 ${className}`}>
        {children}
      </select>
    );
  },
);

/** Interruptor encendido/apagado (más claro que un checkbox para "Activo"). */
export function Interruptor({ activo, onCambiar, etiqueta, deshabilitado }: {
  activo: boolean; onCambiar: (v: boolean) => void; etiqueta?: React.ReactNode; deshabilitado?: boolean;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={`inline-flex cursor-pointer select-none items-center gap-2 text-[12px] ${deshabilitado ? 'opacity-50' : ''}`}>
      <button id={id} type="button" role="switch" aria-checked={activo} disabled={deshabilitado}
        onClick={() => onCambiar(!activo)}
        className="ui-foco relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors"
        style={{ background: activo ? 'var(--status-good)' : 'var(--baseline)' }}>
        <span className="absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-[left]" style={{ left: activo ? 19 : 3 }} />
      </button>
      {etiqueta && <span className="text-[var(--text-secondary)]">{etiqueta}</span>}
    </label>
  );
}

/** Buscador con lupa y botón para limpiar. */
export function Buscador({ valor, onCambiar, placeholder = 'Buscar…', className = '', autoFocus }: {
  valor: string; onCambiar: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean;
}) {
  return (
    <div className={`relative ${className}`}>
      <svg width="15" height="15" viewBox="0 0 24 24" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden>
        <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input value={valor} onChange={(e) => onCambiar(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
        type="search" aria-label={placeholder}
        className={`${CONTROL} h-10 pl-8 pr-8 md:h-9`} />
      {valor && (
        <button type="button" onClick={() => onCambiar('')} aria-label="Limpiar búsqueda"
          className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-[12px] text-[var(--text-muted)] hover:bg-[var(--page-plane)]">✕</button>
      )}
    </div>
  );
}
