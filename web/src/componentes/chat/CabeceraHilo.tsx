import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BotonConfirmar, BotonIcono, Boton, Dialogo, IdentidadLead, Insignia, ItemMenu, Menu, SeparadorMenu, useDeslizar,
  type Tono,
} from '../../ui';
import Icono from '../Iconos';
import { fmtFecha } from '../../api';
import { IconoChat } from './iconos';
import { usePipelines, useUsuarios, yo } from './datos';
import { ventanaRestante } from './util';
import type { Espera, Etapa, Hilo, LeadHilo, Pipeline } from './tipos';

// Cabecera de la conversación: volver (celular), quién es (toca → ficha),
// anterior/siguiente, y debajo los chips para hacer las cosas sin salir del
// chat: etapa, quién lo atiende, la ventana de 24 h y el automensaje en pausa.

const CHIP = 'ui-foco inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--border-hairline)] px-2.5 text-[12px] hover:bg-[var(--surface-1)]';

function Flechita() {
  return <IconoChat nombre="chevronAbajo" tam={13} className="text-[var(--text-muted)]" />;
}

// ---------------------------------------------------------------------
// Etapa
// ---------------------------------------------------------------------

export function pipelineDe(lead: Pick<LeadHilo, 'pipeline_id'>, pipelines: Pipeline[] | null) {
  if (!pipelines?.length) return null;
  return pipelines.find((p) => p.id === lead.pipeline_id) ?? pipelines.find((p) => p.es_predeterminado) ?? pipelines[0];
}

export function MenuEtapa({ lead, onElegir }: { lead: LeadHilo; onElegir: (e: Etapa, p: Pipeline) => void }) {
  const navegar = useNavigate();
  const { valor: pipelines, error, recargar } = usePipelines();
  const pipe = pipelineDe(lead, pipelines);
  const tieneOpp = !!lead.oportunidad_id;
  const etapas = (pipe?.etapas ?? []).filter((e) => tieneOpp || e.tipo === 'abierta');
  return (
    <Menu titulo={pipe ? (tieneOpp ? `Etapa en «${pipe.nombre}»` : `Meter en «${pipe.nombre}»`) : 'Etapa'} ancho={270}
      disparador={({ alternar, abierto }) => (
        <button type="button" onClick={alternar} aria-expanded={abierto} aria-haspopup="menu" className={CHIP}
          aria-label={lead.etapa ? `Etapa: ${lead.etapa}. Cambiar` : 'Meter en el pipeline'}>
          {lead.etapa
            ? <><span className="h-2.5 w-2.5 rounded-full" style={{ background: lead.etapa_color || 'var(--baseline)' }} aria-hidden />{lead.etapa}</>
            : <><IconoChat nombre="pipeline" tam={14} /> Meter en el pipeline</>}
          <Flechita />
        </button>
      )}>
      {!pipelines && !error && <div className="px-3 py-2 text-[12px] text-[var(--text-muted)]">Cargando etapas…</div>}
      {error && <ItemMenu icono="!" onClick={recargar} cerrarAlTocar={false}>No se pudieron cargar. Reintentar</ItemMenu>}
      {etapas.map((e) => (
        <ItemMenu key={e.id} activo={e.id === lead.etapa_id} onClick={() => pipe && e.id !== lead.etapa_id && onElegir(e, pipe)}
          icono={<span className="h-2.5 w-2.5 rounded-full" style={{ background: e.color || 'var(--baseline)' }} />}
          descripcion={e.tipo === 'ganada' ? 'Te pide registrar la venta' : e.tipo === 'perdida' ? 'Te pregunta por qué' : undefined}>
          {e.nombre}
        </ItemMenu>
      ))}
      {pipe && (
        <>
          <SeparadorMenu />
          <ItemMenu icono={<IconoChat nombre="pipeline" tam={15} />} onClick={() => navegar(`/pipeline?p=${pipe.id}`)}>Ver en el Pipeline</ItemMenu>
        </>
      )}
    </Menu>
  );
}

// ---------------------------------------------------------------------
// Responsable
// ---------------------------------------------------------------------

