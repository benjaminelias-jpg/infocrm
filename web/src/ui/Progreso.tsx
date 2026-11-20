// Barra de avance hacia una meta, con la marca del "ritmo esperado" (dónde
// deberías estar hoy). Verde si vas al ritmo, amarillo si un poco atrás,
// rojo si bastante atrás. Sirve para el objetivo del mes, cuotas, etc.

export function BarraProgreso({ valor, meta, ritmo, etiqueta, detalle, alto = 8 }: {
  valor: number; meta: number;
  /** 0..1: qué fracción de la meta "debería" estar cumplida hoy (p. ej. día 15 de 30 → 0,5). */
  ritmo?: number;
  etiqueta?: React.ReactNode; detalle?: React.ReactNode; alto?: number;
}) {
  const frac = meta > 0 ? Math.max(0, Math.min(1, valor / meta)) : 0;
  const esperado = ritmo !== undefined ? Math.max(0, Math.min(1, ritmo)) : undefined;
  const color = esperado === undefined || frac >= esperado
    ? 'var(--status-good)'
    : frac >= esperado * 0.8 ? 'var(--status-warning)' : 'var(--status-critical)';
  return (
    <div className="space-y-1">
      {(etiqueta || detalle) && (
        <div className="flex items-baseline justify-between gap-2 text-[12px]">
          <span className="min-w-0 truncate text-[var(--text-secondary)]">{etiqueta}</span>
          <span className="cifras shrink-0 text-[var(--text-muted)]">{detalle}</span>
        </div>
      )}
      <div className="relative w-full overflow-visible rounded-full" style={{ height: alto, background: 'var(--gridline)' }}
        role="progressbar" aria-valuemin={0} aria-valuemax={meta} aria-valuenow={valor}>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${frac * 100}%`, background: color }} />
        {esperado !== undefined && esperado > 0 && esperado < 1 && (
          <span className="absolute -top-1 w-0.5 rounded-full" style={{ left: `calc(${esperado * 100}% - 1px)`, height: alto + 8, background: 'var(--text-secondary)' }}
            title="Dónde deberías estar hoy" aria-hidden />
        )}
      </div>
    </div>
  );
}

/** Aviso fijo de una pantalla (no se va solo): "Instagram no está conectado · Conectar". */
export function Banner({ tono = 'info', icono, children, accion, onCerrar }: {
  tono?: 'info' | 'aviso' | 'error' | 'exito'; icono?: React.ReactNode; children: React.ReactNode;
  accion?: React.ReactNode; onCerrar?: () => void;
}) {
  const color = { info: 'var(--series-1)', aviso: 'var(--status-warning)', error: 'var(--status-critical)', exito: 'var(--status-good)' }[tono];
  return (
    <div role={tono === 'error' ? 'alert' : 'status'} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-3.5 py-2.5 text-[13px]"
      style={{ background: `color-mix(in srgb, ${color} 9%, var(--surface-1))`, border: `1px solid color-mix(in srgb, ${color} 30%, transparent)` }}>
      {icono && <span className="shrink-0 text-[16px]" style={{ color }} aria-hidden>{icono}</span>}
      <div className="min-w-0 flex-1">{children}</div>
      {accion && <div className="flex shrink-0 items-center gap-2">{accion}</div>}
      {onCerrar && (
        <button type="button" onClick={onCerrar} aria-label="Cerrar aviso"
          className="ui-foco -mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--page-plane)]">✕</button>
      )}
    </div>
  );
}
