import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, fmtDinero, fmtNum, hace, plural } from '../api';
import {
  Avatar, Ayuda, Boton, BotonFlotante, BotonIcono, Buscador, Chip, Dialogo, ErrorCarga, Esqueleto, FilaChips,
  FilaDeslizable, IdentidadLead, ItemMenu, Menu, SeparadorMenu, Vacio, useAviso, useEsMovil,
} from '../ui';
import Icono from '../componentes/Iconos';
import { useFicha } from '../componentes/useFicha';
import TarjetaLead from '../componentes/contenidos-leads/TarjetaLead';
import Portada from '../componentes/contenidos-leads/Portada';
import NuevoLead from '../componentes/contenidos-leads/NuevoLead';
import FiltrosLeads, {
  AVANZADOS, CALIFICACIONES, DIAS, ORDENES, SIN_FILTROS, VISTAS, paramsApi, type Filtros, type Orden, type Vista,
} from '../componentes/contenidos-leads/FiltrosLeads';
import { Temperatura, TEMPERATURAS, type IdTemperatura } from '../componentes/contenidos-leads/temperatura';
import { cargarContexto, olvidarContexto, type Contexto, type Etapa } from '../componentes/contenidos-leads/contexto';
import { useAccionesLead } from '../componentes/contenidos-leads/accionesLead';
import { EVENTO_LEAD_CAMBIADO, guardarListaFicha } from '../componentes/contenidos-leads/listaFicha';

// Leads: todos los contactos, para buscar y filtrar rápido.
// - Escritorio: tabla (tocar la fila abre la ficha). Celular: tarjetas estilo
//   Kommo que se deslizan para ver Chat · Mover · Asignar.
// - Filtros y página en la URL (?vista=mios&etiqueta=vip…): Atrás, recargar y
//   volver del Chat dejan la lista igual.
// - La ficha es la global (?ficha=<id>): Atrás la cierra y se puede pasar al
//   lead siguiente sin cerrarla.

const POR_PAGINA = 50;
const CLAVES: Array<keyof Filtros> = ['q', 'vista', 'etiqueta', 'etapa', 'resp', 'temp', 'calif', 'dias', 'contenido', 'orden'];

/** Todos los filtros en la URL, y un solo cambio para varios a la vez. */
function useFiltrosUrl() {
  const [params, setParams] = useSearchParams();
  const filtros = useMemo<Filtros>(() => {
    const f = { ...SIN_FILTROS };
    for (const k of CLAVES) { const v = params.get(k); if (v) (f as any)[k] = v; }
    if (!VISTAS.some((v) => v.id === f.vista)) f.vista = 'todos';
    if (!ORDENES.some((o) => o.id === f.orden)) f.orden = 'reciente';
    return f;
  }, [params]);
  const pagina = Math.max(0, (Number(params.get('pag')) || 1) - 1);
  const cambiar = useCallback((c: Partial<Filtros> & { pag?: number }) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(c)) {
        if (k === 'pag') continue;
        if (v === undefined || v === null || v === '' || v === (SIN_FILTROS as any)[k]) p.delete(k); else p.set(k, String(v));
      }
      if (c.pag && c.pag > 1) p.set('pag', String(c.pag)); else p.delete('pag');
      return p;
    }, { replace: true });
  }, [setParams]);
  return { filtros, pagina, cambiar };
}

interface Datos { leads: any[]; total: number; conteos: Record<string, number> | null; contenido: any | null }

