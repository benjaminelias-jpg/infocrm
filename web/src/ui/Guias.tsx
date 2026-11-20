import { useId } from 'react';

// Pasos guiados para conectar cosas (integraciones) sin perderse: cada paso
// numerado, el actual abierto, los hechos con ✓, y una verificación en vivo
// que dice "esperando…" hasta que llega el primer dato.

export type EstadoPaso = 'hecho' | 'actual' | 'pendiente';

export function PasosGuiados({ pasos }: {
  pasos: Array<{ titulo: React.ReactNode; estado: EstadoPaso; contenido?: React.ReactNode; resumen?: React.ReactNode }>;
}) {
  return (
    <ol className="relative flex flex-col">
      {pasos.map((p, i) => {
        const ultimo = i === pasos.length - 1;
        return (
          <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
            {!ultimo && <span className="absolute left-[13px] top-7 h-[calc(100%-24px)] w-px" style={{ background: p.estado === 'hecho' ? 'var(--status-good)' : 'var(--border-hairline)' }} aria-hidden />}
            <span className="relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
              style={p.estado === 'hecho'
                ? { background: 'var(--status-good)', color: 'white' }
                : p.estado === 'actual'
                  ? { background: 'var(--series-1)', color: 'white' }
                  : { background: 'var(--gridline)', color: 'var(--text-muted)' }}>
              {p.estado === 'hecho' ? '✓' : i + 1}
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className={`text-[13px] ${p.estado === 'pendiente' ? 'text-[var(--text-muted)]' : 'font-semibold'}`}>{p.titulo}</div>
              {p.estado === 'hecho' && p.resumen && <div className="mt-0.5 text-[12px] text-[var(--text-muted)]">{p.resumen}</div>}
              {p.estado === 'actual' && p.contenido && <div className="ui-fundido mt-2 text-[13px]">{p.contenido}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Estado de una verificación en vivo (ej. "esperando el primer lead de ManyChat"). */
export function Verificacion({ estado, esperando, ok, error, accion }: {
  estado: 'esperando' | 'ok' | 'error' | 'inactivo'; esperando?: React.ReactNode; ok?: React.ReactNode;
  error?: React.ReactNode; accion?: React.ReactNode;
}) {
  const color = estado === 'ok' ? 'var(--status-good)' : estado === 'error' ? 'var(--status-critical)' : estado === 'esperando' ? 'var(--status-warning)' : 'var(--baseline)';
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}
      role="status" aria-live="polite">
      <span className="relative flex h-2.5 w-2.5" aria-hidden>
        {estado === 'esperando' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: color }} />}
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      </span>
      <span className="min-w-0 flex-1">{estado === 'ok' ? ok : estado === 'error' ? error : esperando}</span>
      {accion}
    </div>
  );
}

/**
 * Tarjeta de una integración: ícono, nombre, para qué sirve, estado y botón.
 * En el celular es una fila compacta (ícono · nombre y estado · una línea · ›)
 * para que entren todas sin scroll infinito; desde sm es una tarjeta de grilla.
 */
export function TarjetaIntegracion({ icono, nombre, para, estado, onClick, textoBoton, destacada }: {
  icono: React.ReactNode; nombre: string; para: React.ReactNode;
  estado: 'conectado' | 'desconectado' | 'atencion' | 'pronto'; onClick?: () => void; textoBoton?: string; destacada?: boolean;
}) {
  const etiquetaEstado = { conectado: 'Conectado', desconectado: 'Sin conectar', atencion: 'Revisar', pronto: 'Próximamente' }[estado];
  const colorEstado = { conectado: 'var(--status-good)', desconectado: 'var(--baseline)', atencion: 'var(--status-warning)', pronto: 'var(--baseline)' }[estado];
  const colorTexto = estado === 'desconectado' || estado === 'pronto' ? 'var(--text-muted)' : colorEstado;
  const idPara = useId();
  const chip = (
    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium" style={{ color: colorTexto }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: colorEstado }} aria-hidden />{etiquetaEstado}
    </span>
  );
  return (
    // Para lectores de pantalla: "Instagram, Conectado" + la descripción (no "Conectado Instagram…").
    <button type="button" onClick={onClick} disabled={estado === 'pronto'} aria-label={`${nombre}, ${etiquetaEstado}`} aria-describedby={idPara}
      className={`tarjeta ui-foco flex w-full items-center gap-3 px-3 py-2.5 text-left transition-shadow hover:shadow-md disabled:cursor-default disabled:opacity-60 sm:h-full sm:flex-col sm:items-stretch sm:gap-2 sm:p-4 ${destacada ? '!border-[var(--series-1)]' : ''}`}>
      <div className="flex shrink-0 items-start justify-between gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl text-[20px]" style={{ background: 'var(--page-plane)' }} aria-hidden>{icono}</span>
        <span className="hidden sm:inline-flex">{chip}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-semibold">{nombre}</span>
          <span className="sm:hidden">{chip}</span>
        </div>
        <div id={idPara} className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-[var(--text-muted)] sm:line-clamp-none">{para}</div>
      </div>
      {estado !== 'pronto' && (
        <span className="mt-auto hidden pt-1 text-[12px] font-medium sm:block" style={{ color: 'var(--series-1)' }}>
          {textoBoton ?? (estado === 'conectado' ? 'Ver / ajustar →' : 'Conectar →')}
        </span>
      )}
      {estado !== 'pronto' && <span className="shrink-0 text-[20px] leading-none text-[var(--text-muted)] sm:hidden" aria-hidden>›</span>}
    </button>
  );
}
