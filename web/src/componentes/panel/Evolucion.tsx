import { fmtDinero, fmtNum } from '../../api';
import { Chip, ContenidoDeslizable, FilaChips, useEsMovil, useParamUrl } from '../../ui';
import { MiniSerie, type Granularidad } from '../Graficas';
import type { DatosPanel } from './tipos';

// Evolución: un gráfico chico por número (cada uno con su escala). En
// escritorio, 2×2; en el celular, pestañas y un gráfico por vez que se cambia
// deslizando el dedo. Ventas e ingresos comparten color: son la misma cosa
// (las ventas) contada de dos formas.

type IdSerie = 'leads' | 'reuniones' | 'ventas' | 'ingresos';
const SERIES: Array<{ id: IdSerie; titulo: string; corto: string; color: string; tipo: 'linea' | 'barras'; dinero?: boolean }> = [
  { id: 'leads', titulo: 'Leads', corto: 'Leads', color: 'var(--series-1)', tipo: 'linea' },
  { id: 'reuniones', titulo: 'Reuniones agendadas', corto: 'Reuniones', color: 'var(--series-2)', tipo: 'linea' },
  { id: 'ventas', titulo: 'Ventas', corto: 'Ventas', color: 'var(--series-3)', tipo: 'barras' },
  { id: 'ingresos', titulo: 'Ingresos', corto: 'Ingresos', color: 'var(--series-3)', tipo: 'barras', dinero: true },
];

const RITMO: Record<Granularidad, string> = { dia: 'día a día', semana: 'semana a semana', mes: 'mes a mes' };

export function Evolucion({ datos, cargando }: { datos: DatosPanel; cargando?: boolean }) {
  const movil = useEsMovil();
  const [actual, setActual] = useParamUrl<IdSerie>('serie', 'leads');
  const gran: Granularidad = datos.serie_granularidad ?? 'dia';
  const serie = datos.serie ?? [];
  const puntos = (id: IdSerie) => serie.map((s) => ({ periodo: s.periodo, valor: Number(s[id] ?? 0) }));

  const grafico = (s: (typeof SERIES)[number]) => (
    <MiniSerie key={s.id} titulo={s.titulo} color={s.color} tipo={s.tipo} granularidad={gran}
      formato={s.dinero ? (n) => fmtDinero(n) : (n) => fmtNum(n)} puntos={puntos(s.id)} />
  );

  return (
    <section className={`tarjeta h-full min-w-0 p-4 transition-opacity ${cargando ? 'opacity-60' : ''}`} aria-labelledby="titulo-evolucion">
      <h2 id="titulo-evolucion" className="text-[15px] font-semibold">Evolución</h2>
      <p className="mb-3 mt-0.5 text-[12px] text-[var(--text-secondary)]">Cómo vienen tus números {RITMO[gran]}</p>
      {movil ? (
        <>
          {/* Chips y no Pestanas: las Pestanas del kit hacen scrollIntoView al montarse y
              corren toda la página hacia abajo apenas carga (pedido al kit). */}
          <FilaChips className="mb-3">
            {SERIES.map((s) => <Chip key={s.id} activo={actual === s.id} onClick={() => setActual(s.id)}>{s.corto}</Chip>)}
          </FilaChips>
          {/* key={actual}: el kit pone su propio key en el div que escucha el dedo, y
              después del primer cambio deslizar dejaba de andar (pedido al kit). */}
          <ContenidoDeslizable<IdSerie> key={actual} pestanas={SERIES} actual={actual} onCambiar={setActual}>
            {grafico(SERIES.find((x) => x.id === actual) ?? SERIES[0])}
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">Tocá el gráfico para ver cada {gran === 'semana' ? 'semana' : gran === 'mes' ? 'mes' : 'día'}. Deslizá para cambiar de número.</p>
          </ContenidoDeslizable>
        </>
      ) : (
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          {SERIES.map((s) => grafico(s))}
        </div>
      )}
    </section>
  );
}
