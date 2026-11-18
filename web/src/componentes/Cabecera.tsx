import { useMemo, useState } from 'react';

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
      className="flex items-center gap-0.5 rounded-md p-0.5"
      style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}
      role="group"
      aria-label="Rango de fechas"
    >
      {OPCIONES.map((o) => (
        <button
          key={o.valor}
          onClick={() => setRango(o.valor)}
          aria-pressed={rango === o.valor}
          className={`rounded px-2.5 py-1 text-[12px] transition-colors ${
            rango === o.valor
              ? 'bg-[var(--surface-1)] font-medium text-[var(--text-primary)] shadow-sm'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          {o.etiqueta}
        </button>
      ))}
    </div>
  );
}

export default function Cabecera({
  titulo, subtitulo, derecha,
}: { titulo: string; subtitulo?: string; derecha?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight">{titulo}</h1>
        {subtitulo && (
          <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">{subtitulo}</p>
        )}
      </div>
      {derecha}
    </header>
  );
}
