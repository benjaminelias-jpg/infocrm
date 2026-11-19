import { useEffect, useMemo, useState } from 'react';
import { api, fmtDinero, fmtNum, fmtPct } from '../api';
import { Cargando, Vacio } from '../componentes/Graficas';
import Cabecera, { RangoFechas, usarRango } from '../componentes/Cabecera';
import { ANGULOS, ETIQUETA_ANGULO, ROLES, COLOR_EMBUDO, EMBUDO_DE_ANGULO } from '../infoprod';

type Columna = 'leads' | 'reuniones_agendadas' | 'ventas' | 'ingresos' | 'tasa_lead_venta' | 'valor_por_lead';

const COLUMNAS: Array<{ clave: Columna; etiqueta: string; fmt: (v: any) => string; ayuda?: string }> = [
  { clave: 'leads', etiqueta: 'Leads', fmt: fmtNum },
  { clave: 'reuniones_agendadas', etiqueta: 'Reuniones', fmt: fmtNum },
  { clave: 'ventas', etiqueta: 'Ventas', fmt: fmtNum },
  { clave: 'ingresos', etiqueta: 'Ingresos', fmt: (v) => fmtDinero(v) },
  { clave: 'tasa_lead_venta', etiqueta: 'Lead→venta', fmt: fmtPct, ayuda: 'Qué porcentaje de los leads de este contenido acabó comprando' },
  { clave: 'valor_por_lead', etiqueta: '€/lead', fmt: (v) => fmtDinero(v), ayuda: 'Cuánto factura de media cada lead que trae este contenido' },
];

