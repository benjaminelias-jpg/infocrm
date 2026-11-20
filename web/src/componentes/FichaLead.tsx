import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, fmtDinero, fmtFecha } from '../api';
import {
  Avatar, Ayuda, Banner, Boton, BotonIcono, Desplegable, ErrorCarga, Esqueleto, Insignia, Interruptor, ItemMenu,
  Menu, Pestanas, SeparadorMenu, Vacio, nombreVisible, useAviso,
} from '../ui';
import Icono from './Iconos';
import PanelLateral, { type Animacion } from './contenidos-leads/PanelLateral';
import EditorEtiquetas from './contenidos-leads/EditorEtiquetas';
import CajaNota from './contenidos-leads/CajaNota';
import HistorialLead from './contenidos-leads/HistorialLead';
import Portada from './contenidos-leads/Portada';
import { DialogoDescartar, DialogoEditarDatos } from './contenidos-leads/DialogosFicha';
import { Temperatura, TEMPERATURAS, temperaturaDe } from './contenidos-leads/temperatura';
import { avisarLeadCambiado, EVENTO_LEAD_CAMBIADO, leerListaFicha } from './contenidos-leads/listaFicha';
import { cargarContexto, olvidarContexto, type Contexto, type Etapa } from './contenidos-leads/contexto';
import { quienEs, useAccionesLead } from './contenidos-leads/accionesLead';
import {
  CONFIANZA, PREGUNTAS_CHECKLIST, RESULTADO_CHECKLIST, TIPO_CONTENIDO, metodoAtribucion,
} from './contenidos-leads/textos';
import { resumirAcciones } from './pipeline/acciones';

// Ficha del lead. La dibuja el marco de la app cuando hay ?ficha=<id> (Atrás
// la cierra). Todo lo del día a día se hace desde acá, sin ir a otra
// pantalla: abrir el chat, moverlo de etapa, asignarlo, etiquetarlo, dejar
// una nota (que no se pierde) y pasar al lead siguiente deslizando.

type Tab = 'resumen' | 'historial' | 'notas';
const CLAVE_TAB = 'infocrm_ficha_tab';

// ---------------------------------------------------------------------
// Memoria entre fichas (la ficha se vuelve a montar al pasar de un lead a otro)
// ---------------------------------------------------------------------

/** Últimos leads vistos: pasar al siguiente es instantáneo. */
const cacheLeads = new Map<string, any>();
function recordar(l: any) {
  if (!l?.id) return;
  cacheLeads.delete(l.id);
  cacheLeads.set(l.id, l);
  if (cacheLeads.size > 30) cacheLeads.delete(cacheLeads.keys().next().value as string);
}

let ultimaSalida = 0;
let proximaAnimacion: Animacion | null = null;

function leerTab(): Tab {
  try { const t = sessionStorage.getItem(CLAVE_TAB); return t === 'historial' || t === 'notas' ? t : 'resumen'; } catch { return 'resumen'; }
}

const quienDe = (l: any) => quienEs(l);

// ---------------------------------------------------------------------

