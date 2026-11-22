import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmtNum, plural } from '../../api';
import {
  Ayuda, Boton, Chip, Desplegable, ErrorCarga, FilaChips, FilaDeslizable, Girando, IdentidadLead, Insignia, ItemMenu,
  Menu, SeparadorMenu, nombreVisible, useAviso, useEsMovil, type AccionFila,
} from '../../ui';
import Icono from '../Iconos';
import { useFicha } from '../useFicha';
import { IconoPanel } from './iconos';
import type { LeadQuieto, Quietos } from './tipos';

// Leads quietos (sin moverse de etapa ni recibir mensajes hace más de 7
// días). Primero los que todavía se pueden salvar: los más avanzados y, en
// cada etapa, los que menos días llevan quietos. Cada fila es el lead como
// en toda la app (avatar, nombre, @usuario); tocarla abre la ficha encima
// del Panel (Atrás la cierra). Acciones: "⋯" o deslizar en el celular.

function quitar(d: Quietos, l: LeadQuieto): Quietos {
  return {
    ...d,
    total: Math.max(0, d.total - 1),
    leads: d.leads.filter((x) => x.oportunidad_id !== l.oportunidad_id),
    por_etapa: d.por_etapa?.map((e) => (e.etapa_id === l.etapa_id ? { ...e, n: Math.max(0, e.n - 1) } : e)).filter((e) => e.n > 0),
  };
}

/** Deshacer: el lead vuelve a la lista, en su lugar (y a su chip de etapa). */
function reponer(d: Quietos, l: LeadQuieto, indice: number, etapaAntes: NonNullable<Quietos['por_etapa']>[number] | undefined): Quietos {
  if (d.leads.some((x) => x.oportunidad_id === l.oportunidad_id)) return d;
  const leads = [...d.leads];
  leads.splice(Math.min(Math.max(indice, 0), leads.length), 0, l);
  const porEtapa = d.por_etapa ?? [];
  const yaEsta = porEtapa.some((e) => e.etapa_id === l.etapa_id);
  return {
    ...d,
    total: d.total + 1,
    leads,
    por_etapa: yaEsta
      ? porEtapa.map((e) => (e.etapa_id === l.etapa_id ? { ...e, n: e.n + 1 } : e))
      : etapaAntes ? [...porEtapa, { ...etapaAntes, n: 1 }].sort((a, b) => Number(b.pipeline_predeterminado) - Number(a.pipeline_predeterminado) || b.orden - a.orden) : porEtapa,
  };
}

/** Lo máximo que trae el servidor de una vez: más que eso se sigue en el Pipeline. */
const MAXIMO = 100;

const abrirInstagram = (usuario: string) => window.open(`https://ig.me/m/${encodeURIComponent(usuario.replace(/^@/, ''))}`, '_blank', 'noopener');

