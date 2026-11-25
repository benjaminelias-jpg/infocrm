import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmtDinero, fmtNum, fmtPct, plural } from '../../api';
import { Avatar, Dialogo, nombreVisible, useEsMovil } from '../../ui';
import { calcularDelta } from '../Graficas';
import { IconoPanel } from './iconos';
import { ritmoDelMes } from './Objetivo';
import type { AccionHoy } from './ParaHoy';
import type { DatosPanel, FilaContenido, Kpis } from './tipos';

// Panel con estilo de tablero moderno: tarjetas blancas muy redondeadas, la
// principal en azul, iconos en círculos, barras con la destacada en azul y un
// medidor por segmentos. Un solo azul; el resto, grises.

const AZUL = '#2f6fe4';
const R = 'rounded-[20px]';
const TARJETA = `${R} border border-[var(--border-hairline)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(16,24,40,.04)]`;

// ---------------------------------------------------------------------
// Iconos (línea fina)
// ---------------------------------------------------------------------
const ICONOS: Record<string, string> = {
  plata: 'M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.6 4.5 3 4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3',
  gente: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 19v-1a4 4 0 0 0-3-3.9M15.5 3.1a3.5 3.5 0 0 1 0 6.8',
  cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  bolsa: 'M6 7h12l-1 13H7zM9 7V5a3 3 0 0 1 6 0v2',
  flecha: 'M5 12h14M13 6l6 6-6 6',
};
function Ico({ n, tam = 18 }: { n: string; tam?: number }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONOS[n]} />
    </svg>
  );
}

function PildoraDelta({ actual, anterior, claro }: { actual?: number; anterior?: number | null; claro?: boolean }) {
  const d = calcularDelta(actual, anterior);
  if (!d || d.tono === 'neutro') return null;
  const bien = d.tono === 'bien';
  const estilo = claro
    ? { background: 'rgba(255,255,255,.2)', color: '#fff' }
    : bien
      ? { background: 'color-mix(in srgb, var(--status-good) 13%, transparent)', color: 'color-mix(in srgb, var(--status-good) 72%, var(--text-primary))' }
      : { background: 'color-mix(in srgb, var(--status-critical) 11%, transparent)', color: 'color-mix(in srgb, var(--status-critical) 80%, var(--text-primary))' };
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums" style={estilo}>
      {d.texto.replace('▲', '↑').replace('▼', '↓')}
    </span>
  );
}

// ---------------------------------------------------------------------
// Fila de números
// ---------------------------------------------------------------------
function TarjetaNumero({ titulo, valor, actual, anterior, antes, icono, destacada, a }: {
  titulo: string; valor: string; actual?: number; anterior?: number | null; antes?: string; icono: string; destacada?: boolean; a: string;
}) {
  const navegar = useNavigate();
  return (
    <button type="button" onClick={() => navegar(a)}
      className={`ui-foco relative flex min-h-[132px] min-w-0 flex-col justify-between overflow-hidden p-4 text-left sm:p-5 transition-shadow hover:shadow-[0_12px_32px_-18px_rgba(16,24,40,.35)] ${destacada ? R : TARJETA}`}
      style={destacada ? { background: `linear-gradient(135deg, ${AZUL} 0%, #5b9cf6 100%)`, color: '#fff' } : undefined}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-[13px]" style={{ color: destacada ? 'rgba(255,255,255,.85)' : 'var(--text-secondary)' }}>{titulo}</span>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full sm:h-10 sm:w-10"
          style={destacada ? { background: '#fff', color: AZUL } : icono === 'gente' ? { background: 'var(--text-primary)', color: 'var(--surface-1)' } : { background: AZUL, color: '#fff' }}>
          <Ico n={icono} tam={18} />
        </span>
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums sm:text-[32px]">{valor}</span>
          <PildoraDelta actual={actual} anterior={anterior} claro={destacada} />
        </div>
        {antes && (
          <div className="mt-2 text-[12px]" style={{ color: destacada ? 'rgba(255,255,255,.85)' : 'var(--text-secondary)' }}>
            Período anterior: <b className="font-semibold" style={{ color: destacada ? '#fff' : 'var(--text-primary)' }}>{antes}</b>
          </div>
        )}
      </div>
    </button>
  );
}

