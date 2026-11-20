import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtDinero } from '../../api';
import {
  BotonConfirmar, BotonIcono, Boton, Buscador, Desplegable, Dialogo, ItemMenu, Menu, SeparadorMenu, Vacio, useEsMovil,
} from '../../ui';
import { IconoChat } from './iconos';
import { GRUPOS, grupoDe, ICONO_RECURSO, urlCorta } from './recursos';
import { guardarPreferencia, leerPreferencia } from './util';
import type { ProductoPago, Recurso } from './tipos';

// Atajos del setter: los audios del founder, las respuestas rápidas, los
// enlaces y los links de pago, en ese orden (dentro de cada grupo, el orden
// del founder). Una sola fila que se desliza; "+" para crear uno ahí mismo;
// la hoja "Atajos" (con buscador) y "/" en la caja para buscarlos escribiendo.

export type ItemAtajo =
  | { clase: 'recurso'; id: string; nombre: string; recurso: Recurso }
  | { clase: 'pago'; id: string; nombre: string; producto: ProductoPago };

export type TipoNuevo = 'audio' | 'texto' | 'link' | 'archivo';

export function armarAtajos(recursos: Recurso[], productos: ProductoPago[]): ItemAtajo[] {
  const r: ItemAtajo[] = GRUPOS.flatMap((g) => recursos.filter((x) => grupoDe(x) === g.id))
    .map((x) => ({ clase: 'recurso' as const, id: x.id, nombre: x.nombre, recurso: x }));
  const p: ItemAtajo[] = productos.filter((x) => x.link_pago)
    .map((x) => ({ clase: 'pago' as const, id: `pago-${x.id}`, nombre: x.nombre, producto: x }));
  return [...r, ...p];
}

export const precioDe = (p: ProductoPago) => (Number(p.precio_lista) > 0 ? fmtDinero(Number(p.precio_lista), p.moneda || undefined) : '');
export const textoPago = (p: ProductoPago) => `${p.nombre}${precioDe(p) ? ` — ${precioDe(p)}` : ''}\n${p.link_pago}`;
export const esRapida = (i: ItemAtajo) => i.clase === 'recurso' && i.recurso.tipo === 'texto';

function iconoDe(i: ItemAtajo) {
  return i.clase === 'pago' ? '💳' : ICONO_RECURSO[i.recurso.tipo] ?? '📎';
}

/** Vista previa corta de un atajo (texto, URL o precio). */
export function previaDe(i: ItemAtajo) {
  if (i.clase === 'pago') return [precioDe(i.producto), urlCorta(i.producto.link_pago)].filter(Boolean).join(' · ');
  const r = i.recurso;
  if (r.tipo === 'texto') return r.texto ?? '';
  if (r.tipo === 'link') return urlCorta(r.url);
  if (r.tipo === 'audio') return 'Nota de voz';
  return r.tipo === 'pdf' ? 'PDF' : r.tipo === 'imagen' ? 'Imagen' : 'Video';
}

export function filtrarAtajos(items: ItemAtajo[], q: string) {
  const t = q.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!t) return items;
  const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return items.filter((i) => norm(i.nombre).includes(t) || (i.clase === 'recurso' && norm(i.recurso.texto).includes(t)));
}

// ---------------------------------------------------------------------
// Menú "+" (crear un atajo ahí mismo)
// ---------------------------------------------------------------------

export function MenuCrearAtajo({ onCrear, disparador }: {
  onCrear: (t: TipoNuevo) => void;
  disparador: (p: { abierto: boolean; alternar: () => void }) => React.ReactNode;
}) {
  return (
    <Menu titulo="Nuevo atajo" ancho={250} disparador={disparador}>
      <ItemMenu icono="🎙️" onClick={() => onCrear('audio')} descripcion="Le llega como nota de voz">Grabar un audio</ItemMenu>
      <ItemMenu icono="⚡" onClick={() => onCrear('texto')} descripcion="Se pega para editarlo">Respuesta rápida</ItemMenu>
      <ItemMenu icono="🔗" onClick={() => onCrear('link')} descripcion="Calendario, curso, formulario…">Enlace</ItemMenu>
      <ItemMenu icono="📄" onClick={() => onCrear('archivo')} descripcion="PDF, imagen o video">Subir un archivo</ItemMenu>
    </Menu>
  );
}

// ---------------------------------------------------------------------
// Fila de atajos (arriba de la caja)
// ---------------------------------------------------------------------

