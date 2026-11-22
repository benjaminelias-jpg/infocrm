import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import {
  BotonIcono, ErrorCarga, Esqueleto, ItemMenu, Menu, SeparadorMenu, useAviso, nombreVisible,
} from '../../ui';
import Icono from '../Iconos';
import { useFicha } from '../useFicha';
import { DialogoPerdido, DialogoVenta } from '../pipeline/Dialogos';
import { resumirAcciones, tieneExternas } from '../pipeline/acciones';
import { esRapida, FilaAtajos, PaletaAtajos, previaDe, textoPago, precioDe, type ItemAtajo, type TipoNuevo } from './Atajos';
import { BurbujaLocal, ListaMensajes } from './Burbujas';
import { CabeceraHilo } from './CabeceraHilo';
import { CajaMensaje, type ManijaCaja } from './CajaMensaje';
import { esDueno, yo, type EstadoIG } from './datos';
import { alTerminarEnvio, descartar, deshacer, encolar, ESPERA_ATAJO_MS, limpiarConfirmados, reintentar, useLocales } from './envios';
import { IconoChat } from './iconos';
import { ProbarLead } from './ProbarLead';
import { Programados } from './Programados';
import { useHilo } from './useHilo';
import { copiar, esTactil, fuenteEvento, haceCorto, iconoEvento, fmtEvento, primerNombre, rellenar } from './util';
import type { Conversacion, Etapa, Hilo, LeadHilo, Pipeline } from './tipos';

// La conversación abierta: cabecera con lo que se puede hacer sin salir del
// chat, los mensajes, y abajo los atajos y la caja. Nunca se ve el hilo de
// otro lead mientras carga: la cabecera sale de la lista y el cuerpo es un
// esqueleto hasta que llega el hilo de ESTE lead.

const ESPERA_ETAPA_MS = 5000;

function leadDeSemilla(c: Conversacion | null, id: string): LeadHilo {
  return {
    id, nombre: c?.nombre ?? null, apellido: c?.apellido ?? null, ig_username: c?.ig_username ?? null,
    avatar_url: c?.avatar_url ?? null, pais: c?.pais ?? null, propietario_id: c?.propietario_id ?? null,
    responsable: c?.responsable ?? null, contenido: c?.contenido ?? null, oportunidad_id: c?.oportunidad_id ?? null,
    pipeline_id: c?.pipeline_id ?? null, etapa_id: c?.etapa_id ?? null, etapa: c?.etapa ?? null, etapa_color: c?.etapa_color ?? null,
  };
}

function EsqueletoHilo() {
  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-3 px-3 py-5" aria-busy="true" aria-label="Cargando conversación">
      {[60, 45, 70, 38].map((w, i) => (
        <div key={i} className={`flex ${i % 2 ? 'justify-end' : 'justify-start'}`}>
          <Esqueleto alto={i === 2 ? 52 : 36} ancho={`${w}%`} className="!rounded-xl" />
        </div>
      ))}
    </div>
  );
}