export function LeadsQuietos({ inicial, plegable, abierto, onCambiarAbierto, soloMios }: {
  /** Lo que ya vino con el Panel (para no mostrar un hueco mientras carga). */
  inicial?: Quietos;
  /** Celular: sección plegable. */
  plegable?: boolean;
  abierto?: boolean;
  onCambiarAbierto?: (v: boolean) => void;
  /** Setters y closers: arranca mostrando solo los suyos. */
  soloMios?: boolean;
}) {
  const aviso = useAviso();
  const navegar = useNavigate();
  const ficha = useFicha();
  const movil = useEsMovil(768);
  const [etapa, setEtapa] = useState<string | null>(null);
  const [mios, setMios] = useState(Boolean(soloMios));
  const [limite, setLimite] = useState(5);
  const [datos, setDatos] = useState<Quietos | null>(inicial && !soloMios ? { ...inicial, leads: inicial.leads.slice(0, 5) } : null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const turno = useRef(0);

  const cargar = useCallback(async () => {
    const yo = ++turno.current;
    setCargando(true);
    try {
      const qs = new URLSearchParams({ limite: String(limite) });
      if (etapa) qs.set('etapa_id', etapa);
      if (mios) qs.set('mios', '1');
      const d = await api<Quietos>(`/ux/panel/quietos?${qs}`);
      if (yo === turno.current) { setDatos(d); setError(null); }
    } catch (e: any) {
      if (yo === turno.current) setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (yo === turno.current) setCargando(false);
    }
  }, [limite, etapa, mios]);

  useEffect(() => { cargar(); }, [cargar]);

  // Al cerrar la ficha (pudo haber movido al lead o escrito), refrescamos.
  const fichaAbierta = ficha.abierta;
  const antes = useRef(fichaAbierta);
  useEffect(() => {
    if (antes.current && !fichaAbierta) cargar();
    antes.current = fichaAbierta;
  }, [fichaAbierta, cargar]);

  async function mover(l: LeadQuieto, destino: { id: string; nombre: string }, perdido = false) {
    const quien = nombreVisible(l.nombre, l.ig_username);
    const indice = datos?.leads.findIndex((x) => x.oportunidad_id === l.oportunidad_id) ?? 0;
    const etapaAntes = datos?.por_etapa?.find((e) => e.etapa_id === l.etapa_id);
    setDatos((d) => (d ? quitar(d, l) : d));
    try {
      if (perdido) await api('/ux/pipeline/perdido', { method: 'POST', json: { oportunidad_id: l.oportunidad_id, etapa_id: destino.id } });
      else await api(`/oportunidades/${l.oportunidad_id}/etapa`, { method: 'POST', json: { etapa_id: destino.id } });
      aviso.exito(perdido ? `${quien} quedó como perdido` : `${quien} pasó a «${destino.nombre}»`, {
        texto: 'Deshacer',
        onClick: async () => {
          try {
            await api(`/oportunidades/${l.oportunidad_id}/etapa`, { method: 'POST', json: { etapa_id: l.etapa_id, sin_acciones: true } });
            // Vuelve a la lista donde estaba. No se recarga: para el servidor el lead
            // ya "se movió" (dos veces) y dejaría de aparecer, como si no se hubiera deshecho.
            setDatos((d) => (d ? reponer(d, l, indice, etapaAntes) : d));
            aviso.info(`${quien} volvió a «${l.etapa}»`);
          } catch (e: any) {
            aviso.error(e?.message ?? 'No se pudo deshacer');
            cargar();
          }
        },
      });
    } catch (e: any) {
      aviso.error(e?.message ?? 'No se pudo mover');
      cargar();
    }
  }

  const total = datos?.total ?? 0;
  const porEtapa = datos?.por_etapa ?? [];
  const nombresRepetidos = new Set(porEtapa.map((e) => e.etapa).filter((n, i, a) => a.indexOf(n) !== i));
  const filtrado = etapa ? (porEtapa.find((e) => e.etapa_id === etapa)?.n ?? 0) : total;
  const leads = datos?.leads ?? [];
  const quedan = Math.max(0, filtrado - leads.length);
  const primero = leads[0];

  const fila = (l: LeadQuieto) => {
    const etapas = datos?.etapas_por_pipeline?.[l.pipeline_id] ?? [];
    const destinos = etapas.filter((e) => e.tipo === 'abierta' && e.id !== l.etapa_id);
    const perdida = etapas.find((e) => e.tipo === 'perdida');
    const acciones: AccionFila[] = [
      ...(l.ig_username ? [{ etiqueta: 'Instagram', icono: <IconoPanel nombre="instagram" tam={16} />, color: 'var(--series-1)', onClick: () => abrirInstagram(l.ig_username!) }] : []),
      ...(perdida ? [{ etiqueta: 'Perdido', icono: <IconoPanel nombre="perdido" tam={16} />, color: 'var(--status-critical)', onClick: () => mover(l, perdida, true) }] : []),
    ];
    // Como la tarjeta del Pipeline: quién es (avatar, nombre, @usuario) y, abajo,
    // en qué etapa está y quién lo atiende.
    const cuerpo = (
      <div className="group flex items-center gap-2 py-2 pl-0.5" style={{ background: 'var(--surface-1)' }}>
        <button type="button" onClick={() => ficha.abrir(l.lead_id)} aria-label={`Abrir la ficha de ${nombreVisible(l.nombre, l.ig_username)}`}
          className="ui-foco min-w-0 flex-1 rounded-lg py-0.5 text-left">
          <IdentidadLead id={l.lead_id} nombre={l.nombre} usuario={l.ig_username} foto={l.avatar_url} />
          <span className="mt-0.5 block truncate pl-10 text-[12px] text-[var(--text-secondary)]">
            {l.etapa} · {l.responsable ?? <em>sin asignar</em>}
          </span>
        </button>
        <Insignia tono={l.dias_quieto > 30 ? 'rojo' : 'amarillo'}>{plural(l.dias_quieto, 'día', 'días')}</Insignia>
        <Menu alinear="derecha" ancho={260} titulo={destinos.length ? 'Mover a' : undefined} disparador={({ abierto: ab, alternar, ref }) => (
          <button ref={ref} type="button" onClick={alternar} aria-haspopup="menu" aria-expanded={ab}
            aria-label={`Más acciones para ${nombreVisible(l.nombre, l.ig_username)}`}
            className={`ui-foco flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--page-plane)] hover:text-[var(--text-primary)] md:h-8 md:w-8 ${ab ? '' : 'md:[@media(hover:hover)]:opacity-0 md:focus:opacity-100 md:group-hover:opacity-100 md:group-focus-within:opacity-100'}`}>
            <Icono nombre="puntos" tam={17} />
          </button>
        )}>
          {destinos.map((e) => <ItemMenu key={e.id} onClick={() => mover(l, e)}>{e.nombre}</ItemMenu>)}
          {destinos.length > 0 && <SeparadorMenu />}
          <ItemMenu icono={<Icono nombre="leads" tam={15} />} onClick={() => ficha.abrir(l.lead_id)}>Ver ficha</ItemMenu>
          <ItemMenu icono={<Icono nombre="bandeja" tam={15} />} onClick={() => navegar(`/chat/${l.lead_id}`)}>Abrir chat</ItemMenu>
          {l.ig_username && <ItemMenu icono={<IconoPanel nombre="instagram" tam={15} />} onClick={() => abrirInstagram(l.ig_username!)}>Escribirle por Instagram</ItemMenu>}
          {perdida && <SeparadorMenu />}
          {perdida && <ItemMenu peligro icono={<IconoPanel nombre="perdido" tam={15} />} onClick={() => mover(l, perdida, true)}>Marcar perdido</ItemMenu>}
        </Menu>
      </div>
    );
    return (
      <li key={l.oportunidad_id} className="border-b border-[var(--border-hairline)] last:border-0">
        {movil && acciones.length ? <FilaDeslizable acciones={acciones}>{cuerpo}</FilaDeslizable> : cuerpo}
      </li>
    );
  };

  const contenido = (
    <div className={`transition-opacity ${cargando && datos ? 'opacity-60' : ''}`}>
      {!plegable && (
        <p className="mb-2 text-[12px] text-[var(--text-secondary)]">
          Llevan más de {datos?.dias ?? 7} días sin novedades. Retomalos desde Instagram o cerralos.
        </p>
      )}
      {(porEtapa.length > 1 || soloMios !== undefined) && (
        <FilaChips className={`mb-1.5 md:flex-nowrap md:barra-fina md:pb-1.5 ${plegable ? '!-mx-3.5 !px-3.5' : ''}`}>
          {soloMios !== undefined && <Chip activo={mios} onClick={() => { setMios((v) => !v); setEtapa(null); setLimite(5); }}>Míos</Chip>}
          {porEtapa.length > 1 && <Chip activo={!etapa} contador={total} onClick={() => { setEtapa(null); setLimite(5); }}>Todos</Chip>}
          {porEtapa.length > 1 && porEtapa.slice(0, 6).map((e) => (
            <Chip key={e.etapa_id} activo={etapa === e.etapa_id} contador={e.n} onClick={() => { setEtapa(e.etapa_id); setLimite(5); }}>
              {nombresRepetidos.has(e.etapa) ? `${e.etapa} (${e.pipeline})` : e.etapa}
            </Chip>
          ))}
        </FilaChips>
      )}
      {error && !datos ? (
        <ErrorCarga compacto error={error} titulo="No pudimos cargar los leads quietos" onReintentar={cargar} />
      ) : !datos ? (
        <div className="flex justify-center py-6 text-[var(--text-muted)]"><Girando /></div>
      ) : leads.length === 0 ? (
        <div className="flex items-center gap-2.5 rounded-lg px-3 py-3 text-[13px]" style={{ background: 'var(--page-plane)' }}>
          <span style={{ color: 'color-mix(in srgb, var(--status-good) 72%, var(--text-primary))' }}><IconoPanel nombre="check" tam={16} grosor={2.4} /></span>
          {mios ? 'No tenés leads quietos.' : 'Nadie quieto hace más de 7 días: el equipo está al día.'}
        </div>
      ) : (
        <>
          <ul>{leads.map(fila)}</ul>
          {quedan > 0 && (limite < MAXIMO ? (
            <Boton variante="fantasma" anchoCompleto className="mt-1 !text-[var(--series-1)]" cargando={cargando}
              onClick={() => setLimite((v) => Math.min(MAXIMO, v + 10))}>
              {`Ver más (${fmtNum(quedan)})`}
            </Boton>
          ) : (
            <Boton variante="fantasma" anchoCompleto className="mt-1 !text-[var(--series-1)]" onClick={() => navegar('/pipeline')}>
              {`Hay ${fmtNum(quedan)} más: seguí desde el Pipeline`}
            </Boton>
          ))}
        </>
      )}
    </div>
  );

  const titulo = (
    <span className="inline-flex items-center gap-1.5">
      {soloMios ? 'Tus leads quietos' : 'Leads quietos'}
      {total > 0 && <Insignia tono={total > 50 ? 'rojo' : 'amarillo'}>{fmtNum(total)}</Insignia>}
    </span>
  );

  if (plegable) {
    return (
      <div id="leads-quietos" className="scroll-mt-20">
        <Desplegable titulo={titulo} abierto={abierto} onCambiar={onCambiarAbierto}
          subtitulo={primero ? `Empezá por ${nombreVisible(primero.nombre, primero.ig_username)} · ${primero.etapa}` : 'Más de 7 días sin novedades'}>
          {contenido}
        </Desplegable>
      </div>
    );
  }
  return (
    <section id="leads-quietos" className="tarjeta min-w-0 scroll-mt-20 p-4" aria-label="Leads quietos">
      <div className="mb-1 flex items-center gap-1.5">
        <h2 className="text-[15px] font-semibold">{titulo}</h2>
        <Ayuda titulo="Leads quietos">
          Oportunidades abiertas que hace más de 7 días no cambian de etapa ni reciben mensajes. Primero van los que
          todavía se pueden salvar: los más avanzados en el embudo y, en cada etapa, los que menos días llevan quietos.
        </Ayuda>
      </div>
      {contenido}
    </section>
  );
}
