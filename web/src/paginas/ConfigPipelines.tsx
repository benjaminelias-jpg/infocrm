import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, plural } from '../api';
import {
  Boton, BotonIcono, ContenidoDeslizable, Dialogo, Entrada, ErrorCarga, EsqueletoPantalla, Insignia, ItemMenu, Menu,
  Pestanas, SelectorConMas, SeparadorMenu, useAviso,
} from '../ui';
import Icono from '../componentes/Iconos';
import ListaEtapas from '../componentes/pipeline/config/Etapas';
import ReglasAutomaticas from '../componentes/pipeline/config/Reglas';
import { DialogoBorrarPipeline, DialogoNuevoPipeline, type ResultadoBorrado } from '../componentes/pipeline/config/DialogosPipeline';
import type { Conexion, Pipe } from '../componentes/pipeline/config/datos';

// Configuración del Pipeline, en dos pestañas:
//  · Etapas: las de ESTE pipeline (con qué se mueven solas y qué hacen al
//    entrar un lead).
//  · Reglas automáticas: "cuando el lead hace X, hacé Y" (valen para todos).
// La pestaña vive en la URL (?config=1 | ?config=reglas) y el pipeline en ?p=.

type Tab = 'etapas' | 'reglas';

export default function ConfigPipelines({ onCerrar, foco, pipelineId, onElegirPipeline }: {
  onCerrar: () => void; foco?: 'reglas';
  /** El pipeline que se estaba mirando en el tablero (se abre ese, no el primero). */
  pipelineId?: string | null;
  onElegirPipeline?: (id: string) => void;
}) {
  const aviso = useAviso();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (params.get('config') ?? (foco === 'reglas' ? 'reglas' : '1')) === 'reglas' ? 'reglas' : 'etapas';
  const etapaPedida = params.get('etapa');

  const [pipes, setPipes] = useState<Pipe[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [selId, setSelId] = useState<string | null>(pipelineId ?? null);
  const [conteos, setConteos] = useState<Record<string, number> | null>(null);
  const [recursos, setRecursos] = useState<any[]>([]);
  const [flujos, setFlujos] = useState<any[]>([]);
  const [conexiones, setConexiones] = useState<Conexion[]>([]);
  const [etiquetas, setEtiquetas] = useState<string[]>([]);
  const [nReglas, setNReglas] = useState<number | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [borrar, setBorrar] = useState<Pipe | null>(null);
  const [renombrar, setRenombrar] = useState(false);
  const [sucio, setSucio] = useState<{ etapa: string } | null>(null);
  const [salir, setSalir] = useState<null | (() => void)>(null);

  // El tablero se entera de qué pipeline se está configurando (para volver a ESE).
  const avisarPipe = useRef(onElegirPipeline);
  avisarPipe.current = onElegirPipeline;
  useEffect(() => { if (selId) avisarPipe.current?.(selId); }, [selId]);

  const cargar = useCallback(async () => {
    const [p, c] = await Promise.all([
      api<Pipe[]>('/pipelines'),
      api<Record<string, number>>('/ux/pipeline/conteos').catch(() => null),
    ]);
    setPipes(p); setConteos(c);
    setSelId((s) => (s && p.some((x) => x.id === s) ? s : p.find((x) => x.es_predeterminado)?.id ?? p[0]?.id ?? null));
  }, []);

  useEffect(() => {
    cargar().catch((e) => setError(e));
    api<any[]>('/recursos').then(setRecursos).catch(() => {});
    api<any[]>('/flujos').then(setFlujos).catch(() => {});
    api<Conexion[]>('/webhooks/salida').then(setConexiones).catch(() => {});
    api<any[]>('/etiquetas').then((e) => setEtiquetas(e.map((x: any) => (typeof x === 'string' ? x : x.etiqueta ?? x.nombre)).filter(Boolean))).catch(() => {});
    api<any[]>('/reglas').then((r) => setNReglas(r.length)).catch(() => {});
  }, [cargar]);

  const pipe = pipes?.find((p) => p.id === selId) ?? null;

  /** Si hay cambios sin guardar en una etapa, pregunta antes (con un diálogo propio, nunca del navegador). */
  function conCuidado(seguir: () => void) {
    if (sucio) setSalir(() => seguir); else seguir();
  }

  function cambiarTab(t: Tab) {
    conCuidado(() => setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set('config', t === 'reglas' ? 'reglas' : '1');
      p.delete('etapa');
      return p;
    }, { replace: true, state: window.history.state?.usr }));
  }

  function elegir(id: string) {
    if (id === selId) return;
    conCuidado(() => setSelId(id));
  }

  async function predeterminado() {
    if (!pipe) return;
    try {
      await api(`/pipelines/${pipe.id}`, { method: 'PATCH', json: { es_predeterminado: true } });
      await cargar();
      aviso.exito(`Listo: los leads nuevos entran a «${pipe.nombre}».`);
    } catch (e: any) { aviso.error(e.message); }
  }

  async function duplicar() {
    if (!pipe || !pipes) return;
    const usados = new Set(pipes.map((p) => p.nombre.trim().toLowerCase()));
    let nombre = `${pipe.nombre} (copia)`;
    for (let i = 2; usados.has(nombre.toLowerCase()); i++) nombre = `${pipe.nombre} (copia ${i})`;
    try {
      const p = await api<any>('/pipelines', { method: 'POST', json: { nombre, copiar_de: pipe.id } });
      await cargar(); setSelId(p.id);
      aviso.exito(`Listo: «${nombre}» tiene las mismas etapas y automatizaciones.`);
    } catch (e: any) { aviso.error(e.message); }
  }

  async function guardarNombre(nombre: string) {
    if (!pipe) return;
    const limpio = nombre.trim();
    setRenombrar(false);
    if (!limpio || limpio === pipe.nombre) return;
    setPipes((l) => l?.map((p) => (p.id === pipe.id ? { ...p, nombre: limpio } : p)) ?? l);
    try {
      await api(`/pipelines/${pipe.id}`, { method: 'PATCH', json: { nombre: limpio } });
      aviso.exito('Nombre guardado.');
    } catch (e: any) { aviso.error(e.message); }
    await cargar();
  }

  function borrado(r: ResultadoBorrado) {
    setBorrar(null);
    setSelId(r.destino.id);
    cargar();
    const movidas = r.movidas.length;
    aviso.exito(movidas
      ? `«${r.borrado.nombre}» borrado. ${plural(movidas, 'lead pasó', 'leads pasaron')} a «${r.destino.nombre}».`
      : `«${r.borrado.nombre}» borrado.`, {
      texto: 'Deshacer',
      onClick: async () => {
        try {
          await api(`/pipelines/${r.borrado.id}/restaurar`, {
            method: 'POST', json: { movidas: r.movidas.map((m) => ({ id: m.id, etapa_id: m.etapa_id })), era_predeterminado: r.borrado.era_predeterminado },
          });
          await cargar(); setSelId(r.borrado.id);
          aviso.exito(`«${r.borrado.nombre}» volvió, con sus leads.`);
        } catch (e: any) { aviso.error(e.message); }
      },
    });
  }

  if (error && !pipes) {
    return <div className="px-4 py-8"><ErrorCarga error={error} titulo="No pudimos cargar la configuración" onReintentar={() => { setError(null); cargar().catch(setError); }} /></div>;
  }
  if (!pipes) return <EsqueletoPantalla tarjetas={0} filas={6} />;

  const items = pipes.map((p) => ({ id: p.id, nombre: p.nombre }));
  const pestanas = [
    { id: 'etapas' as Tab, etiqueta: 'Etapas', contador: pipe?.etapas.length },
    { id: 'reglas' as Tab, etiqueta: 'Reglas automáticas', contador: nReglas ?? undefined },
  ];

  return (
    <div className="mx-auto max-w-[880px] px-4 pb-24 pt-3 md:pb-10 md:pt-4 lg:px-8">
      <div className="flex items-center gap-1.5">
        <BotonIcono etiqueta="Volver al tablero" variante="fantasma" tamano="md" onClick={() => conCuidado(onCerrar)}>
          <Icono nombre="volver" tam={20} />
        </BotonIcono>
        <h1 className="text-[17px] font-semibold tracking-tight md:text-[18px]">Configurar pipeline</h1>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {renombrar && pipe ? (
          <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); guardarNombre(String(new FormData(e.currentTarget).get('nombre') ?? '')); }}>
            <Entrada name="nombre" defaultValue={pipe.nombre} autoFocus maxLength={60} aria-label="Nombre del pipeline" className="max-w-[320px]"
              onKeyDown={(e) => { if (e.key === 'Escape') setRenombrar(false); }} />
            <Boton type="submit" variante="primario" tamano="sm">Guardar</Boton>
            <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setRenombrar(false)}>Cancelar</Boton>
          </form>
        ) : (
          <>
            <SelectorConMas items={items} actualId={selId} onElegir={elegir} onNuevo={() => setNuevo(true)} queEs="pipeline"
              extra={(p) => {
                const n = conteos?.[p.id];
                const pred = pipes.find((x) => x.id === p.id)?.es_predeterminado;
                return [n !== undefined ? plural(n, 'lead abierto', 'leads abiertos') : null, pred ? '★ acá entran los nuevos' : null].filter(Boolean).join(' · ') || undefined;
              }} />
            {pipe && (
              <BotonIcono etiqueta="Cambiar el nombre del pipeline" variante="fantasma" tamano="md" onClick={() => setRenombrar(true)}>
                <span className="text-[15px]" aria-hidden>✎</span>
              </BotonIcono>
            )}
            {pipe && (
              <Menu alinear="derecha" ancho={270} titulo={pipe.nombre} disparador={({ alternar, abierto, ref }) => (
                <BotonIcono ref={ref} etiqueta="Más opciones del pipeline" variante="fantasma" tamano="md" onClick={alternar} aria-expanded={abierto}>
                  <Icono nombre="puntos" tam={18} />
                </BotonIcono>
              )}>
                <ItemMenu icono="✏️" onClick={() => setRenombrar(true)}>Cambiar nombre</ItemMenu>
                {!pipe.es_predeterminado && (
                  <ItemMenu icono="★" onClick={predeterminado} descripcion="Los leads que lleguen solos van a este">Que los leads nuevos entren acá</ItemMenu>
                )}
                <ItemMenu icono="⧉" onClick={duplicar} descripcion="Mismas etapas y automatizaciones">Duplicar pipeline</ItemMenu>
                <SeparadorMenu />
                <ItemMenu icono="🗑" peligro onClick={() => setBorrar(pipe)} deshabilitado={pipes.length <= 1}
                  descripcion={pipes.length <= 1 ? 'Es tu único pipeline' : 'Sus leads pasan a otro'}>Borrar pipeline</ItemMenu>
              </Menu>
            )}
            {pipe?.es_predeterminado && <Insignia tono="azul">★ Acá entran los leads nuevos</Insignia>}
          </>
        )}
      </div>

      <Pestanas className="mt-3" pestanas={pestanas} actual={tab} onCambiar={cambiarTab} />
      <ContenidoDeslizable pestanas={pestanas} actual={tab} onCambiar={cambiarTab} className="pt-3">
        {tab === 'etapas' ? (
          pipe ? (
            <ListaEtapas key={pipe.id} pipe={pipe} recursos={recursos} flujos={flujos} conexiones={conexiones}
              abrirInicial={etapaPedida} onRecargar={cargar} onSucio={setSucio}
              onConexionCreada={(c) => setConexiones((l) => [c, ...l.filter((x) => x.id !== c.id)])} />
          ) : null
        ) : (
          <ReglasAutomaticas pipes={pipes} conexiones={conexiones}
            onConexionCreada={(c) => setConexiones((l) => [c, ...l.filter((x) => x.id !== c.id)])} />
        )}
      </ContenidoDeslizable>

      <datalist id="etiquetas-config">{etiquetas.map((e) => <option key={e} value={e} />)}</datalist>

      <DialogoNuevoPipeline abierto={nuevo} pipes={pipes} actualId={selId} onCerrar={() => setNuevo(false)}
        onCreado={async (p) => { setNuevo(false); await cargar(); setSelId(p.id); }} />
      {borrar && (
        <DialogoBorrarPipeline pipe={borrar} pipes={pipes} abiertos={conteos ? conteos[borrar.id] ?? 0 : null}
          onCerrar={() => setBorrar(null)} onBorrado={borrado} />
      )}
      <Dialogo abierto={!!salir} onCerrar={() => setSalir(null)} titulo="Tenés cambios sin guardar"
        descripcion={sucio ? `En las automatizaciones de «${sucio.etapa}».` : undefined}
        pie={<>
          <Boton variante="secundario" onClick={() => setSalir(null)}>Seguir editando</Boton>
          <Boton variante="peligro" onClick={() => { const s = salir; setSalir(null); setSucio(null); s?.(); }}>Salir sin guardar</Boton>
        </>}>
        <p className="text-[13px] text-[var(--text-secondary)]">Si salís ahora, se pierden.</p>
      </Dialogo>
    </div>
  );
}