export default function Leads() {
  const aviso = useAviso();
  const navegar = useNavigate();
  const ficha = useFicha();
  const movil = useEsMovil(768);
  const { filtros, pagina, cambiar } = useFiltrosUrl();
  const [busqueda, setBusqueda] = useState(filtros.q);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<any>(null);
  const [masCargando, setMasCargando] = useState(false);
  const [ctx, setCtx] = useState<Contexto | null>(null);
  const [verFiltros, setVerFiltros] = useState(false);
  const [nuevo, setNuevo] = useState<string | null>(null);
  const [hoja, setHoja] = useState<null | { tipo: 'mover' | 'asignar'; l: any }>(null);
  const acciones = useAccionesLead();
  const turno = useRef(0);
  const inicioLista = useRef<HTMLDivElement>(null);

  useEffect(() => { cargarContexto().then(setCtx).catch(() => {}); }, []);

  // El buscador escribe en la URL con una pausa (y se sincroniza si la URL cambia por Atrás).
  useEffect(() => { setBusqueda(filtros.q); }, [filtros.q]);
  useEffect(() => {
    if (busqueda === filtros.q) return;
    const t = window.setTimeout(() => cambiar({ q: busqueda }), 250);
    return () => window.clearTimeout(t);
  }, [busqueda]); // eslint-disable-line react-hooks/exhaustive-deps

  const consulta = useMemo(() => paramsApi(filtros).toString(), [filtros]);
  // En el celular la lista crece con "Cargar más" (no hay páginas).
  const desde = movil ? 0 : pagina * POR_PAGINA;

  const mostrados = useRef(0);
  const cargar = useCallback(async (silencioso = false) => {
    const yo = ++turno.current;
    if (!silencioso) setCargando(true);
    // Al refrescar sin aviso, se vuelven a pedir todos los que ya se ven (el celular pudo cargar más).
    const limite = silencioso && movil ? Math.min(200, Math.max(POR_PAGINA, mostrados.current)) : POR_PAGINA;
    try {
      const r = await api<Datos>(`/ux/leads/lista?${consulta}${consulta ? '&' : ''}limite=${limite}&offset=${desde}`);
      if (yo !== turno.current) return;
      setDatos(r);
      setError(null);
    } catch (e: any) {
      if (yo !== turno.current) return;
      setError(e);
      if (silencioso) aviso.error(e.message);
    } finally {
      if (yo === turno.current) setCargando(false);
    }
  }, [consulta, desde, movil]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { cargar(); }, [cargar]);

  async function cargarMas() {
    if (!datos) return;
    setMasCargando(true);
    const yo = turno.current;
    try {
      const r = await api<Datos>(`/ux/leads/lista?${consulta}${consulta ? '&' : ''}limite=${POR_PAGINA}&offset=${datos.leads.length}`);
      if (yo !== turno.current) return;
      setDatos((d) => (d ? { ...r, leads: [...d.leads, ...r.leads.filter((x) => !d.leads.some((y) => y.id === x.id))] } : r));
    } catch (e: any) {
      aviso.error(e.message);
    } finally {
      setMasCargando(false);
    }
  }

  // Al cerrar la ficha (o si algo cambió un lead), la lista se refresca sin parpadear.
  const fichaAntes = useRef(ficha.abierta);
  useEffect(() => {
    if (fichaAntes.current && !ficha.abierta) {
      cargar(true);
      cargarContexto().then(setCtx).catch(() => {}); // por si se creó una etiqueta nueva
    }
    fichaAntes.current = ficha.abierta;
  }, [ficha.abierta, cargar]);
  useEffect(() => {
    let t = 0;
    const f = () => { window.clearTimeout(t); t = window.setTimeout(() => { if (!new URLSearchParams(window.location.search).get('ficha')) cargar(true); }, 400); };
    window.addEventListener(EVENTO_LEAD_CAMBIADO, f);
    return () => { window.removeEventListener(EVENTO_LEAD_CAMBIADO, f); window.clearTimeout(t); };
  }, [cargar]);

  const leads = datos?.leads ?? [];
  const total = datos?.total ?? 0;
  mostrados.current = leads.length;
  const conteos = datos?.conteos ?? null;

  // La ficha puede pasar al anterior/siguiente de esta lista.
  useEffect(() => { if (leads.length) guardarListaFicha(leads.map((l) => l.id), 'Leads'); }, [leads]);

  function irAPagina(n: number) {
    cambiar({ ...filtros, pag: n + 1 });
    inicioLista.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  const avanzadosActivos = AVANZADOS.filter((k) => Boolean(filtros[k])).length;
  const hayFiltros = Boolean(filtros.q || filtros.vista !== 'todos' || filtros.etiqueta || filtros.contenido || avanzadosActivos);
  const limpiarTodo = () => { setBusqueda(''); cambiar({ ...SIN_FILTROS, orden: filtros.orden }); };
  const pareceUsuario = /^@?[a-z0-9._]{2,30}$/i.test(filtros.q.trim());

  // ---------------- Filtros activos (como chips con ✕) ----------------
  const etapaFiltro = ctx?.pipelines.flatMap((p) => p.etapas.map((e) => ({ ...e, pipe: p.nombre }))).find((e) => e.id === filtros.etapa);
  const persona = ctx?.usuarios.find((u) => u.id === filtros.resp);
  const activos: Array<{ clave: keyof Filtros; texto: string }> = [];
  if (filtros.contenido) activos.push({ clave: 'contenido', texto: `Vino de: ${datos?.contenido?.titulo ?? 'un contenido'}` });
  if (filtros.etapa) activos.push({ clave: 'etapa', texto: `Etapa: ${etapaFiltro?.nombre ?? '…'}` });
  if (filtros.resp) activos.push({ clave: 'resp', texto: `Lo atiende: ${persona?.nombre ?? '…'}` });
  if (filtros.temp) activos.push({ clave: 'temp', texto: TEMPERATURAS[filtros.temp as IdTemperatura]?.etiqueta ?? filtros.temp });
  if (filtros.calif) activos.push({ clave: 'calif', texto: CALIFICACIONES.find((c) => c.id === filtros.calif)?.etiqueta ?? filtros.calif });
  if (filtros.dias) activos.push({ clave: 'dias', texto: `Entró: ${DIAS.find((d) => d.id === filtros.dias)?.etiqueta.toLowerCase() ?? ''}` });

  const ordenActual = ORDENES.find((o) => o.id === filtros.orden) ?? ORDENES[0];
  const menuOrden = (
    <Menu alinear="derecha" titulo="Ordenar por" ancho={260} disparador={({ alternar, abierto, ref }) => (
      movil
        ? <BotonIcono ref={ref} etiqueta={`Ordenar: ${ordenActual.etiqueta}`} variante="secundario" onClick={alternar} aria-expanded={abierto}><IconoOrden /></BotonIcono>
        : <Boton ref={ref} tamano="sm" onClick={alternar} aria-expanded={abierto} icono={<IconoOrden />}>{ordenActual.etiqueta}</Boton>
    )}>
      {ORDENES.map((o) => (
        <ItemMenu key={o.id} activo={o.id === filtros.orden} descripcion={o.descripcion} onClick={() => cambiar({ ...filtros, orden: o.id as Orden })}>{o.etiqueta}</ItemMenu>
      ))}
    </Menu>
  );

  const subtitulo = !datos ? 'Cargando…'
    : hayFiltros ? `${fmtNum(total)} de ${plural(conteos?.todos ?? total, 'contacto')}`
      : plural(total, 'contacto');

  // ---------------- Acciones de la tarjeta (celular) ----------------
  const accion = (l: any) => ({
    lead_id: l.id, oportunidad_id: l.oportunidad_id, etapa_id: l.etapa_id, nombre: l.nombre,
    ig_username: l.ig_username, avatar_url: l.avatar_url, valor: Number(l.valor_total) || null,
  });
  const etapasDe = (l: any): Etapa[] => ctx?.pipelines.find((p) => p.id === l.pipeline_id)?.etapas ?? [];
  const actualizarFila = (id: string, cambios: Record<string, unknown>) =>
    setDatos((d) => (d ? { ...d, leads: d.leads.map((x) => (x.id === id ? { ...x, ...cambios } : x)) } : d));

  return (
    <div className="px-4 py-5 lg:px-8">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-[18px] font-semibold tracking-tight sm:text-[20px]">Leads</h1>
            <button type="button" onClick={() => setNuevo('')} aria-label="Nuevo lead" title="Nuevo lead"
              className="ui-foco flex h-8 w-8 items-center justify-center rounded-lg text-white shadow-sm hover:brightness-110"
              style={{ background: 'var(--series-1)' }}>
              <Icono nombre="mas" tam={17} />
            </button>
          </div>
          <p className="cifras mt-0.5 text-[13px] text-[var(--text-muted)]">{subtitulo}</p>
        </div>
        {menuOrden}
      </header>

      <div className="mt-3 space-y-2">
        <div className="flex items-center gap-2">
          <Buscador valor={busqueda} onCambiar={setBusqueda} placeholder="Buscar @usuario, nombre o email…" className="min-w-0 flex-1 md:max-w-[420px]" />
          <Menu alinear="derecha" titulo="Mostrar" ancho={240} disparador={({ alternar, abierto }) => (
            <Boton variante="secundario" tamano="sm" onClick={alternar} aria-expanded={abierto}>
              {VISTAS.find((v) => v.id === filtros.vista)?.etiqueta ?? 'Todos'}{filtros.etiqueta ? ` · ${filtros.etiqueta}` : ''} ▾
            </Boton>
          )}>
            {VISTAS.map((v) => (
              <ItemMenu key={v.id} activo={filtros.vista === v.id} onClick={() => cambiar({ ...filtros, vista: v.id as Vista })}
                derecha={conteos ? <span className="cifras text-[11px] text-[var(--text-muted)]">{fmtNum(conteos[v.id] ?? 0)}</span> : undefined}>{v.etiqueta}</ItemMenu>
            ))}
            {(ctx?.etiquetas ?? []).length > 0 && <SeparadorMenu />}
            {(ctx?.etiquetas ?? []).slice(0, 12).map((t) => (
              <ItemMenu key={t.etiqueta} activo={filtros.etiqueta === t.etiqueta}
                onClick={() => cambiar({ ...filtros, etiqueta: filtros.etiqueta === t.etiqueta ? '' : t.etiqueta })}
                derecha={<span className="cifras text-[11px] text-[var(--text-muted)]">{fmtNum(t.n)}</span>}>{t.etiqueta}</ItemMenu>
            ))}
          </Menu>
          <Boton variante="secundario" tamano="sm" onClick={() => setVerFiltros(true)}>{'Filtros'}{avanzadosActivos ? ` · ${avanzadosActivos}` : ''}</Boton>
        </div>
        {activos.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {activos.map((a) => (
              <span key={a.clave} className="inline-flex h-7 max-w-full items-center gap-0.5 rounded-md pl-2 text-[12px]"
                style={{ background: 'color-mix(in srgb, var(--series-1) 12%, transparent)', color: 'var(--text-primary)' }}>
                <span className="truncate">{a.texto}</span>
                <button type="button" onClick={() => cambiar({ ...filtros, [a.clave]: '' })} aria-label={`Quitar filtro: ${a.texto}`}
                  className="ui-foco flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                  <Icono nombre="cerrar" tam={13} />
                </button>
              </span>
            ))}
            <button type="button" onClick={limpiarTodo} className="ui-foco h-7 rounded-md px-2 text-[12px] font-medium text-[var(--series-1)] hover:bg-[var(--surface-1)]">
              Limpiar
            </button>
          </div>
        )}
      </div>

      <div ref={inicioLista} className="scroll-mt-4" />
      {error && !datos ? (
        <div className="tarjeta mt-4"><ErrorCarga error={error} titulo="No pudimos cargar tus leads" onReintentar={() => cargar()} /></div>
      ) : !datos ? (
        <div className="mt-4 space-y-2" aria-busy="true" aria-label="Cargando leads">
          {Array.from({ length: 8 }, (_, i) => <Esqueleto key={i} alto={movil ? 76 : 52} className="rounded-xl" />)}
        </div>
      ) : leads.length === 0 ? (
        <div className="tarjeta mt-4">
          {hayFiltros ? (
            <Vacio icono={<Icono nombre="buscar" tam={24} />} titulo={filtros.q ? `Nadie coincide con «${filtros.q}»` : 'Ningún lead con estos filtros'}
              texto="Probá con menos filtros o buscá de otra forma."
              accion={(
                <div className="flex flex-wrap justify-center gap-2">
                  <Boton onClick={limpiarTodo}>Limpiar filtros</Boton>
                  {filtros.q && pareceUsuario && (
                    <Boton variante="primario" icono={<Icono nombre="mas" tam={15} />} onClick={() => setNuevo(filtros.q.trim())}>
                      Cargar @{filtros.q.trim().replace(/^@/, '')}
                    </Boton>
                  )}
                </div>
              )} />
          ) : (
            <Vacio icono={<Icono nombre="leads" tam={24} />} titulo="Todavía no tenés leads"
              texto="Llegan solos cuando alguien comenta tu palabra clave o te escribe por Instagram. También podés cargar uno a mano."
              accion={<Boton variante="primario" icono={<Icono nombre="mas" tam={15} />} onClick={() => setNuevo('')}>Cargar un lead</Boton>} />
          )}
        </div>
      ) : movil ? (
        // ---------------- Celular: tarjetas que se deslizan ----------------
        <div className={`mt-3 transition-opacity ${cargando ? 'opacity-60' : ''}`} aria-busy={cargando}>
          <ul className="flex flex-col gap-2">
            {leads.map((l) => (
              <li key={l.id}>
                <FilaDeslizable className="rounded-lg" acciones={[
                  { etiqueta: 'Chat', color: 'var(--series-1)', icono: <Icono nombre="bandeja" tam={16} />, onClick: () => navegar(`/chat/${l.id}`) },
                  ...(l.oportunidad_id ? [{ etiqueta: 'Mover', color: 'var(--series-2)', icono: <Icono nombre="pipeline" tam={16} />, onClick: () => setHoja({ tipo: 'mover' as const, l }) }] : []),
                  { etiqueta: 'Asignar', color: 'var(--series-3)', icono: <Icono nombre="leads" tam={16} />, onClick: () => setHoja({ tipo: 'asignar', l }) },
                ]}>
                  <TarjetaLead l={l} onAbrir={() => ficha.abrir(l.id)} onChat={() => navegar(`/chat/${l.id}`)} />
                </FilaDeslizable>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-col items-center gap-1.5 pb-20">
            {leads.length < total && (
              <Boton anchoCompleto onClick={cargarMas} cargando={masCargando}>Cargar {Math.min(POR_PAGINA, total - leads.length)} más</Boton>
            )}
            <span className="cifras text-[12px] text-[var(--text-muted)]">Mostrando {fmtNum(leads.length)} de {fmtNum(total)} · deslizá una tarjeta para ver acciones</span>
          </div>
        </div>
      ) : (
        // ---------------- Escritorio: tabla ----------------
        <div className="mt-4">
          {total > POR_PAGINA && <Paginador pagina={pagina} total={total} onIr={irAPagina} />}
          <div className={`tarjeta overflow-hidden transition-opacity ${cargando ? 'opacity-60' : ''}`} aria-busy={cargando}>
            <table className="w-full table-fixed text-[13px]">
              <thead>
                <tr className="border-b border-[var(--border-hairline)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="w-[30%] px-4 py-2.5 font-medium">Lead</th>
                  <th className="hidden w-[15%] px-3 py-2.5 font-medium lg:table-cell">Lo atiende</th>
                  <th className="w-[17%] px-3 py-2.5 font-medium">
                    <span className="inline-flex items-center gap-1">Temperatura
                      <Ayuda titulo="Temperatura">Sale sola de lo que hizo cada lead (si respondió, si contó de su negocio, si agendó o compró). Frío, tibio, caliente o listo para vender.</Ayuda>
                    </span>
                  </th>
                  <th className="w-[17%] px-3 py-2.5 font-medium">Etapa</th>
                  <th className="hidden w-[21%] px-3 py-2.5 font-medium xl:table-cell">Vino de</th>
                  <th className="w-[13%] whitespace-nowrap px-3 py-2.5 text-right font-medium">Última vez</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => {
                  const sinLeer = Number(l.mensajes_sin_leer) || 0;
                  return (
                    <tr key={l.id} onClick={(e) => { if (!(e.target as HTMLElement).closest('button, a')) ficha.abrir(l.id); }}
                      className="cursor-pointer border-b border-[var(--border-hairline)] last:border-0 hover:bg-[var(--page-plane)]">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <IdentidadLead id={l.id} nombre={[l.nombre, l.apellido].filter(Boolean).join(' ')} usuario={l.ig_username}
                            foto={l.avatar_url} pais={l.pais} onClick={() => ficha.abrir(l.id)} className="min-w-0 flex-1" />
                          {sinLeer > 0 && (
                            <button type="button" onClick={(e) => { e.stopPropagation(); navegar(`/chat/${l.id}`); }} aria-label={`${sinLeer} sin leer: abrir el chat`}
                              className="ui-foco inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold text-white" style={{ background: 'var(--series-1)' }}>
                              <Icono nombre="bandeja" tam={12} />{sinLeer}
                            </button>
                          )}
                          {Number(l.valor_total) > 0 && (
                            <span className="cifras shrink-0 text-[12px] font-semibold" style={{ color: 'var(--status-good)' }}>{fmtDinero(l.valor_total)}</span>
                          )}
                        </div>
                      </td>
                      <td className="hidden px-3 py-2 lg:table-cell">
                        {l.propietario_nombre ? (
                          <span className="flex min-w-0 items-center gap-1.5">
                            <Avatar id={l.propietario_id} nombre={l.propietario_nombre} tam={20} />
                            <span className="truncate">{l.propietario_nombre}</span>
                          </span>
                        ) : <span className="italic text-[var(--text-muted)]">Sin asignar</span>}
                      </td>
                      <td className="px-3 py-2"><Temperatura score={l.score} /></td>
                      <td className="px-3 py-2">
                        {l.etapa_nombre ? (
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: l.etapa_color ?? 'var(--baseline)' }} aria-hidden />
                            <span className="truncate">{l.etapa_nombre}</span>
                          </span>
                        ) : <span className="text-[var(--text-muted)]">—</span>}
                      </td>
                      <td className="hidden px-3 py-2 xl:table-cell">
                        {l.contenido_titulo ? (
                          <span className="flex min-w-0 items-center gap-2">
                            <Portada url={l.contenido_thumbnail} tipo={l.contenido_tipo} tam="xs" />
                            <span className="min-w-0">
                              <span className="block truncate text-[12px]">{l.contenido_titulo}</span>
                              {l.palabra_clave && <span className="block truncate text-[11px] text-[var(--text-muted)]">comentó «{l.palabra_clave}»</span>}
                            </span>
                          </span>
                        ) : <span className="text-[12px] text-[var(--text-muted)]">Sin reel de origen</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-[12px] text-[var(--text-muted)]">{hace(l.ultima_actividad)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {total > POR_PAGINA && <Paginador pagina={pagina} total={total} onIr={irAPagina} abajo />}
        </div>
      )}

      <BotonFlotante etiqueta="Nuevo lead" onClick={() => setNuevo('')} icono={<Icono nombre="mas" tam={24} />} />

      {verFiltros && (
        <FiltrosLeads filtros={filtros} ctx={ctx} onCerrar={() => setVerFiltros(false)}
          onAplicar={(c) => { setVerFiltros(false); cambiar({ ...filtros, ...c }); }} />
      )}
      {nuevo !== null && (
        <NuevoLead ctx={ctx} inicial={nuevo} onCerrar={() => setNuevo(null)}
          onVerFicha={(id) => { setNuevo(null); ficha.abrir(id); }}
          onCreado={(r, quien) => {
            setNuevo(null);
            cargar(true);
            olvidarContexto();
            cargarContexto().then(setCtx).catch(() => {});
            aviso.exito(r.ya_existia ? `${quien} ya estaba: lo moviste de etapa.` : `${quien} cargado.`, { texto: 'Ver ficha', onClick: () => ficha.abrir(r.lead_id) });
          }} />
      )}
      {hoja && (
        <Dialogo abierto onCerrar={() => setHoja(null)} autoFoco={false}
          titulo={hoja.tipo === 'mover' ? 'Mover a' : 'Lo atiende'}
          descripcion={hoja.l.ig_username ? `@${hoja.l.ig_username}` : hoja.l.nombre}>
          <div className="-mx-2 flex flex-col gap-0.5 pb-2">
            {hoja.tipo === 'mover' ? etapasDe(hoja.l).map((e) => (
              <ItemMenu key={e.id} activo={e.id === hoja.l.etapa_id} icono={<span className="h-2.5 w-2.5 rounded-full" style={{ background: e.color }} />}
                descripcion={e.tipo === 'ganada' ? 'Registra la venta' : e.tipo === 'perdida' ? 'Te pregunta por qué' : undefined}
                onClick={() => {
                  const l = hoja.l;
                  setHoja(null);
                  acciones.mover(accion(l), e, (et) => actualizarFila(l.id, { etapa_id: et.id, etapa_nombre: et.nombre, etapa_color: et.color }));
                }}>{e.nombre}</ItemMenu>
            )) : (
              <>
                {(ctx?.usuarios ?? []).map((u) => (
                  <ItemMenu key={u.id} activo={u.id === hoja.l.propietario_id} icono={<Avatar id={u.id} nombre={u.nombre} tam={22} />}
                    onClick={() => {
                      const l = hoja.l;
                      setHoja(null);
                      actualizarFila(l.id, { propietario_id: u.id, propietario_nombre: u.nombre });
                      acciones.asignar(accion(l), u, l.propietario_id ?? null);
                    }}>{u.nombre}</ItemMenu>
                ))}
                <ItemMenu activo={!hoja.l.propietario_id} onClick={() => {
                  const l = hoja.l;
                  setHoja(null);
                  actualizarFila(l.id, { propietario_id: null, propietario_nombre: null });
                  acciones.asignar(accion(l), null, l.propietario_id ?? null);
                }}>Sin asignar</ItemMenu>
              </>
            )}
            {hoja.tipo === 'mover' && etapasDe(hoja.l).length === 0 && (
              <p className="px-2 py-3 text-[12px] text-[var(--text-muted)]">Cargando etapas…</p>
            )}
          </div>
        </Dialogo>
      )}
      {acciones.dialogos}
    </div>
  );
}

function Paginador({ pagina, total, onIr, abajo }: { pagina: number; total: number; onIr: (n: number) => void; abajo?: boolean }) {
  const desde = pagina * POR_PAGINA + 1;
  const hasta = Math.min((pagina + 1) * POR_PAGINA, total);
  const ultima = Math.ceil(total / POR_PAGINA) - 1;
  return (
    <div className={`flex items-center justify-end gap-1 text-[12px] text-[var(--text-muted)] ${abajo ? 'mt-2' : 'mb-2'}`}>
      <span className="cifras mr-1">{fmtNum(desde)}–{fmtNum(hasta)} de {fmtNum(total)}</span>
      <BotonIcono etiqueta="Página anterior" variante="secundario" disabled={pagina === 0} onClick={() => onIr(pagina - 1)}>
        <Icono nombre="volver" tam={16} />
      </BotonIcono>
      <BotonIcono etiqueta="Página siguiente" variante="secundario" disabled={pagina >= ultima} onClick={() => onIr(pagina + 1)}>
        <Icono nombre="siguiente" tam={16} />
      </BotonIcono>
    </div>
  );
}

function IconoOrden() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5" />
    </svg>
  );
}

function IconoFiltro() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 5h18M6 12h12M10 19h4" />
    </svg>
  );
}