export function FilaAtajos({ items, ocupado, onUsar, onCrear, onGestionar }: {
  items: ItemAtajo[]; ocupado?: boolean;
  onUsar: (i: ItemAtajo) => void; onCrear: (t: TipoNuevo) => void; onGestionar: () => void;
}) {
  const movil = useEsMovil();
  const [plegada, setPlegada] = useState(() => leerPreferencia('atajos_plegados', '0') === '1');
  const [armado, setArmado] = useState<string | null>(null);
  const reloj = useRef<number | null>(null);
  useEffect(() => () => { if (reloj.current) window.clearTimeout(reloj.current); }, []);

  function plegar(v: boolean) { setPlegada(v); guardarPreferencia('atajos_plegados', v ? '1' : '0'); }

  function tocar(i: ItemAtajo) {
    if (i.clase === 'pago' && armado !== i.id) {
      // Un link de pago se confirma en el mismo chip (no se puede borrar en Instagram).
      setArmado(i.id);
      if (reloj.current) window.clearTimeout(reloj.current);
      reloj.current = window.setTimeout(() => setArmado(null), 4000);
      return;
    }
    setArmado(null);
    onUsar(i);
  }

  if (movil && plegada) {
    return (
      <div className="flex items-center px-2 pt-1.5">
        <button type="button" onClick={() => plegar(false)} aria-expanded={false}
          className="ui-foco inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface-1)]">
          <IconoChat nombre="rayo" tam={14} /> Atajos ({items.length}) <IconoChat nombre="chevronArriba" tam={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-1 pl-1.5 pt-1.5 md:pl-3">
      {movil && (
        <BotonIcono etiqueta="Plegar atajos" tamano="xs" onClick={() => plegar(true)} aria-expanded>
          <IconoChat nombre="chevronAbajo" tam={15} />
        </BotonIcono>
      )}
      <div data-no-deslizar className="sin-barra md:barra-fina flex min-w-0 flex-1 snap-x items-center gap-1.5 overflow-x-auto pb-1 pr-3 md:pb-1.5"
        role="toolbar" aria-label="Atajos">
        {items.map((i) => {
          const rapida = esRapida(i);
          const confirmando = armado === i.id;
          return (
            <button key={i.id} type="button" disabled={ocupado} onClick={() => tocar(i)}
              title={rapida ? 'Se pega en el mensaje para que lo edites' : i.clase === 'pago' ? 'Link de pago: se confirma con un segundo toque' : 'Sale con un toque (tenés unos segundos para deshacerlo)'}
              className={`ui-foco inline-flex h-8 shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12px] transition-colors disabled:opacity-50 ${confirmando ? 'font-semibold text-white' : 'border border-[var(--border-hairline)] hover:bg-[var(--surface-1)]'}`}
              style={confirmando ? { background: 'var(--status-good)' } : i.clase === 'pago' ? { color: 'var(--status-good)' } : undefined}>
              <span aria-hidden>{iconoDe(i)}</span>
              {confirmando ? `¿Mandar ${i.nombre}${precioDe((i as any).producto) ? ` (${precioDe((i as any).producto)})` : ''}? Tocá de nuevo` : i.nombre}
            </button>
          );
        })}
        <MenuCrearAtajo onCrear={onCrear} disparador={({ alternar, abierto }) => (
          <button type="button" onClick={alternar} aria-expanded={abierto} aria-label="Crear un atajo" title="Crear un atajo"
            className="ui-foco inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-[var(--baseline)] text-[var(--text-secondary)] hover:bg-[var(--surface-1)]">
            <IconoChat nombre="mas" tam={15} />
          </button>
        )} />
        <button type="button" onClick={onGestionar} aria-label="Ordenar y editar atajos" title="Ordenar y editar atajos"
          className="ui-foco inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--surface-1)]">
          <IconoChat nombre="ajustes" tam={15} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Hoja "Atajos" (con buscador y vista previa)
// ---------------------------------------------------------------------

function FilaItem({ i, onUsar }: { i: ItemAtajo; onUsar: (i: ItemAtajo) => void }) {
  const rapida = esRapida(i);
  return (
    <div className="flex items-start gap-2.5 rounded-xl px-2 py-2 hover:bg-[var(--page-plane)]">
      <span className="mt-0.5 text-[18px]" aria-hidden>{iconoDe(i)}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium md:text-[13px]">{i.nombre}</div>
        {i.clase === 'recurso' && i.recurso.tipo === 'audio' && i.recurso.url_publica
          ? <audio controls preload="none" src={i.recurso.url_publica} className="mt-1 h-8 w-full max-w-[260px]" />
          : <div className={`text-[12px] text-[var(--text-muted)] ${rapida ? 'line-clamp-2' : 'truncate'}`}>{previaDe(i)}</div>}
      </div>
      {i.clase === 'pago'
        ? <BotonConfirmar variante="primario" tamano="sm" confirmar="¿Mandar? Tocá de nuevo" onConfirmar={() => onUsar(i)}>Mandar</BotonConfirmar>
        : <Boton tamano="sm" variante={rapida ? 'secundario' : 'primario'} onClick={() => onUsar(i)}>{rapida ? 'Pegar' : 'Mandar'}</Boton>}
    </div>
  );
}

export function PaletaAtajos({ abierto, onCerrar, items, onUsar, onCrear, onGestionar }: {
  abierto: boolean; onCerrar: () => void; items: ItemAtajo[];
  onUsar: (i: ItemAtajo) => void; onCrear: (t: TipoNuevo) => void; onGestionar: () => void;
}) {
  const movil = useEsMovil();
  const [q, setQ] = useState('');
  useEffect(() => { if (!abierto) setQ(''); }, [abierto]);
  const filtrados = useMemo(() => filtrarAtajos(items, q), [items, q]);
  const usar = (i: ItemAtajo) => { onCerrar(); onUsar(i); };
  const grupos = [
    ...GRUPOS.map((g) => ({ id: g.id, titulo: `${g.icono} ${g.titulo}`, items: filtrados.filter((i) => i.clase === 'recurso' && grupoDe(i.recurso) === g.id) })),
    { id: 'pagos', titulo: '💳 Links de pago', items: filtrados.filter((i) => i.clase === 'pago') },
  ].filter((g) => g.items.length);

  return (
    <Dialogo abierto={abierto} onCerrar={onCerrar} titulo="Atajos" ancho={520} autoFoco={!movil}
      descripcion="Los audios y enlaces salen con un toque (tenés unos segundos para deshacer). Las respuestas rápidas se pegan para editarlas."
      pie={<>
        <Boton variante="fantasma" tamano="sm" icono={<IconoChat nombre="ajustes" tam={14} />} onClick={() => { onCerrar(); onGestionar(); }}>Ordenar y editar</Boton>
        <MenuCrearAtajo onCrear={(t) => { onCerrar(); onCrear(t); }} disparador={({ alternar, abierto: a }) => (
          <Boton tamano="sm" variante="primario" onClick={alternar} aria-expanded={a} icono={<IconoChat nombre="mas" tam={14} />}>Nuevo atajo</Boton>
        )} />
      </>}>
      <div className="space-y-2">
        {items.length > 6 && <Buscador valor={q} onCambiar={setQ} placeholder="Buscar un atajo" />}
        {!items.length && (
          <Vacio compacto icono="🎙️" titulo="Todavía no hay atajos"
            texto="Grabá el audio de bienvenida del founder o guardá tus respuestas rápidas: después salen con un toque." />
        )}
        {items.length > 0 && !filtrados.length && <Vacio compacto icono="🔎" titulo={`Ningún atajo con «${q}»`} />}
        {q.trim()
          ? filtrados.map((i) => <FilaItem key={i.id} i={i} onUsar={usar} />)
          : grupos.map((g) => (
            <Desplegable key={g.id} tarjeta={false} abiertoInicial clave={`chat-paleta-${g.id}`} titulo={g.titulo}
              subtitulo={g.items.length === 1 ? '1 atajo' : `${g.items.length} atajos`}>
              <div className="space-y-0.5">{g.items.map((i) => <FilaItem key={i.id} i={i} onUsar={usar} />)}</div>
            </Desplegable>
          ))}
      </div>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------
// "/" en la caja: lista filtrada encima del mensaje
// ---------------------------------------------------------------------

export function BarraAtajos({ items, indice, armado, onElegir, onIndice }: {
  items: ItemAtajo[]; indice: number; armado: string | null;
  onElegir: (i: ItemAtajo) => void; onIndice: (i: number) => void;
}) {
  const lista = useRef<HTMLDivElement>(null);
  useEffect(() => {
    lista.current?.querySelector<HTMLElement>(`[data-i="${indice}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [indice]);
  return (
    <div ref={lista} role="listbox" aria-label="Atajos" id="chat-barra-atajos"
      className="ui-aparecer absolute inset-x-0 bottom-full z-20 mb-1.5 max-h-60 overflow-y-auto rounded-xl p-1 shadow-xl"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border-hairline)' }}>
      {!items.length && <div className="px-3 py-2.5 text-[12px] text-[var(--text-muted)]">Ningún atajo con ese nombre. Seguí escribiendo o borrá la «/».</div>}
      {items.map((i, n) => (
        <button key={i.id} type="button" role="option" aria-selected={n === indice} data-i={n}
          onMouseDown={(e) => e.preventDefault()} onClick={() => onElegir(i)} onMouseEnter={() => onIndice(n)}
          className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${n === indice ? 'bg-[var(--page-plane)]' : ''}`}>
          <span className="text-[16px]" aria-hidden>{iconoDe(i)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{i.nombre}</span>
            <span className="block truncate text-[11px] text-[var(--text-muted)]">{previaDe(i)}</span>
          </span>
          <span className="shrink-0 text-[11px] font-medium" style={{ color: armado === i.id ? 'var(--status-good)' : 'var(--text-muted)' }}>
            {armado === i.id ? 'Enter de nuevo para mandar' : esRapida(i) ? 'Pegar' : 'Mandar'}
          </span>
        </button>
      ))}
      <SeparadorLeve />
      <div className="px-2.5 pb-1 pt-1.5 text-[10px] text-[var(--text-muted)]">↑ ↓ para elegir · Enter para usar · Esc para cerrar</div>
    </div>
  );
}

function SeparadorLeve() {
  return <div className="mx-2 mt-1 h-px" style={{ background: 'var(--border-hairline)' }} aria-hidden />;
}

export { SeparadorMenu };