export function FilaNumeros({ k, anterior }: { k: Kpis; anterior: Kpis | null }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <TarjetaNumero destacada titulo="Ingresos" valor={fmtDinero(k.ingresos)} actual={k.ingresos} anterior={anterior?.ingresos}
        antes={anterior ? fmtDinero(anterior.ingresos) : undefined} icono="plata" a="/finanzas" />
      <TarjetaNumero titulo="Leads nuevos" valor={fmtNum(k.leads)} actual={k.leads} anterior={anterior?.leads}
        antes={anterior ? fmtNum(anterior.leads) : undefined} icono="gente" a="/leads" />
      <TarjetaNumero titulo="Reuniones" valor={fmtNum(k.reuniones_agendadas)} actual={k.reuniones_agendadas} anterior={anterior?.reuniones_agendadas}
        antes={anterior ? fmtNum(anterior.reuniones_agendadas) : undefined} icono="cal" a="/pipeline" />
      <TarjetaNumero titulo="Ventas" valor={fmtNum(k.ventas)} actual={k.ventas} anterior={anterior?.ventas}
        antes={anterior ? fmtNum(anterior.ventas) : undefined} icono="bolsa" a="/finanzas" />
    </div>
  );
}

// ---------------------------------------------------------------------
// Barras «Rendimiento»
// ---------------------------------------------------------------------
type Metrica = 'ingresos' | 'leads' | 'reuniones' | 'ventas';
const METRICAS: Array<{ v: Metrica; t: string }> = [
  { v: 'ingresos', t: 'Ingresos' }, { v: 'leads', t: 'Leads' }, { v: 'reuniones', t: 'Reuniones' }, { v: 'ventas', t: 'Ventas' },
];

function etiquetaPeriodo(p: string, gran?: string) {
  const d = new Date(p.length <= 10 ? `${p}T12:00:00` : p);
  if (Number.isNaN(d.getTime())) return p;
  return gran === 'mes' ? d.toLocaleDateString('es-ES', { month: 'short' }) : d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}
function corto(n: number, dinero: boolean) {
  const abs = Math.abs(n);
  const s = abs >= 1000 ? `${(n / 1000).toLocaleString('es-ES', { maximumFractionDigits: abs >= 10000 ? 0 : 1 })}k` : fmtNum(n);
  return dinero ? `${s} €` : s;
}

