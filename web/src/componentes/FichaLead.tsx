import { useEffect, useState } from 'react';
import { api, fmtDinero, fmtFecha, fmtNum } from '../api';
import { Cargando } from './Graficas';
import { CALIFICACION, colorScore } from '../infoprod';

const ETIQUETA_EVENTO: Record<string, string> = {
  lead_creado: 'Entró como lead',
  recurso_entregado: 'Recurso entregado',
  respondio_dm: 'Respondió por DM',
  comentario: 'Comentó',
  reunion_agendada: 'Agendó reunión',
  reunion_realizada: 'Reunión realizada',
  reunion_no_asistio: 'No se presentó',
  reunion_cancelada: 'Canceló la reunión',
  venta: 'Compró',
  reembolso: 'Reembolso',
  etapa_cambiada: 'Cambio de etapa',
  mensaje_enviado: 'Mensaje enviado',
  mensaje_recibido: 'Mensaje recibido',
  nota: 'Nota',
};

const COLOR_EVENTO: Record<string, string> = {
  venta: 'var(--status-good)',
  reunion_agendada: 'var(--series-2)',
  reunion_no_asistio: 'var(--status-critical)',
  reembolso: 'var(--status-critical)',
  lead_creado: 'var(--series-1)',
};

const CONFIANZA: Record<string, { texto: string; color: string }> = {
  alta: { texto: 'Atribución exacta', color: 'var(--status-good)' },
  media: { texto: 'Atribución aproximada', color: 'var(--ramp-5)' },
  baja: { texto: 'Atribución dudosa', color: 'var(--status-warning)' },
  ninguna: { texto: 'Sin atribuir', color: 'var(--text-muted)' },
};

