import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Boton, Vacio, nombreVisible, useAviso, useEsMovil, useParamUrl } from '../ui';
import GestorRecursos, { type TipoNuevo } from '../componentes/GestorRecursos';
import { armarAtajos } from '../componentes/chat/Atajos';
import { AvisoInstagram } from '../componentes/chat/AvisoInstagram';
import { useAtajosDatos, useEstadoInstagram, yo } from '../componentes/chat/datos';
import { alTerminarEnvio } from '../componentes/chat/envios';
import { ListaConversaciones } from '../componentes/chat/ListaConversaciones';
import { PanelHilo } from '../componentes/chat/PanelHilo';
import { conversacionEnMemoria, useBandeja } from '../componentes/chat/useBandeja';
import { precargarHilo } from '../componentes/chat/useHilo';
import { esTactil } from '../componentes/chat/util';
import type { Conversacion, FiltroChat } from '../componentes/chat/tipos';

// Chat del setter.
//  - Celular y tablet: /chat es la lista y /chat/:leadId la conversación a
//    pantalla completa (con su "volver"); el Atrás del teléfono vuelve a la lista.
//  - Escritorio (desde 1024 px): lista + conversación lado a lado, y la URL
//    igual dice qué conversación está abierta (se puede recargar o compartir).
// Los atajos (audios del founder, respuestas, enlaces, links de pago) viven
// dentro del chat; "Recursos y atajos" se abre como columna (desde 1280 px),
// panel lateral o, en el celular, como hoja desde abajo.

const FILTROS: FiltroChat[] = ['por_responder', 'sin_leer', 'mios', 'se_cierra', 'automensaje', 'todos', 'archivados'];

// Lo que sobrevive si se sale y se vuelve al Chat.
let ultimaBusqueda = '';
let ultimoAbierto: string | null = null;

type Persona = { id: string; nombre: string | null; ig_username: string | null; mensajes_sin_leer?: number; archivado?: boolean; propietario_id?: string | null; responsable?: string | null };

