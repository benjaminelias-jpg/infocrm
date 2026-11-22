import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fmtDinero, fmtNum, fmtPct, fmtFecha, plural } from '../../api';
import {
  Ayuda, Boton, Chip, Dialogo, FilaChips, Insignia, TablaResponsiva, Vacio, useEsMovil, type Columna,
} from '../../ui';
import { useAncho } from '../Graficas';
import { IconoPanel } from './iconos';
import { ROL_CONTENIDO, TIPO_CONTENIDO } from './textos';
import type { FilaContenido } from './tipos';

// "Contenido que más factura": se puede reordenar sin salir (más factura ·
// más leads · mejor conversión). En el celular son tarjetas (nada de tablas
// que esconden la plata a la derecha) y se ven 3 + "Ver los 5". Tocar una
// fila abre el detalle del contenido (y Atrás lo cierra).

type Orden = 'factura' | 'leads' | 'conversion';
const TITULOS: Record<Orden, string> = {
  factura: 'Contenido que más factura',
  leads: 'Contenido que más leads trae',
  conversion: 'Contenido que mejor convierte',
};

/** Un valor de la URL que se abre "encima" (Atrás lo cierra), como la ficha del lead. */
export function useApilado(clave: string) {
  const [params, setParams] = useSearchParams();
  const valor = params.get(clave);
  const marca = `apilado_${clave}`;
  const abrir = useCallback((v: string) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set(clave, v);
      return p;
    }, { replace: Boolean(new URLSearchParams(window.location.search).get(clave)), state: { [marca]: true } });
  }, [clave, marca, setParams]);
  const cerrar = useCallback(() => {
    if ((window.history.state as any)?.usr?.[marca]) { window.history.back(); return; }
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.delete(clave);
      return p;
    }, { replace: true });
  }, [clave, marca, setParams]);
  return { valor, abrir, cerrar };
}

/** Insignia del rol, solo si el contenido tiene datos suficientes (10 leads en 90 días). */
export function InsigniaRol({ c }: { c: FilaContenido }) {
  const rol = c.rol_90d ?? c.rol;
  if (!rol || !ROL_CONTENIDO[rol] || (c.leads_90d ?? c.leads) < 10) return null;
  return <Insignia tono={ROL_CONTENIDO[rol].tono}>{ROL_CONTENIDO[rol].etiqueta}</Insignia>;
}

function metaContenido(c: FilaContenido) {
  const tipo = TIPO_CONTENIDO[c.tipo] ?? 'Contenido';
  const vistas = Number(c.ig_reproducciones ?? 0) || Number(c.ig_alcance ?? 0);
  return `${tipo}${vistas ? ` · ${fmtNum(vistas)} ${c.ig_reproducciones ? 'vistas' : 'de alcance'}` : ''}`;
}

