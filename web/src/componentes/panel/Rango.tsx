import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Girando, ItemMenu, Menu, useEsMovil } from '../../ui';

// Período del Panel: 7 días · Este mes · 90 días · Todo. Se guarda en la URL
// (?rango=mes: recargar o compartir el link lo mantiene) y en este navegador
// (ir al Chat y volver no lo resetea). "Este mes" se compara con el mismo
// tramo del mes pasado (1 al 20 contra 1 al 20), no con 20 días cualquiera.

export type RangoPanel = '7' | 'mes' | '90' | 'todo';

export const OPCIONES_RANGO: Array<{ valor: RangoPanel; etiqueta: string }> = [
  { valor: '7', etiqueta: '7 días' },
  { valor: 'mes', etiqueta: 'Este mes' },
  { valor: '90', etiqueta: '90 días' },
  { valor: 'todo', etiqueta: 'Todo' },
];

const CLAVE = 'infocrm_panel_rango';
const esRango = (v: unknown): v is RangoPanel => v === '7' || v === 'mes' || v === '90' || v === 'todo';

function leerGuardado(): RangoPanel | null {
  try {
    const v = localStorage.getItem(CLAVE);
    return esRango(v) ? v : null;
  } catch { return null; }
}

export const etiquetaRango = (r: RangoPanel) => OPCIONES_RANGO.find((o) => o.valor === r)?.etiqueta ?? r;

/** Fechas que se piden al servidor para cada período, y cómo se dice en palabras. */
export function fechasDeRango(rango: RangoPanel, ahora: number) {
  const p = new URLSearchParams();
  p.set('granularidad', 'auto');
  let comparacion: string | null = null;
  let texto = 'desde el principio';
  if (rango === '7' || rango === '90') {
    const dias = Number(rango);
    p.set('desde', new Date(ahora - dias * 86_400_000).toISOString());
    comparacion = `los ${dias} días anteriores`;
    texto = `en los últimos ${dias} días`;
  } else if (rango === 'mes') {
    const d = new Date(ahora);
    const ini = new Date(d.getFullYear(), d.getMonth(), 1);
    const iniAnt = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const finAnt = new Date(Math.min(iniAnt.getTime() + (ahora - ini.getTime()), ini.getTime()));
    p.set('desde', ini.toISOString());
    p.set('anterior_desde', iniAnt.toISOString());
    p.set('anterior_hasta', finAnt.toISOString());
    const mesAnt = iniAnt.toLocaleDateString('es-ES', { month: 'long' });
    const ultimoDia = Math.max(1, new Date(finAnt.getTime() - 1).getDate());
    comparacion = `el mismo tramo de ${mesAnt} (${ultimoDia <= 1 ? 'el 1' : `del 1 al ${ultimoDia}`})`;
    texto = 'en lo que va del mes';
  }
  return { params: p.toString(), comparacion, texto };
}

export function usarRangoPanel() {
  const [params, setParams] = useSearchParams();
  const enUrl = params.get('rango');
  const rango: RangoPanel = esRango(enUrl) ? enUrl : (leerGuardado() ?? 'mes');
  // "Ahora" de las fechas: queda fijo (para no pedir de nuevo en cada render)
  // y se renueva al cambiar de período o al tocar "Actualizar".
  const [ahora, setAhora] = useState(() => Date.now());

  const setRango = useCallback((r: RangoPanel) => {
    try { localStorage.setItem(CLAVE, r); } catch { /* sin almacenamiento */ }
    setAhora(Date.now());
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set('rango', r);
      return p;
    }, { replace: true, state: window.history.state?.usr });
  }, [setParams]);

  const renovar = useCallback(() => setAhora(Date.now()), []);
  const fechas = useMemo(() => fechasDeRango(rango, ahora), [rango, ahora]);
  return { rango, setRango, renovar, ...fechas };
}

/**
 * Selector del período. Escritorio: botones segmentados de 36 px. Celular:
 * una pastilla "Este mes ▾" que abre la lista desde abajo (queda siempre a
 * la vista en la barra de arriba).
 */
export function SelectorRango({ rango, onCambiar, cargando }: {
  rango: RangoPanel; onCambiar: (r: RangoPanel) => void; cargando?: boolean;
}) {
  const movil = useEsMovil();
  if (movil) {
    return (
      <Menu titulo="Período" alinear="derecha" ancho={220} disparador={({ abierto, alternar, ref }) => (
        <button ref={ref} type="button" onClick={alternar} aria-haspopup="menu" aria-expanded={abierto}
          aria-label={`Período: ${etiquetaRango(rango)}. Cambiar`}
          className="ui-foco inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3.5 text-[13px] font-medium">
          {cargando && <Girando tam={13} />}
          {etiquetaRango(rango)}
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden className={`transition-transform ${abierto ? 'rotate-180' : ''}`}>
            <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}>
        {OPCIONES_RANGO.map((o) => (
          <ItemMenu key={o.valor} activo={o.valor === rango} onClick={() => onCambiar(o.valor)}>{o.etiqueta}</ItemMenu>
        ))}
      </Menu>
    );
  }
  // Teclado: flechas para moverse entre los períodos (patrón de grupo de radios).
  function tecla(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = OPCIONES_RANGO.findIndex((o) => o.valor === rango);
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const grupo = e.currentTarget;
    const sig = OPCIONES_RANGO[(i + d + OPCIONES_RANGO.length) % OPCIONES_RANGO.length];
    onCambiar(sig.valor);
    window.requestAnimationFrame(() => grupo.querySelector<HTMLButtonElement>(`[data-rango="${sig.valor}"]`)?.focus());
  }
  return (
    <div role="radiogroup" aria-label="Período" onKeyDown={tecla} className="flex shrink-0 items-center gap-0.5 rounded-lg p-0.5"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border-hairline)' }}>
      {OPCIONES_RANGO.map((o) => {
        const activo = o.valor === rango;
        return (
          <button key={o.valor} type="button" role="radio" aria-checked={activo} onClick={() => onCambiar(o.valor)}
            data-rango={o.valor} tabIndex={activo ? 0 : -1}
            className={`ui-foco inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] transition-colors ${activo
              ? 'bg-[var(--page-plane)] font-semibold text-[var(--text-primary)] shadow-sm'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
            {activo && cargando && <Girando tam={12} />}
            {o.etiqueta}
          </button>
        );
      })}
    </div>
  );
}