export default function Contenidos() {
  const { rango, setRango, params } = usarRango();
  const [modelo, setModelo] = useState<'primer_toque' | 'ultimo_toque'>('primer_toque');
  const [filas, setFilas] = useState<any[]>([]);
  const [orden, setOrden] = useState<Columna>('ingresos');
  const [filtroAngulo, setFiltroAngulo] = useState('');
  const [cargando, setCargando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    setCargando(true);
    api(`/analitica/contenidos?${params}&modelo=${modelo}`)
      .then(setFilas)
      .finally(() => setCargando(false));
  }, [params, modelo]);

  // Cambiar el ángulo de un contenido (actualiza la fila en el sitio)
  async function setAngulo(id: string, angulo: string) {
    setFilas((prev) => prev.map((f) =>
      f.id === id ? { ...f, angulo: angulo || null, etapa_embudo: angulo ? EMBUDO_DE_ANGULO[angulo] : null } : f));
    try {
      await api(`/contenidos/${id}`, { method: 'PATCH', json: { angulo: angulo || null } });
    } catch { /* si falla, la próxima recarga lo corrige */ }
  }

  const ordenadas = useMemo(
    () => [...filas]
      .filter((f) => !filtroAngulo || f.angulo === filtroAngulo)
      .sort((a, b) => Number(b[orden] ?? 0) - Number(a[orden] ?? 0)),
    [filas, orden, filtroAngulo],
  );

  const totales = useMemo(
    () =>
      filas.reduce(
        (acc, f) => ({
          leads: acc.leads + Number(f.leads ?? 0),
          reuniones: acc.reuniones + Number(f.reuniones_agendadas ?? 0),
          ventas: acc.ventas + Number(f.ventas ?? 0),
          ingresos: acc.ingresos + Number(f.ingresos ?? 0),
        }),
        { leads: 0, reuniones: 0, ventas: 0, ingresos: 0 },
      ),
    [filas],
  );

  async function sincronizar() {
    setSincronizando(true);
    setAviso(null);
    try {
      const r = await api<any>('/instagram/sincronizar', { method: 'POST' });
      setAviso(r.mensaje);
      if (r.ok) {
        const nuevas = await api(`/analitica/contenidos?${params}&modelo=${modelo}`);
        setFilas(nuevas as any[]);
      }
    } catch (err: any) {
      setAviso(err.message);
    } finally {
      setSincronizando(false);
    }
  }

  return (
    <div className="px-5 py-5 lg:px-8">
      <Cabecera
        titulo="Rendimiento por contenido"
        subtitulo="Qué reel trajo cada lead, cada reunión y cada euro"
        derecha={
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="flex items-center gap-0.5 rounded-md p-0.5"
              style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}
              role="group"
              aria-label="Modelo de atribución"
            >
              {([['primer_toque', 'Primer toque'], ['ultimo_toque', 'Último toque']] as const).map(
                ([v, et]) => (
                  <button
                    key={v}
                    onClick={() => setModelo(v)}
                    aria-pressed={modelo === v}
                    className={`rounded px-2.5 py-1 text-[12px] ${
                      modelo === v
                        ? 'bg-[var(--surface-1)] font-medium shadow-sm'
                        : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    {et}
                  </button>
                ),
              )}
            </div>
            <select
              value={filtroAngulo}
              onChange={(e) => setFiltroAngulo(e.target.value)}
              className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2.5 py-1.5 text-[12px] outline-none"
              aria-label="Filtrar por ángulo"
            >
              <option value="">Todos los ángulos</option>
              {ANGULOS.map((a) => (
                <option key={a.valor} value={a.valor}>{a.etiqueta} ({a.embudo})</option>
              ))}
            </select>
            <RangoFechas rango={rango} setRango={setRango} />
            <button
              onClick={sincronizar}
              disabled={sincronizando}
              className="rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] hover:bg-[var(--surface-1)] disabled:opacity-60"
            >
              {sincronizando ? 'Sincronizando…' : '⟳ Sincronizar Instagram'}
            </button>
          </div>
        }
      />

      {aviso && (
        <div
          className="mt-3 rounded-md px-3 py-2 text-[12px]"
          style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}
        >
          {aviso}
        </div>
      )}

      <p className="mt-3 text-[12px] text-[var(--text-muted)]">
        {modelo === 'primer_toque'
          ? 'Primer toque: el contenido que trajo al lead por primera vez. Es el que mide qué contenido capta.'
          : 'Último toque: el último contenido que tocó antes de avanzar. Mide qué contenido empuja a la acción.'}{' '}
        El periodo filtra por cuándo entró el lead, con todo lo que hizo después aunque la venta llegara más tarde.
      </p>

      {cargando ? (
        <Cargando />
      ) : filas.length === 0 ? (
        <Vacio mensaje="Todavía no hay contenido. Sincroniza Instagram o deja que lleguen leads por el webhook de ManyChat: el contenido se crea solo con el ig_media_id." />
      ) : (
        <div className="tarjeta mt-4 overflow-x-auto">
          <table className="w-full min-w-[920px] text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border-hairline)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                <th className="px-4 py-2.5 font-medium">Contenido</th>
                {COLUMNAS.map((c) => (
                  <th key={c.clave} className="px-3 py-2.5 text-right font-medium" title={c.ayuda}>
                    <button
                      onClick={() => setOrden(c.clave)}
                      className={`hover:text-[var(--text-primary)] ${
                        orden === c.clave ? 'text-[var(--text-primary)]' : ''
                      }`}
                    >
                      {c.etiqueta}
                      {orden === c.clave && <span aria-hidden> ↓</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((f) => {
                const maxIngresos = Math.max(...filas.map((x) => Number(x.ingresos ?? 0)), 1);
                const proporcion = Number(f.ingresos ?? 0) / maxIngresos;
                return (
                  <tr
                    key={f.id ?? 'sin-atribuir'}
                    className="border-b border-[var(--border-hairline)] last:border-0 hover:bg-[var(--page-plane)]"
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-start gap-2.5">
                        {/* Barra de proporción: magnitud sin añadir una gráfica aparte */}
                        <span
                          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                          style={{
                            background: f.id ? 'var(--series-1)' : 'var(--baseline)',
                            opacity: f.id ? 0.25 + proporcion * 0.75 : 1,
                          }}
                          aria-hidden
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="max-w-[360px] truncate font-medium">
                              {f.permalink ? (
                                <a href={f.permalink} target="_blank" rel="noreferrer" className="hover:underline">
                                  {f.titulo}
                                </a>
                              ) : f.titulo}
                            </span>
                            {f.id && f.rol && ROLES[f.rol] && !['estable', 'sin_atribuir'].includes(f.rol) && (
                              <span className="shrink-0 rounded px-1.5 py-[1px] text-[10px]"
                                style={{ background: 'var(--gridline)', color: ROLES[f.rol].color }}
                                title={ROLES[f.rol].ayuda}>
                                {ROLES[f.rol].etiqueta}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-muted)]">
                            {f.id && (
                              <select
                                value={f.angulo ?? ''}
                                onChange={(e) => setAngulo(f.id, e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                className="rounded border bg-transparent px-1 py-0.5 text-[10px] outline-none"
                                style={{ borderColor: f.angulo ? 'var(--border-hairline)' : 'var(--status-warning)',
                                         color: f.etapa_embudo ? COLOR_EMBUDO[f.etapa_embudo] : 'var(--status-warning)' }}
                                title="Ángulo del contenido"
                              >
                                <option value="">▸ sin ángulo</option>
                                {ANGULOS.map((a) => (
                                  <option key={a.valor} value={a.valor}>{a.etiqueta} · {a.embudo}</option>
                                ))}
                              </select>
                            )}
                            <span>{f.tipo}</span>
                            {f.ig_reproducciones ? <span>· ▶ {fmtNum(f.ig_reproducciones)}</span> : null}
                            {f.ig_alcance ? <span title="Alcance">· 👁 {fmtNum(f.ig_alcance)}</span> : null}
                            {f.ig_likes ? <span title="Me gusta">· ♥ {fmtNum(f.ig_likes)}</span> : null}
                            {f.ig_comentarios ? <span title="Comentarios">· 💬 {fmtNum(f.ig_comentarios)}</span> : null}
                            {f.ig_guardados ? <span title="Guardados">· 🔖 {fmtNum(f.ig_guardados)}</span> : null}
                            {f.ig_compartidos ? <span title="Compartidos">· ↗ {fmtNum(f.ig_compartidos)}</span> : null}
                            {f.publicado_en && (
                              <span>· {new Date(f.publicado_en).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}</span>
                            )}
                            {Number(f.toques_dudosos) > 0 && (
                              <span style={{ color: 'var(--status-warning)' }}
                                title="Parte de estos leads se atribuyeron por una palabra clave que está en varios contenidos">
                                · ⚠ {f.toques_dudosos} dudosos
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    {COLUMNAS.map((c) => (
                      <td
                        key={c.clave}
                        className={`cifras px-3 py-2.5 text-right ${
                          c.clave === 'ingresos' ? 'font-semibold' : ''
                        }`}
                      >
                        {c.fmt(f[c.clave])}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-[var(--baseline)] text-[12px] font-semibold">
                <td className="px-4 py-2.5">Total</td>
                <td className="cifras px-3 py-2.5 text-right">{fmtNum(totales.leads)}</td>
                <td className="cifras px-3 py-2.5 text-right">{fmtNum(totales.reuniones)}</td>
                <td className="cifras px-3 py-2.5 text-right">{fmtNum(totales.ventas)}</td>
                <td className="cifras px-3 py-2.5 text-right">{fmtDinero(totales.ingresos)}</td>
                <td className="cifras px-3 py-2.5 text-right">
                  {fmtPct(totales.leads > 0 ? (totales.ventas / totales.leads) * 100 : 0)}
                </td>
                <td className="cifras px-3 py-2.5 text-right">
                  {fmtDinero(totales.leads > 0 ? totales.ingresos / totales.leads : 0)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
