import { Esqueleto } from '../../ui';

/** El Panel cargando por primera vez: la forma de lo que va a aparecer (no un "Cargando…" suelto). */
export function EsqueletoPanel() {
  return (
    <div aria-busy="true" aria-label="Cargando tu panel" className="space-y-4">
      <div className="sin-barra -mx-4 flex gap-3 overflow-hidden px-4 md:mx-0 md:grid md:grid-cols-3 md:px-0 xl:grid-cols-6">
        {/* El ancho va en un envoltorio: Esqueleto pone width: 100% en línea y pisaba w-[42vw]. */}
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="w-[42vw] shrink-0 md:w-auto"><Esqueleto alto={104} className="rounded-xl" /></div>
        ))}
      </div>
      <div className="sin-barra -mx-4 flex gap-3 overflow-hidden px-4 md:mx-0 md:grid md:grid-cols-2 md:px-0 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="w-[min(80vw,300px)] shrink-0 md:w-auto"><Esqueleto alto={140} className="rounded-xl" /></div>
        ))}
      </div>
      <Esqueleto alto={120} className="rounded-xl" />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2"><Esqueleto alto={320} className="rounded-xl" /></div>
        <Esqueleto alto={320} className="rounded-xl" />
      </div>
    </div>
  );
}
