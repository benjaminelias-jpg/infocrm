import { useEffect, useState } from 'react';
import { api, fmtDinero, fmtNum, hace } from '../api';
import { Cargando, Vacio } from '../componentes/Graficas';
import Cabecera from '../componentes/Cabecera';
import FichaLead from '../componentes/FichaLead';
import { CALIFICACION, colorScore } from '../infoprod';

export default function Leads() {
  const [q, setQ] = useState('');
  const [etiqueta, setEtiqueta] = useState('');
  const [calificacion, setCalificacion] = useState('');
  const [ordenScore, setOrdenScore] = useState(false);
  const [sinAtribuir, setSinAtribuir] = useState(false);
  const [datos, setDatos] = useState<any>(null);
  const [etiquetas, setEtiquetas] = useState<any[]>([]);
  const [pagina, setPagina] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState<string | null>(null);

  const porPagina = 50;

  useEffect(() => {
    api<any[]>('/etiquetas').then(setEtiquetas).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams({
        limite: String(porPagina),
        offset: String(pagina * porPagina),
      });
      if (q) p.set('q', q);
      if (etiqueta) p.set('etiqueta', etiqueta);
      if (calificacion) p.set('calificacion', calificacion);
      if (ordenScore) p.set('orden', 'score');
      if (sinAtribuir) p.set('sin_atribuir', 'true');

      setCargando(true);
      api(`/leads?${p}`).then(setDatos).finally(() => setCargando(false));
    }, 220);
    return () => clearTimeout(t);
  }, [q, etiqueta, calificacion, ordenScore, sinAtribuir, pagina]);

  useEffect(() => { setPagina(0); }, [q, etiqueta, calificacion, ordenScore, sinAtribuir]);

  const leads = datos?.leads ?? [];
  const total = datos?.total ?? 0;

  return (
    <div className="px-5 py-5 lg:px-8">
      <Cabecera
        titulo="Leads"
        subtitulo={`${fmtNum(total)} contactos`}
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por usuario, nombre o email…"
          className="w-full max-w-[320px] rounded-md border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-1.5 text-[13px] outline-none focus:border-[var(--series-1)]"
        />
        <select
          value={etiqueta}
          onChange={(e) => setEtiqueta(e.target.value)}
          className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2.5 py-1.5 text-[13px] outline-none"
        >
          <option value="">Todas las etiquetas</option>
          {etiquetas.map((e) => (
            <option key={e.etiqueta} value={e.etiqueta}>
              {e.etiqueta} ({e.n})
            </option>
          ))}
        </select>
        <select
          value={calificacion}
          onChange={(e) => setCalificacion(e.target.value)}
          className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2.5 py-1.5 text-[13px] outline-none"
        >
          <option value="">Toda calificación</option>
          <option value="calificado">Calificados</option>
          <option value="sin_calificar">Sin calificar</option>
          <option value="no_calificado">No calificados</option>
        </select>
        <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
          <input type="checkbox" checked={ordenScore} onChange={(e) => setOrdenScore(e.target.checked)} />
          Ordenar por score
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={sinAtribuir}
            onChange={(e) => setSinAtribuir(e.target.checked)}
          />
          Solo sin atribuir
        </label>
      </div>

      {cargando && !datos ? (
        <Cargando />
      ) : leads.length === 0 ? (
        <Vacio mensaje="No hay leads con esos filtros." />
      ) : (
        <>
          <div className="tarjeta mt-4 overflow-x-auto">
            <table className="w-full min-w-[840px] text-[13px]">
              <thead>
                <tr className="border-b border-[var(--border-hairline)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="px-4 py-2.5 font-medium">Lead</th>
                  <th className="px-3 py-2.5 text-center font-medium" title="Score de calidad del lead (0-100)">Score</th>
                  <th className="px-3 py-2.5 font-medium">Etapa</th>
                  <th className="px-3 py-2.5 font-medium">Vino de</th>
                  <th className="px-3 py-2.5 text-right font-medium">Valor</th>
                  <th className="px-3 py-2.5 text-right font-medium">Último contacto</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l: any) => (
                  <tr
                    key={l.id}
                    onClick={() => setAbierto(l.id)}
                    className="cursor-pointer border-b border-[var(--border-hairline)] last:border-0 hover:bg-[var(--page-plane)]"
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{l.nombre || l.ig_username || '—'}</span>
                        {l.calificacion && l.calificacion !== 'sin_calificar' && CALIFICACION[l.calificacion] && (
                          <span className="h-1.5 w-1.5 rounded-full"
                            style={{ background: CALIFICACION[l.calificacion].color }}
                            title={CALIFICACION[l.calificacion].etiqueta} aria-hidden />
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {l.ig_username ? `@${l.ig_username}` : l.email ?? ''}
                        {l.pais ? ` · ${l.pais}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="cifras inline-block min-w-[30px] rounded px-1.5 py-0.5 text-[12px] font-semibold"
                        style={{ background: 'var(--gridline)', color: colorScore(Number(l.score ?? 0)) }}
                        title="Score de calidad (filtro antipodridos)">
                        {Number(l.score ?? 0)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {l.etapa_nombre && (
                        <span className="flex items-center gap-1.5">
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ background: l.etapa_color }}
                            aria-hidden
                          />
                          <span className="text-[12px]">{l.etapa_nombre}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {l.contenido_titulo ? (
                        <div className="max-w-[260px] truncate text-[12px]" title={l.contenido_titulo}>
                          {l.contenido_titulo}
                        </div>
                      ) : (
                        <span className="text-[12px] text-[var(--text-muted)]">Sin atribuir</span>
                      )}
                      {l.palabra_clave && (
                        <div className="text-[11px] text-[var(--text-muted)]">{l.palabra_clave}</div>
                      )}
                    </td>
                    <td className="cifras px-3 py-2.5 text-right">
                      {Number(l.valor_total) > 0 ? (
                        <span className="font-semibold" style={{ color: 'var(--status-good)' }}>
                          {fmtDinero(l.valor_total)}
                        </span>
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[12px] text-[var(--text-muted)]">
                      {hace(l.ultimo_contacto_en)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {total > porPagina && (
            <div className="mt-3 flex items-center justify-between text-[12px] text-[var(--text-muted)]">
              <span className="cifras">
                {pagina * porPagina + 1}–{Math.min((pagina + 1) * porPagina, total)} de {fmtNum(total)}
              </span>
              <div className="flex gap-1.5">
                <button
                  disabled={pagina === 0}
                  onClick={() => setPagina((p) => p - 1)}
                  className="rounded border border-[var(--border-hairline)] px-2.5 py-1 disabled:opacity-40"
                >
                  Anterior
                </button>
                <button
                  disabled={(pagina + 1) * porPagina >= total}
                  onClick={() => setPagina((p) => p + 1)}
                  className="rounded border border-[var(--border-hairline)] px-2.5 py-1 disabled:opacity-40"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {abierto && <FichaLead leadId={abierto} alCerrar={() => setAbierto(null)} />}
    </div>
  );
}
