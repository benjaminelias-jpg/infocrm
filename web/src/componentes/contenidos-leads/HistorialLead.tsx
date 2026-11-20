import { useMemo, useState } from 'react';
import { fmtDinero, fmtFecha } from '../../api';
import { textoDe } from '../../textos';
import { Vacio } from '../../ui';
import { COLOR_EVENTO, EVENTO, FUENTE } from './textos';

// Lo que pasó con el lead, agrupado por día ("Hoy", "Ayer", "12 nov") y
// plegado a los últimos 8. El reel se nombra solo si no es el de origen.

const INICIAL = 8;

function dia(fecha: string) {
  const d = new Date(fecha);
  const hoy = new Date();
  const ayer = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === hoy.toDateString()) return 'Hoy';
  if (d.toDateString() === ayer.toDateString()) return 'Ayer';
  return fmtFecha(d);
}

function hora(fecha: string) {
  return new Date(fecha).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function HistorialLead({ eventos, contenidoOrigen }: { eventos: any[]; contenidoOrigen?: string | null }) {
  const [todos, setTodos] = useState(false);
  const visibles = todos ? eventos : eventos.slice(0, INICIAL);
  const grupos = useMemo(() => {
    const g: Array<{ dia: string; eventos: any[] }> = [];
    for (const ev of visibles) {
      const d = dia(ev.ocurrido_en);
      const ult = g[g.length - 1];
      if (ult && ult.dia === d) ult.eventos.push(ev); else g.push({ dia: d, eventos: [ev] });
    }
    return g;
  }, [visibles]);

  if (!eventos.length) {
    return <Vacio compacto icono={<span className="text-[16px]">·</span>} titulo="Todavía no pasó nada" texto="Acá vas a ver cada mensaje, reunión y compra de este lead." />;
  }

  return (
    <div>
      {grupos.map((g) => (
        <section key={g.dia} className="mb-3 last:mb-0">
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{g.dia}</h4>
          <ol className="relative space-y-2.5 border-l border-[var(--gridline)] pl-4">
            {g.eventos.map((ev) => {
              const fuente = FUENTE[ev.fuente] ?? '';
              const reel = ev.contenido_titulo && ev.contenido_titulo !== contenidoOrigen ? ev.contenido_titulo : null;
              return (
                <li key={ev.id} className="relative">
                  <span className="absolute -left-[21px] top-[5px] h-2.5 w-2.5 rounded-full ring-2 ring-[var(--surface-1)]"
                    style={{ background: COLOR_EVENTO[ev.tipo] ?? 'var(--baseline)' }} aria-hidden />
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 text-[13px]">
                      {EVENTO[ev.tipo] ?? textoDe('evento', ev.tipo)}
                      {ev.titulo && <span className="text-[var(--text-secondary)]"> · {ev.titulo}</span>}
                      {Number(ev.valor) > 0 && (
                        <span className="cifras ml-1.5 font-semibold" style={{ color: ev.tipo === 'reembolso' ? 'var(--status-critical)' : 'var(--status-good)' }}>
                          {fmtDinero(ev.valor, ev.moneda || undefined)}
                        </span>
                      )}
                    </span>
                    <span className="cifras shrink-0 text-[11px] text-[var(--text-muted)]">{hora(ev.ocurrido_en)}</span>
                  </div>
                  {(fuente || reel) && (
                    <div className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
                      {fuente}{fuente && reel ? ' · ' : ''}{reel ? `por «${reel}»` : ''}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      {eventos.length > INICIAL && (
        <button type="button" onClick={() => setTodos((v) => !v)}
          className="ui-foco mt-1 w-full rounded-lg py-2 text-center text-[12px] font-medium text-[var(--series-1)] hover:bg-[var(--page-plane)]">
          {todos ? 'Ver menos' : `Ver todo (${eventos.length})`}
        </button>
      )}
    </div>
  );
}
