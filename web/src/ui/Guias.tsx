import { useId } from 'react';
import { Insignia, type Tono } from './Basicos';

// Pasos guiados para conectar cosas (integraciones) sin perderse: cada paso
// numerado, el actual abierto, los hechos con ✓, y una verificación en vivo
// que dice "escuchando…" hasta que llega el primer dato.

export type EstadoPaso = 'hecho' | 'actual' | 'pendiente';

export function PasosGuiados({ pasos }: {
  pasos: Array<{ titulo: React.ReactNode; estado: EstadoPaso; contenido?: React.ReactNode; resumen?: React.ReactNode }>;
}) {
  return (
    <ol className="relative flex flex-col">
      {pasos.map((p, i) => {
        const ultimo = i === pasos.length - 1;
        return (
          <li key={i} className="relative flex gap-3 pb-4 last:pb-0" aria-current={p.estado === 'actual' ? 'step' : undefined}>
            {!ultimo && <span className="absolute left-[13px] top-7 h-[calc(100%-24px)] w-px" style={{ background: p.estado === 'hecho' ? 'var(--status-good)' : 'var(--border-hairline)' }} aria-hidden />}
            <span className="relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
              style={p.estado === 'hecho'
                ? { background: 'var(--status-good)', color: 'white' }
                : p.estado === 'actual'
                  ? { background: 'var(--accion, var(--series-1))', color: 'white' }
                  : { background: 'var(--surface-2, var(--gridline))', color: 'var(--text-muted)' }}>
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

export type EstadoVerificacion = 'esperando' | 'ok' | 'error' | 'inactivo' | 'escuchando' | 'aviso';

const COLOR_VERIF: Record<EstadoVerificacion, string> = {
  ok: 'var(--status-good)', error: 'var(--status-critical)', esperando: 'var(--status-warning)',
  aviso: 'var(--status-warning)', escuchando: 'var(--accion, var(--series-1))', inactivo: 'var(--baseline)',
};

/**
 * Estado de una verificación en vivo (ej. "escuchando el primer lead de
 * ManyChat"). La caja se tiñe según el estado (verde, ámbar, roja) y puede
 * llevar acciones adentro (`detalle`), p. ej. [Probar de nuevo] en el error.
 */
export function Verificacion({ estado, esperando, ok, error, accion, detalle }: {
  estado: EstadoVerificacion; esperando?: React.ReactNode; ok?: React.ReactNode;
  error?: React.ReactNode; accion?: React.ReactNode;
  /** Contenido extra debajo del texto (botones, detalle técnico plegado). */
  detalle?: React.ReactNode;
}) {
  const color = COLOR_VERIF[estado];
  const late = estado === 'esperando' || estado === 'escuchando';
  const tenido = estado === 'ok' || estado === 'error' || estado === 'aviso' || estado === 'esperando';
  return (
    <div className="rounded-lg px-3 py-2 text-[12px]" role="status" aria-live="polite"
      style={{
        background: tenido ? `color-mix(in srgb, ${color} 9%, var(--surface-1))` : 'var(--page-plane)',
        border: `1px solid ${tenido ? `color-mix(in srgb, ${color} 32%, transparent)` : 'var(--border-hairline)'}`,
      }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
          {late && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: color }} />}
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        </span>
        <span className="min-w-0 flex-1 leading-snug">{estado === 'ok' ? ok : estado === 'error' || estado === 'aviso' ? error : esperando}</span>
        {accion}
      </div>
      {detalle && <div className="mt-2 pl-[18px]">{detalle}</div>}
    </div>
  );
}

export type EstadoTarjeta = 'conectado' | 'desconectado' | 'atencion' | 'pronto' | 'esperando' | 'desconocido';

const ESTADOS: Record<EstadoTarjeta, { texto: string; corto?: string; tono: Tono }> = {
  conectado: { texto: 'Conectado', tono: 'verde' },
  esperando: { texto: 'Esperando el primer dato', corto: 'Esperando datos', tono: 'amarillo' },
  atencion: { texto: 'Revisar', tono: 'amarillo' },
  desconectado: { texto: 'Sin conectar', tono: 'neutro' },
  desconocido: { texto: 'No pudimos comprobarlo', corto: 'Sin comprobar', tono: 'neutro' },
  pronto: { texto: 'Próximamente', tono: 'neutro' },
};

/**
 * Tarjeta de una integración: logo, nombre, estado (Insignia legible), una
 * línea de para qué sirve o qué pasa y la acción. En el celular es una fila
 * compacta (logo · nombre y estado · una línea · ›); desde sm, tarjeta de grilla.
 * Toda la tarjeta abre la guía; `accion` es un botón aparte con su propia
 * acción (p. ej. "Renovar conexión"), y en 'desconocido' se ofrece Reintentar.
 */
export function TarjetaIntegracion({
  icono, logo, nombre, para, detalle, estado, onClick, textoBoton, destacada, recomendada, accion, onReintentar, etiquetaEstado,
}: {
  icono?: React.ReactNode; logo?: React.ReactNode; nombre: string; para: React.ReactNode;
  /** Segunda línea (p. ej. "Lo configuraste el 20 nov · todavía no llegó nada"). */
  detalle?: React.ReactNode;
  estado: EstadoTarjeta; onClick?: () => void; textoBoton?: string; destacada?: boolean;
  /** Etiqueta "Empezá por acá" (o el texto que se pase). */
  recomendada?: boolean | string;
  /** Botón con acción propia (distinta de abrir la guía). */
  accion?: { texto: string; onClick: () => void; cargando?: boolean };
  onReintentar?: () => void;
  /** Texto del estado a medida ("Vence en 6 días", "Con error"…). */
  etiquetaEstado?: string;
}) {
  const e = ESTADOS[estado];
  const etiqueta = etiquetaEstado ?? e.texto;
  const corto = etiquetaEstado ?? e.corto ?? e.texto;
  const idPara = useId();
  const marca = logo ?? icono;
  const boton = accion ?? (estado === 'desconocido' && onReintentar ? { texto: 'Reintentar', onClick: onReintentar } : undefined);
  const cta = textoBoton ?? (estado === 'conectado' ? 'Ver / ajustar →' : estado === 'esperando' ? 'Probar →' : estado === 'atencion' ? 'Revisar →' : 'Conectar →');
  const insignia = (cortar: boolean) => (
    <span key={estado} className="ui-aparecer inline-flex">
      <Insignia tono={e.tono} punto>
        {estado === 'esperando' && <span className="sr-only">Estado: </span>}
        {cortar ? corto : etiqueta}
      </Insignia>
    </span>
  );
  const rotulo = recomendada ? (typeof recomendada === 'string' ? recomendada : 'Empezá por acá') : null;
  return (
    <div className={`tarjeta group relative flex w-full items-center gap-3 px-3 py-2.5 transition-shadow hover:shadow-md sm:h-full sm:flex-col sm:items-stretch sm:gap-2 sm:p-4 ${estado === 'pronto' ? 'opacity-60' : ''}`}
      style={destacada && !rotulo ? { borderColor: 'var(--accion, var(--series-1))' } : undefined}>
      {/* Toda la tarjeta es el botón (lectores de pantalla: "Instagram, Conectado" + la descripción). */}
      <button type="button" onClick={onClick} disabled={estado === 'pronto'} aria-label={`${nombre}, ${etiqueta}`} aria-describedby={idPara}
        className="ui-foco absolute inset-0 z-[1] rounded-[inherit] disabled:cursor-default" />
      <div className="pointer-events-none flex shrink-0 items-start justify-between gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg text-[20px]" style={{ background: 'var(--surface-2, var(--page-plane))' }} aria-hidden>{marca}</span>
        <span className="hidden flex-col items-end gap-1 sm:flex">
          {insignia(false)}
          {rotulo && <span className="text-[11px] font-semibold" style={{ color: 'var(--accion, var(--series-1))' }}>{rotulo}</span>}
        </span>
      </div>
      <div className="pointer-events-none min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate text-[14px] font-semibold">{nombre}</span>
          <span className="sm:hidden">{insignia(true)}</span>
          {rotulo && <span className="text-[11px] font-semibold sm:hidden" style={{ color: 'var(--accion, var(--series-1))' }}>· {rotulo}</span>}
        </div>
        <div id={idPara} className="mt-0.5 line-clamp-1 text-[12px] leading-snug text-[var(--text-secondary)] sm:line-clamp-2">{para}</div>
        {detalle && <div className="mt-0.5 hidden text-[12px] leading-snug sm:block">{detalle}</div>}
      </div>
      {estado !== 'pronto' && (
        boton ? (
          <button type="button" onClick={boton.onClick} disabled={boton.cargando}
            className="ui-foco relative z-[2] shrink-0 rounded-md px-2.5 py-1.5 text-[12px] font-semibold disabled:opacity-60 sm:mt-auto sm:self-start sm:px-0 sm:py-0 sm:pt-1"
            style={{ color: 'var(--accion, var(--series-1))' }}>
            {boton.cargando ? 'Un momento…' : `${boton.texto} →`}
          </button>
        ) : (
          <>
            <span className="pointer-events-none mt-auto hidden pt-1 text-[12px] font-semibold sm:block" style={{ color: 'var(--accion, var(--series-1))' }}>{cta}</span>
            <span className="pointer-events-none shrink-0 text-[20px] leading-none text-[var(--text-muted)] sm:hidden" aria-hidden>›</span>
          </>
        )
      )}
    </div>
  );
}