export default function FichaLead({
  leadId, alCerrar,
}: { leadId: string; alCerrar: () => void }) {
  const [lead, setLead] = useState<any>(null);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    setLead(await api(`/leads/${leadId}`));
  }

  useEffect(() => { cargar(); }, [leadId]);

  useEffect(() => {
    function escape(e: KeyboardEvent) { if (e.key === 'Escape') alCerrar(); }
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [alCerrar]);

  async function anadirNota(e: React.FormEvent) {
    e.preventDefault();
    if (!nota.trim()) return;
    setGuardando(true);
    try {
      await api(`/leads/${leadId}/notas`, { method: 'POST', json: { cuerpo: nota } });
      setNota('');
      await cargar();
    } finally {
      setGuardando(false);
    }
  }

  const primerToque = lead?.toques?.find((t: any) => t.contenido_id);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      onClick={alCerrar}
      role="dialog"
      aria-modal="true"
      aria-label="Ficha del lead"
    >
      <div
        className="h-full w-full max-w-[520px] overflow-y-auto shadow-2xl"
        style={{ background: 'var(--surface-1)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {!lead ? (
          <Cargando />
        ) : (
          <>
            <header className="sticky top-0 z-10 border-b border-[var(--border-hairline)] px-5 py-4"
                    style={{ background: 'var(--surface-1)' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-[17px] font-semibold tracking-tight">
                    {lead.nombre || lead.ig_username || 'Sin nombre'} {lead.apellido ?? ''}
                  </h2>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-[var(--text-muted)]">
                    {lead.ig_username && (
                      <a
                        href={`https://instagram.com/${lead.ig_username}`}
                        target="_blank" rel="noreferrer"
                        className="hover:underline"
                      >
                        @{lead.ig_username}
                      </a>
                    )}
                    {lead.email && <span>· {lead.email}</span>}
                    {lead.pais && <span>· {lead.pais}</span>}
                  </div>
                </div>
                <button
                  onClick={alCerrar}
                  className="shrink-0 rounded px-2 py-1 text-[16px] text-[var(--text-muted)] hover:bg-[var(--page-plane)]"
                  aria-label="Cerrar"
                >
                  ✕
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {lead.etapa_nombre && (
                  <span
                    className="rounded-full px-2.5 py-0.5 text-[11px] font-medium text-white"
                    style={{ background: lead.etapa_color }}
                  >
                    {lead.etapa_nombre}
                  </span>
                )}
                {Number(lead.valor_total) > 0 && (
                  <span className="cifras text-[13px] font-semibold" style={{ color: 'var(--status-good)' }}>
                    {fmtDinero(lead.valor_total)}
                  </span>
                )}
                {(lead.etiquetas ?? []).map((e: string) => (
                  <span
                    key={e}
                    className="rounded px-1.5 py-[2px] text-[10px]"
                    style={{ background: 'var(--gridline)', color: 'var(--text-secondary)' }}
                  >
                    {e}
                  </span>
                ))}
              </div>
            </header>

            <div className="px-5 py-4">
              {/* Calidad del lead (score + filtro antipodridos) */}
              <section className="mb-4 rounded-lg p-3" style={{ background: 'var(--page-plane)' }}>
                <div className="flex items-start gap-4">
                  <div className="shrink-0 text-center">
                    <div className="cifras text-[30px] font-semibold leading-none"
                      style={{ color: colorScore(Number(lead.score ?? 0)) }}>
                      {Number(lead.score ?? 0)}
                    </div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Score</div>
                    {lead.calificacion && CALIFICACION[lead.calificacion] && (
                      <div className="mt-1 text-[11px]" style={{ color: CALIFICACION[lead.calificacion].color }}>
                        {CALIFICACION[lead.calificacion].etiqueta}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                      Por qué este score
                    </h3>
                    {Array.isArray(lead.score_detalle) && lead.score_detalle.length > 0 ? (
                      <ul className="space-y-0.5 text-[12px]">
                        {lead.score_detalle.map((d: any, i: number) => (
                          <li key={i} className="flex items-baseline justify-between gap-2">
                            <span className="text-[var(--text-secondary)]">{d.motivo}</span>
                            <span className="cifras shrink-0 font-medium" style={{ color: 'var(--status-good)' }}>
                              +{d.puntos}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[12px] text-[var(--text-muted)]">
                        Todavía no ha hecho nada que sume: solo pidió el recurso. Es el patrón del cazador de freebies.
                      </p>
                    )}
                  </div>
                </div>

                {(lead.modelo_negocio || lead.ingresos_aprox || lead.cuello_botella) && (
                  <div className="mt-3 grid grid-cols-1 gap-2 border-t border-[var(--border-hairline)] pt-3 text-[12px] sm:grid-cols-3">
                    {lead.modelo_negocio && (
                      <div><div className="text-[10px] uppercase text-[var(--text-muted)]">Negocio</div>{lead.modelo_negocio}</div>
                    )}
                    {lead.ingresos_aprox && (
                      <div><div className="text-[10px] uppercase text-[var(--text-muted)]">Ingresos</div>{lead.ingresos_aprox}</div>
                    )}
                    {lead.cuello_botella && (
                      <div><div className="text-[10px] uppercase text-[var(--text-muted)]">Cuello de botella</div>{lead.cuello_botella}</div>
                    )}
                  </div>
                )}
              </section>

              {/* Atribución */}
              <section className="rounded-lg p-3" style={{ background: 'var(--page-plane)' }}>
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  De dónde vino
                </h3>
                {lead.contenido_titulo ? (
                  <>
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 text-[12px]" aria-hidden>▶</span>
                      <div className="min-w-0">
                        {lead.contenido_permalink ? (
                          <a
                            href={lead.contenido_permalink} target="_blank" rel="noreferrer"
                            className="text-[13px] font-medium hover:underline"
                          >
                            {lead.contenido_titulo}
                          </a>
                        ) : (
                          <span className="text-[13px] font-medium">{lead.contenido_titulo}</span>
                        )}
                        <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                          {lead.palabra_clave && (
                            <>comentó <code className="rounded px-1" style={{ background: 'var(--gridline)' }}>
                              {lead.palabra_clave}
                            </code> · </>
                          )}
                          {fmtFecha(lead.primer_contacto_en, true)}
                        </div>
                      </div>
                    </div>
                    {primerToque && (
                      <div className="mt-2 flex items-center gap-1.5 text-[11px]">
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full"
                          style={{ background: CONFIANZA[primerToque.confianza]?.color }}
                          aria-hidden
                        />
                        <span style={{ color: CONFIANZA[primerToque.confianza]?.color }}>
                          {CONFIANZA[primerToque.confianza]?.texto}
                        </span>
                        <span className="text-[var(--text-muted)]">
                          (por {primerToque.metodo.replace('_', ' ')})
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-[12px] text-[var(--text-muted)]">
                    No se pudo atribuir a ningún contenido: el webhook no traía ni ig_media_id ni una
                    palabra clave enlazada a un reel.
                  </p>
                )}
              </section>

              {/* Oportunidades */}
              {lead.oportunidades?.length > 1 && (
                <section className="mt-4">
                  <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    Oportunidades ({lead.oportunidades.length})
                  </h3>
                  <div className="space-y-1.5">
                    {lead.oportunidades.map((o: any) => (
                      <div key={o.id} className="flex items-center justify-between text-[12px]">
                        <span className="flex items-center gap-2">
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ background: o.etapa_color }}
                            aria-hidden
                          />
                          {o.etapa_nombre}
                        </span>
                        <span className="cifras text-[var(--text-muted)]">
                          {Number(o.valor) > 0 ? fmtDinero(o.valor) : '—'} · {fmtFecha(o.abierta_en)}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Timeline */}
              <section className="mt-4">
                <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  Historial
                </h3>
                <ol className="relative space-y-3 border-l border-[var(--gridline)] pl-4">
                  {(lead.eventos ?? []).map((ev: any) => (
                    <li key={ev.id} className="relative">
                      <span
                        className="absolute -left-[21px] top-[5px] h-2.5 w-2.5 rounded-full ring-2"
                        style={{
                          background: COLOR_EVENTO[ev.tipo] ?? 'var(--baseline)',
                          ['--tw-ring-color' as any]: 'var(--surface-1)',
                        }}
                        aria-hidden
                      />
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[13px]">
                          {ETIQUETA_EVENTO[ev.tipo] ?? ev.tipo}
                          {ev.titulo && (
                            <span className="text-[var(--text-secondary)]"> · {ev.titulo}</span>
                          )}
                          {Number(ev.valor) > 0 && (
                            <span className="cifras ml-1.5 font-semibold" style={{ color: 'var(--status-good)' }}>
                              {fmtDinero(ev.valor, ev.moneda ?? 'EUR')}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
                          {fmtFecha(ev.ocurrido_en, true)}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                        vía {ev.fuente}
                        {ev.contenido_titulo && <> · {ev.contenido_titulo}</>}
                      </div>
                    </li>
                  ))}
                  {(lead.eventos ?? []).length === 0 && (
                    <li className="text-[12px] text-[var(--text-muted)]">Sin eventos todavía.</li>
                  )}
                </ol>
              </section>

              {/* Notas */}
              <section className="mt-5">
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  Notas
                </h3>
                <form onSubmit={anadirNota} className="mb-3">
                  <textarea
                    value={nota}
                    onChange={(e) => setNota(e.target.value)}
                    rows={2}
                    placeholder="Qué pasó en la llamada…"
                    className="w-full resize-none rounded-md border border-[var(--border-hairline)] bg-transparent px-3 py-2 text-[13px] outline-none focus:border-[var(--series-1)]"
                  />
                  <button
                    type="submit"
                    disabled={guardando || !nota.trim()}
                    className="mt-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
                    style={{ background: 'var(--series-1)' }}
                  >
                    {guardando ? 'Guardando…' : 'Añadir nota'}
                  </button>
                </form>

                <div className="space-y-2">
                  {(lead.notas ?? []).map((n: any) => (
                    <div key={n.id} className="rounded-md p-2.5" style={{ background: 'var(--page-plane)' }}>
                      <p className="whitespace-pre-wrap text-[13px]">{n.cuerpo}</p>
                      <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                        {n.usuario_nombre ?? 'Sistema'} · {fmtFecha(n.creado_en, true)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