export default function FichaLead({ leadId, alCerrar }: { leadId: string; alCerrar: () => void }) {
  const aviso = useAviso();
  const navegar = useNavigate();
  const [, setParams] = useSearchParams();
  const [lead, setLead] = useState<any>(() => cacheLeads.get(leadId) ?? null);
  const [error, setError] = useState<any>(null);
  const [ctx, setCtx] = useState<Contexto | null>(null);
  const [tab, setTabEstado] = useState<Tab>(leerTab);
  const [dialogo, setDialogo] = useState<null | 'editar' | 'descartar'>(null);
  const acciones = useAccionesLead();
  const [animacion] = useState<Animacion>(() => {
    const a = proximaAnimacion ?? (performance.now() - ultimaSalida < 500 ? 'nada' : 'abrir');
    proximaAnimacion = null;
    return a;
  });
  useEffect(() => () => { ultimaSalida = performance.now(); }, []);

  function setTab(t: Tab) {
    setTabEstado(t);
    try { sessionStorage.setItem(CLAVE_TAB, t); } catch { /* sin almacenamiento */ }
  }

  const cargar = useCallback(async () => {
    try {
      const l = await api(`/leads/${leadId}`);
      recordar(l);
      setLead(l);
      setError(null);
    } catch (e: any) {
      setError(e);
    }
  }, [leadId]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { cargarContexto().then(setCtx).catch(() => {}); }, []);
  useEffect(() => {
    const f = (e: Event) => { if ((e as CustomEvent).detail?.id === leadId) cargar(); };
    window.addEventListener(EVENTO_LEAD_CAMBIADO, f);
    return () => window.removeEventListener(EVENTO_LEAD_CAMBIADO, f);
  }, [leadId, cargar]);

  // ‹ anterior · siguiente › según la lista de donde se abrió.
  const lista = useMemo(() => {
    const l = leerListaFicha();
    return l && l.ruta === window.location.pathname && l.ids.includes(leadId) ? l : null;
  }, [leadId]);
  const indice = lista ? lista.ids.indexOf(leadId) : -1;
  const irA = useCallback((id: string, dir: Animacion) => {
    proximaAnimacion = dir;
    // Reemplaza (no llena el Atrás) y conserva la marca de "la abrimos nosotros".
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set('ficha', id);
      return p;
    }, { replace: true, state: (window.history.state as any)?.usr ?? null });
  }, [setParams]);
  const anterior = lista && indice > 0 ? () => irA(lista.ids[indice - 1], 'anterior') : null;
  const siguiente = lista && indice >= 0 && indice < lista.ids.length - 1 ? () => irA(lista.ids[indice + 1], 'siguiente') : null;

  // Los vecinos se piden de antemano.
  useEffect(() => {
    if (!lead || !lista) return;
    for (const id of [lista.ids[indice + 1], lista.ids[indice - 1]]) {
      if (id && !cacheLeads.has(id)) api(`/leads/${id}`).then(recordar).catch(() => {});
    }
  }, [lead?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------- Datos derivados ----------------
  const opp = lead?.oportunidades?.find((o: any) => o.id === lead.oportunidad_id) ?? null;
  const pipeline = ctx?.pipelines.find((p) => p.id === opp?.pipeline_id) ?? null;
  const etapas = pipeline?.etapas ?? [];
  const responsableId: string | null = opp?.propietario_id ?? lead?.propietario_id ?? null;
  const responsable = responsableId
    ? (ctx?.usuarios.find((u) => u.id === responsableId) ?? { id: responsableId, nombre: lead?.propietario_nombre ?? 'Alguien del equipo' })
    : null;
  const quien = quienDe(lead);
  const nombreCompleto = lead ? [lead.nombre, lead.apellido].filter(Boolean).join(' ').trim() : '';

  // ---------------- Acciones ----------------

  const accion = () => ({
    lead_id: lead.id as string, oportunidad_id: opp?.id ?? null, etapa_id: lead.etapa_id ?? null,
    nombre: lead.nombre, ig_username: lead.ig_username, avatar_url: lead.avatar_url, valor: opp?.valor ?? null,
  });

  function moverA(destino: Etapa) {
    if (!lead) return;
    acciones.mover(accion(), destino, (e) => {
      setLead((l: any) => ({ ...l, etapa_id: e.id, etapa_nombre: e.nombre, etapa_color: e.color }));
    });
  }

  function asignar(usuarioId: string | null) {
    if (!lead) return;
    const usuario = usuarioId ? (ctx?.usuarios.find((u) => u.id === usuarioId) ?? null) : null;
    setLead((l: any) => ({
      ...l, propietario_id: usuarioId, propietario_nombre: usuario?.nombre ?? null,
      oportunidades: (l.oportunidades ?? []).map((o: any) => (o.id === opp?.id ? { ...o, propietario_id: usuarioId } : o)),
    }));
    acciones.asignar(accion(), usuario, responsableId);
  }

  async function cambiarEtiquetas(nuevas: string[], cambio: { agregada?: string; quitada?: string }) {
    if (!lead) return;
    const antes: string[] = lead.etiquetas ?? [];
    const id = lead.id as string;
    setLead((l: any) => ({ ...l, etiquetas: nuevas }));
    try {
      const r = await api(`/leads/${id}`, { method: 'PATCH', json: { etiquetas: nuevas } });
      recordar(r);
      setLead(r);
      avisarLeadCambiado(id);
      if (cambio.agregada && !ctx?.etiquetas.some((e) => e.etiqueta === cambio.agregada)) olvidarContexto();
      if (cambio.quitada) {
        aviso.exito(`Etiqueta «${cambio.quitada}» quitada`, { texto: 'Deshacer', onClick: () => cambiarEtiquetas(antes, {}) });
      }
    } catch (e: any) {
      setLead((l: any) => ({ ...l, etiquetas: antes }));
      aviso.error(e.message);
    }
  }

  async function marcar(i: number, valor: boolean) {
    const campo = `calif_c${i + 1}`;
    setLead((l: any) => ({ ...l, [campo]: valor }));
    try {
      const r = await api(`/leads/${leadId}`, { method: 'PATCH', json: { [campo]: valor } });
      recordar(r);
      setLead(r);
    } catch (e: any) {
      setLead((l: any) => ({ ...l, [campo]: !valor }));
      aviso.error(e.message);
    }
  }

  async function volverAConsiderar() {
    try {
      const r = await api(`/leads/${leadId}`, { method: 'PATCH', json: { calificacion: 'sin_calificar', motivo_descarte: null } });
      recordar(r);
      setLead(r);
      avisarLeadCambiado(leadId);
      aviso.exito(`${quienDe(r)} vuelve a estar en juego.`);
    } catch (e: any) { aviso.error(e.message); }
  }

  function copiarUsuario() {
    const u = `@${lead.ig_username}`;
    navigator.clipboard?.writeText(u).then(() => aviso.exito(`${u} copiado`)).catch(() => aviso.error('No se pudo copiar'));
  }

  // ---------------- Cabecera ----------------

  const navegacion = lista && (
    <div className="flex items-center">
      <BotonIcono etiqueta="Lead anterior" onClick={() => anterior?.()} disabled={!anterior}>
        <Icono nombre="volver" tam={18} />
      </BotonIcono>
      <span className="cifras hidden min-w-[44px] text-center text-[11px] text-[var(--text-muted)] sm:inline" aria-live="polite">
        {indice + 1} de {lista.ids.length}
      </span>
      <BotonIcono etiqueta="Lead siguiente" onClick={() => siguiente?.()} disabled={!siguiente}>
        <Icono nombre="siguiente" tam={18} />
      </BotonIcono>
    </div>
  );

  const cerrar = (
    <BotonIcono etiqueta="Cerrar la ficha" onClick={alCerrar}>
      <Icono nombre="cerrar" tam={18} />
    </BotonIcono>
  );

  const cabecera = !lead ? (
    <div className="flex items-start gap-3 px-4 pb-3 pt-2 md:px-5 md:pt-4">
      <Esqueleto alto={44} ancho={44} className="shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2 pt-1">
        <Esqueleto alto={16} ancho="60%" />
        <Esqueleto alto={12} ancho="40%" />
      </div>
      {navegacion}{cerrar}
    </div>
  ) : (
    <div className="px-4 pb-2.5 pt-1.5 md:px-5 md:pt-4">
      <div className="flex items-start gap-3">
        <Avatar id={lead.id} nombre={nombreCompleto || null} usuario={lead.ig_username} foto={lead.avatar_url} tam={40} />
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className="truncate text-[17px] font-semibold leading-tight tracking-tight">{nombreVisible(nombreCompleto, lead.ig_username)}</h2>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12px] text-[var(--text-muted)]">
            {nombreCompleto && lead.ig_username && <span className="truncate font-medium" style={{ color: 'var(--series-1)' }}>@{lead.ig_username}</span>}
            {lead.pais && <span>· {lead.pais}</span>}
            {Number(lead.valor_total) > 0 && (
              <span className="cifras font-semibold" style={{ color: 'var(--status-good)' }}>· {fmtDinero(lead.valor_total)}</span>
            )}
          </div>
        </div>
        <div className="-mr-2 flex shrink-0 items-center">
          {navegacion}
          <Menu alinear="derecha" ancho={250} disparador={({ alternar, abierto, ref }) => (
            <BotonIcono ref={ref} etiqueta="Más acciones" onClick={alternar} aria-haspopup="menu" aria-expanded={abierto}>
              <Icono nombre="puntos" tam={17} />
            </BotonIcono>
          )}>
            {lead.ig_username && <ItemMenu icono={<IconoMenu d="M8 8h11v11H8zM5 16V5h11" />} onClick={copiarUsuario}>Copiar @{lead.ig_username}</ItemMenu>}
            {lead.ig_username && (
              <ItemMenu icono={<IconoMenu d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />}
                onClick={() => window.open(`https://instagram.com/${lead.ig_username}`, '_blank', 'noopener,noreferrer')}>
                Ver su perfil de Instagram
              </ItemMenu>
            )}
            <ItemMenu icono={<IconoMenu d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" />} onClick={() => setDialogo('editar')}>Editar datos</ItemMenu>
            <SeparadorMenu />
            {lead.calificacion === 'no_calificado'
              ? <ItemMenu onClick={volverAConsiderar} icono={<IconoMenu d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />}>Volver a considerar</ItemMenu>
              : <ItemMenu peligro onClick={() => setDialogo('descartar')} icono={<IconoMenu d="M18 6 6 18M6 6l12 12" />}>Descartar lead</ItemMenu>}
          </Menu>
          {cerrar}
        </div>
      </div>

      {/* Barra de acciones: en el celular se desliza de costado. */}
      <div data-no-deslizar data-no-arrastrar className="sin-barra -mx-4 mt-2.5 flex items-center gap-1.5 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
        <Boton tamano="sm" variante="primario" icono={<Icono nombre="bandeja" tam={15} />} onClick={() => navegar(`/chat/${lead.id}`)}>
          Chat
        </Boton>
        {opp && (
          <Menu titulo="Mover a" ancho={300} disparador={({ alternar, abierto, ref }) => (
            <Boton ref={ref} tamano="sm" onClick={alternar} aria-haspopup="menu" aria-expanded={abierto} className="max-w-[150px] sm:max-w-[210px]">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: lead.etapa_color ?? 'var(--baseline)' }} aria-hidden />
              <span className="truncate">{lead.etapa_nombre ?? 'Etapa'}</span>
              <Flecha />
            </Boton>
          )}>
            {pipeline && <div className="px-2.5 pb-1 text-[11px] text-[var(--text-muted)]">{pipeline.nombre}</div>}
            {etapas.length === 0 && <div className="px-2.5 py-2 text-[12px] text-[var(--text-muted)]">Cargando etapas…</div>}
            {etapas.map((e) => (
              <ItemMenu key={e.id} activo={e.id === lead.etapa_id} onClick={() => moverA(e)}
                descripcion={e.tipo === 'ganada' ? 'Registra la venta' : e.tipo === 'perdida' ? 'Te pregunta por qué' : (resumirAcciones(e) ? `Automático: ${resumirAcciones(e)}` : undefined)}
                icono={<span className="h-2.5 w-2.5 rounded-full" style={{ background: e.color }} />}>
                {e.nombre}
              </ItemMenu>
            ))}
          </Menu>
        )}
        <Menu titulo="Lo atiende" ancho={260} disparador={({ alternar, abierto, ref }) => (
          <Boton ref={ref} tamano="sm" onClick={alternar} aria-haspopup="menu" aria-expanded={abierto} className="max-w-[130px] sm:max-w-[200px]"
            aria-label={responsable ? `Lo atiende ${responsable.nombre}. Cambiar` : 'Sin asignar. Asignar a alguien'}>
            {responsable
              ? <Avatar id={responsable.id} nombre={responsable.nombre} tam={18} />
              : <span className="text-[var(--text-muted)]"><Icono nombre="leads" tam={15} /></span>}
            <span className={`truncate ${responsable ? '' : 'italic text-[var(--text-secondary)]'}`}>
              {responsable ? <><span className="sm:hidden">{String(responsable.nombre).split(' ')[0]}</span><span className="hidden sm:inline">{responsable.nombre}</span></> : 'Sin asignar'}
            </span>
            <Flecha />
          </Boton>
        )}>
          {(ctx?.usuarios ?? []).map((u) => (
            <ItemMenu key={u.id} activo={u.id === responsableId} onClick={() => asignar(u.id)}
              icono={<Avatar id={u.id} nombre={u.nombre} tam={20} />}>{u.nombre}</ItemMenu>
          ))}
          {!ctx && <div className="px-2.5 py-2 text-[12px] text-[var(--text-muted)]">Cargando el equipo…</div>}
          <SeparadorMenu />
          <ItemMenu activo={!responsableId} onClick={() => asignar(null)}>Sin asignar</ItemMenu>
        </Menu>
      </div>

      <div data-no-arrastrar className="mt-2">
        <EditorEtiquetas etiquetas={lead.etiquetas ?? []} sugerencias={ctx?.etiquetas ?? []} onCambiar={cambiarEtiquetas} />
      </div>

      <Pestanas className="mt-1.5 -mb-2.5 border-b-0" actual={tab} onCambiar={setTab} pestanas={[
        { id: 'resumen', etiqueta: 'Resumen' },
        { id: 'historial', etiqueta: 'Historial', contador: (lead.eventos ?? []).length },
        { id: 'notas', etiqueta: 'Notas', contador: (lead.notas ?? []).length },
      ]} />
    </div>
  );

  // ---------------- Cuerpo ----------------

  let cuerpo: React.ReactNode;
  if (error && !lead) {
    cuerpo = error?.estado === 404
      ? <Vacio icono={<Icono nombre="leads" tam={22} />} titulo="Este lead ya no existe" texto="Puede que lo hayan borrado o que el link sea de otra cuenta."
          accion={<Boton onClick={alCerrar}>Cerrar</Boton>} />
      : <ErrorCarga error={error} titulo="No pudimos abrir la ficha" onReintentar={cargar} />;
  } else if (!lead) {
    cuerpo = (
      <div className="space-y-3 px-4 py-4 md:px-5" aria-busy="true" aria-label="Cargando la ficha">
        <Esqueleto alto={72} className="rounded-xl" />
        <Esqueleto alto={110} className="rounded-xl" />
        <Esqueleto alto={84} className="rounded-xl" />
      </div>
    );
  } else if (tab === 'historial') {
    cuerpo = <div className="px-4 py-4 md:px-5"><HistorialLead eventos={lead.eventos ?? []} contenidoOrigen={lead.contenido_titulo} /></div>;
  } else if (tab === 'notas') {
    cuerpo = (
      <div className="space-y-2 px-4 py-4 md:px-5">
        {(lead.notas ?? []).length === 0 && (
          <Vacio compacto icono={<IconoMenu d="M4 20h4L19 9l-4-4L4 16z" tam={18} />} titulo="Todavía no hay notas"
            texto="Anotá qué pasó en la llamada o en el chat, y el próximo paso. Abajo tenés la caja." />
        )}
        {(lead.notas ?? []).map((n: any) => (
          <article key={n.id} className="rounded-lg px-3 py-2.5" style={{ background: 'var(--page-plane)' }}>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{n.cuerpo}</p>
            <div className="mt-1 text-[11px] text-[var(--text-muted)]">{n.usuario_nombre ?? 'Automático'} · {fmtFecha(n.creado_en, true)}</div>
          </article>
        ))}
      </div>
    );
  } else {
    cuerpo = <Resumen lead={lead} onMarcar={marcar} onEditar={() => setDialogo('editar')} onVolver={volverAConsiderar} />;
  }

  return (
    <PanelLateral etiqueta={lead ? `Ficha de ${quien}` : 'Ficha del lead'} onCerrar={alCerrar} animacion={animacion}
      onAnterior={anterior} onSiguiente={siguiente} cabecera={cabecera}
      pie={lead ? <CajaNota key={lead.id} leadId={lead.id} onGuardada={(n) => setLead((l: any) => ({ ...l, notas: [n, ...(l.notas ?? [])] }))} /> : null}>
      <div className={animacion === 'nada' ? '' : 'ui-fundido'}>{cuerpo}</div>

      {dialogo === 'editar' && lead && (
        <DialogoEditarDatos lead={lead} onCerrar={() => setDialogo(null)}
          onGuardado={(r) => { recordar(r); setLead(r); setDialogo(null); avisarLeadCambiado(r.id); }} />
      )}
      {dialogo === 'descartar' && lead && (
        <DialogoDescartar lead={lead} quien={quien} onCerrar={() => setDialogo(null)}
          onListo={(r) => {
            recordar(r); setLead(r); setDialogo(null); avisarLeadCambiado(r.id);
            aviso.exito(`${quien} quedó descartado.`, { texto: 'Deshacer', onClick: volverAConsiderar });
          }} />
      )}
      {acciones.dialogos}
    </PanelLateral>
  );
}