export function MejorContenido({ contenidos, texto, onAbrir, cargando }: {
  contenidos: FilaContenido[]; texto: string; onAbrir: (c: FilaContenido) => void; cargando?: boolean;
}) {
  const movil = useEsMovil(768);
  const { ref, ancho } = useAncho<HTMLDivElement>();
  // Tarjeta angosta (tablet, laptop de 1280 con la columna de al lado): quedan
  // las columnas clave para que Ingresos nunca quede escondido a la derecha.
  const angosto = !movil && ancho > 0 && ancho < 700;
  const [orden, setOrden] = useState<Orden | null>(null);
  const [todos, setTodos] = useState(false);
  const conIngresos = contenidos.filter((c) => c.id && c.ingresos > 0).length;
  const hayLeads = contenidos.some((c) => c.id && c.leads > 0);
  const automatico = orden === null && conIngresos < 3;
  const efectivo: Orden = orden ?? (conIngresos >= 3 ? 'factura' : 'leads');

  const filas = useMemo(() => {
    const base = contenidos.filter((c) => c.id);
    const lista = efectivo === 'factura'
      ? base.filter((c) => c.ingresos > 0).sort((a, b) => b.ingresos - a.ingresos || b.leads - a.leads)
      : efectivo === 'leads'
        ? base.filter((c) => c.leads > 0).sort((a, b) => b.leads - a.leads || b.ingresos - a.ingresos)
        : base.filter((c) => c.leads >= 10).sort((a, b) => b.tasa_lead_venta - a.tasa_lead_venta || b.ingresos - a.ingresos);
    return lista.slice(0, 5);
  }, [contenidos, efectivo]);
  const visibles = movil && !todos ? filas.slice(0, 3) : filas;

  // Columnas de ancho fijo (el título se corta con "…"): la plata, a la derecha,
  // nunca queda cortada. En el celular, la tarjeta muestra lo que manda el orden.
  const todas: Array<Columna<FilaContenido>> = [
    {
      clave: 'contenido', titulo: 'Contenido', enMovil: 'titulo',
      render: (c) => (
        <span className="flex min-w-0 items-center gap-2.5">
          {c.thumbnail_url && <img src={c.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-8 w-8 shrink-0 rounded-md object-cover" />}
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              {movil ? (
                <span className="min-w-0 max-w-[60vw] truncate font-medium">{c.titulo}</span>
              ) : (
                // En la tabla la fila se toca con el mouse; con el teclado, este botón.
                <button type="button" onClick={(e) => { e.stopPropagation(); onAbrir(c); }}
                  className="ui-foco min-w-0 truncate rounded text-left font-medium hover:underline">{c.titulo}</button>
              )}
              <span className="shrink-0"><InsigniaRol c={c} /></span>
            </span>
            <span className="block truncate text-[12px] font-normal text-[var(--text-secondary)]">
              {movil
                ? `${TIPO_CONTENIDO[c.tipo] ?? 'Contenido'} · ${plural(c.leads, 'lead', 'leads')} · ${plural(c.ventas, 'venta', 'ventas')}${efectivo === 'conversion' && c.leads > 0 ? ` · ${fmtPct(c.tasa_lead_venta)} compra` : ''}`
                : `${metaContenido(c)}${angosto && efectivo === 'conversion' ? ` · ${plural(c.ventas, 'venta', 'ventas')}` : ''}`}
            </span>
          </span>
        </span>
      ),
    },
    // En el celular, leads y ventas van en la segunda línea de la tarjeta (más compacto).
    { clave: 'leads', titulo: 'Leads', alinear: 'der', ancho: '72px', enMovil: 'ocultar', render: (c) => fmtNum(c.leads) },
    efectivo === 'conversion'
      ? { clave: 'compran', titulo: 'Compran', alinear: 'der', ancho: '96px', enMovil: 'ocultar', render: (c) => (c.leads > 0 ? fmtPct(c.tasa_lead_venta) : '—') }
      : { clave: 'reuniones', titulo: 'Reuniones', alinear: 'der', ancho: '104px', enMovil: 'ocultar', render: (c) => fmtNum(c.reuniones_agendadas) },
    { clave: 'ventas', titulo: 'Ventas', alinear: 'der', ancho: '76px', enMovil: 'ocultar', render: (c) => fmtNum(c.ventas) },
    { clave: 'ingresos', titulo: 'Ingresos', alinear: 'der', ancho: '112px', enMovil: 'esquina', render: (c) => <b className="font-semibold">{fmtDinero(c.ingresos)}</b> },
  ];
  const sobran = efectivo === 'conversion' ? ['ventas'] : ['reuniones'];
  const columnas = angosto ? todas.filter((c) => !sobran.includes(c.clave)) : todas;

  return (
    <section className={`min-w-0 transition-opacity ${cargando ? 'opacity-60' : ''}`} aria-labelledby="titulo-contenido">
      <div className="mb-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 id="titulo-contenido" className="truncate text-[15px] font-semibold">{TITULOS[efectivo]}</h2>
            <Ayuda titulo="De qué contenido vienen">
              Cada lead se cuenta en el reel o la publicación que lo trajo, con todo lo que compró después. La etiqueta
              (por ejemplo «Caballo de batalla») dice qué trabajo hace ese contenido, según los últimos 90 días; aparece
              cuando ya trajo al menos 10 leads.
            </Ayuda>
          </div>
          <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">Los leads que entraron {texto}</p>
        </div>
        <Link to="/contenidos" className="ui-foco inline-flex h-10 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium text-[var(--series-1)] hover:bg-[var(--surface-1)] md:h-9">
          Ver todos <IconoPanel nombre="flecha" tam={13} />
        </Link>
      </div>
      {/* Sin ningún lead en el período no hay nada que ordenar: los chips sobran. */}
      {(hayLeads || orden !== null) && (
        <FilaChips className="mb-2.5">
          {(['factura', 'leads', 'conversion'] as Orden[]).map((o) => (
            <Chip key={o} activo={efectivo === o} onClick={() => { setOrden(o); setTodos(false); }}>
              {o === 'factura' ? 'Más factura' : o === 'leads' ? 'Más leads' : 'Mejor conversión'}
            </Chip>
          ))}
        </FilaChips>
      )}
      {automatico && filas.length > 0 && (
        <p className="mb-2 text-[12px] text-[var(--text-secondary)]">
          {conIngresos === 0 ? 'Todavía no hubo ventas atribuidas a un contenido' : 'Casi no hubo ventas atribuidas a un contenido'} {texto}: te mostramos los que más leads trajeron.
        </p>
      )}
      <div ref={ref} className="md:[&_table]:table-fixed">
        <TablaResponsiva<FilaContenido> columnas={columnas} filas={visibles} clave={(c) => c.id ?? c.titulo} onFila={onAbrir}
          vacio={(
            <div className="tarjeta">
              <Vacio compacto icono={<IconoPanel nombre="mudo" tam={20} />}
                titulo={efectivo === 'factura' ? `Sin ventas atribuidas ${texto}` : efectivo === 'leads' ? `Ningún contenido trajo leads ${texto}` : 'Todavía no hay con qué comparar'}
                texto={efectivo === 'conversion' ? 'Hace falta que algún contenido traiga al menos 10 leads.' : 'Cuando tu contenido traiga leads, acá vas a ver cuál rinde más.'} />
            </div>
          )} />
      </div>
      {movil && filas.length > 3 && (
        <Boton variante="fantasma" anchoCompleto className="mt-1.5 !text-[var(--series-1)]" onClick={() => setTodos((v) => !v)}>
          {todos ? 'Ver menos' : `Ver los ${filas.length}`}
        </Boton>
      )}
    </section>
  );
}

/** Detalle de un contenido: todos sus números, qué rol cumple y el link a Instagram. */
export function DetalleContenido({ contenido, onCerrar }: { contenido: FilaContenido | null; onCerrar: () => void }) {
  const c = contenido;
  const rol = c ? (c.rol_90d ?? c.rol) : null;
  const info = rol && c && (c.leads_90d ?? c.leads) >= 10 ? ROL_CONTENIDO[rol] : null;
  const datos: Array<[string, string]> = c ? [
    ['Leads', fmtNum(c.leads)],
    ['Reuniones', fmtNum(c.reuniones_agendadas)],
    ['Ventas', fmtNum(c.ventas)],
    ['Ingresos', fmtDinero(c.ingresos)],
    ['Compran', c.leads > 0 ? fmtPct(c.tasa_lead_venta) : '—'],
    ['Valor por lead', fmtDinero(c.valor_por_lead)],
  ] : [];
  return (
    <Dialogo abierto={Boolean(c)} onCerrar={onCerrar} titulo={c?.titulo} autoFoco={false}
      descripcion={c ? `${metaContenido(c)}${c.publicado_en ? ` · publicado el ${fmtFecha(c.publicado_en)}` : ''}` : undefined}
      pie={c ? (
        <>
          <Link to="/contenidos" className="ui-foco inline-flex h-10 items-center rounded-lg px-3 text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--page-plane)] md:h-9">
            Ver todo el contenido
          </Link>
          {c.permalink && (
            <a href={c.permalink} target="_blank" rel="noreferrer"
              className="ui-foco inline-flex h-10 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium text-white hover:brightness-110 md:h-9"
              style={{ background: 'var(--series-1)' }}>
              <IconoPanel nombre="externo" tam={14} /> Ver en Instagram
            </a>
          )}
        </>
      ) : undefined}>
      {c && (
        <div className="space-y-3 pb-1">
          {info && (
            <div className="rounded-lg px-3 py-2.5" style={{ background: 'var(--page-plane)' }}>
              <div className="flex items-center gap-2"><Insignia tono={info.tono}>{info.etiqueta}</Insignia>
                <span className="text-[11px] text-[var(--text-secondary)]">según los últimos 90 días</span></div>
              <p className="mt-1 text-[12.5px] leading-snug text-[var(--text-secondary)]">{info.ayuda}</p>
            </div>
          )}
          <dl className="grid grid-cols-3 gap-x-3 gap-y-2.5" aria-label="Leads que entraron en el período elegido y lo que compraron después">
            {datos.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-[11px] text-[var(--text-secondary)]">{k}</dt>
                <dd className="text-[15px] font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Dialogo>
  );
}
