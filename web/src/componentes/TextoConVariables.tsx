import { useRef } from 'react';
import { AreaTexto, Entrada } from '../ui';

// Texto de un mensaje con atajos "+ Nombre" / "+ @usuario" que se insertan
// donde está el cursor, contador de caracteres y vista previa de cómo le
// llega al lead. Lo usan la pizarra de automensajes y las acciones de etapa.

/** {{nombre}} → [Nombre] para leerlo como persona. */
export function conVariables(t: string) {
  return t.replace(/\{\{\s*nombre\s*\}\}/gi, '[Nombre]').replace(/\{\{\s*usuario\s*\}\}/gi, '[@usuario]');
}

export default function TextoConVariables({
  valor, onCambio, filas = 4, placeholder, max = 1000, linea = false, autoFoco, invalido, onBlur, etiqueta,
}: {
  valor: string; onCambio: (v: string) => void; filas?: number; placeholder?: string; max?: number;
  linea?: boolean; autoFoco?: boolean; invalido?: boolean; onBlur?: () => void; etiqueta?: string;
}) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  function insertar(variable: string) {
    const el = ref.current;
    const ini = el?.selectionStart ?? valor.length;
    const fin = el?.selectionEnd ?? valor.length;
    const nuevo = `${valor.slice(0, ini)}${variable}${valor.slice(fin)}`;
    onCambio(nuevo);
    requestAnimationFrame(() => { el?.focus(); const pos = ini + variable.length; el?.setSelectionRange(pos, pos); });
  }
  const largo = valor.length;
  return (
    <div>
      {linea
        ? <Entrada ref={ref as any} value={valor} onChange={(e) => onCambio(e.target.value)} placeholder={placeholder} autoFocus={autoFoco}
            invalido={invalido} onBlur={onBlur} aria-label={etiqueta} />
        : <AreaTexto ref={ref as any} value={valor} onChange={(e) => onCambio(e.target.value)} rows={filas} placeholder={placeholder} autoFocus={autoFoco}
            className="resize-y" invalido={invalido} onBlur={onBlur} aria-label={etiqueta} />}
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
        <button type="button" onClick={() => insertar('{{nombre}}')} className="ui-foco min-h-[28px] rounded-[8px] px-2.5 font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]" style={{ background: 'var(--surface-2)' }}>+ Nombre</button>
        <button type="button" onClick={() => insertar('{{usuario}}')} className="ui-foco min-h-[28px] rounded-[8px] px-2.5 font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]" style={{ background: 'var(--surface-2)' }}>+ @usuario</button>
        <span className="ml-auto cifras" style={{ color: largo > max ? 'var(--status-critical)' : undefined }}>{largo}/{max}</span>
      </div>
      {/\{\{\s*(nombre|usuario)\s*\}\}/i.test(valor) && (
        <div className="mt-1 text-[11px] text-[var(--text-muted)]">Así le llega: «{conVariables(valor).replace(/\[Nombre\]/g, 'Sofía').replace(/\[@usuario\]/g, '@sofi.coach').slice(0, 90)}»</div>
      )}
    </div>
  );
}