/** Chat vacío: lo que pasó con el lead (de dónde vino, qué recibió) y atajos grandes para arrancar. */
function HiloVacio({ hilo, atajos, onUsar }: { hilo: Hilo; atajos: ItemAtajo[]; onUsar: (i: ItemAtajo) => void }) {
  const eventos = [...(hilo.eventos ?? [])].reverse().slice(-6);
  const primeros = [
    ...atajos.filter((a) => a.clase === 'recurso' && a.recurso.tipo === 'audio'),
    ...atajos.filter((a) => !(a.clase === 'recurso' && a.recurso.tipo === 'audio')),
  ].slice(0, 3);
  const nombre = primerNombre(hilo.lead);
  return (
    <div className="mx-auto flex max-w-[520px] flex-col items-center gap-2 px-2 py-6 text-center">
      {eventos.length > 0 && (
        <div className="mb-2 flex flex-col items-center gap-1.5" aria-label="Lo que pasó con este lead">
          {eventos.map((e, i) => (
            <span key={i} className="max-w-full truncate rounded-md px-3 py-1 text-[12px] text-[var(--text-secondary)]"
              style={{ background: 'var(--gridline)' }}>
              {iconoEvento(e.tipo)} {fmtEvento(e)}{fuenteEvento(e.fuente) ? ` · ${fuenteEvento(e.fuente)}` : ''} · {haceCorto(e.ocurrido_en)}
            </span>
          ))}
        </div>
      )}
      <p className="text-[13px] text-[var(--text-muted)]">Todavía no hay mensajes con {nombre}.</p>
      {primeros.length > 0 && (
        <div className="mt-1 flex w-full flex-col gap-1.5">
          {primeros.map((a) => (
            <button key={a.id} type="button" onClick={() => onUsar(a)}
              className="ui-foco flex min-h-[48px] items-center gap-3 rounded-xl border border-[var(--border-hairline)] px-3.5 py-2 text-left hover:bg-[var(--surface-1)]"
              style={{ background: 'var(--surface-1)' }}>
              <span className="text-[18px]" aria-hidden>{a.clase === 'pago' ? '💳' : a.recurso.tipo === 'audio' ? '🎙️' : esRapida(a) ? '⚡' : '🔗'}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium md:text-[13px]">
                  {esRapida(a) ? `Escribile: «${a.nombre}»` : a.clase === 'recurso' && a.recurso.tipo === 'audio' ? `Mandale «${a.nombre}»` : `Mandale «${a.nombre}»`}
                </span>
                <span className="block truncate text-[12px] text-[var(--text-muted)]">{previaDe(a)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PanelHilo({
  leadId, semilla, unaColumna, ig, atajos, avisoArriba, onVolver, onAnterior, onSiguiente, siguiente, onIrA,
  onCambioFila, onNoLeido, onArchivar, onCrearAtajo, onGestionarAtajos,
}: {
  leadId: string; semilla: Conversacion | null; unaColumna: boolean; ig: EstadoIG | null; atajos: ItemAtajo[];
  /** Aviso fijo debajo de la cabecera (Instagram desconectado, en el celular). */
  avisoArriba?: React.ReactNode;
  onVolver: () => void; onAnterior: (() => void) | null; onSiguiente: (() => void) | null;
  /** La siguiente conversación por responder (para la píldora después de mandar). */
  siguiente: Conversacion | null; onIrA: (id: string) => void;
  onCambioFila: (id: string, cambio: Partial<Conversacion>) => void;
  onNoLeido: (lead: LeadHilo) => void; onArchivar: (lead: LeadHilo, archivar: boolean) => void;
  onCrearAtajo: (t: TipoNuevo) => void; onGestionarAtajos: () => void;
}) {
  const aviso = useAviso();
  const ficha = useFicha();
  const { hilo, error, cargando, recargar, parchear } = useHilo(leadId);
  const locales = useLocales(leadId);
  const caja = useRef<ManijaCaja>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [nuevos, setNuevos] = useState(0);
  const [mostrarSiguiente, setMostrarSiguiente] = useState(false);
  const [paleta, setPaleta] = useState(false);
  const [probar, setProbar] = useState(false);
  const [cierre, setCierre] = useState<{ tipo: 'venta' | 'perdido'; etapa: Etapa } | null>(null);
  const pendienteEtapa = useRef<{ timer: number; desde: Partial<LeadHilo> } | null>(null);
  const tactil = useMemo(() => esTactil(), []);

  const lead: LeadHilo = hilo?.lead ?? leadDeSemilla(semilla, leadId);
  const nombre = nombreVisible(lead.nombre, lead.ig_username);
  const quien = lead.ig_username ? `@${lead.ig_username}` : nombre;
  const igCaido = ig === 'desconectado' || ig === 'cortado';

  // Lo que el servidor ya confirmó se dibuja una sola vez.
  useEffect(() => {
    if (hilo) limpiarConfirmados(leadId, new Set(hilo.mensajes.map((m) => m.id)));
  }, [hilo, leadId]);
  const idsServidor = useMemo(() => new Set((hilo?.mensajes ?? []).map((m) => m.id)), [hilo]);
  const pendientes = locales.filter((m) => !(m.idServidor && idsServidor.has(m.idServidor)));

  // Al terminar un envío de este lead: traer el hilo y avisar si no le llegó.
  useEffect(() => alTerminarEnvio(({ local, respuesta, error: err }) => {
    if (local.leadId !== leadId) return;
    if (err) {
      aviso.error(`No se pudo mandar: ${err.message}`, { texto: 'Reintentar', onClick: () => reintentar(local.idLocal) });
      return;
    }
    recargar(true);
    if (respuesta?.aviso && !igCaido) aviso.error(`No le llegó a ${quien} por Instagram: ${respuesta.aviso}. Quedó guardado acá.`);
  }), [leadId, recargar, aviso, igCaido, quien]);

  // Refresco: si la lista dice que hay algo nuevo de este lead, o cada 30 s.
  const ultimoServidor = hilo?.mensajes[hilo.mensajes.length - 1]?.ocurrido_en ?? null;
  useEffect(() => {
    if (!hilo || !semilla?.ultimo_en) return;
    if (!ultimoServidor || new Date(semilla.ultimo_en).getTime() > new Date(ultimoServidor).getTime() + 500) recargar(true);
  }, [semilla?.ultimo_en, semilla?.mensajes_sin_leer]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') recargar(true); }, 30_000);
    return () => window.clearInterval(t);
  }, [recargar]);

  // Al cerrar la ficha (pudo cambiar nombre, etapa…), traer el hilo de nuevo.
  const fichaAntes = useRef(ficha.abierta);
  useEffect(() => {
    if (fichaAntes.current && !ficha.abierta) recargar(true);
    fichaAntes.current = ficha.abierta;
  }, [ficha.abierta, recargar]);

  // ---------------- Desplazamiento ----------------

  const cerca = () => {
    const el = scroller.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  };
  const alFondo = useCallback((suave = false) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: suave ? 'smooth' : 'auto' });
    setNuevos(0);
  }, []);

  const vistos = useRef<{ lead: string | null; n: number }>({ lead: null, n: 0 });
  const totalMsjs = hilo?.mensajes.length ?? 0;
  useLayoutEffect(() => {
    if (!hilo) return;
    const v = vistos.current;
    if (v.lead !== leadId) {
      vistos.current = { lead: leadId, n: totalMsjs };
      alFondo();
      setMostrarSiguiente(false);
      return;
    }
    if (totalMsjs > v.n) {
      const ultimo = hilo.mensajes[totalMsjs - 1];
      const llegaron = totalMsjs - v.n; // (calculado ahora: el ref cambia antes de que corra el setState)
      if (cerca() || ultimo?.direccion === 'saliente') alFondo(true);
      else setNuevos((x) => x + llegaron);
    }
    vistos.current = { lead: leadId, n: totalMsjs };
  }, [hilo, leadId, totalMsjs, alFondo]);

  const totalLocales = pendientes.length;
  const localesAntes = useRef(0);
  useEffect(() => {
    if (totalLocales > localesAntes.current) alFondo(true);
    localesAntes.current = totalLocales;
  }, [totalLocales, alFondo]);

  // En escritorio, al abrir un chat el cursor va a la caja (en el celular no: abriría el teclado).
  const enfocadoPara = useRef<string | null>(null);
  useEffect(() => {
    if (tactil || !hilo || enfocadoPara.current === leadId) return;
    enfocadoPara.current = leadId;
    window.setTimeout(() => caja.current?.enfocar(), 30);
  }, [hilo, leadId, tactil]);

  // Celular: deslizar desde el borde izquierdo vuelve a la lista.
  const borde = useRef<{ x: number; y: number; t: number } | null>(null);
  function toqueInicio(e: React.TouchEvent) {
    const t = e.touches[0];
    borde.current = unaColumna && t.clientX < 24 ? { x: t.clientX, y: t.clientY, t: performance.now() } : null;
  }
  function toqueFin(e: React.TouchEvent) {
    const b = borde.current;
    borde.current = null;
    if (!b) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - b.x; const dy = t.clientY - b.y;
    if (dx > 70 && Math.abs(dy) < dx * 0.6 && performance.now() - b.t < 800) onVolver();
  }

  // ---------------- Mandar ----------------

  const avisarAutomensaje = useCallback(() => {
    const e = hilo?.esperas?.[0];
    if (!e) return;
    aviso.info(`El automensaje «${e.flujo}» sigue activo con ${primerNombre(lead)}.`, { texto: 'Cortarlo', onClick: () => { cortar(); } });
  }, [hilo, lead]); // eslint-disable-line react-hooks/exhaustive-deps

  function mandarTexto(texto: string) {
    encolar({ leadId, payload: { texto }, vista: { texto } });
    setMostrarSiguiente(true);
    avisarAutomensaje();
  }

  function usarAtajo(i: ItemAtajo) {
    if (esRapida(i) && i.clase === 'recurso') {
      caja.current?.insertar(rellenar(i.recurso.texto ?? '', lead));
      return;
    }
    let id: string;
    if (i.clase === 'pago') {
      id = encolar({
        leadId, payload: { texto: textoPago(i.producto) }, demoraMs: ESPERA_ATAJO_MS,
        vista: { texto: textoPago(i.producto), tipo: 'pago', nombre: `${i.producto.nombre}${precioDe(i.producto) ? ` · ${precioDe(i.producto)}` : ''}` },
      });
    } else {
      id = encolar({
        leadId, payload: { recurso_id: i.recurso.id }, demoraMs: ESPERA_ATAJO_MS,
        vista: { texto: i.recurso.nombre, tipo: i.recurso.tipo, nombre: i.recurso.nombre, url: i.recurso.url_publica },
      });
    }
    aviso.info(<>«{i.nombre}» le sale a {primerNombre(lead)} en 4 s.</>, { texto: 'Deshacer', onClick: () => { if (deshacer(id)) aviso.exito('Listo, no se mandó.'); } });
    setMostrarSiguiente(true);
    avisarAutomensaje();
  }

  // ---------------- Acciones sobre el lead ----------------

  function aplicarEtapa(e: { id: string; nombre: string; color: string }, p: { id: string }, oportunidadId?: string | null) {
    const cambio = { etapa_id: e.id, etapa: e.nombre, etapa_color: e.color, pipeline_id: p.id, ...(oportunidadId ? { oportunidad_id: oportunidadId } : {}) };
    parchear((h) => ({ ...h, lead: { ...h.lead, ...cambio } }));
    onCambioFila(leadId, cambio);
  }

  async function enviarEtapa(etapaId: string, sinAcciones = false) {
    try {
      const r = await api<{ oportunidad_id: string }>(`/ux/chat/${leadId}/etapa`, { method: 'POST', json: { etapa_id: etapaId, ...(sinAcciones ? { sin_acciones: true } : {}) } });
      if (r?.oportunidad_id) parchear((h) => ({ ...h, lead: { ...h.lead, oportunidad_id: r.oportunidad_id } }));
      onCambioFila(leadId, { oportunidad_id: r?.oportunidad_id ?? null });
    } catch (err: any) {
      aviso.error(err.message);
      recargar(true);
    }
  }

  function elegirEtapa(e: Etapa, p: Pipeline) {
    if (e.tipo === 'ganada' && lead.oportunidad_id) { setCierre({ tipo: 'venta', etapa: e }); return; }
    if (e.tipo === 'perdida' && lead.oportunidad_id) { setCierre({ tipo: 'perdido', etapa: e }); return; }
    const desde = { etapa_id: lead.etapa_id, etapa: lead.etapa, etapa_color: lead.etapa_color, pipeline_id: lead.pipeline_id };
    const resumen = resumirAcciones(e);
    aplicarEtapa(e, p);
    const volver = () => {
      parchear((h) => ({ ...h, lead: { ...h.lead, ...desde } }));
      onCambioFila(leadId, desde as Partial<Conversacion>);
    };
    if (tieneExternas(e)) {
      // Sale algo hacia el lead (DM, audio, email…): 5 s para arrepentirse.
      if (pendienteEtapa.current) window.clearTimeout(pendienteEtapa.current.timer);
      const timer = window.setTimeout(() => { pendienteEtapa.current = null; enviarEtapa(e.id); }, ESPERA_ETAPA_MS);
      pendienteEtapa.current = { timer, desde };
      aviso.info(<>{quien} → «{e.nombre}». En 5 s {resumen}.</>, {
        texto: 'Deshacer',
        onClick: () => {
          if (pendienteEtapa.current) { window.clearTimeout(pendienteEtapa.current.timer); pendienteEtapa.current = null; }
          volver();
        },
      });
      return;
    }
    enviarEtapa(e.id);
    aviso.exito(<>{quien} → «{e.nombre}»{resumen ? <> · {resumen}</> : null}</>, desde.etapa_id ? {
      texto: 'Deshacer',
      onClick: () => { volver(); enviarEtapa(desde.etapa_id as string, true); },
    } : undefined);
  }

  async function asignar(usuarioId: string | null, nombreU: string | null) {
    const antes = { propietario_id: lead.propietario_id, responsable: lead.responsable };
    const cambio = { propietario_id: usuarioId, responsable: nombreU };
    parchear((h) => ({ ...h, lead: { ...h.lead, ...cambio } }));
    onCambioFila(leadId, cambio);
    try {
      await api(`/ux/chat/${leadId}/asignar`, { method: 'POST', json: { usuario_id: usuarioId } });
      const texto = !usuarioId ? `${quien} quedó sin asignar.` : usuarioId === yo().id ? `Ahora a ${quien} lo atendés vos.` : `Ahora a ${quien} lo atiende ${nombreU}.`;
      aviso.exito(texto, {
        texto: 'Deshacer',
        onClick: async () => {
          parchear((h) => ({ ...h, lead: { ...h.lead, ...antes } }));
          onCambioFila(leadId, antes);
          await api(`/ux/chat/${leadId}/asignar`, { method: 'POST', json: { usuario_id: antes.propietario_id } }).catch((e) => aviso.error(e.message));
        },
      });
    } catch (err: any) {
      parchear((h) => ({ ...h, lead: { ...h.lead, ...antes } }));
      onCambioFila(leadId, antes);
      aviso.error(err.message);
    }
  }

  async function cortar() {
    const flujos = (hilo?.esperas ?? []).map((e) => `«${e.flujo}»`).join(', ');
    try {
      await api(`/ux/chat/${leadId}/cortar-automensajes`, { method: 'POST' });
      parchear((h) => ({ ...h, esperas: [] }));
      onCambioFila(leadId, { flujo_esperando: false });
      aviso.exito(`Listo: ${flujos || 'el automensaje'} ya no le va a mandar nada a ${primerNombre(lead)}.`);
    } catch (err: any) { aviso.error(err.message); }
  }

  const tarjeta = { lead_id: leadId, oportunidad_id: lead.oportunidad_id, valor: lead.valor, ig_username: lead.ig_username, nombre: lead.nombre };
  const alCerrarCierre = async (texto: string) => {
    if (cierre) aplicarEtapa(cierre.etapa, { id: cierre.etapa.pipeline_id });
    setCierre(null);
    aviso.exito(texto);
    recargar(true);
  };

  // ---------------- Menú ⋯ ----------------

  const menu = (
    <Menu alinear="derecha" ancho={250} disparador={({ alternar, abierto }) => (
      <BotonIcono etiqueta="Más opciones" onClick={alternar} aria-expanded={abierto} aria-haspopup="menu" tamano="md">
        <Icono nombre="puntos" tam={20} />
      </BotonIcono>
    )}>
      <ItemMenu icono={<IconoChat nombre="ficha" tam={16} />} onClick={() => ficha.abrir(leadId)}>Ver ficha</ItemMenu>
      {lead.ig_username && (
        <>
          <ItemMenu icono={<IconoChat nombre="instagram" tam={16} />}
            onClick={() => window.open(`https://www.instagram.com/${lead.ig_username}/`, '_blank', 'noopener,noreferrer')}>Abrir su Instagram</ItemMenu>
          <ItemMenu icono={<IconoChat nombre="copiar" tam={16} />}
            onClick={async () => { if (await copiar(`@${lead.ig_username}`)) aviso.exito(`Copiado: @${lead.ig_username}`); }}>Copiar @{lead.ig_username}</ItemMenu>
        </>
      )}
      <SeparadorMenu />
      <ItemMenu icono={<IconoChat nombre="noleido" tam={12} />} onClick={() => onNoLeido(lead)}>Marcar como no leído</ItemMenu>
      <ItemMenu icono={<IconoChat nombre="archivar" tam={16} />} onClick={() => onArchivar(lead, !lead.archivado)}>
        {lead.archivado ? 'Sacar de archivadas' : 'Archivar conversación'}
      </ItemMenu>
      {esDueno() && (
        <>
          <SeparadorMenu />
          <ItemMenu icono={<IconoChat nombre="probar" tam={16} />} onClick={() => setProbar(true)}
            descripcion="Simula que este lead te escribe">Probar automensajes…</ItemMenu>
        </>
      )}
    </Menu>
  );

  // ---------------- Caja ----------------

  const ventana = hilo?.ventana ?? null;
  const cerrada = !igCaido && !!ventana && !ventana.abierta;
  const modo: 'enviar' | 'guardar' = igCaido || cerrada ? 'guardar' : 'enviar';
  const avisoCaja = cerrada && ventana ? (
    <p className="mb-1.5 rounded-lg px-3 py-1.5 text-[12px] text-[var(--text-secondary)]" style={{ background: 'var(--gridline)' }}>
      {ventana.por_manychat
        ? 'Te escribió por ManyChat: respondele ahí o esperá a que te escriba por DM. Lo que escribas acá queda como nota.'
        : ventana.nunca_escribio
          ? `${primerNombre(lead)} todavía no te escribió por DM: lo que escribas queda como nota hasta que te escriba.`
          : 'Pasaron más de 24 h: no le va a llegar hasta que te vuelva a escribir. Queda como nota.'}
    </p>
  ) : null;

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col" aria-label={`Conversación con ${nombre}`}
      onTouchStart={toqueInicio} onTouchEnd={toqueFin}>
      <CabeceraHilo lead={lead} ventana={ventana} esperas={hilo?.esperas ?? []} cargando={!hilo}
        unaColumna={unaColumna} igConectado={ig === 'conectado' || ig === null}
        onVolver={onVolver} onAnterior={onAnterior} onSiguiente={onSiguiente} onFicha={() => ficha.abrir(leadId)}
        onEtapa={elegirEtapa} onAsignar={asignar} onCortar={cortar} menu={menu} />
      {avisoArriba}

      <div className="relative min-h-0 flex-1">
        <div ref={scroller} className="h-full overflow-y-auto overscroll-contain px-3 py-3 md:px-5"
          onScroll={() => { if (nuevos && cerca()) setNuevos(0); }} aria-live="polite" aria-busy={cargando}>
          {error && !hilo ? (
            <ErrorCarga error={error} onReintentar={() => recargar(false)} titulo="No pudimos abrir esta conversación" />
          ) : !hilo ? (
            <EsqueletoHilo />
          ) : (
            <div className="mx-auto flex max-w-[760px] flex-col pb-2">
              {hilo.mensajes.length === 0 && pendientes.length === 0 && <HiloVacio hilo={hilo} atajos={atajos} onUsar={usarAtajo} />}
              <ListaMensajes mensajes={hilo.mensajes} />
              {pendientes.map((m) => (
                <BurbujaLocal key={m.idLocal} m={m}
                  onDeshacer={() => { if (deshacer(m.idLocal)) aviso.exito('Listo, no se mandó.'); }}
                  onReintentar={() => reintentar(m.idLocal)} onDescartar={() => descartar(m.idLocal)} />
              ))}
            </div>
          )}
        </div>
        {nuevos > 0 && (
          <button type="button" onClick={() => alFondo(true)}
            className="ui-foco ui-aparecer absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-md px-3.5 py-2 text-[12px] font-semibold text-white shadow-lg"
            style={{ background: 'var(--series-1)' }}>
            <IconoChat nombre="abajo" tam={14} /> {nuevos === 1 ? '1 mensaje nuevo' : `${nuevos} mensajes nuevos`}
          </button>
        )}
      </div>

      <div className="border-t border-[var(--border-hairline)]" style={{ background: 'var(--page-plane)' }}>
        {mostrarSiguiente && siguiente && siguiente.id !== leadId && (
          <div className="flex justify-center px-3 pt-2">
            <button type="button" onClick={() => onIrA(siguiente.id)}
              className="ui-foco inline-flex max-w-full items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] hover:bg-[var(--surface-1)]"
              style={{ background: 'var(--surface-1)' }}>
              <span className="truncate">Siguiente: <strong className="font-semibold">{nombreVisible(siguiente.nombre, siguiente.ig_username)}</strong>
                {siguiente.ultimo_entrante ? <span className="text-[var(--text-muted)]"> · te escribió {haceCorto(siguiente.ultimo_entrante)}</span> : null}</span>
              <IconoChat nombre="chevronDerecha" tam={14} />
            </button>
          </div>
        )}
        <FilaAtajos items={atajos} onUsar={usarAtajo} onCrear={onCrearAtajo} onGestionar={onGestionarAtajos} ocupado={!hilo} />
        <Programados leadId={leadId} />
        <CajaMensaje key={leadId} ref={caja} leadId={leadId} nombreLead={nombre} modo={modo} deshabilitado={!hilo}
          placeholder={igCaido || cerrada ? (unaColumna ? 'Escribí una nota…' : 'Escribí una nota (no le llega)…') : 'Escribí un mensaje…'}
          aviso={avisoCaja} atajos={atajos} onEnviar={mandarTexto} onUsarAtajo={usarAtajo} onAbrirAtajos={() => setPaleta(true)} />
      </div>

      <PaletaAtajos abierto={paleta} onCerrar={() => setPaleta(false)} items={atajos} onUsar={usarAtajo}
        onCrear={onCrearAtajo} onGestionar={onGestionarAtajos} />
      {esDueno() && <ProbarLead abierto={probar} onCerrar={() => setProbar(false)} leadId={leadId} nombre={primerNombre(lead)} onListo={() => recargar(true)} />}
      {cierre?.tipo === 'venta' && (
        <DialogoVenta tarjeta={tarjeta} etapa={cierre.etapa} onCerrar={() => setCierre(null)}
          onListo={(_registrada, texto) => alCerrarCierre(texto)} />
      )}
      {cierre?.tipo === 'perdido' && (
        <DialogoPerdido tarjeta={tarjeta} etapa={cierre.etapa} onCerrar={() => setCierre(null)} onListo={(texto) => alCerrarCierre(texto)} />
      )}
    </section>
  );
}
