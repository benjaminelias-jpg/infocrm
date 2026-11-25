import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmtDinero, fmtNum, fmtPct, plural } from '../../api';
import { Avatar, Dialogo, ItemMenu, Menu, nombreVisible, useEsMovil } from '../../ui';
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
// Barras «Rendimiento» (réplica del diseño de referencia)
// ---------------------------------------------------------------------
// Cada columna tiene dos barras en el MISMO eje: atrás, clara, el mismo tramo
// del período anterior; adelante, este período. La destacada (la mayor, o la
// que tenés debajo del mouse) va en azul rayado con un punto arriba y su globo.
type Metrica = 'ingresos' | 'leads' | 'reuniones' | 'ventas';
const METRICAS: Array<{ v: Metrica; t: string }> = [
  { v: 'ingresos', t: 'Ingresos' }, { v: 'leads', t: 'Leads' }, { v: 'reuniones', t: 'Reuniones' }, { v: 'ventas', t: 'Ventas' },
];

const FONDO_BARRA = 'color-mix(in srgb, var(--text-primary) 3.5%, var(--surface-1))';
const BARRA = 'color-mix(in srgb, var(--text-primary) 8.5%, var(--surface-1))';
const PUNTO_ANTERIOR = 'color-mix(in srgb, var(--text-primary) 14%, var(--surface-1))';
const DESTACADA = [
  'repeating-linear-gradient(45deg, rgba(255,255,255,.34) 0 1.6px, transparent 1.6px 8px)',
  'linear-gradient(180deg, #1f6ff2 0%, #4f8ef5 42%, #a9c7fa 78%, #d6e5fd 100%)',
].join(', ');

const aFecha = (p: string) => new Date(p.length <= 10 ? `${p}T12:00:00` : p);
function tramo(desde: string, hasta: string, gran?: string, largo = false) {
  const a = aFecha(desde), b = aFecha(hasta);
  if (Number.isNaN(a.getTime())) return desde;
  if (gran === 'mes') {
    const t = a.toLocaleDateString('es-ES', largo ? { month: 'long', year: 'numeric' } : { month: 'short' });
    return largo ? t.charAt(0).toUpperCase() + t.slice(1) : t.replace('.', '');
  }
  if (gran === 'semana') return `${largo ? 'Semana del ' : ''}${a.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '')}`;
  const mismo = desde === hasta;
  if (!largo) return a.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '');
  if (mismo) return a.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
  return `${a.getDate()} al ${b.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}`;
}

/** Tope «redondo» del eje y su paso (6 marcas parejas, como la referencia). */
function escala(max: number) {
  const bruto = Math.max(1, max) / 5;
  const p = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= bruto) ?? 10 * p;
  return { tope: paso * 5, paso };
}
function marca(v: number, k: boolean) {
  if (!k) return fmtNum(v);
  const n = v / 1000;
  return `${n.toLocaleString('es-ES', { maximumFractionDigits: n < 10 && n % 1 ? 1 : 0 })}k`;
}

