import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtNum, fmtPct, plural } from '../api';
import { Ayuda, Girando } from '../ui';

// Gráficos chicos del Panel (y piezas que usan otras pantallas: Vacio y
// Cargando). Reglas: marcas finas, ejes con números redondos, una sola
// escala por gráfico (nada de dos ejes), texto siempre en tinta (nunca del
// color de la serie) y todo lo que se ve al pasar el mouse también se puede
// ver tocando o con el teclado.

/** Mide el ancho real del contenedor para dibujar en píxeles, no escalado. */
export function useAncho<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  // Arranca en 0 a propósito: si empezara con un ancho inventado, el SVG
  // ensancharía su columna de la rejilla y el observador mediría ese ancho
  // inflado. Mejor no dibujar nada hasta saber el ancho real.
  const [ancho, setAncho] = useState(0);

  useLayoutEffect(() => {
    const nodo = ref.current;
    if (!nodo) return;
    const obs = new ResizeObserver((entradas) => {
      const w = entradas[0]?.contentRect.width;
      if (w) setAncho((prev) => (Math.abs(w - prev) > 1 ? w : prev));
    });
    obs.observe(nodo);
    setAncho(nodo.getBoundingClientRect().width);
    return () => obs.disconnect();
  }, []);

  return { ref, ancho };
}

// ---------------------------------------------------------------------
// Formato para ejes y períodos
// ---------------------------------------------------------------------

export type Granularidad = 'dia' | 'semana' | 'mes';

const nfCompacto = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 });
/** "16 mil", "1,2 M": para ejes que llegan a 10.000 o más. */
export const fmtCompacto = (n: number) => nfCompacto.format(n);

/**
 * Nombre de un período de la serie. Los períodos vienen del servidor en UTC
 * (medianoche), así que se leen en UTC para no correrse un día.
 * corto: "17 ago" · largo: "lun 17 ago" / "Semana del 17 ago" / "agosto 2026".
 */
export function etiquetaPeriodo(periodo: string, gran: Granularidad, largo = false) {
  const d = new Date(periodo);
  if (Number.isNaN(d.getTime())) return '';
  const limpio = (s: string) => s.replace(/\./g, '');
  if (gran === 'mes') {
    const esteAnio = d.getUTCFullYear() === new Date().getFullYear();
    return limpio(d.toLocaleDateString('es-ES', {
      month: largo ? 'long' : 'short', ...(largo || !esteAnio ? { year: 'numeric' } : {}), timeZone: 'UTC',
    }));
  }
  const corto = limpio(d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' }));
  if (!largo) return corto;
  if (gran === 'semana') return `Semana del ${corto}`;
  return limpio(d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }));
}

/**
 * Marcas "lindas" para el eje Y (0-2-4-6, 0-25-50, 0-5 mil-10 mil): de 2 a 4
 * tramos, el tope más bajo posible. Con conteos, solo números enteros.
 */
export function marcasEje(max: number, enteros = true): number[] {
  if (!(max > 0)) return [0, 1];
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const pasos: number[] = [];
  for (const m of [mag / 10, mag, mag * 10]) {
    for (const f of [1, 2, 2.5, 5]) pasos.push(Math.round(f * m * 1e6) / 1e6);
  }
  let mejor: { paso: number; n: number } | null = null;
  let respaldo: { paso: number; n: number } | null = null;
  for (const paso of pasos.sort((a, b) => a - b)) {
    if (enteros && !Number.isInteger(paso)) continue;
    const n = Math.ceil(max / paso - 1e-9);
    if (n < 1 || n > 4) continue;
    const tope = n * paso;
    if (n === 1) {
      if (!respaldo || tope < respaldo.paso * respaldo.n) respaldo = { paso, n };
      continue;
    }
    const topeMejor = mejor ? mejor.paso * mejor.n : Infinity;
    if (tope < topeMejor - 1e-9 || (Math.abs(tope - topeMejor) < 1e-9 && mejor && n < mejor.n)) mejor = { paso, n };
  }
  const elegido = mejor ?? respaldo ?? { paso: max, n: 1 };
  return Array.from({ length: elegido.n + 1 }, (_, i) => Math.round(i * elegido.paso * 1e6) / 1e6);
}

