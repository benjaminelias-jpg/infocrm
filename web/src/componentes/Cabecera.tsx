import { useMemo, useState } from 'react';
import { Ayuda } from '../ui';

export type Rango = '7' | '30' | '90' | 'todo';

const OPCIONES: Array<{ valor: Rango; etiqueta: string }> = [
  { valor: '7', etiqueta: '7 días' },
  { valor: '30', etiqueta: '30 días' },
  { valor: '90', etiqueta: '90 días' },
  { valor: 'todo', etiqueta: 'Todo' },
];

export function usarRango(inicial: Rango = '90') {
  const [rango, setRango] = useState<Rango>(inicial);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (rango !== 'todo') {
      const desde = new Date(Date.now() - Number(rango) * 86_400_000);
      p.set('desde', desde.toISOString());
      p.set('granularidad', rango === '90' ? 'semana' : 'dia');
    } else {
      p.set('granularidad', 'semana');
    }
    return p.toString();
  }, [rango]);

  return { rango, setRango, params };
}

export function RangoFechas({
  rango, setRango,
}: { rango: Rango; setRango: (r: Rango) => void }) {
  return (
    <div
      className="flex items-center gap-0.5 rounded-[12px] p-1"
      style={{ background: 'var(--surface-2)' }}
      role="group"
      aria-label="Rango de fechas"
    >
      {OPCIONES.map((o) => (
        <button
          key={o.valor}
          type="button"
          onClick={() => setRango(o.valor)}
          aria-pressed={rango === o.valor}
          className={`ui-foco h-8 rounded-[9px] px-3 text-[12px] font-semibold transition-colors md:h-7 ${
            rango === o.valor
              ? 'bg-[var(--surface-1)] text-[var(--text-primary)] shadow-sm'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          {o.etiqueta}
        </button>
      ))}
    </div>
  );
}

/**
 * Encabezado de pantalla. En el celular el título es más compacto y el
 * subtítulo (que suele ser una explicación larga) pasa a un ⓘ al lado del
 * título, para que el contenido empiece arriba.
 */
export default function Cabecera({
  titulo, subtitulo, derecha,
}: { titulo: string; subtitulo?: React.ReactNode; derecha?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div className="min-w-0">
        <h1 className="flex items-center gap-1.5 text-[19px] font-bold tracking-tight sm:text-[22px]">
          {titulo}
          {subtitulo && <span className="sm:hidden"><Ayuda titulo={titulo}>{subtitulo}</Ayuda></span>}
        </h1>
        {subtitulo && (
          <p className="mt-0.5 hidden text-[13px] text-[var(--text-muted)] sm:block">{subtitulo}</p>
        )}
      </div>
      {derecha}
    </header>
  );
}
