import { useEffect, useId, useState } from 'react';

// Secciones que se pliegan y despliegan (con altura animada). Si se les da
// una `clave`, recuerdan si quedaron abiertas en este navegador.

function leer(clave?: string): boolean | null {
  if (!clave) return null;
  try {
    const v = localStorage.getItem(`infocrm_plegado_${clave}`);
    return v === null ? null : v === '1';
  } catch { return null; }
}
function guardar(clave: string | undefined, abierto: boolean) {
  if (!clave) return;
  try { localStorage.setItem(`infocrm_plegado_${clave}`, abierto ? '1' : '0'); } catch { /* sin almacenamiento */ }
}

export function Chevron({ abierto, tam = 16 }: { abierto: boolean; tam?: number }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 24 24" aria-hidden
      className="shrink-0 text-[var(--text-muted)] transition-transform duration-200" style={{ transform: abierto ? 'rotate(90deg)' : 'none' }}>
      <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Desplegable({
  titulo, subtitulo, derecha, abiertoInicial = false, clave, children, className = '', tarjeta = true, icono,
  abierto: controlado, onCambiar,
}: {
  titulo: React.ReactNode; subtitulo?: React.ReactNode; derecha?: React.ReactNode; abiertoInicial?: boolean;
  clave?: string; children: React.ReactNode; className?: string; tarjeta?: boolean; icono?: React.ReactNode;
  abierto?: boolean; onCambiar?: (abierto: boolean) => void;
}) {
  const [propio, setPropio] = useState<boolean>(() => leer(clave) ?? abiertoInicial);
  const abierto = controlado ?? propio;
  const id = useId();
  useEffect(() => { if (controlado === undefined) guardar(clave, propio); }, [clave, propio, controlado]);
  const alternar = () => { const v = !abierto; setPropio(v); onCambiar?.(v); };
  return (
    <section className={`${tarjeta ? 'tarjeta' : ''} ${className}`}>
      <div className="flex items-center gap-2 pr-2">
        <button type="button" onClick={alternar} aria-expanded={abierto} aria-controls={id}
          className="ui-foco flex min-h-[48px] min-w-0 flex-1 items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left">
          <Chevron abierto={abierto} />
          {icono && <span className="text-[16px]">{icono}</span>}
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold leading-tight">{titulo}</span>
            {subtitulo && <span className="mt-0.5 block text-[12px] leading-snug text-[var(--text-muted)]">{subtitulo}</span>}
          </span>
        </button>
        {derecha && <div className="flex shrink-0 items-center gap-1.5">{derecha}</div>}
      </div>
      <div id={id} className="ui-desplegable" data-abierto={abierto}>
        <div>
          <div className={tarjeta ? 'px-3.5 pb-3.5' : 'pb-2'}>{abierto || controlado !== undefined ? children : null}</div>
        </div>
      </div>
    </section>
  );
}

/** Lista que muestra los primeros N y despliega el resto con "Ver todos". */
export function ListaDesplegable<T>({ items, inicial = 5, render, vacio, textoMas = 'Ver todos' }: {
  items: T[]; inicial?: number; render: (item: T, i: number) => React.ReactNode; vacio?: React.ReactNode; textoMas?: string;
}) {
  const [todos, setTodos] = useState(false);
  if (!items.length) return <>{vacio ?? null}</>;
  const visibles = todos ? items : items.slice(0, inicial);
  return (
    <>
      {visibles.map(render)}
      {items.length > inicial && (
        <button type="button" onClick={() => setTodos((v) => !v)}
          className="ui-foco mt-1 w-full rounded-lg py-2 text-center text-[12px] font-medium text-[var(--series-1)] hover:bg-[var(--page-plane)]">
          {todos ? 'Ver menos' : `${textoMas} (${items.length})`}
        </button>
      )}
    </>
  );
}