/** Barra con la punta redondeada (4 px) y la base recta, apoyada en el eje. */
function caminoBarra(x0: number, ancho: number, yTope: number, yBase: number) {
  const h = yBase - yTope;
  if (h <= 0 || ancho <= 0) return '';
  const r = Math.min(4, ancho / 2, h);
  return `M${x0},${yBase} V${yTope + r} Q${x0},${yTope} ${x0 + r},${yTope} H${x0 + ancho - r} Q${x0 + ancho},${yTope} ${x0 + ancho},${yTope + r} V${yBase} Z`;
}

// ---------------------------------------------------------------------
// Serie temporal chica (small multiples)
// ---------------------------------------------------------------------

export interface PuntoSerie {
  periodo: string;
  valor: number;
}

interface PropsMini {
  titulo: string;
  color: string;
  puntos: PuntoSerie[];
  formato?: (n: number) => string;
  tipo?: 'linea' | 'barras';
  /** Alto del área del gráfico (sin contar las fechas de abajo). */
  alto?: number;
  /** Para nombrar cada punto: "lun 17 ago", "Semana del 17 ago", "agosto 2026". */
  granularidad?: Granularidad;
  /** Oculta el encabezado (título y total) cuando ya lo muestra otra pieza. */
  sinEncabezado?: boolean;
}

/**
 * Un panel chico por métrica (small multiples). Leads, reuniones y ventas
 * tienen magnitudes muy distintas: cada una lleva su propia escala.
 * - Barras con escala de bandas: ninguna se sale del gráfico.
 * - Eje Y con números redondos; eje X con fechas.
 * - Mouse: se recorre con el puntero. Dedo: tocar un punto muestra su valor.
 *   Teclado: flechas. El valor elegido reemplaza al total del encabezado.
 */