export function Rendimiento({ datos }: { datos: DatosPanel }) {
  const [m, setM] = useState<Metrica>('ingresos');
  const [sobre, setSobre] = useState<number | null>(null);
  const movil = useEsMovil(640);
  const dinero = m === 'ingresos';
  // Como mucho 12 barras: si hay más días, se agrupan.
  const barras = useMemo(() => {
    const s = datos.serie ?? [];
    const tam = Math.max(1, Math.ceil(s.length / (movil ? 6 : 12)));
    const out: Array<{ etq: string; v: number; ventas: number; leads: number }> = [];
    for (let i = 0; i < s.length; i += tam) {
      const g = s.slice(i, i + tam);
      out.push({
        etq: etiquetaPeriodo(g[0].periodo, datos.serie_granularidad),
        v: g.reduce((a, x) => a + (Number(x[m]) || 0), 0),
        ventas: g.reduce((a, x) => a + (Number(x.ventas) || 0), 0),
        leads: g.reduce((a, x) => a + (Number(x.leads) || 0), 0),
      });
    }
    return out;
  }, [datos.serie, datos.serie_granularidad, m, movil]);
  const max = Math.max(1, ...barras.map((b) => b.v));
  const tope = (() => { const p = 10 ** Math.floor(Math.log10(max)); return Math.ceil(max / p) * p; })();
  const lineas = [0, 0.25, 0.5, 0.75, 1].map((f) => f * tope);
  const mayor = barras.reduce((bi, b, i) => (b.v > barras[bi].v ? i : bi), 0);
  const activa = sobre ?? mayor;
  const H = 230;
  return (
    <section className={`${TARJETA} min-w-0 p-5 lg:col-span-2`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[18px] font-semibold tracking-tight">Rendimiento</h2>
        <div className="flex max-w-full overflow-x-auto rounded-full bg-[var(--surface-2)] p-1" role="tablist" aria-label="Qué mostrar">
          {METRICAS.map((x) => (
            <button key={x.v} type="button" role="tab" aria-selected={m === x.v} onClick={() => setM(x.v)}
              className="ui-foco shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors"
              style={m === x.v ? { background: 'var(--surface-1)', color: 'var(--text-primary)', boxShadow: '0 1px 2px rgba(0,0,0,.08)' } : { color: 'var(--text-secondary)' }}>
              {x.t}
            </button>
          ))}
        </div>
      </div>
      {barras.length === 0 ? (
        <div className="grid h-[230px] place-items-center text-[13px] text-[var(--text-secondary)]">Todavía no hay datos en este período.</div>
      ) : (
        <div className="mt-6 flex gap-2 sm:gap-3">
          <div className="relative w-8 shrink-0 text-right sm:w-10 text-[11px] text-[var(--text-secondary)] tabular-nums" style={{ height: H }}>
            {lineas.map((v) => <span key={v} className="absolute right-0 -translate-y-1/2" style={{ top: H - (v / tope) * H }}>{corto(v, false)}</span>)}
          </div>
          <div className="relative min-w-0 flex-1">
            {lineas.map((v) => <div key={v} className="absolute inset-x-0 border-t border-dashed border-[var(--border-hairline)]" style={{ top: H - (v / tope) * H }} />)}
            <div className="relative flex items-end gap-2 sm:gap-3" style={{ height: H }} onPointerLeave={() => setSobre(null)}>
              {barras.map((b, i) => {
                const on = i === activa;
                const alto = Math.max(4, (b.v / tope) * H);
                return (
                  <div key={i} className="relative flex h-full min-w-0 flex-1 items-end" onPointerEnter={() => setSobre(i)}>
                    <div className="absolute inset-0 rounded-[10px] bg-[var(--surface-2)] opacity-60" />
                    <div className="relative w-full rounded-[10px] transition-[height] duration-300"
                      style={{
                        height: alto,
                        background: on
                          ? `repeating-linear-gradient(135deg, ${AZUL} 0 7px, #5b9cf6 7px 12px)`
                          : 'color-mix(in srgb, var(--text-primary) 12%, var(--surface-2))',
                      }} />
                    {on && (
                      <div className={`pointer-events-none absolute z-10 w-max rounded-[14px] border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3.5 py-2.5 text-[12px] shadow-[0_12px_32px_-12px_rgba(16,24,40,.35)] ${i > barras.length / 2 ? 'right-[calc(100%+8px)]' : 'left-[calc(100%+8px)]'}`}
                        style={{ bottom: Math.max(0, Math.min(alto - 30, H - 78)) }}>
                        <div className="mb-1.5 font-semibold">{b.etq}</div>
                        <div className="flex items-center justify-between gap-6"><span className="flex items-center gap-1.5 text-[var(--text-secondary)]"><span className="h-2 w-2 rounded-full" style={{ background: AZUL }} />{METRICAS.find((x) => x.v === m)!.t}</span><b className="tabular-nums">{dinero ? fmtDinero(b.v) : fmtNum(b.v)}</b></div>
                        {m !== 'ventas' && <div className="mt-1 flex items-center justify-between gap-6"><span className="flex items-center gap-1.5 text-[var(--text-secondary)]"><span className="h-2 w-2 rounded-full bg-[var(--text-muted)]" />Ventas</span><b className="tabular-nums">{fmtNum(b.ventas)}</b></div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex gap-2 sm:gap-3">
              {barras.map((b, i) => <span key={i} className="min-w-0 flex-1 truncate text-center text-[11px] text-[var(--text-secondary)]">{b.etq}</span>)}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// Medidor por segmentos
// ---------------------------------------------------------------------
function Medidor({ p }: { p: number }) {
  const N = 16, llenos = Math.round(Math.max(0, Math.min(1, p)) * N);
  const cx = 130, cy = 128, r1 = 82, r2 = 118;
  return (
    <svg viewBox="0 0 260 140" className="w-full max-w-[300px]" aria-hidden>
      {Array.from({ length: N }).map((_, i) => {
        const a = Math.PI - (i + 0.5) * (Math.PI / N);
        const ancho = (Math.PI / N) * 0.5;
        const p1 = [cx + r1 * Math.cos(a - ancho / 2), cy - r1 * Math.sin(a - ancho / 2)];
        const p2 = [cx + r2 * Math.cos(a - ancho / 2), cy - r2 * Math.sin(a - ancho / 2)];
        const p3 = [cx + r2 * Math.cos(a + ancho / 2), cy - r2 * Math.sin(a + ancho / 2)];
        const p4 = [cx + r1 * Math.cos(a + ancho / 2), cy - r1 * Math.sin(a + ancho / 2)];
        const lleno = i < llenos;
        const tono = lleno ? `color-mix(in srgb, ${AZUL} ${100 - (i / Math.max(1, llenos)) * 45}%, #ffffff)` : 'var(--surface-2)';
        return <path key={i} d={`M${p1} L${p2} L${p3} L${p4} Z`} fill={tono} stroke={tono} strokeWidth="6" strokeLinejoin="round" />;
      })}
    </svg>
  );
}

export function TarjetaMedidor({ datos, onObjetivo }: { datos: DatosPanel; onObjetivo: () => void }) {
  const k = datos.kpis;
  const m = datos.metas;
  const { mes, diasRestantes } = ritmoDelMes();
  const conObjetivo = Boolean(m?.tiene_meta && m.objetivo && m.objetivo.ingresos > 0);
  const p = conObjetivo ? m!.real.ingresos / m!.objetivo!.ingresos : (k.reuniones_realizadas + k.no_shows > 0 ? k.tasa_asistencia / 100 : 0);
  return (
    <section className={`${TARJETA} flex min-w-0 flex-col p-5`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[18px] font-semibold tracking-tight">{conObjetivo ? `Objetivo de ${mes}` : 'Asistencia'}</h2>
        <button type="button" onClick={onObjetivo} className="ui-foco rounded-full border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] font-medium hover:bg-[var(--surface-2)]">
          {conObjetivo ? 'Editar' : 'Poner objetivo'}
        </button>
      </div>
      <div className="relative mt-4 flex justify-center">
        <Medidor p={p} />
        <div className="absolute bottom-1 text-center">
          <div className="text-[30px] font-semibold leading-none tracking-tight tabular-nums">{fmtPct(Math.round(p * 1000) / 10)}</div>
          <div className="mt-1 text-[11px] text-[var(--text-secondary)]">{conObjetivo ? `de ${fmtDinero(m!.objetivo!.ingresos)} · faltan ${plural(diasRestantes, 'día', 'días')}` : 'vinieron a la llamada'}</div>
        </div>
      </div>
      <div className="mt-auto grid grid-cols-2 gap-3 pt-5">
        <div className="rounded-[14px] bg-[var(--surface-2)] p-3.5">
          <div className="text-[12px] text-[var(--text-secondary)]">{conObjetivo ? 'Ventas' : 'Reuniones hechas'}</div>
          <div className="mt-1.5 text-[20px] font-semibold tabular-nums">{conObjetivo ? `${fmtNum(m!.real.ventas)}${m!.objetivo!.ventas ? ` / ${fmtNum(m!.objetivo!.ventas)}` : ''}` : fmtNum(k.reuniones_realizadas)}</div>
        </div>
        <div className="rounded-[14px] bg-[var(--surface-2)] p-3.5">
          <div className="text-[12px] text-[var(--text-secondary)]">{conObjetivo ? 'Leads' : 'No vinieron'}</div>
          <div className="mt-1.5 text-[20px] font-semibold tabular-nums">{conObjetivo ? `${fmtNum(m!.real.leads)}${m!.objetivo!.leads ? ` / ${fmtNum(m!.objetivo!.leads)}` : ''}` : fmtNum(k.no_shows)}</div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------
// Tabla de contenidos (con miniatura)
// ---------------------------------------------------------------------
export function TablaContenidos({ datos, onAbrir, onVerTodos }: { datos: DatosPanel; onAbrir: (c: FilaContenido) => void; onVerTodos: () => void }) {
  const [orden, setOrden] = useState<'ingresos' | 'leads'>('ingresos');
  const filas = useMemo(() => (datos.contenidos ?? []).filter((c) => c.id && (c.leads > 0 || c.ingresos > 0))
    .sort((a, b) => (orden === 'ingresos' ? b.ingresos - a.ingresos || b.leads - a.leads : b.leads - a.leads))
    .slice(0, 6), [datos.contenidos, orden]);
  return (
    <section className={`${TARJETA} min-w-0 p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[18px] font-semibold tracking-tight">Contenido que más vende</h2>
        <div className="flex items-center gap-2">
          <div className="flex rounded-full bg-[var(--surface-2)] p-1">
            {([['ingresos', 'Más plata'], ['leads', 'Más leads']] as const).map(([v, t]) => (
              <button key={v} type="button" onClick={() => setOrden(v)} className="ui-foco rounded-full px-3 py-1.5 text-[12px] font-medium"
                style={orden === v ? { background: 'var(--surface-1)', boxShadow: '0 1px 2px rgba(0,0,0,.08)' } : { color: 'var(--text-secondary)' }}>{t}</button>
            ))}
          </div>
          <button type="button" onClick={onVerTodos} className="ui-foco rounded-full border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] font-medium hover:bg-[var(--surface-2)]">Ver todos</button>
        </div>
      </div>
      {filas.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-[var(--text-secondary)]">Cuando tus publicaciones traigan leads, aparecen acá.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[620px] text-[13px]">
            <thead>
              <tr className="text-left text-[12px] text-[var(--text-secondary)]">
                <th className={`rounded-l-[12px] bg-[var(--surface-2)] px-3 py-2.5 font-medium`}>Contenido</th>
                <th className="bg-[var(--surface-2)] px-3 py-2.5 text-right font-medium">Leads</th>
                <th className="bg-[var(--surface-2)] px-3 py-2.5 text-right font-medium">Reuniones</th>
                <th className="bg-[var(--surface-2)] px-3 py-2.5 text-right font-medium">Ventas</th>
                <th className="bg-[var(--surface-2)] px-3 py-2.5 text-right font-medium">Compra</th>
                <th className="rounded-r-[12px] bg-[var(--surface-2)] px-3 py-2.5 text-right font-medium">Ingresos</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((c) => {
                const titulo = c.titulo?.startsWith('Contenido ') ? 'Publicación sin título' : c.titulo;
                return (
                  <tr key={c.id} onClick={() => onAbrir(c)} className="cursor-pointer border-b border-[var(--border-hairline)] last:border-0 hover:bg-[var(--surface-2)]/50">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3">
                        {c.thumbnail_url
                          ? <img src={c.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-11 w-11 shrink-0 rounded-[10px] object-cover" />
                          : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-[var(--surface-2)] text-[11px] font-semibold uppercase text-[var(--text-secondary)]">{c.tipo === 'reel' ? 'Reel' : c.tipo?.slice(0, 4)}</span>}
                        <div className="min-w-0">
                          <div className="max-w-[340px] truncate font-medium">{titulo}</div>
                          <div className="text-[12px] text-[var(--text-secondary)]">{c.tipo === 'reel' ? 'Reel' : c.tipo === 'historia' ? 'Historia' : 'Publicación'}{c.publicado_en ? ` · ${new Date(c.publicado_en).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}` : ''}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmtNum(c.leads)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmtNum(c.reuniones_agendadas)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmtNum(c.ventas)}</td>
                    <td className="px-3 py-3 text-right">
                      <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
                        style={{ background: 'color-mix(in srgb, #2f6fe4 10%, transparent)', color: 'color-mix(in srgb, #2f6fe4 85%, var(--text-primary))' }}>{fmtPct(Math.min(100, c.tasa_lead_venta))}</span>
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">{fmtDinero(c.ingresos)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// Tarjetas de abajo
// ---------------------------------------------------------------------
function Caja({ titulo, accion, children }: { titulo: string; accion?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={`${TARJETA} flex min-w-0 flex-col p-5`}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-[16px] font-semibold tracking-tight">{titulo}</h2>
        {accion}
      </div>
      {children}
    </section>
  );
}

export function ParaHoyCaja({ acciones }: { acciones: AccionHoy[] }) {
  const navegar = useNavigate();
  return (
    <Caja titulo="Para hoy">
      {acciones.length === 0 ? (
        <p className="text-[13px] text-[var(--text-secondary)]">Todo al día. No hay nada urgente.</p>
      ) : (
        <ul className="-mx-2 space-y-1">
          {acciones.slice(0, 4).map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => (a.onClick ? a.onClick() : a.a && navegar(a.a))}
                className="ui-foco flex w-full items-center gap-3 rounded-[12px] px-2 py-2.5 text-left hover:bg-[var(--surface-2)]">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-[var(--text-secondary)]">
                  <IconoPanel nombre={a.icono} tam={15} />
                </span>
                <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug">{a.titulo}</span>
                <span className="text-[var(--text-muted)]"><Ico n="flecha" tam={16} /></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Caja>
  );
}

export function QuietosCaja({ datos, onVer }: { datos: DatosPanel; onVer: () => void }) {
  const q = datos.estancados;
  return (
    <Caja titulo="Para retomar" accion={q?.total ? <button type="button" onClick={onVer} className="ui-foco rounded-full border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] font-medium hover:bg-[var(--surface-2)]">Ver {fmtNum(q.total)}</button> : undefined}>
      {!q?.total ? (
        <p className="text-[13px] text-[var(--text-secondary)]">Nadie quieto. Todos tus leads se movieron en la última semana.</p>
      ) : (
        <ul className="space-y-3">
          {q.leads.slice(0, 4).map((l) => (
            <li key={l.oportunidad_id} className="flex items-center gap-3">
              <Avatar id={l.lead_id} nombre={l.nombre} usuario={l.ig_username} foto={l.avatar_url} tam={36} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{nombreVisible(l.nombre, l.ig_username)}</div>
                <div className="truncate text-[12px] text-[var(--text-secondary)]">{l.etapa}</div>
              </div>
              <span className="shrink-0 rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[var(--text-secondary)]">{plural(l.dias_quieto, 'día', 'días')}</span>
            </li>
          ))}
        </ul>
      )}
    </Caja>
  );
}

export function EmbudoCaja({ datos }: { datos: DatosPanel }) {
  const pasos = (datos.embudo ?? []).filter((p) => p.tipo !== 'perdida');
  const max = Math.max(1, ...pasos.map((p) => p.alcanzaron));
  return (
    <Caja titulo="Del lead a la venta">
      {!pasos.length ? <p className="text-[13px] text-[var(--text-secondary)]">Sin datos todavía.</p> : (
        <ol className="space-y-3">
          {pasos.map((p, i) => (
            <li key={p.id}>
              <div className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="truncate">{p.nombre}</span>
                <span className="shrink-0 font-semibold tabular-nums">{fmtNum(p.alcanzaron)}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
                <div className="h-full rounded-full" style={{ width: `${Math.max(2, (p.alcanzaron / max) * 100)}%`, background: AZUL, opacity: Math.max(0.35, 1 - i * 0.12) }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </Caja>
  );
}

export function DialogoSimple({ abierto, onCerrar, titulo, children }: { abierto: boolean; onCerrar: () => void; titulo: string; children: React.ReactNode }) {
  return <Dialogo abierto={abierto} onCerrar={onCerrar} titulo={titulo} ancho={760}>{children}</Dialogo>;
}
