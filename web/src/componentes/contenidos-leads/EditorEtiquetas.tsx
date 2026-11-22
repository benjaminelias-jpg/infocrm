import { useMemo, useRef, useState } from 'react';
import { estiloEtiqueta } from '../../etiquetas';

// Etiquetas del lead en línea: chips con ✕ para quitar y un "+ Etiqueta"
// al final que abre un campo con sugerencias (las que ya usás en la cuenta).

export default function EditorEtiquetas({ etiquetas, sugerencias, onCambiar, deshabilitado }: {
  etiquetas: string[]; sugerencias: Array<{ etiqueta: string; n: number }>;
  onCambiar: (nuevas: string[], cambio: { agregada?: string; quitada?: string }) => void; deshabilitado?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const campo = useRef<HTMLInputElement>(null);

  const opciones = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return sugerencias
      .filter((s) => !etiquetas.includes(s.etiqueta) && (!t || s.etiqueta.toLowerCase().includes(t)))
      .slice(0, 6);
  }, [sugerencias, etiquetas, texto]);

  function agregar(valor: string) {
    const v = valor.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!v) return;
    if (!etiquetas.some((e) => e.toLowerCase() === v.toLowerCase())) onCambiar([...etiquetas, v], { agregada: v });
    setTexto('');
    campo.current?.focus();
  }

  function cerrar() { setAbierto(false); setTexto(''); }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {etiquetas.map((e) => (
        <span key={e} className="inline-flex h-7 items-center gap-0.5 rounded-md border border-[var(--border-hairline)] pl-2 text-[12px] text-[var(--text-secondary)]" style={estiloEtiqueta(e)}>
          {e}
          <button type="button" disabled={deshabilitado} onClick={() => onCambiar(etiquetas.filter((x) => x !== e), { quitada: e })}
            aria-label={`Quitar la etiqueta ${e}`}
            className="ui-foco flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--status-critical)]">
            <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
          </button>
        </span>
      ))}
      {!abierto ? (
        <button type="button" disabled={deshabilitado} onClick={() => { setAbierto(true); window.setTimeout(() => campo.current?.focus(), 0); }}
          className="ui-foco inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-[var(--border-hairline)] px-2 text-[12px] font-medium text-[var(--series-1)] hover:bg-[var(--page-plane)]">
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
          Etiqueta
        </button>
      ) : (
        <div className="w-full">
          <form onSubmit={(e) => { e.preventDefault(); agregar(texto); }} className="flex items-center gap-1.5">
            <input ref={campo} value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={40}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); } }}
              placeholder="Nueva etiqueta (ej. vip)" aria-label="Nueva etiqueta"
              className="ui-control h-9 min-w-0 flex-1 rounded-lg px-2.5 text-[16px] md:h-8 md:text-[13px]" />
            <button type="submit" disabled={!texto.trim()}
              className="ui-foco h-9 shrink-0 rounded-lg px-3 text-[12px] font-medium text-white disabled:opacity-50 md:h-8" style={{ background: 'var(--series-1)' }}>
              Agregar
            </button>
            <button type="button" onClick={cerrar} className="ui-foco h-9 shrink-0 rounded-lg px-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--page-plane)] md:h-8">
              Listo
            </button>
          </form>
          {opciones.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Sugerencias">
              {opciones.map((o) => (
                <button key={o.etiqueta} type="button" onClick={() => agregar(o.etiqueta)}
                  className="ui-foco inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  style={{ background: 'var(--page-plane)' }}>
                  + {o.etiqueta}<span className="cifras text-[10px] text-[var(--text-muted)]">{o.n}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