export function MiniSerie({
  titulo, color, puntos, formato = fmtNum, tipo = 'linea', alto = 96, granularidad = 'dia', sinEncabezado,
}: PropsMini) {
  const { ref, ancho } = useAncho<HTMLDivElement>();
  const [activo, setActivo] = useState<number | null>(null);
  const reloj = useRef<number | null>(null);
  useEffect(() => () => { if (reloj.current) window.clearTimeout(reloj.current); }, []);
  // Si cambian los datos (otro período), el punto elegido ya no vale.
  const firma = puntos.map((pt) => `${pt.periodo}:${pt.valor}`).join('|');
  useEffect(() => { setActivo(null); }, [firma]);

  const n = puntos.length;
  const total = puntos.reduce((a, p) => a + p.valor, 0);
  const max = Math.max(0, ...puntos.map((p) => p.valor));
  const vacio = max <= 0;
  const enteros = puntos.every((p) => Number.isInteger(p.valor));
  const marcas = marcasEje(max, enteros);
  const tope = marcas[marcas.length - 1] || 1;
  const compacto = tope >= 10_000;
  const fmtEje = (v: number) => (compacto ? fmtCompacto(v) : fmtNum(v));
  const largoEtiqueta = Math.max(1, ...marcas.map((m) => fmtEje(m).length));

  const padIzq = vacio ? 8 : Math.max(22, Math.round(largoEtiqueta * 6.2 + 10));
  const padDer = 6;
  const padArr = 8;
  const altoFechas = 18;
  const w = ancho;
  const anchoUtil = Math.max(1, w - padIzq - padDer);
  const base = padArr + alto;
  const banda = n > 0 ? anchoUtil / n : anchoUtil;
  const x = (i: number) => padIzq + (i + 0.5) * banda;
  const y = (v: number) => base - (v / tope) * alto;

  const p = activo !== null ? puntos[activo] : null;

  function indiceEn(clientX: number, svg: SVGSVGElement) {
    const r = svg.getBoundingClientRect();
    const i = Math.floor((clientX - r.left - padIzq) / Math.max(banda, 1));
    return Math.min(n - 1, Math.max(0, i));
  }
  function elegirConDedo(i: number) {
    if (reloj.current) window.clearTimeout(reloj.current);
    setActivo((a) => (a === i ? null : i));
    reloj.current = window.setTimeout(() => setActivo(null), 4000);
  }

  // Fechas del eje X: la primera, la del medio y la última (las que entran).
  const indicesFecha = n === 0 ? [] : n <= 2 || w < 220
    ? [...new Set([0, n - 1])]
    : [...new Set([0, Math.floor((n - 1) / 2), n - 1])];

  const lineaD = puntos.map((pt, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(pt.valor)}`).join(' ');
  const areaD = n > 1 ? `${lineaD} L${x(n - 1)},${base} L${x(0)},${base} Z` : '';
  const anchoBarra = Math.max(2, Math.min(24, banda * 0.62));

  return (
    <figure ref={ref} className="relative m-0 w-full min-w-0">
      {!sinEncabezado && (
        <figcaption className="mb-1 flex min-h-[20px] items-baseline justify-between gap-2 px-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
            <span className="truncate text-[13px] font-medium text-[var(--text-secondary)]">{titulo}</span>
          </span>
          <span className="cifras shrink-0 text-right text-[13px] text-[var(--text-primary)]" aria-live="polite">
            {p ? (
              <>
                <span className="text-[12px] text-[var(--text-secondary)]">{etiquetaPeriodo(p.periodo, granularidad, true)} · </span>
                <b className="font-semibold">{formato(p.valor)}</b>
              </>
            ) : <b className="font-semibold">{formato(total)}</b>}
          </span>
        </figcaption>
      )}

      {w === 0 ? (
        <div style={{ height: base + altoFechas }} aria-hidden />
      ) : vacio ? (
        <div className="relative" style={{ height: base + altoFechas }}>
          <svg width={w} height={base + altoFechas} aria-hidden style={{ display: 'block' }}>
            <line x1={padIzq} x2={w - padDer} y1={base} y2={base} stroke="var(--baseline)" strokeWidth={1} />
          </svg>
          <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[12px] text-[var(--text-muted)]">
            Sin movimiento en este período
          </p>
        </div>
      ) : (
        <svg
          width={w}
          height={base + altoFechas}
          role="img"
          tabIndex={0}
          aria-label={`${titulo}: ${formato(total)} en el período. Usá las flechas para ver cada ${granularidad === 'semana' ? 'semana' : granularidad === 'mes' ? 'mes' : 'día'}.`}
          // Sin el anillo negro del navegador al tocarlo o hacer clic (el SVG queda con foco);
          // con el teclado sí se ve el anillo de la casa (ui-foco).
          className="ui-foco rounded-md [&:focus:not(:focus-visible)]:outline-none"
          style={{ display: 'block', overflow: 'visible', touchAction: 'pan-y' }}
          onPointerMove={(e) => { if (e.pointerType !== 'touch') setActivo(indiceEn(e.clientX, e.currentTarget)); }}
          onPointerLeave={(e) => { if (e.pointerType !== 'touch') setActivo(null); }}
          onPointerDown={(e) => { if (e.pointerType === 'touch') elegirConDedo(indiceEn(e.clientX, e.currentTarget)); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              e.preventDefault();
              setActivo((a) => {
                const d = e.key === 'ArrowRight' ? 1 : -1;
                if (a === null) return d === 1 ? 0 : n - 1;
                return Math.min(n - 1, Math.max(0, a + d));
              });
            } else if (e.key === 'Escape') setActivo(null);
          }}
          onBlur={() => setActivo(null)}
        >
          {/* Rejilla y eje Y */}
          {marcas.map((m) => (
            <g key={m}>
              <line x1={padIzq} x2={w - padDer} y1={y(m)} y2={y(m)} stroke="var(--gridline)" strokeWidth={1} />
              <text x={padIzq - 6} y={y(m) + 3.5} textAnchor="end" fontSize={10} fill="var(--text-muted)" className="cifras">
                {fmtEje(m)}
              </text>
            </g>
          ))}

          {tipo === 'linea' ? (
            <>
              {areaD && <path d={areaD} fill={color} opacity={0.1} />}
              <path d={lineaD} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              {n === 1 && <circle cx={x(0)} cy={y(puntos[0].valor)} r={4} fill={color} stroke="var(--surface-1)" strokeWidth={2} />}
            </>
          ) : (
            puntos.map((pt, i) => {
              const alto0 = (pt.valor / tope) * alto;
              const h = pt.valor > 0 ? Math.max(alto0, 2) : 0;
              return (
                <path key={i} d={caminoBarra(x(i) - anchoBarra / 2, anchoBarra, base - h, base)} fill={color}
                  opacity={activo === null || activo === i ? 1 : 0.45} />
              );
            })
          )}

          {p && activo !== null && (
            <>
              <line x1={x(activo)} x2={x(activo)} y1={padArr} y2={base} stroke="var(--baseline)" strokeWidth={1} />
              {tipo === 'linea' && (
                <circle cx={x(activo)} cy={y(p.valor)} r={4.5} fill={color} stroke="var(--surface-1)" strokeWidth={2} />
              )}
            </>
          )}

          {/* Eje X */}
          <line x1={padIzq} x2={w - padDer} y1={base} y2={base} stroke="var(--baseline)" strokeWidth={1} />
          {indicesFecha.map((i) => {
            const texto = etiquetaPeriodo(puntos[i].periodo, granularidad);
            const medio = (texto.length * 5.6) / 2;
            const cx = Math.min(Math.max(x(i), padIzq + medio), w - padDer - medio);
            return (
              <text key={i} x={cx} y={base + 13} textAnchor="middle" fontSize={10} fill="var(--text-muted)">{texto}</text>
            );
          })}
        </svg>
      )}

      {/* Lo mismo en una tabla para lectores de pantalla. El sr-only va en un div:
          una <table> no respeta el ancho de 1 px y desbordaba la página (tablet, 768 px). */}
      <div className="sr-only">
        <table>
          <caption>{titulo}</caption>
          <thead><tr><th scope="col">Período</th><th scope="col">{titulo}</th></tr></thead>
          <tbody>
            {puntos.map((pt) => (
              <tr key={pt.periodo}><td>{etiquetaPeriodo(pt.periodo, granularidad, true)}</td><td>{formato(pt.valor)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

// ---------------------------------------------------------------------
// Embudo
// ---------------------------------------------------------------------

export interface PasoEmbudo {
  id: string;
  nombre: string;
  alcanzaron: number;
  oportunidades: number;
  conversion_desde_inicio: number;
  /** De los que llegaron al paso anterior, qué % llegó a este. */
  conversion_desde_anterior?: number | null;
  tipo: string;
  slug?: string;
  /** "No asistió" o "Perdido": no son pasos, son salidas. */
  es_salida?: boolean;
  /** Para una salida: de qué paso sale (null = de cualquiera). */
  salida_de?: string | null;
}

const esSalida = (p: PasoEmbudo) => p.es_salida ?? p.tipo === 'perdida';
const noVinieron = (p: PasoEmbudo) => p.slug === 'no-asistio' || /no asisti/i.test(p.nombre);

/**
 * Embudo de UN pipeline con rampa ordinal azul (una sola familia de color,
 * de claro a oscuro: el color dice en qué paso estás, no quién es).
 * Cada fila: cuántos llegaron y qué % de los que entraron. Entre fila y fila,
 * cuántos pasan al siguiente. Las salidas ("No asistió", "Perdido") van como
 * nota gris, no como pasos.
 */
export function Embudo({ pasos, onPaso }: { pasos: PasoEmbudo[]; onPaso?: (p: PasoEmbudo) => void }) {
  const visibles = pasos.filter((p) => !esSalida(p));
  const salidas = pasos.filter(esSalida);
  const notas = new Map<string, PasoEmbudo[]>();
  const sueltas: PasoEmbudo[] = [];
  for (const s of salidas) {
    if (s.salida_de && visibles.some((v) => v.id === s.salida_de)) notas.set(s.salida_de, [...(notas.get(s.salida_de) ?? []), s]);
    else sueltas.push(s);
  }
  const max = Math.max(1, ...visibles.map((p) => p.alcanzaron));

  return (
    <div>
      <div className="mb-1.5 flex justify-between gap-2 px-2 text-[11px] text-[var(--text-muted)]" aria-hidden>
        <span>Paso</span>
        <span>Llegaron · % de los que entraron</span>
      </div>
      <ol className="flex flex-col">
        {visibles.map((paso, i) => {
          const ancho = (paso.alcanzaron / max) * 100;
          const anterior = i > 0 ? visibles[i - 1] : null;
          const pasa = anterior && anterior.alcanzaron > 0
            ? (paso.conversion_desde_anterior ?? Math.round((paso.alcanzaron / anterior.alcanzaron) * 1000) / 10)
            : null;
          const bajo = pasa !== null && pasa < 30;
          const notasPaso = (notas.get(paso.id) ?? []).filter((s) => s.alcanzaron > 0);
          const textoNotas = notasPaso.map((s) => (noVinieron(s) ? `${fmtNum(s.alcanzaron)} no vinieron` : `${fmtNum(s.alcanzaron)} en «${s.nombre}»`));
          const etiqueta = `${paso.nombre}: llegaron ${fmtNum(paso.alcanzaron)}${i > 0 ? `, ${fmtPct(paso.conversion_desde_inicio)} de los que entraron` : ''}${textoNotas.length ? `. ${textoNotas.join(', ')}` : ''}`;
          const cuerpo = (
            <>
              <span className="flex items-baseline justify-between gap-2 text-[12px]">
                <span className="min-w-0 truncate text-left">
                  <span className="text-[var(--text-primary)]">{paso.nombre}</span>
                  {textoNotas.length > 0 && <span className="text-[var(--text-secondary)]"> · {textoNotas.join(' · ')}</span>}
                </span>
                <span className="cifras shrink-0">
                  <b className="font-semibold text-[var(--text-primary)]">{fmtNum(paso.alcanzaron)}</b>
                  {i > 0 && <span className="text-[var(--text-secondary)]"> · {fmtPct(paso.conversion_desde_inicio)}</span>}
                </span>
              </span>
              <span className="mt-1 block h-2.5 w-full rounded-r-[4px]" style={{ background: 'color-mix(in srgb, var(--gridline) 70%, transparent)' }}>
                <span className="block h-full rounded-r-[4px] transition-[width] duration-300"
                  style={{ width: `${paso.alcanzaron > 0 ? Math.max(ancho, 1) : 0}%`, background: `var(--ramp-${Math.min(i + 1, 8)})` }} />
              </span>
            </>
          );
          return (
            <li key={paso.id}>
              {anterior && (
                <div className="flex h-4 items-center gap-1 pl-2 text-[11px] md:h-[18px]"
                  style={{ color: bajo ? 'color-mix(in srgb, var(--status-critical) 85%, var(--text-primary))' : 'var(--text-muted)' }}>
                  {pasa !== null ? (
                    <>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M12 4v16M5 13l7 7 7-7" />
                      </svg>
                      <span className="cifras">pasa el {fmtPct(pasa)}</span>
                    </>
                  ) : null}
                </div>
              )}
              {onPaso ? (
                <button type="button" onClick={() => onPaso(paso)} aria-label={`${etiqueta}. Ver en el pipeline`}
                  className="ui-foco block w-full rounded-lg px-2 py-1 text-left transition-colors hover:bg-[var(--page-plane)] md:py-1.5">
                  {cuerpo}
                </button>
              ) : (
                <div className="px-2 py-1 md:py-1.5" aria-label={etiqueta}>{cuerpo}</div>
              )}
            </li>
          );
        })}
      </ol>
      {sueltas.filter((s) => s.alcanzaron > 0).map((s) => (
        <p key={s.id} className="mt-2 px-2 text-[12px] text-[var(--text-secondary)]">
          {s.tipo === 'perdida'
            ? <>{plural(s.alcanzaron, 'se perdió', 'se perdieron')} en el camino.</>
            : <>{fmtNum(s.alcanzaron)} en «{s.nombre}».</>}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// Tarjeta de KPI
// ---------------------------------------------------------------------

const TINTA_BIEN = 'color-mix(in srgb, var(--status-good) 72%, var(--text-primary))';
const TINTA_MAL = 'color-mix(in srgb, var(--status-critical) 85%, var(--text-primary))';

export interface Delta { texto: string; tono: 'bien' | 'mal' | 'neutro' }

/** Variación contra el período anterior: % (o puntos, para tasas). null si no hay con qué comparar. */
export function calcularDelta(actual: number | undefined, anterior: number | null | undefined, opciones: { menosEsMejor?: boolean; puntos?: boolean } = {}): Delta | null {
  if (actual === undefined || anterior === undefined || anterior === null) return null;
  if (opciones.puntos) {
    const d = Math.round(actual - anterior);
    if (d === 0) return { texto: '= igual', tono: 'neutro' };
    const bueno = opciones.menosEsMejor ? d < 0 : d > 0;
    return { texto: `${d > 0 ? '▲' : '▼'} ${plural(Math.abs(d), 'punto', 'puntos')}`, tono: bueno ? 'bien' : 'mal' };
  }
  if (anterior === 0) return actual > 0 ? { texto: 'nuevo', tono: 'neutro' } : null;
  const pct = Math.round(((actual - anterior) / Math.abs(anterior)) * 100);
  if (pct === 0) return { texto: '= igual', tono: 'neutro' };
  const bueno = opciones.menosEsMejor ? pct < 0 : pct > 0;
  return { texto: `${pct > 0 ? '▲' : '▼'} ${fmtNum(Math.abs(pct))} %`, tono: bueno ? 'bien' : 'mal' };
}

export function PastillaDelta({ delta }: { delta: Delta }) {
  const color = delta.tono === 'bien' ? TINTA_BIEN : delta.tono === 'mal' ? TINTA_MAL : 'var(--text-secondary)';
  const fondo = delta.tono === 'bien'
    ? 'color-mix(in srgb, var(--status-good) 13%, transparent)'
    : delta.tono === 'mal' ? 'color-mix(in srgb, var(--status-critical) 12%, transparent)' : 'var(--gridline)';
  return (
    <span className="cifras inline-flex items-center whitespace-nowrap rounded-full px-1.5 py-[1px] text-[11px] font-medium"
      style={{ color, background: fondo }}>
      {delta.texto}
    </span>
  );
}

/**
 * Tarjeta de un número: etiqueta (con ⓘ si hay explicación), valor, variación
 * contra el período anterior (como pastilla) y una línea de contexto. Si
 * recibe `a`, toda la tarjeta lleva al detalle.
 */
export function Kpi({
  etiqueta, valor, sub, acento, ayuda, actual, anterior, menosEsMejor, delta: deltaFijo, puntos, a, cargando,
}: {
  etiqueta: string;
  valor: string;
  sub?: React.ReactNode;
  acento?: string;
  /** Qué significa: se ve con el ⓘ (en el celular, en una hoja). */
  ayuda?: React.ReactNode;
  /** Para mostrar la variación contra el período anterior. */
  actual?: number;
  anterior?: number | null;
  menosEsMejor?: boolean;
  /** La variación ya calculada (o null para no mostrarla). Tiene prioridad sobre actual/anterior. */
  delta?: Delta | null;
  /** La variación de una tasa va en puntos, no en %. */
  puntos?: boolean;
  /** A dónde lleva tocar la tarjeta. */
  a?: string;
  cargando?: boolean;
}) {
  const delta = deltaFijo !== undefined ? deltaFijo : calcularDelta(actual, anterior, { menosEsMejor, puntos });
  return (
    <div className={`tarjeta relative h-full px-3.5 py-3 transition-shadow ${a ? 'hover:shadow-md' : ''}`}>
      {a && <Link to={a} className="ui-foco absolute inset-0 rounded-[12px]" aria-label={`${etiqueta}: ${valor}. Ver el detalle`} />}
      <div className="pointer-events-none relative flex min-h-[20px] items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
        {acento && <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: acento }} aria-hidden />}
        <span className="min-w-0 truncate">{etiqueta}</span>
        {ayuda && <span className="pointer-events-auto ml-0.5 inline-flex"><Ayuda titulo={etiqueta}>{ayuda}</Ayuda></span>}
        {cargando && <span className="ml-auto text-[var(--text-muted)]"><Girando tam={12} /></span>}
      </div>
      <div className="pointer-events-none relative mt-1 text-[22px] font-semibold leading-tight tracking-tight sm:text-[24px]">{valor}</div>
      {delta && <div className="pointer-events-none relative mt-1"><PastillaDelta delta={delta} /></div>}
      {sub && <div className="pointer-events-none relative mt-1 text-[12px] leading-snug text-[var(--text-secondary)]">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Barra de calidad (una barra fina partida en tramos)
// ---------------------------------------------------------------------

/**
 * Barra fina partida en tramos (cuánto de lo que se ve es seguro). Sin texto
 * encima: la leyenda de abajo dice cada tramo y su cantidad.
 */
export function BarraCalidad({
  alta, media, baja, ninguna, total, etiquetas = {},
}: {
  alta: number; media: number; baja: number; ninguna: number; total: number;
  etiquetas?: Partial<Record<'alta' | 'media' | 'baja' | 'ninguna', string>>;
}) {
  const t = Math.max(total, 1);
  const tramos = [
    { n: alta, color: 'var(--status-good)', etiqueta: etiquetas.alta ?? 'Exacta' },
    { n: media, color: 'var(--ramp-5)', etiqueta: etiquetas.media ?? 'Aproximada' },
    { n: baja, color: 'var(--status-warning)', etiqueta: etiquetas.baja ?? 'Dudosa' },
    { n: ninguna, color: 'var(--baseline)', etiqueta: etiquetas.ninguna ?? 'Sin atribuir' },
  ].filter((x) => x.n > 0);

  return (
    <div>
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-full" role="img"
        aria-label={tramos.map((tr) => `${tr.etiqueta}: ${fmtNum(tr.n)}`).join(', ')}>
        {tramos.map((tr) => (
          <div key={tr.etiqueta} style={{ width: `${(tr.n / t) * 100}%`, background: tr.color }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--text-secondary)]">
        {tramos.map((tr) => (
          <span key={tr.etiqueta} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: tr.color }} aria-hidden />
            {tr.etiqueta}
            <span className="cifras font-medium text-[var(--text-primary)]">{fmtNum(tr.n)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Estados que usan otras pantallas (misma firma de siempre)
// ---------------------------------------------------------------------

export function Vacio({ mensaje, accion }: { mensaje: string; accion?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <p className="max-w-md text-[13px] text-[var(--text-muted)]">{mensaje}</p>
      {accion}
    </div>
  );
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 py-16 text-[13px] text-[var(--text-muted)]">
      <Girando tam={16} />
      {texto}
    </div>
  );
}
