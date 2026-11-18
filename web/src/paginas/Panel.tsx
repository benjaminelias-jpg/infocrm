import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDinero, fmtNum, fmtPct } from '../api';
import { MiniSerie, Embudo, Kpi, BarraCalidad, Cargando } from '../componentes/Graficas';
import Cabecera, { RangoFechas, usarRango } from '../componentes/Cabecera';
import { COLOR_EMBUDO, ROLES } from '../infoprod';

export default function Panel() {
  const { rango, setRango, params } = usarRango();
  const [datos, setDatos] = useState<any>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    setCargando(true);
    api(`/analitica/panel?${params}`)
      .then(setDatos)
      .finally(() => setCargando(false));
  }, [params]);

  if (cargando && !datos) return <Cargando />;
  if (!datos) return null;

  const k = datos.kpis;
  const serie = datos.serie ?? [];
  const topContenidos = (datos.contenidos ?? [])
    .filter((c: any) => c.id)
    .slice(0, 5);

  return (
    <div className="px-5 py-5 lg:px-8">
      <Cabecera
        titulo="Panel"
        subtitulo="De qué contenido vienen tus leads, tus reuniones y tu dinero"
        derecha={<RangoFechas rango={rango} setRango={setRango} />}
      />

      {/* KPIs */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
        <Kpi
          etiqueta="Leads" valor={fmtNum(k.leads)} acento="var(--series-1)"
          sub={`${fmtPct(k.cobertura_atribucion)} con origen conocido`}
          ayuda="Leads que entraron en el periodo seleccionado"
        />
        <Kpi
          etiqueta="Reuniones" valor={fmtNum(k.reuniones_agendadas)} acento="var(--series-2)"
          sub={`${fmtPct(k.tasa_lead_reunion)} de los leads`}
        />
        <Kpi
          etiqueta="Asistencia" valor={fmtPct(k.tasa_asistencia)}
          sub={`${fmtNum(k.no_shows)} no-shows`}
        />
        <Kpi
          etiqueta="Ventas" valor={fmtNum(k.ventas)} acento="var(--series-3)"
          sub={`${fmtPct(k.tasa_reunion_venta)} de las reuniones hechas`}
        />
        <Kpi
          etiqueta="Ingresos" valor={fmtDinero(k.ingresos)}
          sub={`ticket medio ${fmtDinero(k.ticket_medio)}`}
        />
        <Kpi
          etiqueta="Valor por lead" valor={fmtDinero(k.valor_por_lead)}
          sub={k.dias_medios_cierre > 0 ? `cierra en ${k.dias_medios_cierre} días` : undefined}
          ayuda="Cuánto factura de media cada lead que entra. Es el número que decide cuánto puedes pagar por un lead."
        />
      </div>

      {/* Objetivo del mes */}
      {datos.metas?.tiene_meta && datos.metas.progreso && (
        <section className="tarjeta mt-4 min-w-0 p-4">
          <h2 className="mb-3 text-[14px] font-semibold">Objetivo del mes</h2>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { k: 'leads', et: 'Leads', color: 'var(--series-1)', fmt: fmtNum },
              { k: 'calificados', et: 'Calificados', color: 'var(--series-2)', fmt: fmtNum },
              { k: 'ventas', et: 'Ventas', color: 'var(--series-3)', fmt: fmtNum },
              { k: 'ingresos', et: 'Ingresos', color: 'var(--ramp-6)', fmt: (n: number) => fmtDinero(n) },
            ].map(({ k, et, color, fmt }) => {
              const real = datos.metas.real[k];
              const obj = datos.metas.objetivo[k];
              const pct = datos.metas.progreso[k];
              return (
                <div key={k}>
                  <div className="flex items-baseline justify-between text-[12px]">
                    <span className="text-[var(--text-secondary)]">{et}</span>
                    <span className="cifras text-[var(--text-muted)]">{pct}%</span>
                  </div>
                  <div className="cifras mt-0.5 text-[16px] font-semibold">
                    {fmt(real)} <span className="text-[12px] font-normal text-[var(--text-muted)]">/ {fmt(obj)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded" style={{ background: 'var(--gridline)' }}>
                    <div className="h-full rounded" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* Series */}
        <section className="tarjeta min-w-0 p-4 lg:col-span-2">
          <h2 className="mb-1 text-[14px] font-semibold">Evolución</h2>
          <p className="mb-4 text-[12px] text-[var(--text-muted)]">
            Cada métrica con su propia escala: meterlas en un mismo eje aplastaría las ventas contra cero.
          </p>
          <div className="space-y-4">
            <MiniSerie
              titulo="Leads" color="var(--series-1)"
              puntos={serie.map((s: any) => ({ periodo: s.periodo, valor: Number(s.leads) }))}
            />
            <MiniSerie
              titulo="Reuniones agendadas" color="var(--series-2)"
              puntos={serie.map((s: any) => ({ periodo: s.periodo, valor: Number(s.reuniones) }))}
            />
            <MiniSerie
              titulo="Ventas" color="var(--series-3)" tipo="barras"
              puntos={serie.map((s: any) => ({ periodo: s.periodo, valor: Number(s.ventas) }))}
            />
            <MiniSerie
              titulo="Ingresos" color="var(--ramp-6)" tipo="barras"
              formato={(n) => fmtDinero(n)}
              puntos={serie.map((s: any) => ({ periodo: s.periodo, valor: Number(s.ingresos) }))}
            />
          </div>
        </section>

        {/* Embudo */}
        <section className="tarjeta min-w-0 p-4">
          <h2 className="mb-1 text-[14px] font-semibold">Embudo</h2>
          <p className="mb-4 text-[12px] text-[var(--text-muted)]">
            Cuántos llegaron a cada etapa alguna vez, no cuántos están ahí ahora.
          </p>
          <Embudo pasos={datos.embudo ?? []} />
        </section>
      </div>

      {/* Ángulos: de qué tipo de contenido viene el dinero */}
      {datos.angulos?.some((a: any) => a.leads > 0) && (
        <section className="tarjeta mt-4 min-w-0 p-4">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[14px] font-semibold">De qué ángulo viene el dinero</h2>
            <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
              {['TOFU', 'MOFU', 'BOFU'].map((e) => (
                <span key={e} className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLOR_EMBUDO[e] }} aria-hidden />
                  {e}
                </span>
              ))}
            </div>
          </div>
          <p className="mb-4 text-[12px] text-[var(--text-muted)]">
            No todo el contenido hace el mismo trabajo. El de abajo del embudo (BOFU) cierra; el de
            arriba (TOFU) capta. Júzgalos distinto.
          </p>

          {(() => {
            const maxIng = Math.max(...datos.angulos.map((a: any) => a.ingresos), 1);
            const maxLeads = Math.max(...datos.angulos.map((a: any) => a.leads), 1);
            return (
              <div className="space-y-3">
                {datos.angulos.filter((a: any) => a.leads > 0).map((a: any) => (
                  <div key={a.angulo}>
                    <div className="mb-1 flex items-baseline justify-between text-[12px]">
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block h-2 w-2 rounded-full"
                          style={{ background: COLOR_EMBUDO[a.etapa_embudo] ?? 'var(--text-muted)' }} aria-hidden />
                        <span className="font-medium">{a.etiqueta}</span>
                        <span className="text-[var(--text-muted)]">{a.etapa_embudo ?? ''}</span>
                      </span>
                      <span className="cifras text-[var(--text-muted)]">
                        <span className="font-semibold text-[var(--text-primary)]">{fmtDinero(a.ingresos)}</span>
                        {'  ·  '}{fmtNum(a.leads)} leads · {fmtNum(a.ventas)} ventas · L→V {fmtPct(a.tasa_lead_venta)}
                      </span>
                    </div>
                    {/* dos barras finas: ingresos (fuerte) y leads (tenue) a la misma escala relativa */}
                    <div className="space-y-1">
                      <div className="h-2.5 overflow-hidden rounded" style={{ background: 'var(--gridline)' }}>
                        <div className="h-full rounded" style={{
                          width: `${Math.max((a.ingresos / maxIng) * 100, a.ingresos > 0 ? 2 : 0)}%`,
                          background: COLOR_EMBUDO[a.etapa_embudo] ?? 'var(--text-muted)',
                        }} title={`Ingresos ${fmtDinero(a.ingresos)}`} />
                      </div>
                      <div className="h-1.5 overflow-hidden rounded" style={{ background: 'var(--gridline)' }}>
                        <div className="h-full rounded opacity-40" style={{
                          width: `${Math.max((a.leads / maxLeads) * 100, 2)}%`,
                          background: COLOR_EMBUDO[a.etapa_embudo] ?? 'var(--text-muted)',
                        }} title={`${fmtNum(a.leads)} leads`} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

          {datos.mezcla?.aviso && (
            <div className="mt-4 flex items-start gap-1.5 rounded-md p-2.5 text-[11px]"
              style={{ background: 'var(--page-plane)' }}>
              <span style={{ color: 'var(--status-warning)' }} aria-hidden>⚠</span>
              <span className="text-[var(--text-secondary)]">
                {datos.mezcla.aviso} ({datos.mezcla.dias_muestra} días de muestra,
                {' '}{datos.mezcla.clasificados}/{datos.mezcla.total} contenidos con ángulo asignado)
              </span>
            </div>
          )}
        </section>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* Top contenidos */}
        <section className="tarjeta min-w-0 p-4 lg:col-span-2">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-[14px] font-semibold">Contenido que más factura</h2>
            <Link to="/contenidos" className="text-[12px] text-[var(--series-1)] hover:underline">
              Ver todos →
            </Link>
          </div>

          <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[480px] text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border-hairline)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                <th className="pb-2 font-medium">Contenido</th>
                <th className="pb-2 text-right font-medium">Leads</th>
                <th className="pb-2 text-right font-medium">Reu.</th>
                <th className="pb-2 text-right font-medium">Ventas</th>
                <th className="pb-2 text-right font-medium">Ingresos</th>
              </tr>
            </thead>
            <tbody>
              {topContenidos.map((c: any) => (
                <tr key={c.id} className="border-b border-[var(--border-hairline)] last:border-0">
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="max-w-[260px] truncate">{c.titulo}</span>
                      {c.rol && ROLES[c.rol] && c.rol !== 'estable' && c.rol !== 'sin_atribuir' && (
                        <span className="shrink-0 rounded px-1.5 py-[1px] text-[10px]"
                          style={{ background: 'var(--gridline)', color: ROLES[c.rol].color }}
                          title={ROLES[c.rol].ayuda}>
                          {ROLES[c.rol].etiqueta}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)]">
                      {c.tipo} · {fmtNum(c.ig_reproducciones)} repr.
                    </div>
                  </td>
                  <td className="cifras py-2 text-right">{fmtNum(c.leads)}</td>
                  <td className="cifras py-2 text-right">{fmtNum(c.reuniones_agendadas)}</td>
                  <td className="cifras py-2 text-right">{fmtNum(c.ventas)}</td>
                  <td className="cifras py-2 text-right font-semibold">{fmtDinero(c.ingresos)}</td>
                </tr>
              ))}
              {topContenidos.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-[12px] text-[var(--text-muted)]">
                    Aún no hay contenido con leads en este periodo.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </section>

        {/* Calidad de atribución */}
        <section className="tarjeta min-w-0 p-4">
          <h2 className="mb-1 text-[14px] font-semibold">Fiabilidad de la atribución</h2>
          <p className="mb-4 text-[12px] text-[var(--text-muted)]">
            Cuánto de lo que ves arriba se puede defender con datos.
          </p>

          <BarraCalidad
            alta={datos.calidad.alta} media={datos.calidad.media}
            baja={datos.calidad.baja} ninguna={datos.calidad.ninguna}
            total={datos.calidad.total}
          />

          <div className="cifras mt-4 text-[26px] font-semibold leading-none">
            {fmtPct(datos.calidad.porcentaje_fiable)}
          </div>
          <div className="mt-1 text-[12px] text-[var(--text-muted)]">de los toques son fiables</div>

          {datos.calidad.palabras_ambiguas?.length > 0 && (
            <div className="mt-4 rounded-md p-3" style={{ background: 'var(--page-plane)' }}>
              <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium">
                <span style={{ color: 'var(--status-warning)' }} aria-hidden>⚠</span>
                Palabras clave repetidas
              </div>
              <ul className="space-y-1 text-[11px] text-[var(--text-secondary)]">
                {datos.calidad.palabras_ambiguas.map((p: any) => (
                  <li key={p.palabra_clave}>
                    <code className="rounded px-1" style={{ background: 'var(--gridline)' }}>
                      {p.palabra_clave}
                    </code>{' '}
                    está en {p.contenidos} contenidos: no se puede saber de cuál vino el lead.
                  </li>
                ))}
              </ul>
              <Link
                to="/automatizaciones"
                className="mt-2 inline-block text-[11px] text-[var(--series-1)] hover:underline"
              >
                Arreglarlo →
              </Link>
            </div>
          )}
        </section>
      </div>

      {/* Closers */}
      {datos.closers?.filter((c: any) => Number(c.oportunidades) > 0).length > 0 && (
        <section className="tarjeta mt-4 min-w-0 p-4">
          <h2 className="mb-3 text-[14px] font-semibold">Equipo</h2>
          <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[620px] text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border-hairline)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                <th className="pb-2 font-medium">Persona</th>
                <th className="pb-2 text-right font-medium">Oportunidades</th>
                <th className="pb-2 text-right font-medium">Reuniones</th>
                <th className="pb-2 text-right font-medium">Ventas</th>
                <th className="pb-2 text-right font-medium">Cierre</th>
                <th className="pb-2 text-right font-medium">Ingresos</th>
              </tr>
            </thead>
            <tbody>
              {datos.closers
                .filter((c: any) => Number(c.oportunidades) > 0)
                .map((c: any) => (
                  <tr key={c.id} className="border-b border-[var(--border-hairline)] last:border-0">
                    <td className="py-2">
                      {c.nombre}
                      <span className="ml-2 text-[11px] text-[var(--text-muted)]">{c.rol}</span>
                    </td>
                    <td className="cifras py-2 text-right">{fmtNum(c.oportunidades)}</td>
                    <td className="cifras py-2 text-right">{fmtNum(c.reuniones)}</td>
                    <td className="cifras py-2 text-right">{fmtNum(c.ventas)}</td>
                    <td className="cifras py-2 text-right">
                      {fmtPct(Number(c.reuniones) > 0 ? (Number(c.ventas) / Number(c.reuniones)) * 100 : 0)}
                    </td>
                    <td className="cifras py-2 text-right font-semibold">{fmtDinero(c.ingresos)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          </div>
        </section>
      )}
    </div>
  );
}