export default function Chat() {
  const { leadId } = useParams();
  const sel = leadId ?? null;
  const navegar = useNavigate();
  const ubicacion = useLocation();
  const [params, setParams] = useSearchParams();
  const aviso = useAviso();
  const unaColumna = useEsMovil(1024);
  const panelFijo = !useEsMovil(1280);
  const movil = useEsMovil();
  const tactil = useMemo(() => esTactil(), []);
  const mio = yo();

  // ---------------- Filtro, búsqueda y bandeja ----------------

  const [filtroUrl, setFiltroUrl] = useParamUrl<FiltroChat>('filtro', 'por_responder');
  const filtro: FiltroChat = FILTROS.includes(filtroUrl) ? filtroUrl : 'por_responder';
  const [q, setQ] = useState(ultimaBusqueda);
  const [qServidor, setQServidor] = useState(ultimaBusqueda.trim());
  useEffect(() => {
    ultimaBusqueda = q;
    const t = window.setTimeout(() => setQServidor(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);
  const bandeja = useBandeja(filtro, qServidor);
  const ig = useEstadoInstagram();
  const { recursos, productos } = useAtajosDatos();
  const atajos = useMemo(() => armarAtajos(recursos, productos), [recursos, productos]);

  // La conversación abierta no desaparece de la lista mientras está abierta
  // (aunque ya no cumpla el filtro, p. ej. "Por responder" después de responder).
  const filaSel = useRef<Conversacion | null>(null);
  const ordenPrevio = useRef<string[]>([]);
  const filas = useMemo(() => {
    const items = [...bandeja.items];
    const actual = sel ? items.find((c) => c.id === sel) : null;
    if (actual) filaSel.current = actual;
    else if (sel && !qServidor && filaSel.current?.id === sel) {
      const i = ordenPrevio.current.indexOf(sel);
      if (i >= 0) {
        const previo = ordenPrevio.current.slice(0, i).reverse().find((id) => items.some((c) => c.id === id));
        const pos = previo ? items.findIndex((c) => c.id === previo) + 1 : 0;
        items.splice(pos, 0, filaSel.current);
      }
    }
    ordenPrevio.current = items.map((c) => c.id);
    return items;
  }, [bandeja.items, sel, qServidor]);

  const indice = sel ? filas.findIndex((c) => c.id === sel) : -1;
  const anterior = indice > 0 ? filas[indice - 1] : null;
  const siguiente = indice >= 0 ? filas[indice + 1] ?? null : null;
  const siguientePendiente = useMemo(
    () => filas.find((c, i) => i > indice && c.id !== sel && c.ultimo_dir === 'entrante' && !c.archivado) ?? null,
    [filas, indice, sel]);
  const semilla = sel ? filas.find((c) => c.id === sel) ?? conversacionEnMemoria(sel) : null;

  // ---------------- Navegación ----------------

  const busqueda = useCallback((extra?: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(window.location.search);
    p.delete('lead'); p.delete('ficha');
    extra?.(p);
    const s = p.toString();
    return s ? `?${s}` : '';
  }, []);

  // Link viejo: /chat?lead=<id> → /chat/<id>
  const leadViejo = params.get('lead');
  useEffect(() => {
    if (leadViejo) navegar({ pathname: `/chat/${leadViejo}`, search: busqueda() }, { replace: true });
  }, [leadViejo, navegar, busqueda]);

  const abrir = useCallback((id: string) => {
    if (id === sel) return;
    ultimoAbierto = id;
    const destino = { pathname: `/chat/${id}`, search: busqueda((p) => p.delete('recursos')) };
    if (!unaColumna) navegar({ ...destino, search: busqueda() }, { replace: true });
    else if (!sel) navegar(destino, { state: { desdeLista: true } });
    else navegar(destino, { replace: true, state: ubicacion.state });
  }, [sel, unaColumna, navegar, busqueda, ubicacion.state]);

  const volverALista = useCallback(() => {
    if ((ubicacion.state as any)?.desdeLista) navegar(-1);
    else navegar({ pathname: '/chat', search: busqueda() }, { replace: true });
  }, [ubicacion.state, navegar, busqueda]);

  /** Cerrar la conversación abierta (después de archivarla o marcarla como no leída). */
  const cerrarConversacion = useCallback(() => {
    if (unaColumna) volverALista();
    else navegar({ pathname: '/chat', search: busqueda() }, { replace: true });
  }, [unaColumna, volverALista, navegar, busqueda]);

  // Al abrir una conversación: queda leída (el servidor la marca al traer el hilo).
  useEffect(() => {
    if (!sel) return;
    ultimoAbierto = sel;
    const c = conversacionEnMemoria(sel);
    if (c && Number(c.mensajes_sin_leer) > 0) {
      bandeja.parchear(sel, { mensajes_sin_leer: 0 });
      bandeja.ajustarConteos({ sin_leer: -1 });
    }
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Precarga la siguiente para pasar sin esperas.
  useEffect(() => {
    if (!sel || !siguiente) return;
    const t = window.setTimeout(() => precargarHilo(siguiente.id), 900);
    return () => window.clearTimeout(t);
  }, [sel, siguiente?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Novedades de Instagram (DMs nuevos) al abrir el Chat y cada 45 s.
  useEffect(() => {
    const pedir = () => {
      if (document.visibilityState !== 'visible') return;
      api<any>('/instagram/novedades-chats', { method: 'POST' })
        .then((r) => { if (r?.mensajes || r?.leadsNuevos) bandeja.refrescar(); })
        .catch(() => {});
    };
    pedir();
    const t = window.setInterval(pedir, 45_000);
    return () => window.clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresco liviano de la lista mientras la pestaña está a la vista.
  useEffect(() => {
    const tic = () => { if (document.visibilityState === 'visible') bandeja.refrescar(); };
    const t = window.setInterval(tic, 15_000);
    window.addEventListener('focus', tic);
    return () => { window.clearInterval(t); window.removeEventListener('focus', tic); };
  }, [bandeja.refrescar]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cuando sale un mensaje, la fila sube y cambia la vista previa.
  useEffect(() => alTerminarEnvio(() => { bandeja.refrescar(); }), [bandeja.refrescar]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escritorio: Alt+↓ / Alt+↑ para pasar de conversación, Esc vuelve a la lista.
  useEffect(() => {
    if (unaColumna) return;
    const f = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'ArrowDown' && siguiente) { e.preventDefault(); abrir(siguiente.id); return; }
      if (e.altKey && e.key === 'ArrowUp' && anterior) { e.preventDefault(); abrir(anterior.id); return; }
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"],[role="menu"]')) {
        const fila = document.querySelector<HTMLElement>(`[data-fila="${sel}"] [data-abrir]`)
          ?? document.querySelector<HTMLElement>('[data-fila] [data-abrir]');
        if (fila && document.activeElement !== fila) { fila.focus(); }
      }
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [unaColumna, siguiente, anterior, abrir, sel]);

  // ---------------- Acciones sobre una conversación ----------------

  const quien = (p: Persona) => (p.ig_username ? `@${p.ig_username}` : nombreVisible(p.nombre, p.ig_username));

  const marcarLeido = useCallback(async (p: Persona, leido: boolean) => {
    bandeja.parchear(p.id, { mensajes_sin_leer: leido ? 0 : 1 });
    bandeja.ajustarConteos({ sin_leer: leido ? -1 : 1 });
    if (!leido && p.id === sel) cerrarConversacion();
    try {
      await api(`/ux/chat/${p.id}/leido`, { method: 'POST', json: { leido } });
      aviso.exito(leido ? `${quien(p)}: leído.` : `${quien(p)} quedó como no leído.`, {
        texto: 'Deshacer',
        onClick: () => {
          bandeja.parchear(p.id, { mensajes_sin_leer: leido ? Number(p.mensajes_sin_leer) || 1 : 0 });
          bandeja.ajustarConteos({ sin_leer: leido ? 1 : -1 });
          api(`/ux/chat/${p.id}/leido`, { method: 'POST', json: { leido: !leido } }).catch((e) => aviso.error(e.message));
        },
      });
    } catch (e: any) { aviso.error(e.message); bandeja.refrescar(); }
  }, [bandeja, sel, cerrarConversacion, aviso]);

  const asignarme = useCallback(async (p: Persona) => {
    if (!mio.id) return;
    const antes = { propietario_id: p.propietario_id ?? null, responsable: p.responsable ?? null };
    bandeja.parchear(p.id, { propietario_id: mio.id, responsable: mio.nombre });
    bandeja.ajustarConteos({ mios: 1 });
    try {
      await api(`/ux/chat/${p.id}/asignar`, { method: 'POST', json: { usuario_id: mio.id } });
      aviso.exito(`Ahora a ${quien(p)} lo atendés vos.`, {
        texto: 'Deshacer',
        onClick: () => {
          bandeja.parchear(p.id, antes);
          bandeja.ajustarConteos({ mios: -1 });
          api(`/ux/chat/${p.id}/asignar`, { method: 'POST', json: { usuario_id: antes.propietario_id } }).catch((e) => aviso.error(e.message));
        },
      });
    } catch (e: any) { aviso.error(e.message); bandeja.parchear(p.id, antes); bandeja.ajustarConteos({ mios: -1 }); }
  }, [bandeja, mio.id, mio.nombre, aviso]);

  const archivar = useCallback(async (p: Persona, archivado: boolean) => {
    if (archivado) bandeja.quitar(p.id);
    if (p.id === sel) cerrarConversacion();
    try {
      await api(`/ux/chat/${p.id}/archivar`, { method: 'POST', json: { archivado } });
      bandeja.refrescar();
      aviso.exito(archivado ? `Archivaste la conversación con ${quien(p)}. Vuelve sola si te escribe.` : `${quien(p)} volvió a la bandeja.`, {
        texto: 'Deshacer',
        onClick: async () => {
          await api(`/ux/chat/${p.id}/archivar`, { method: 'POST', json: { archivado: !archivado } }).catch((e) => aviso.error(e.message));
          bandeja.refrescar();
        },
      });
    } catch (e: any) { aviso.error(e.message); bandeja.refrescar(); }
  }, [bandeja, sel, cerrarConversacion, aviso]);

  const accionesFila = useMemo(() => ({
    alternarLeido: (c: Conversacion) => marcarLeido(c, Number(c.mensajes_sin_leer) > 0),
    asignarme: (c: Conversacion) => asignarme(c),
    archivar: (c: Conversacion) => archivar(c, !c.archivado),
  }), [marcarLeido, asignarme, archivar]);

  // ---------------- Recursos y atajos ----------------

  const recursosAbierto = params.get('recursos') === '1';
  const [crear, setCrear] = useState<TipoNuevo | null>(null);
  const abrirRecursos = useCallback((tipo?: TipoNuevo) => {
    setCrear(tipo ?? null);
    if (new URLSearchParams(window.location.search).get('recursos') === '1') return;
    const apilar = !panelFijo;
    setParams((prev) => { const p = new URLSearchParams(prev); p.set('recursos', '1'); return p; },
      { replace: !apilar, state: apilar ? { ...((ubicacion.state as object) ?? {}), recursosApilado: true } : ubicacion.state });
  }, [panelFijo, setParams, ubicacion.state]);
  const cerrarRecursos = useCallback(() => {
    if ((window.history.state as any)?.usr?.recursosApilado) { navegar(-1); return; }
    setParams((prev) => { const p = new URLSearchParams(prev); p.delete('recursos'); return p; }, { replace: true, state: ubicacion.state });
  }, [navegar, setParams, ubicacion.state]);

  useEffect(() => {
    if (!recursosAbierto || panelFijo) return;
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role="dialog"],[role="menu"]')) cerrarRecursos(); };
    document.addEventListener('keydown', f);
    return () => document.removeEventListener('keydown', f);
  }, [recursosAbierto, panelFijo, cerrarRecursos]);

  // Hoja de recursos (celular): deslizar hacia abajo desde la agarradera la cierra.
  const agarre = useRef<number | null>(null);

  const gestor = <GestorRecursos onCerrar={cerrarRecursos} crear={crear} onCrearVisto={() => setCrear(null)} />;

  // ---------------- Pantalla ----------------

  const porResponder = bandeja.conteos?.por_responder ?? 0;
  const primeraPendiente = filas.find((c) => c.ultimo_dir === 'entrante' && !c.archivado) ?? filas[0] ?? null;

  return (
    <div className="alto-app flex flex-col overflow-hidden">
      {!unaColumna && <AvisoInstagram estado={ig} />}
      <div className="flex min-h-0 flex-1">
        {(!unaColumna || !sel) && (
          <div className={`flex min-h-0 flex-col ${unaColumna ? 'w-full' : 'w-[320px] shrink-0 border-r border-[var(--border-hairline)] xl:w-[340px]'}`}>
            <ListaConversaciones bandeja={bandeja} items={filas} filtro={filtro} onFiltro={(f) => setFiltroUrl(f)}
              q={q} onQ={setQ} selId={sel} onAbrir={abrir} acciones={accionesFila} onRecursos={() => abrirRecursos()}
              yoId={mio.id} resaltarId={unaColumna && !sel ? ultimoAbierto : null}
              arriba={unaColumna ? <AvisoInstagram estado={ig} compacto /> : undefined} escritorio={!tactil} />
          </div>
        )}

        {sel ? (
          <PanelHilo key={sel} leadId={sel} semilla={semilla} unaColumna={unaColumna} ig={ig} atajos={atajos}
            avisoArriba={unaColumna ? <AvisoInstagram estado={ig} compacto /> : undefined}
            onVolver={volverALista}
            onAnterior={anterior ? () => abrir(anterior.id) : null}
            onSiguiente={siguiente ? () => abrir(siguiente.id) : null}
            siguiente={siguientePendiente} onIrA={abrir}
            onCambioFila={(id, cambio) => bandeja.parchear(id, cambio)}
            onNoLeido={(l) => marcarLeido({ ...l, mensajes_sin_leer: 0 }, false)}
            onArchivar={(l, a) => archivar(l, a)}
            onCrearAtajo={(t) => abrirRecursos(t)} onGestionarAtajos={() => abrirRecursos()} />
        ) : !unaColumna ? (
          <div className="flex min-w-0 flex-1 items-center justify-center" style={{ background: 'var(--page-plane)' }}>
            <Vacio icono="💬" titulo="Elegí una conversación"
              texto={porResponder > 0 ? `Tenés ${porResponder === 1 ? '1 conversación' : `${porResponder} conversaciones`} por responder.` : 'Estás al día: nadie espera tu respuesta.'}
              accion={primeraPendiente ? <Boton variante="primario" onClick={() => abrir(primeraPendiente.id)}>Ir a la primera</Boton> : undefined} />
          </div>
        ) : null}

        {recursosAbierto && panelFijo && (
          <aside className="flex w-[320px] shrink-0 flex-col border-l border-[var(--border-hairline)]" style={{ background: 'var(--page-plane)' }}
            aria-label="Recursos y atajos">
            {gestor}
          </aside>
        )}
      </div>

      {recursosAbierto && !panelFijo && (
        <div className="fixed inset-0 z-[55] flex items-end justify-end md:items-stretch">
          <div className="ui-fundido absolute inset-0 bg-black/35" onClick={cerrarRecursos} aria-hidden />
          <aside role="dialog" aria-modal="true" aria-label="Recursos y atajos"
            className={`relative flex flex-col shadow-2xl ${movil ? 'ui-subir h-[90dvh] w-full rounded-t-xl' : 'ui-aparecer h-full w-[380px] max-w-[92vw] border-l border-[var(--border-hairline)]'}`}
            style={{ background: 'var(--page-plane)' }}>
            {movil && (
              <div className="flex justify-center pb-1 pt-2"
                onTouchStart={(e) => { agarre.current = e.touches[0].clientY; }}
                onTouchEnd={(e) => { const y0 = agarre.current; agarre.current = null; if (y0 !== null && e.changedTouches[0].clientY - y0 > 70) cerrarRecursos(); }}>
                <span className="h-1 w-10 rounded-full" style={{ background: 'var(--baseline)' }} aria-hidden />
              </div>
            )}
            {gestor}
          </aside>
        </div>
      )}
    </div>
  );
}