// ---------------------------------------------------------------------
// Resumen: temperatura, checklist para la llamada, de dónde vino y datos
// ---------------------------------------------------------------------

function Resumen({ lead, onMarcar, onEditar, onVolver }: {
  lead: any; onMarcar: (i: number, v: boolean) => void; onEditar: () => void; onVolver: () => void;
}) {
  const score = Number(lead.score ?? 0);
  const t = TEMPERATURAS[temperaturaDe(score)];
  const motivos: Array<{ motivo: string; puntos: number }> = Array.isArray(lead.score_detalle) ? lead.score_detalle : [];
  const eventos: any[] = lead.eventos ?? [];
  const marcados = [lead.calif_c1, lead.calif_c2, lead.calif_c3].filter(Boolean).length;
  const resultado = RESULTADO_CHECKLIST[marcados];
  const cargadoAMano = eventos.some((e) => e.tipo === 'lead_creado' && e.fuente === 'manual');
  const primerToque = (lead.toques ?? []).find((x: any) => x.contenido_id && x.contenido_id === lead.primer_contenido_id)
    ?? (lead.toques ?? []).find((x: any) => x.contenido_id);
  const datos: Array<[string, string]> = ([
    ['Email', lead.email], ['Teléfono', lead.telefono], ['A qué se dedica', lead.modelo_negocio],
    ['Cuánto factura', lead.ingresos_aprox], ['Qué lo frena', lead.cuello_botella],
  ] as Array<[string, string]>).filter(([, v]) => Boolean(v));
  const otras = (lead.oportunidades ?? []).filter((o: any) => o.id !== lead.oportunidad_id);

  let sinPuntos = 'Todavía no interactuó.';
  if (eventos.some((e) => e.tipo === 'recurso_entregado')) sinPuntos = 'Pidió el recurso y todavía no respondió.';
  else if (cargadoAMano) sinPuntos = 'Lo cargaste a mano y todavía no interactuó.';

  return (
    <div className="space-y-4 px-4 py-4 md:px-5">
      {lead.calificacion === 'no_calificado' && (
        <Banner tono="aviso" accion={<Boton tamano="sm" onClick={onVolver}>Volver a considerar</Boton>}>
          Descartado{lead.motivo_descarte ? `: ${String(lead.motivo_descarte).toLowerCase()}` : ''}.
        </Banner>
      )}

      {/* Temperatura */}
      <section>
        <TituloChico ayuda={<>Sale sola de lo que hizo el lead: si respondió, si contó de su negocio, si agendó o compró, y de qué contenido vino. Va de 0 a 100.</>}>
          Temperatura
        </TituloChico>
        <div className="flex flex-wrap items-center gap-2">
          <Temperatura score={score} />
          <span className="text-[12px] text-[var(--text-secondary)]">{t.ayuda}</span>
        </div>
        <Desplegable tarjeta={false} clave="ficha-porque" className="-mx-3.5 mt-1"
          titulo={<span className="text-[13px] font-medium">Por qué tiene {score}</span>}>
          {motivos.length ? (
            <ul className="space-y-1 px-3.5 text-[12px]">
              {motivos.map((d, i) => (
                <li key={i} className="flex items-baseline justify-between gap-2">
                  <span className="text-[var(--text-secondary)]">{d.motivo}</span>
                  <span className="cifras shrink-0 font-medium" style={{ color: 'var(--status-good)' }}>+{d.puntos}</span>
                </li>
              ))}
            </ul>
          ) : <p className="px-3.5 text-[12px] text-[var(--text-muted)]">{sinPuntos}</p>}
        </Desplegable>
      </section>

      {/* Checklist para la llamada */}
      <section className="rounded-xl p-3" style={{ background: 'var(--page-plane)' }}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <TituloChico sinMargen ayuda="Lo marcás vos (o el closer) después de hablar con el lead. Con las 3 preguntas en sí, está perfecto para vender.">
            Checklist para la llamada
          </TituloChico>
          <Insignia tono={resultado.tono}>
            {marcados > 0 && <span className="cifras">{marcados} de 3 ·</span>}{resultado.texto}
          </Insignia>
        </div>
        <div className="space-y-2.5">
          {PREGUNTAS_CHECKLIST.map((p, i) => (
            <div key={p} className="flex min-h-[32px] items-center">
              <Interruptor activo={Boolean(lead[`calif_c${i + 1}`])} onCambiar={(v) => onMarcar(i, v)}
                etiqueta={<span className="text-[13px] text-[var(--text-primary)]">{p}</span>} />
            </div>
          ))}
        </div>
      </section>

      {/* De dónde vino */}
      <section>
        <TituloChico>De dónde vino</TituloChico>
        {lead.contenido_titulo ? (
          <div className="flex items-start gap-3">
            <Portada url={lead.contenido_thumbnail} tipo={lead.contenido_tipo} tam="sm" />
            <div className="min-w-0 flex-1">
              {lead.contenido_permalink ? (
                <a href={lead.contenido_permalink} target="_blank" rel="noreferrer"
                  className="ui-foco line-clamp-2 rounded text-[13px] font-medium hover:underline">
                  {lead.contenido_titulo} <span aria-hidden className="text-[var(--text-muted)]">↗</span>
                </a>
              ) : <div className="line-clamp-2 text-[13px] font-medium">{lead.contenido_titulo}</div>}
              <div className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                {[TIPO_CONTENIDO[lead.contenido_tipo] ?? null, metodoAtribucion(primerToque?.metodo, lead.palabra_clave), fmtFecha(lead.primer_contacto_en)]
                  .filter(Boolean).join(' · ')}
              </div>
              {primerToque && CONFIANZA[primerToque.confianza] && primerToque.confianza !== 'alta' && (
                <div className="mt-1 flex items-center gap-1">
                  <Insignia tono={CONFIANZA[primerToque.confianza].tono}>Origen {CONFIANZA[primerToque.confianza].texto.toLowerCase()}</Insignia>
                  <Ayuda titulo="¿Por qué dudoso?">
                    Comentó una palabra que usás en varios reels, así que no sabemos con seguridad cuál lo trajo. Usá una palabra distinta en cada reel.
                  </Ayuda>
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-[var(--text-secondary)]">
            {cargadoAMano ? 'Lo cargaste a mano.' : 'No sabemos de qué reel vino.'}
            <span className="text-[var(--text-muted)]"> {fmtFecha(lead.primer_contacto_en)}</span>
          </p>
        )}
      </section>

      {/* Datos */}
      <section>
        <div className="flex items-center justify-between gap-2">
          <TituloChico sinMargen>Datos</TituloChico>
          <button type="button" onClick={onEditar} aria-label={datos.length ? 'Editar sus datos' : 'Agregar sus datos'}
            className="ui-foco -mr-1.5 h-8 rounded-md px-2 text-[12px] font-medium text-[var(--series-1)] hover:bg-[var(--page-plane)]">
            {datos.length ? 'Editar' : 'Agregar'}
          </button>
        </div>
        {datos.length ? (
          <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {datos.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-[11px] text-[var(--text-muted)]">{k}</dt>
                <dd className="break-words text-[13px]">{v}</dd>
              </div>
            ))}
          </dl>
        ) : <p className="mt-1 text-[12px] text-[var(--text-muted)]">Sin email ni teléfono todavía. Si te los pasó en el chat, agregalos.</p>}
      </section>

      {otras.length > 0 && (
        <section>
          <TituloChico>También está en</TituloChico>
          <ul className="space-y-1.5">
            {otras.map((o: any) => (
              <li key={o.id} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: o.etapa_color }} aria-hidden />
                  <span className="truncate">{o.pipeline_nombre} · {o.etapa_nombre}</span>
                </span>
                <span className="cifras shrink-0 text-[var(--text-muted)]">
                  {Number(o.valor) > 0 ? `${fmtDinero(o.valor)} · ` : ''}{fmtFecha(o.abierta_en)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function TituloChico({ children, ayuda, sinMargen }: { children: React.ReactNode; ayuda?: React.ReactNode; sinMargen?: boolean }) {
  return (
    <h3 className={`${sinMargen ? '' : 'mb-1.5'} flex items-center gap-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]`}>
      {children}
      {ayuda && <Ayuda titulo={typeof children === 'string' ? children : undefined}>{ayuda}</Ayuda>}
    </h3>
  );
}

function Flecha() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" className="shrink-0 text-[var(--text-muted)]" aria-hidden>
      <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconoMenu({ d, tam = 16 }: { d: string; tam?: number }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