export function MenuResponsable({ lead, onAsignar }: { lead: LeadHilo; onAsignar: (usuarioId: string | null, nombre: string | null) => void }) {
  const { valor: usuarios } = useUsuarios();
  const mio = yo();
  const activos = (usuarios ?? []).filter((u) => u.activo !== false);
  return (
    <Menu titulo="Quién lo atiende" ancho={250}
      disparador={({ alternar, abierto }) => (
        <button type="button" onClick={alternar} aria-expanded={abierto} aria-haspopup="menu" className={CHIP}
          aria-label={lead.responsable ? `Lo atiende ${lead.responsable}. Cambiar` : 'Sin asignar. Asignar'}>
          <IconoChat nombre="usuario" tam={14} />
          <span className={lead.responsable ? '' : 'text-[var(--text-muted)]'}>
            {lead.propietario_id && lead.propietario_id === mio.id ? 'Vos' : lead.responsable ?? 'Sin asignar'}
          </span>
          <Flechita />
        </button>
      )}>
      {mio.id && lead.propietario_id !== mio.id && (
        <>
          <ItemMenu icono={<IconoChat nombre="usuario" tam={15} />} onClick={() => onAsignar(mio.id, mio.nombre)}>Asignarme a mí</ItemMenu>
          <SeparadorMenu />
        </>
      )}
      {!usuarios && <div className="px-3 py-2 text-[12px] text-[var(--text-muted)]">Cargando equipo…</div>}
      {activos.map((u) => (
        <ItemMenu key={u.id} activo={u.id === lead.propietario_id} onClick={() => u.id !== lead.propietario_id && onAsignar(u.id, u.nombre)}>
          {u.id === mio.id ? `${u.nombre} (vos)` : u.nombre}
        </ItemMenu>
      ))}
      {lead.propietario_id && (
        <>
          <SeparadorMenu />
          <ItemMenu onClick={() => onAsignar(null, null)}>Sin asignar</ItemMenu>
        </>
      )}
    </Menu>
  );
}

// ---------------------------------------------------------------------
// Ventana de 24 h
// ---------------------------------------------------------------------

export function InsigniaVentana({ ventana }: { ventana: Hilo['ventana'] }) {
  const [abierto, setAbierto] = useState(false);
  const [, setReloj] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setReloj((x) => x + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const r = ventana.abierta ? ventanaRestante(ventana.cierra_en) : null;
  const tono: Tono = r ? (r.tono === 'verde' ? 'verde' : r.tono === 'amarillo' ? 'amarillo' : 'rojo') : 'neutro';
  const texto = r ? `⏳ ${r.corto}` : ventana.nunca_escribio ? 'Todavía no te escribió' : 'Sin ventana';
  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} className="ui-foco shrink-0 rounded-full"
        aria-label={r ? `Quedan ${r.largo} para responderle por Instagram. Qué significa` : `${texto}. Qué significa`}>
        <Insignia tono={tono} className="!h-8 !px-2.5 !text-[12px]">{texto}</Insignia>
      </button>
      <Dialogo abierto={abierto} onCerrar={() => setAbierto(false)} autoFoco={false}
        titulo={r ? `Quedan ${r.largo} para responderle` : ventana.nunca_escribio ? 'Todavía no te escribió por DM' : 'La ventana de 24 h se cerró'}
        pie={<Boton variante="primario" onClick={() => setAbierto(false)}>Entendido</Boton>}>
        <div className="space-y-2 text-[14px] leading-relaxed text-[var(--text-secondary)] md:text-[13px]">
          <p>Instagram te deja responderle a un lead <strong>hasta 24 h después de su último mensaje</strong>. Cada vez que te escribe, el reloj vuelve a empezar.</p>
          {r && ventana.cierra_en && <p>Se cierra el {fmtFecha(ventana.cierra_en, true)}. Si se cierra, lo que escribas queda guardado acá pero no le llega hasta que te vuelva a escribir.</p>}
          {!r && ventana.por_manychat && <p>Te escribió por ManyChat: respondele ahí o esperá a que te escriba por DM.</p>}
          {!r && !ventana.por_manychat && ventana.nunca_escribio && <p>Podés escribirle recién cuando él te escriba primero (o cuando comente un reel, con una respuesta privada).</p>}
          {!r && !ventana.por_manychat && !ventana.nunca_escribio && <p>Lo que escribas queda guardado acá como nota. Le llega recién cuando te vuelva a escribir.</p>}
        </div>
      </Dialogo>
    </>
  );
}

// ---------------------------------------------------------------------
// Automensaje en pausa
// ---------------------------------------------------------------------

