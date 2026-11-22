import { Fragment } from 'react';
import { ItemMenu, Menu, SeparadorMenu } from '../../ui';
import { ANGULO, ANGULOS, PARTE_EMBUDO } from './textos';

// El ángulo de un contenido se elige tocando su insignia: un menú con los
// ángulos agrupados por lo que hacen (Atrae / Educa / Vende / Siempre suma),
// cada uno con una línea que lo explica. En el celular sale como hoja.

const GRUPOS: Array<{ embudo: string; titulo: string }> = [
  { embudo: 'TOFU', titulo: 'Atrae gente nueva' },
  { embudo: 'MOFU', titulo: 'Educa' },
  { embudo: 'BOFU', titulo: 'Vende' },
  { embudo: 'transversal', titulo: 'Siempre suma' },
];

export function textoAngulo(angulo?: string | null) {
  const a = angulo ? ANGULO[angulo] : null;
  if (!a) return null;
  const parte = PARTE_EMBUDO[a.embudo];
  return a.embudo === 'transversal' ? a.etiqueta : `${a.etiqueta} · ${parte.etiqueta}`;
}

export default function MenuAngulo({ angulo, onElegir, compacto }: {
  angulo?: string | null; onElegir: (angulo: string | null) => void; compacto?: boolean;
}) {
  const a = angulo ? ANGULO[angulo] : null;
  const parte = a ? PARTE_EMBUDO[a.embudo] : null;
  return (
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="inline-flex">
      <Menu titulo="¿Qué tipo de contenido es?" ancho={300} disparador={({ alternar, abierto, ref }) => (
        <button ref={ref} type="button" onClick={alternar} aria-haspopup="menu" aria-expanded={abierto}
          aria-label={a ? `Ángulo: ${textoAngulo(angulo)}. Cambiar` : 'Elegir el ángulo de este contenido'}
          className={`ui-foco inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[11px] font-medium ${compacto ? 'h-6' : 'h-7'} ${a ? '' : 'border border-dashed'}`}
          style={a
            ? { background: `color-mix(in srgb, ${parte!.color} 13%, transparent)`, color: `color-mix(in srgb, ${parte!.color} 70%, var(--text-primary))` }
            : { borderColor: 'var(--baseline)', color: 'var(--text-secondary)' }}>
          {a ? textoAngulo(angulo) : '+ Elegí el ángulo'}
          <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden className="shrink-0 opacity-70">
            <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}>
        {GRUPOS.map((g, i) => (
          <Fragment key={g.embudo}>
            {i > 0 && <SeparadorMenu />}
            <div className="px-2.5 pb-0.5 pt-1 text-[11px] font-semibold" style={{ color: PARTE_EMBUDO[g.embudo].color }}>{g.titulo}</div>
            {ANGULOS.filter((x) => x.embudo === g.embudo).map((x) => (
              <ItemMenu key={x.valor} activo={x.valor === angulo} descripcion={x.descripcion} onClick={() => onElegir(x.valor)}>{x.etiqueta}</ItemMenu>
            ))}
          </Fragment>
        ))}
        {a && (
          <>
            <SeparadorMenu />
            <ItemMenu onClick={() => onElegir(null)}>Quitar el ángulo</ItemMenu>
          </>
        )}
      </Menu>
    </span>
  );
}
