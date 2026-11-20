import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fmtDinero, fmtNum, hace } from '../api';
import { Cargando } from '../componentes/Graficas';
import Cabecera from '../componentes/Cabecera';
import FichaLead from '../componentes/FichaLead';
import ConfigPipelines from './ConfigPipelines';

export default function Pipeline() {
  const [etapas, setEtapas] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [leadAbierto, setLeadAbierto] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const [config, setConfig] = useState(!!params.get('config'));
  const [pipes, setPipes] = useState<any[]>([]);
  const [pipeId, setPipeId] = useState<string | null>(null);

  async function cargar(pid?: string | null) {
    const [d, p] = await Promise.all([
      api<any[]>(`/kanban${pid ? `?pipeline_id=${pid}` : ''}`),
      pipes.length ? Promise.resolve(pipes) : api<any[]>('/pipelines').catch(() => []),
    ]);
    setEtapas(d);
    if (!pipes.length) { setPipes(p); if (!pipeId) setPipeId(p.find((x: any) => x.es_predeterminado)?.id ?? p[0]?.id ?? null); }
    setCargando(false);
  }

  useEffect(() => { cargar(pipeId); }, []);
  function elegirPipe(id: string) { setPipeId(id); setCargando(true); cargar(id); }

  if (config) {
    return (
      <ConfigPipelines foco={params.get('config') === 'reglas' ? 'reglas' : undefined}
        onCerrar={() => {
          setConfig(false); setPipes([]); setCargando(true); cargar(pipeId);
          if (params.get('config')) { params.delete('config'); setParams(params, { replace: true }); }
        }} />
    );
  }

  async function soltar(etapaId: string) {
    if (!arrastrando) return;
    const oportunidadId = arrastrando;
    setArrastrando(null);
    await moverA(oportunidadId, etapaId);
  }

  /** Mueve una tarjeta (arrastrando o desde el desplegable de la tarjeta). */
  async function moverA(oportunidadId: string, etapaId: string) {

    // Movimiento optimista: la tarjeta salta ya, y si falla se recarga
    setEtapas((prev) => {
      let tarjeta: any = null;
      const sinTarjeta = prev.map((e) => {
        const idx = e.tarjetas.findIndex((t: any) => t.oportunidad_id === oportunidadId);
        if (idx === -1) return e;
        tarjeta = e.tarjetas[idx];
        return {
          ...e,
          total: e.total - 1,
          tarjetas: e.tarjetas.filter((t: any) => t.oportunidad_id !== oportunidadId),
        };
      });
      if (!tarjeta) return prev;
      return sinTarjeta.map((e) =>
        e.id === etapaId
          ? { ...e, total: e.total + 1, tarjetas: [tarjeta, ...e.tarjetas] }
          : e,
      );
    });

    try {
      await api(`/oportunidades/${oportunidadId}/etapa`, {
        method: 'POST', json: { etapa_id: etapaId },
      });
    } catch {
      cargar(pipeId);
    }
  }

  if (cargando) return <Cargando />;

  return (
    <div className="flex h-[calc(100vh-49px)] flex-col px-4 py-5 md:h-screen lg:px-8">
      <Cabecera
        titulo="Pipeline"
        subtitulo="Arrastrá la tarjeta o cambiá la etapa desde su desplegable. Cada etapa puede disparar sus automatizaciones."
        derecha={
          <div className="flex items-center gap-2">
            {pipes.length > 1 && (
              <select value={pipeId ?? ''} onChange={(e) => elegirPipe(e.target.value)}
                className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1.5 text-[12px] outline-none">
                {pipes.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            )}
            <button onClick={() => setConfig(true)} className="rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] hover:bg-[var(--surface-1)]">⚙ Configurar</button>
          </div>
        }
      />

      <div className="mt-4 flex flex-1 gap-3 overflow-x-auto pb-4">
        {etapas.map((etapa) => (
          <section
            key={etapa.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => soltar(etapa.id)}
            className="flex w-[254px] shrink-0 flex-col rounded-lg"
            style={{ background: 'var(--page-plane)' }}
          >
            <header className="sticky top-0 z-10 rounded-t-lg px-3 py-2.5" style={{ background: 'var(--page-plane)' }}>
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: etapa.color }}
                  aria-hidden
                />
                <span className="text-[13px] font-medium">{etapa.nombre}</span>
                <span className="cifras ml-auto text-[12px] text-[var(--text-muted)]">
                  {fmtNum(etapa.total)}
                </span>
              </div>
              {Number(etapa.valor_total) > 0 && (
                <div className="cifras mt-0.5 pl-[18px] text-[11px] text-[var(--text-muted)]">
                  {fmtDinero(etapa.valor_total)}
                </div>
              )}
            </header>

            <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
              {etapa.tarjetas.map((t: any) => (
                <article
                  key={t.oportunidad_id}
                  draggable
                  onDragStart={() => setArrastrando(t.oportunidad_id)}
                  onDragEnd={() => setArrastrando(null)}
                  onClick={() => setLeadAbierto(t.lead_id)}
                  className="tarjeta cursor-pointer px-2.5 py-2 text-[12px] transition-shadow hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{t.nombre || t.ig_username}</div>
                      {t.ig_username && (
                        <div className="truncate text-[11px] text-[var(--text-muted)]">
                          @{t.ig_username}
                        </div>
                      )}
                    </div>
                    {Number(t.valor) > 0 && (
                      <span className="cifras shrink-0 text-[11px] font-semibold">
                        {fmtDinero(t.valor)}
                      </span>
                    )}
                  </div>

                  {t.contenido_titulo && (
                    <div className="mt-1.5 flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                      <span aria-hidden>▶</span>
                      <span className="truncate">{t.contenido_titulo}</span>
                    </div>
                  )}

                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                    <span className="truncate">👤 {t.propietario_nombre ?? 'sin asignar'}</span>
                    <select value={etapa.id} onClick={(ev) => ev.stopPropagation()}
                      onChange={(ev) => { ev.stopPropagation(); moverA(t.oportunidad_id, ev.target.value); }}
                      aria-label="Cambiar de etapa"
                      className="ml-auto max-w-[110px] rounded border border-[var(--border-hairline)] bg-[var(--surface-1)] px-1 py-0.5 text-[10px] outline-none">
                      {etapas.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                    </select>
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {(t.etiquetas ?? []).slice(0, 3).map((e: string) => (
                      <span
                        key={e}
                        className="rounded px-1.5 py-[1px] text-[10px]"
                        style={{ background: 'var(--gridline)', color: 'var(--text-secondary)' }}
                      >
                        {e}
                      </span>
                    ))}
                    <span className="ml-auto text-[10px] text-[var(--text-muted)]">
                      {hace(t.abierta_en)}
                    </span>
                  </div>
                </article>
              ))}

              {etapa.tarjetas.length === 0 && (
                <div className="px-2 py-6 text-center text-[11px] text-[var(--text-muted)]">
                  Nadie acá todavía
                </div>
              )}

              {etapa.total > etapa.tarjetas.length && (
                <div className="px-2 py-1 text-center text-[11px] text-[var(--text-muted)]">
                  +{etapa.total - etapa.tarjetas.length} más
                </div>
              )}
            </div>
          </section>
        ))}
      </div>

      {leadAbierto && (
        <FichaLead
          leadId={leadAbierto}
          alCerrar={() => { setLeadAbierto(null); cargar(pipeId); }}
        />
      )}
    </div>
  );
}