export function InsigniaAutomensaje({ esperas, onCortar }: { esperas: Espera[]; onCortar: () => Promise<void> | void }) {
  if (!esperas.length) return null;
  return (
    <Menu titulo="Automensaje en pausa" ancho={290}
      disparador={({ alternar, abierto }) => (
        <button type="button" onClick={alternar} aria-expanded={abierto} className="ui-foco shrink-0 rounded-full"
          aria-label="Automensaje en pausa: ver o cortar">
          <Insignia tono="violeta" className="!h-8 !px-2.5 !text-[12px]"><IconoChat nombre="pausa" tam={12} /> Automensaje</Insignia>
        </button>
      )}>
      <div className="space-y-1 px-2.5 pb-2 pt-1 text-[13px]">
        {esperas.map((e) => (
          <p key={String(e.id)}>
            «{e.flujo}» {e.esperando === 'tiempo'
              ? <>sigue solo{e.reanudar_en ? <> el {fmtFecha(e.reanudar_en, true)}</> : null}.</>
              : <>espera su respuesta.</>}
          </p>
        ))}
        <p className="text-[12px] text-[var(--text-muted)]">Si le escribís vos a mano, cortalo para que no le lleguen mensajes automáticos encima.</p>
      </div>
      <div className="px-1.5 pb-1">
        <BotonConfirmar onConfirmar={onCortar} className="w-full" confirmar="¿Cortarlo? Tocá de nuevo">Cortar para este lead</BotonConfirmar>
      </div>
    </Menu>
  );
}

// ---------------------------------------------------------------------
// Cabecera completa
// ---------------------------------------------------------------------

export function CabeceraHilo({
  lead, ventana, esperas, cargando, unaColumna, igConectado, onVolver, onAnterior, onSiguiente, onFicha,
  onEtapa, onAsignar, onCortar, menu,
}: {
  lead: LeadHilo; ventana: Hilo['ventana'] | null; esperas: Espera[]; cargando: boolean; unaColumna: boolean; igConectado: boolean;
  onVolver: () => void; onAnterior: (() => void) | null; onSiguiente: (() => void) | null; onFicha: () => void;
  onEtapa: (e: Etapa, p: Pipeline) => void; onAsignar: (usuarioId: string | null, nombre: string | null) => void;
  onCortar: () => Promise<void> | void; menu: React.ReactNode;
}) {
  // En el celular: deslizar la cabecera pasa a la conversación siguiente o anterior.
  const ref = useDeslizar<HTMLDivElement>({ onIzquierda: () => onSiguiente?.(), onDerecha: () => onAnterior?.() });
  return (
    <header ref={ref} className="border-b border-[var(--border-hairline)] px-2 pb-2 pt-2 md:px-4" style={{ background: 'var(--page-plane)' }}>
      <div className="flex items-center gap-1.5">
        {unaColumna && (
          <BotonIcono etiqueta="Volver a la lista" tamano="md" onClick={onVolver} className="shrink-0">
            <Icono nombre="volver" tam={22} />
          </BotonIcono>
        )}
        <IdentidadLead id={lead.id} nombre={lead.nombre} usuario={lead.ig_username} foto={lead.avatar_url as string | null | undefined}
          tam="md" onClick={onFicha} className="min-w-0 flex-1 py-0.5 pr-1" />
        {!unaColumna && (
          <>
            <BotonIcono etiqueta="Conversación anterior (Alt+↑)" onClick={() => onAnterior?.()} disabled={!onAnterior}>
              <IconoChat nombre="chevronArriba" tam={17} />
            </BotonIcono>
            <BotonIcono etiqueta="Conversación siguiente (Alt+↓)" onClick={() => onSiguiente?.()} disabled={!onSiguiente}>
              <IconoChat nombre="chevronAbajo" tam={17} />
            </BotonIcono>
          </>
        )}
        {menu}
      </div>
      <div data-no-deslizar className={`sin-barra -mx-2 mt-1.5 flex items-center gap-1.5 overflow-x-auto px-2 md:mx-0 md:px-0 ${unaColumna ? '' : 'md:pl-[50px]'}`}>
        {cargando ? (
          <span className="h-8" aria-hidden />
        ) : (
          <>
            <MenuEtapa lead={lead} onElegir={onEtapa} />
            <MenuResponsable lead={lead} onAsignar={onAsignar} />
            {ventana && igConectado && <InsigniaVentana ventana={ventana} />}
            <InsigniaAutomensaje esperas={esperas} onCortar={onCortar} />
          </>
        )}
      </div>
    </header>
  );
}
