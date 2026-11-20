import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fmtDinero, fmtNum, fmtPct } from '../api';

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
  alto?: number;
}

/**
 * Un panel pequeño por métrica (small multiples).
 * Leads, reuniones y ventas tienen magnitudes muy distintas: meterlas en
 * un mismo eje aplastaría las ventas contra cero, y dos ejes en una misma
 * gráfica mienten. Cada métrica lleva su propia escala y su propio panel.
 */
export function MiniSerie({
  titulo, color, puntos, formato = fmtNum, tipo = 'linea', alto = 104,
}: PropsMini) {
  const { ref, ancho } = useAncho<HTMLDivElement>();
  const [activo, setActivo] = useState<number | null>(null);

  const padIzq = 44;
  const padDer = 12;
  const padArr = 10;
  const padAbj = 20;
  const w = ancho > 0 ? Math.max(ancho, 200) : 0;
  const anchoUtil = w - padIzq - padDer;
  const altoUtil = alto - padArr - padAbj;

  const max = Math.max(1, ...puntos.map((p) => p.valor));
  const escalaY = (v: number) => padArr + altoUtil - (v / max) * altoUtil;
  const escalaX = (i: number) =>
    puntos.length <= 1 ? padIzq + anchoUtil / 2
      : padIzq + (i / (puntos.length - 1)) * anchoUtil;

  const total = puntos.reduce((a, p) => a + p.valor, 0);
  const d = puntos.map((p, i) => `${i === 0 ? 'M' : 'L'}${escalaX(i)},${escalaY(p.valor)}`).join(' ');
  const area = puntos.length
    ? `${d} L${escalaX(puntos.length - 1)},${padArr + altoUtil} L${escalaX(0)},${padArr + altoUtil} Z`
    : '';

  const anchoBarra = puntos.length ? Math.max(2, (anchoUtil / puntos.length) * 0.62) : 2;
  const marcas = [0, max / 2, max];

  function alMover(e: React.MouseEvent<SVGSVGElement>) {
    const caja = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - caja.left;
    if (!puntos.length) return;
    const i = Math.round(((x - padIzq) / Math.max(anchoUtil, 1)) * (puntos.length - 1));
    setActivo(Math.min(puntos.length - 1, Math.max(0, i)));
  }

  const p = activo !== null ? puntos[activo] : null;

  return (
    <div ref={ref} className="relative w-full min-w-0 overflow-hidden">
      <div className="flex items-baseline justify-between px-1">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: color }}
            aria-hidden
          />
          <span className="text-[13px] font-medium text-[var(--text-secondary)]">{titulo}</span>
        </div>
        <span className="cifras text-[13px] font-semibold text-[var(--text-primary)]">
          {formato(total)}
        </span>
      </div>

      {w === 0 ? (
        <div style={{ height: alto }} aria-hidden />
      ) : (
      <svg
        width={w}
        height={alto}
        role="img"
        aria-label={`${titulo}: ${formato(total)} en el periodo`}
        onMouseMove={alMover}
        onMouseLeave={() => setActivo(null)}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {marcas.map((m, i) => (
          <g key={i}>
            <line
              x1={padIzq} x2={w - padDer} y1={escalaY(m)} y2={escalaY(m)}
              stroke="var(--gridline)" strokeWidth={1}
            />
            <text
              x={padIzq - 8} y={escalaY(m) + 3.5} textAnchor="end"
              fontSize={10} fill="var(--text-muted)" className="cifras"
            >
              {m >= 1000 ? `${Math.round(m / 1000)}k` : Math.round(m)}
            </text>
          </g>
        ))}

        {tipo === 'linea' ? (
          <>
            <path d={area} fill={color} opacity={0.1} />
            <path
              d={d} fill="none" stroke={color} strokeWidth={2}
              strokeLinecap="round" strokeLinejoin="round"
            />
          </>
        ) : (
          puntos.map((punto, i) => {
            const h = (punto.valor / max) * altoUtil;
            return (
              <rect
                key={i}
                x={escalaX(i) - anchoBarra / 2}
                y={padArr + altoUtil - h}
                width={anchoBarra}
                height={Math.max(h, punto.valor > 0 ? 2 : 0)}
                rx={2}
                fill={color}
                opacity={activo === null || activo === i ? 1 : 0.45}
              />
            );
          })
        )}

        {p && (
          <>
            <line
              x1={escalaX(activo!)} x2={escalaX(activo!)} y1={padArr} y2={padArr + altoUtil}
              stroke="var(--baseline)" strokeWidth={1}
            />
            {tipo === 'linea' && (
              <circle
                cx={escalaX(activo!)} cy={escalaY(p.valor)} r={4.5}
                fill={color} stroke="var(--surface-1)" strokeWidth={2}
              />
            )}
          </>
        )}

        <line
          x1={padIzq} x2={w - padDer} y1={padArr + altoUtil} y2={padArr + altoUtil}
          stroke="var(--baseline)" strokeWidth={1}
        />
      </svg>
      )}

      {p && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 rounded-md px-2 py-1 text-[11px] shadow-lg"
          style={{
            left: Math.min(Math.max(escalaX(activo!), 60), w - 60),
            top: -4,
            background: 'var(--surface-1)',
            border: '1px solid var(--border-hairline)',
            color: 'var(--text-primary)',
          }}
        >
          <span className="text-[var(--text-muted)]">
            {new Date(p.periodo).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
          </span>
          {'  '}
          <span className="cifras font-semibold">{formato(p.valor)}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------

interface PasoEmbudo {
  id: string;
  nombre: string;
  alcanzaron: number;
  oportunidades: number;
  conversion_desde_inicio: number;
  tipo: string;
}

/**
 * Embudo con rampa ordinal azul (una sola familia de color, de claro a
 * oscuro): el color codifica la posición en el embudo, no la identidad.
 */
export function Embudo({ pasos }: { pasos: PasoEmbudo[] }) {
  const visibles = pasos.filter((p) => p.tipo !== 'perdida');
  const max = Math.max(1, ...visibles.map((p) => p.alcanzaron));

  return (
    <div className="space-y-2">
      {visibles.map((paso, i) => {
        const ancho = (paso.alcanzaron / max) * 100;
        const caida =
          i > 0 && visibles[i - 1].alcanzaron > 0
            ? 100 - (paso.alcanzaron / visibles[i - 1].alcanzaron) * 100
            : 0;
        return (
          <div key={paso.id} className="group">
            <div className="mb-1 flex items-baseline justify-between text-[12px]">
              <span className="text-[var(--text-secondary)]">{paso.nombre}</span>
              <span className="cifras tabular-nums text-[var(--text-muted)]">
                <span className="font-semibold text-[var(--text-primary)]">
                  {fmtNum(paso.alcanzaron)}
                </span>
                {i > 0 && <span className="ml-2">{fmtPct(paso.conversion_desde_inicio)}</span>}
              </span>
            </div>
            <div className="relative h-5 overflow-hidden rounded" style={{ background: 'var(--gridline)' }}>
              <div
                className="h-full rounded transition-all"
                style={{
                  width: `${Math.max(ancho, paso.alcanzaron > 0 ? 1.5 : 0)}%`,
                  background: `var(--ramp-${Math.min(i + 1, 8)})`,
                }}
                title={`${paso.nombre}: ${paso.alcanzaron} llegaron, ${paso.oportunidades} están aquí ahora`}
              />
              {/* La caída solo se dibuja si queda hueco fuera de la barra:
                  si no, se pisarían el texto y el relleno. */}
              {i > 0 && caida > 0 && ancho < 88 && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">
                  −{Math.round(caida)}%
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------

export function Kpi({
  etiqueta, valor, sub, acento, ayuda, actual, anterior, menosEsMejor,
}: {
  etiqueta: string;
  valor: string;
  sub?: string;
  acento?: string;
  ayuda?: string;
  /** Para mostrar la variación contra el periodo anterior. */
  actual?: number;
  anterior?: number | null;
  menosEsMejor?: boolean;
}) {
  let delta: { texto: string; color: string } | null = null;
  if (actual !== undefined && anterior !== undefined && anterior !== null) {
    if (anterior === 0) {
      delta = actual > 0 ? { texto: 'nuevo vs período anterior', color: 'var(--text-muted)' } : null;
    } else {
      const pct = Math.round(((actual - anterior) / Math.abs(anterior)) * 100);
      const bueno = menosEsMejor ? pct < 0 : pct > 0;
      delta = {
        texto: `${pct > 0 ? '▲' : pct < 0 ? '▼' : '='} ${Math.abs(pct)}% vs período anterior`,
        color: pct === 0 ? 'var(--text-muted)' : bueno ? 'var(--status-good)' : 'var(--status-critical)',
      };
    }
  }
  return (
    <div className="tarjeta px-4 py-3" title={ayuda}>
      <div className="flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
        {acento && (
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: acento }} aria-hidden />
        )}
        {etiqueta}
      </div>
      <div className="cifras mt-1 text-[26px] font-semibold leading-none tracking-tight">{valor}</div>
      {delta && <div className="mt-1 text-[11px] font-medium" style={{ color: delta.color }}>{delta.texto}</div>}
      {sub && <div className="mt-1 text-[12px] text-[var(--text-muted)]">{sub}</div>}
    </div>
  );
}

/** Barra de calidad de atribución: cuánto de lo que se ve es fiable. */
export function BarraCalidad({
  alta, media, baja, ninguna, total,
}: { alta: number; media: number; baja: number; ninguna: number; total: number }) {
  const t = Math.max(total, 1);
  const tramos = [
    { n: alta, color: 'var(--status-good)', etiqueta: 'Exacta' },
    { n: media, color: 'var(--ramp-5)', etiqueta: 'Aproximada' },
    { n: baja, color: 'var(--status-warning)', etiqueta: 'Dudosa' },
    { n: ninguna, color: 'var(--baseline)', etiqueta: 'Sin atribuir' },
  ].filter((x) => x.n > 0);

  return (
    <div>
      <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full">
        {tramos.map((tr) => (
          <div
            key={tr.etiqueta}
            style={{ width: `${(tr.n / t) * 100}%`, background: tr.color }}
            title={`${tr.etiqueta}: ${tr.n}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-secondary)]">
        {tramos.map((tr) => (
          <span key={tr.etiqueta} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: tr.color }} aria-hidden />
            {tr.etiqueta}
            <span className="cifras text-[var(--text-muted)]">{fmtNum(tr.n)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

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
    <div className="flex items-center justify-center py-16 text-[13px] text-[var(--text-muted)]">
      {texto}
    </div>
  );
}
