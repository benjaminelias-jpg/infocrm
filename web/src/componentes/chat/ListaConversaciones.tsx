import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  BotonIcono, Boton, Buscador, Chip, Desplegable, ErrorCarga, Esqueleto, FilaChips, Vacio, Menu, ItemMenu, SeparadorMenu, useAviso,
} from '../../ui';
import { api, fmtNum } from '../../api';
import { FilaConversacion, type AccionesFila } from './FilaConversacion';
import { IconoChat } from './iconos';
import { useBandeja, type Bandeja } from './useBandeja';
import { leerBorrador, suscribirBorradores } from './util';
import type { Conteos, Conversacion, FiltroChat } from './tipos';

// Columna de conversaciones: buscador (en el servidor, en TODOS los leads),
// filtros con contador que se deslizan en el celular, la lista que carga más
// al llegar al final y, plegado al fondo, quienes todavía no escribieron.

const FILTROS: Array<{ id: FiltroChat; texto: string; siempre?: boolean }> = [
  { id: 'por_responder', texto: 'Por responder', siempre: true },
  { id: 'sin_leer', texto: 'Sin leer', siempre: true },
  { id: 'mios', texto: 'Míos', siempre: true },
  { id: 'todos', texto: 'Todas', siempre: true },
  { id: 'se_cierra', texto: '⏳ Se cierra pronto' },
  { id: 'automensaje', texto: 'En automensaje' },
  { id: 'archivados', texto: 'Archivadas' },
];

const VACIOS: Record<FiltroChat, { icono: string; titulo: string; texto: string }> = {
  por_responder: { icono: '🎉', titulo: 'Estás al día', texto: 'Nadie espera tu respuesta ahora. Cuando un lead te escriba, aparece acá.' },
  sin_leer: { icono: '✓', titulo: 'No tenés mensajes sin leer', texto: 'Los mensajes nuevos de tus leads aparecen acá.' },
  mios: { icono: '👤', titulo: 'Todavía no tenés conversaciones asignadas', texto: 'Asignate un lead desde su chat (👤) o deslizando la fila.' },
  todos: { icono: '💬', titulo: 'Todavía no hay conversaciones', texto: 'Cuando un lead te escriba o comente, aparece acá.' },
  se_cierra: { icono: '⏳', titulo: 'Ninguna ventana se cierra pronto', texto: 'Acá ves a quién le quedan menos de 4 h para que le puedas responder por Instagram.' },
  automensaje: { icono: '🤖', titulo: 'Nadie está en un automensaje ahora', texto: 'Acá ves a quién le está esperando la respuesta un automensaje.' },
  sin_conversacion: { icono: '💬', titulo: 'Todos tus leads ya tienen conversación', texto: '' },
  archivados: { icono: '🗂️', titulo: 'No hay conversaciones archivadas', texto: 'Archivá una conversación deslizándola (o desde su menú ⋯). Vuelve sola si el lead te escribe.' },
};

function useBorradores() {
  // Re-dibuja la lista cuando cambia un borrador (para mostrar "Borrador: …").
  return useSyncExternalStore(suscribirBorradores, versionBorradores);
}
let version = 0;
suscribirBorradores(() => { version++; });
const versionBorradores = () => version;

