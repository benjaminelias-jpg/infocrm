import { memo, useEffect, useState } from 'react';
import { Avatar, BotonIcono, FilaDeslizable, nombreVisible, type AccionFila } from '../../ui';
import { IconoChat } from './iconos';
import { cuandoCorto, ventanaRestante, vistaPrevia } from './util';
import type { Conversacion } from './tipos';

// Una conversación en la bandeja, como en WhatsApp: avatar, nombre y @usuario,
// la hora a la derecha y, abajo, el último mensaje (o el borrador) con el
// contador de no leídos o el ⏳ si la ventana de Instagram se está por cerrar.
// En el celular se desliza para marcar leído, asignarse o archivar.

export interface AccionesFila {
  alternarLeido: (c: Conversacion) => void;
  asignarme: (c: Conversacion) => void;
  archivar: (c: Conversacion) => void;
}

export const FilaConversacion = memo(function FilaConversacion({
  c, activa, borrador, resaltar, yoId, acciones, onAbrir, escritorio,
}: {
  c: Conversacion; activa: boolean; borrador: string; resaltar: boolean; yoId: string | null;
  acciones: AccionesFila; onAbrir: (id: string) => void;
  /** Escritorio: acciones como íconos al pasar el mouse (en el celular, deslizando). */
  escritorio?: boolean;
}) {
  const [brillo, setBrillo] = useState(resaltar);
  useEffect(() => {
    if (!resaltar) return;
    setBrillo(true);
    const t = window.setTimeout(() => setBrillo(false), 1100);
    return () => window.clearTimeout(t);
  }, [resaltar]);

  const nombre = nombreVisible(c.nombre, c.ig_username);
  const usuario = c.nombre?.trim() && c.ig_username ? `@${c.ig_username}` : null;
  const sinLeer = Number(c.mensajes_sin_leer) || 0;
  const pendiente = c.ultimo_dir === 'entrante' && !c.archivado;
  const prev = vistaPrevia(c);
  const ventana = pendiente ? ventanaRestante(c.ventana_cierra_en) : null;
  const urgente = ventana && ventana.tono !== 'verde';
  const cuando = cuandoCorto(c.ultimo_en ?? c.actividad);

  const lista: AccionFila[] = [
    sinLeer > 0
      ? { etiqueta: 'Marcar leído', icono: <IconoChat nombre="leido" tam={16} />, color: 'var(--series-1)', onClick: () => acciones.alternarLeido(c) }
      : { etiqueta: 'No leído', icono: <IconoChat nombre="noleido" tam={12} />, color: 'var(--series-1)', onClick: () => acciones.alternarLeido(c) },
  ];
  if (yoId && c.propietario_id !== yoId) {
    lista.push({ etiqueta: 'Asignarme', icono: <IconoChat nombre="usuario" tam={16} />, color: 'var(--series-2)', onClick: () => acciones.asignarme(c) });
  }
  if (c.con_conversacion || c.archivado) {
    lista.push({ etiqueta: c.archivado ? 'Desarchivar' : 'Archivar', icono: <IconoChat nombre="archivar" tam={16} />, color: 'var(--status-good)', onClick: () => acciones.archivar(c) });
  }

  const fondo = activa
    ? 'color-mix(in srgb, var(--series-1) 11%, var(--page-plane))'
    : brillo ? 'color-mix(in srgb, var(--series-1) 18%, var(--page-plane))' : 'var(--page-plane)';

  let segunda: React.ReactNode;
  if (borrador) {
    segunda = <><span className="font-medium" style={{ color: 'var(--series-1)' }}>Borrador:</span> {borrador}</>;
  } else if (!c.con_conversacion && c.contenido) {
    segunda = <>Vino de «{c.contenido}»</>;
  } else {
    segunda = (
      <>
        {prev.fallo && <span className="font-semibold" style={{ color: 'var(--status-critical)' }} title="No le llegó">! </span>}
        {prev.prefijo && <span className={prev.prefijo === '🤖' ? '' : 'text-[var(--text-secondary)]'}>{prev.prefijo} </span>}
        {prev.texto}
      </>
    );
  }

  const fila = (
        <button type="button" data-abrir onClick={() => onAbrir(c.id)} aria-current={activa ? 'true' : undefined}
          className="ui-foco relative flex w-full items-center gap-3 py-2.5 pl-3 pr-3 text-left transition-colors duration-700 hover:brightness-[0.98]"
          style={{ background: fondo }}>
          {activa && <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: 'var(--series-1)' }} aria-hidden />}
          <Avatar id={c.id} nombre={c.nombre} usuario={c.ig_username} foto={c.avatar_url} tam={42} />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-1.5">
              <span className={`min-w-0 shrink-[0.25] truncate text-[14px] md:text-[13px] ${pendiente || sinLeer ? 'font-semibold' : 'font-medium'}`}>{nombre}</span>
              {c.etapa && (
                <span className="h-2 w-2 shrink-0 self-center rounded-full" style={{ background: c.etapa_color || 'var(--baseline)' }}
                  title={`Etapa: ${c.etapa}`} aria-label={`Etapa: ${c.etapa}`} role="img" />
              )}
              {usuario && <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-muted)]">{usuario}</span>}
              <span className="ml-auto shrink-0 pl-1 text-[11px]"
                style={{ color: sinLeer || pendiente ? 'var(--series-1)' : 'var(--text-muted)', fontWeight: sinLeer ? 600 : 400 }}>
                {cuando}
              </span>
            </span>
            <span className="mt-0.5 flex items-center gap-1.5">
              <span className={`min-w-0 flex-1 truncate text-[13px] md:text-[12px] ${sinLeer ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
                {segunda}
              </span>
              {urgente && (
                <span className="inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-[1px] text-[10px] font-semibold"
                  style={ventana!.tono === 'rojo'
                    ? { background: 'color-mix(in srgb, var(--status-critical) 14%, transparent)', color: 'var(--status-critical)' }
                    : { background: 'color-mix(in srgb, var(--status-warning) 22%, transparent)', color: 'color-mix(in srgb, var(--status-warning) 55%, var(--text-primary))' }}
                  title="La ventana de 24 h de Instagram se está por cerrar">
                  ⏳ {ventana!.corto}
                </span>
              )}
              {c.flujo_esperando && !urgente && (
                <span className="shrink-0" style={{ color: 'var(--text-secondary)' }} title="Un automensaje espera su respuesta" aria-label="En automensaje" role="img">
                  <IconoChat nombre="pausa" tam={12} />
                </span>
              )}
              {sinLeer > 0 && (
                <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1.5 text-[11px] font-semibold text-white"
                  style={{ background: 'var(--series-1)' }} aria-label={`${sinLeer} sin leer`}>
                  {sinLeer > 99 ? '99+' : sinLeer}
                </span>
              )}
            </span>
          </span>
        </button>
  );

  if (escritorio) {
    return (
      <li className="group relative border-b border-[var(--border-hairline)]" data-fila={c.id}>
        {fila}
        <div className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-lg p-0.5 opacity-0 shadow-md transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-hairline)' }}>
          {lista.map((a) => (
            <BotonIcono key={a.etiqueta} etiqueta={a.etiqueta} tamano="xs" onClick={(e) => { e.stopPropagation(); a.onClick(); }}>
              {a.icono}
            </BotonIcono>
          ))}
        </div>
      </li>
    );
  }
  return (
    <li className="border-b border-[var(--border-hairline)]" data-fila={c.id}>
      <FilaDeslizable acciones={lista}>{fila}</FilaDeslizable>
    </li>
  );
});