export function Rendimiento({ datos }: { datos: DatosPanel }) {
  const [m, setM] = useState<Metrica>('ingresos');
  const [sobre, setSobre] = useState<number | null>(null);
  const movil = useEsMovil(640);
  const dinero = m === 'ingresos';
  const H = movil ? 200 : 232;
  const nombre = METRICAS.find((x) => x.v === m)!.t;

  // Como mucho 12 columnas (6 en el celular): si hay más días, se agrupan.
  const barras = useMemo(() => {
    const s = datos.serie ?? [];
    const ant = datos.serie_anterior ?? null;
    const tam = Math.max(1, Math.ceil(s.length / (movil ? 6 : 12)));
    const out: Array<{ corta: string; larga: string; v: number; antes: number | null }> = [];
    for (let i = 0; i < s.length; i += tam) {
      const g = s.slice(i, i + tam);
      const ga = ant ? ant.slice(i, i + tam) : null;
      out.push({
        corta: tramo(g[0].periodo, g[g.length - 1].periodo, datos.serie_granularidad),
        larga: tramo(g[0].periodo, g[g.length - 1].periodo, datos.serie_granularidad, true),
        v: g.reduce((a, x) => a + (Number(x[m]) || 0), 0),
        antes: ga && ga.length ? ga.reduce((a, x) => a + (Number(x[m]) || 0), 0) : null,
      });
    }
    return out;
  }, [datos.serie, datos.serie_anterior, datos.serie_granularidad, m, movil]);

  const max = Math.max(1, ...barras.map((b) => Math.max(b.v, b.antes ?? 0)));
  const { tope, paso } = escala(max);
  const k = tope >= 1000;
  const marcas = Array.from({ length: 6 }, (_, i) => tope - i * paso);
  // Destacada por defecto: la última columna con datos (dónde estás ahora).
  const ultima = barras.reduce((u, b, i) => (b.v > 0 ? i : u), Math.max(0, barras.length - 1));
  const activa = sobre ?? ultima;
  const fmt = (v: number) => (dinero ? fmtDinero(v) : fmtNum(v));
  const hayAnterior = barras.some((b) => b.antes !== null);

  return (
    <section className={`${TARJETA} min-w-0 p-5 sm:p-6 lg:col-span-2`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[19px] font-medium tracking-[-0.01em] sm:text-[20px]">Rendimiento</h2>
        <Menu alinear="derecha" ancho={200} titulo="Qué mostrar" disparador={({ abierto, alternar, ref }) => (
          <button ref={ref} type="button" onClick={alternar} aria-haspopup="menu" aria-expanded={abierto}
            className="ui-foco inline-flex h-[42px] items-center gap-3 rounded-full pl-4 pr-1 text-[14px]"
            style={{ background: 'color-mix(in srgb, var(--text-primary) 4%, var(--surface-1))' }}>
            {nombre}
            <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-[var(--surface-1)] shadow-[0_1px_3px_rgba(16,24,40,.10)]">
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden className={`transition-transform ${abierto ? 'rotate-180' : ''}`}>
                <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
        )}>
          {METRICAS.map((x) => <ItemMenu key={x.v} activo={x.v === m} onClick={() => setM(x.v)}>{x.t}</ItemMenu>)}
        </Menu>
      </div>

      {barras.length === 0 ? (
        <div className="grid place-items-center text-[13px] text-[var(--text-secondary)]" style={{ height: H + 60 }}>Todavía no hay datos en este período.</div>
      ) : (
        <div className="mt-9 flex">
          {/* Eje: 6 marcas parejas */}
          <div className="relative shrink-0 pr-3 text-right text-[12px] text-[var(--text-secondary)] tabular-nums sm:pr-4 sm:text-[13px]" style={{ height: H, width: movil ? 34 : 44 }}>
            {marcas.map((v) => (
              <span key={v} className="absolute right-3 -translate-y-1/2 sm:right-4" style={{ top: H - (v / tope) * H }}>{marca(v, k)}</span>
            ))}
          </div>
          <div className="relative min-w-0 flex-1">
            {marcas.map((v) => (
              <div key={v} className="pointer-events-none absolute inset-x-0 border-t border-dashed"
                style={{ top: H - (v / tope) * H, borderColor: 'color-mix(in srgb, var(--text-primary) 10%, transparent)' }} />
            ))}
            <div className="relative flex items-end" style={{ height: H, gap: movil ? 10 : 18 }} onPointerLeave={() => setSobre(null)}>
              {barras.map((b, i) => {
                const on = i === activa;
                const altoFondo = b.antes ? (b.antes / tope) * H : 0;
                const alto = b.v > 0 ? Math.max(8, (b.v / tope) * H - 3) : 0;
                const punto = alto + 3; // centro del punto, desde la base
                const ALTO_GLOBO = hayAnterior ? 104 : 78;
                const cabeArriba = punto + 6 + ALTO_GLOBO <= H + 30;
                // Cerca del borde izquierdo el globo abre hacia la derecha (si no, taparía el eje).
                const aLaDerecha = (i + 0.5) / barras.length < (movil ? 0.62 : 0.32);
                return (
                  <div key={i} className="relative h-full min-w-0 flex-1 cursor-default" onPointerEnter={() => setSobre(i)}
                    aria-label={`${b.larga}: ${fmt(b.v)}`}>
                    {altoFondo > alto + 6 && (
                      <div className="absolute inset-x-0 bottom-0 rounded-[12px]" style={{ height: altoFondo, background: FONDO_BARRA }} />
                    )}
                    {alto > 0 && (
                      <div className="absolute bottom-[3px] left-[3px] right-[3px] rounded-[10px] transition-[height] duration-300"
                        style={{ height: alto, background: on ? DESTACADA : BARRA }} />
                    )}
                    {on && alto > 0 && (
                      <span className="pointer-events-none absolute left-1/2 z-[2] h-[11px] w-[11px] -translate-x-1/2 translate-y-1/2 rounded-full"
                        style={{ bottom: punto, background: AZUL, boxShadow: '0 0 0 2.5px var(--surface-1), 0 1px 4px rgba(16,24,40,.25)' }} />
                    )}
                    {on && (
                      <div className={`pointer-events-none absolute z-[3] w-max rounded-[16px] bg-[var(--surface-1)] ${movil ? 'min-w-[150px] px-3.5 py-3 text-[12px]' : 'min-w-[176px] px-4 py-3.5 text-[13px]'}`}
                        style={{
                          boxShadow: '0 12px 32px -8px rgba(16,24,40,.18), 0 0 0 1px color-mix(in srgb, var(--text-primary) 7%, transparent)',
                          bottom: cabeArriba ? punto + 6 : H + 28 - ALTO_GLOBO,
                          ...(aLaDerecha
                            ? { left: cabeArriba ? '50%' : 'calc(100% + 8px)' }
                            : { right: cabeArriba ? '50%' : 'calc(100% + 8px)' }),
                        }}>
                        <div className="text-[14px] font-medium text-[var(--text-primary)]">{b.larga}</div>
                        {b.antes !== null && (
                          <div className="mt-2.5 flex items-center justify-between gap-8">
                            <span className="flex items-center gap-2 text-[var(--text-secondary)]"><span className="h-2 w-2 rounded-full" style={{ background: PUNTO_ANTERIOR }} />Período anterior</span>
                            <b className="font-semibold tabular-nums text-[var(--text-primary)]">{fmt(b.antes)}</b>
                          </div>
                        )}
                        <div className={`${b.antes !== null ? 'mt-2' : 'mt-2.5'} flex items-center justify-between gap-8`}>
                          <span className="flex items-center gap-2 text-[var(--text-secondary)]"><span className="h-2 w-2 rounded-full" style={{ background: AZUL }} />{nombre}</span>
                          <b className="font-semibold tabular-nums text-[var(--text-primary)]">{fmt(b.v)}</b>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex" style={{ gap: movil ? 10 : 18 }}>
              {barras.map((b, i) => (
                <span key={i} className="min-w-0 flex-1 truncate text-center text-[12px] capitalize text-[var(--text-secondary)] sm:text-[13px]">{b.corta}</span>
              ))}
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