function FilasEsqueleto({ n = 6 }: { n?: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-[var(--border-hairline)] px-3 py-3">
          <Esqueleto alto={42} ancho={42} className="!rounded-full" />
          <div className="flex-1 space-y-2">
            <Esqueleto alto={12} ancho={`${55 + ((i * 17) % 30)}%`} />
            <Esqueleto alto={10} ancho={`${70 + ((i * 11) % 25)}%`} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ListaConversaciones({
  bandeja, items: itemsProp, filtro, onFiltro, q, onQ, selId, onAbrir, acciones, onRecursos, yoId, resaltarId, arriba, escritorio,
}: {
  bandeja: Bandeja;
  /** Filas a mostrar (por defecto, las de la bandeja). */
  items?: Conversacion[];
  filtro: FiltroChat; onFiltro: (f: FiltroChat) => void;
  q: string; onQ: (q: string) => void; selId: string | null; onAbrir: (id: string) => void;
  acciones: AccionesFila; onRecursos: () => void; yoId: string | null; resaltarId: string | null;
  /** Aviso fijo arriba de la lista (Instagram desconectado, en pantallas chicas). */
  arriba?: React.ReactNode;
  escritorio?: boolean;
}) {
  useBorradores();
  const items = itemsProp ?? bandeja.items;
  const scroller = useRef<HTMLDivElement>(null);
  const centinela = useRef<HTMLDivElement>(null);
  const buscando = q.trim().length > 0;
  const conteos = bandeja.conteos;

  // Más filas al llegar al final.
  useEffect(() => {
    const el = centinela.current;
    if (!el || !bandeja.hayMas) return;
    const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting) bandeja.cargarMas(); },
      { root: scroller.current, rootMargin: '240px' });
    io.observe(el);
    return () => io.disconnect();
  }, [bandeja.hayMas, bandeja.cargarMas, items.length]);

  // Al volver a la lista (celular), la última conversación abierta queda a la vista.
  useEffect(() => {
    if (!resaltarId) return;
    const fila = scroller.current?.querySelector<HTMLElement>(`[data-fila="${resaltarId}"]`);
    fila?.scrollIntoView({ block: 'nearest' });
  }, [resaltarId]);

  const visibles = FILTROS.filter((f) => f.siempre || f.id === filtro || (conteos?.[f.id] ?? 0) > 0);
  const vacio = VACIOS[filtro];

  const aviso = useAviso();
  async function traerDeInstagram() {
    aviso.info('Trayendo tus chats de Instagram…');
    try {
      const r = await api<{ ok: boolean; mensaje: string }>('/instagram/importar-chats', { method: 'POST' });
      (r.ok ? aviso.exito : aviso.error)(r.mensaje);
      bandeja.recargar();
    } catch (e: any) { aviso.error(e?.message ?? 'No pudimos traer tus chats.'); }
  }

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Conversaciones">
      {arriba}
      <div className="space-y-2 border-b border-[var(--border-hairline)] px-3 pb-2.5 pt-3">
        <div className="flex items-center gap-2">
          <Buscador valor={q} onCambiar={onQ} placeholder="Buscar por nombre o @usuario" className="min-w-0 flex-1" />
          <Menu alinear="derecha" titulo="Filtros" ancho={240} disparador={({ alternar, abierto }) => (
            <span className="relative inline-flex">
              <BotonIcono etiqueta="Filtros" onClick={alternar} aria-expanded={abierto} variante="secundario" tamano="md"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M3 5h18M6 12h12M10 19h4" /></svg></BotonIcono>
              {filtro !== visibles[0]?.id && <span className="absolute right-1 top-1 h-2 w-2 rounded-full" style={{ background: 'var(--series-1)' }} aria-hidden />}
            </span>
          )}>
            {visibles.map((f) => (
              <ItemMenu key={f.id} activo={filtro === f.id} onClick={() => onFiltro(f.id)}
                derecha={conteos && conteos[f.id] ? <span className="cifras text-[11px] text-[var(--text-muted)]">{fmtNum(conteos[f.id])}</span> : undefined}>
                {f.texto}
              </ItemMenu>
            ))}
            <SeparadorMenu />
            <ItemMenu icono={<span aria-hidden>↻</span>} onClick={traerDeInstagram}>Traer mis chats de Instagram</ItemMenu>
          </Menu>
          <BotonIcono etiqueta="Recursos y atajos" onClick={onRecursos} variante="secundario" tamano="md">
            <IconoChat nombre="microfono" tam={18} />
          </BotonIcono>
        </div>
        {buscando ? (
          <p className="px-0.5 text-[12px] text-[var(--text-muted)]" aria-live="polite">
            {bandeja.cargando ? 'Buscando en todos tus leads…' : `Resultados en todos tus leads${items.length ? ` (${fmtNum(items.length)}${bandeja.hayMas ? '+' : ''})` : ''}`}
          </p>
        ) : (
          <p className="px-0.5 text-[12px] text-[var(--text-muted)]">Mostrando: <b className="font-medium text-[var(--text-secondary)]">{visibles.find((f) => f.id === filtro)?.texto ?? ''}</b></p>
        )}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {bandeja.error && !items.length ? (
          <ErrorCarga error={bandeja.error} onReintentar={bandeja.recargar} titulo="No pudimos cargar tus conversaciones" />
        ) : bandeja.cargando && !items.length ? (
          <FilasEsqueleto />
        ) : (
          <>
            {items.length > 0 && (
              <ul aria-label={buscando ? 'Resultados de la búsqueda' : 'Conversaciones'}>
                {items.map((c) => (
                  <FilaConversacion key={c.id} c={c} activa={c.id === selId} borrador={leerBorrador(c.id)}
                    resaltar={c.id === resaltarId} yoId={yoId} acciones={acciones} onAbrir={onAbrir} escritorio={escritorio} />
                ))}
              </ul>
            )}
            {bandeja.hayMas && (
              <div ref={centinela}>
                {bandeja.cargandoMas ? <FilasEsqueleto n={3} /> : (
                  <div className="p-3 text-center">
                    <Boton tamano="sm" variante="fantasma" onClick={bandeja.cargarMas}>Ver más</Boton>
                  </div>
                )}
              </div>
            )}
            {bandeja.error && items.length > 0 && (
              <ErrorCarga compacto error={bandeja.error} onReintentar={bandeja.hayMas ? bandeja.cargarMas : bandeja.recargar} titulo="No pudimos cargar más" />
            )}
            {!items.length && (
              buscando ? (
                <Vacio compacto icono="🔎" titulo={`No hay ningún lead con «${q.trim()}»`}
                  texto="Probá con el @usuario, el nombre o el email."
                  accion={<Boton tamano="sm" onClick={() => onQ('')}>Borrar búsqueda</Boton>} />
              ) : (
                <Vacio compacto icono={vacio.icono} titulo={vacio.titulo} texto={vacio.texto}
                  accion={filtro !== 'todos' && (conteos?.todos ?? 0) > 0
                    ? <Boton tamano="sm" onClick={() => onFiltro('todos')}>Ver todas las conversaciones</Boton>
                    : undefined} />
              )
            )}
            {!buscando && filtro === 'todos' && !bandeja.hayMas && (conteos?.sin_conversacion ?? 0) > 0 && (
              <SinConversacion total={conteos!.sin_conversacion} selId={selId} onAbrir={onAbrir} acciones={acciones} yoId={yoId} resaltarId={resaltarId} escritorio={escritorio} />
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** Leads que nunca escribieron (plegado al final de "Todas"). Se carga recién al abrirlo. */
function SinConversacion({ total, selId, onAbrir, acciones, yoId, resaltarId, escritorio }: {
  total: number; selId: string | null; onAbrir: (id: string) => void; acciones: AccionesFila; yoId: string | null; resaltarId: string | null; escritorio?: boolean;
}) {
  return (
    <div className="border-t border-[var(--border-hairline)]">
      <Desplegable tarjeta={false} clave="chat-sin-conversacion" titulo="Sin conversación todavía"
        subtitulo={`${fmtNum(total)} leads que todavía no te escribieron`}>
        <ListaSinConversacion selId={selId} onAbrir={onAbrir} acciones={acciones} yoId={yoId} resaltarId={resaltarId} escritorio={escritorio} />
      </Desplegable>
    </div>
  );
}

function ListaSinConversacion({ selId, onAbrir, acciones, yoId, resaltarId, escritorio }: {
  selId: string | null; onAbrir: (id: string) => void; acciones: AccionesFila; yoId: string | null; resaltarId: string | null; escritorio?: boolean;
}) {
  const b = useBandeja('sin_conversacion', '');
  if (b.error && !b.items.length) return <ErrorCarga compacto error={b.error} onReintentar={b.recargar} />;
  if (b.cargando && !b.items.length) return <FilasEsqueleto n={3} />;
  return (
    <>
      <ul aria-label="Leads sin conversación">
        {b.items.map((c) => (
          <FilaConversacion key={c.id} c={c} activa={c.id === selId} borrador={leerBorrador(c.id)}
            resaltar={c.id === resaltarId} yoId={yoId} acciones={acciones} onAbrir={onAbrir} escritorio={escritorio} />
        ))}
      </ul>
      {b.hayMas && (
        <div className="p-3 text-center">
          <Boton tamano="sm" variante="fantasma" cargando={b.cargandoMas} onClick={b.cargarMas}>Ver más</Boton>
        </div>
      )}
    </>
  );
}

export type { Conteos };
