import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, hace, leerSesion } from '../api';
import { Ayuda, Boton, ErrorCarga, useAviso, useCarga, useEsMovil } from '../ui';
import { Angulos, Equipo, Fiabilidad } from '../componentes/panel/Analisis';
import { EmbudoPanel, leerPipelineGuardado } from '../componentes/panel/EmbudoPanel';
import { EsqueletoPanel } from '../componentes/panel/EsqueletoPanel';
import { Evolucion } from '../componentes/panel/Evolucion';
import { FilaKpis } from '../componentes/panel/Kpis';
import { LeadsQuietos } from '../componentes/panel/LeadsQuietos';
import { DetalleContenido, MejorContenido, useApilado } from '../componentes/panel/MejorContenido';
import { ObjetivoMes } from '../componentes/panel/Objetivo';
import { ParaHoy, armarParaHoy } from '../componentes/panel/ParaHoy';
import { DialogoMudos, PrimerosPasos } from '../componentes/panel/PrimerosPasos';
import { SelectorRango, etiquetaRango, usarRangoPanel } from '../componentes/panel/Rango';
import type { DatosPanel, EstadoCuenta } from '../componentes/panel/tipos';

// Panel de inicio. Arriba lo de todos los días (números, "Para hoy",
// objetivo); después la evolución y el embudo; al final, plegado, el
// análisis que se mira de vez en cuando. Los números de arriba y los
// gráficos de abajo cuentan lo mismo (lo que pasó EN el período).

const SUBTITULO = 'De qué contenido vienen tus leads, tus reuniones y tu plata';
const CLAVE_QUIETOS = 'infocrm_plegado_panel_quietos';

function leerBool(clave: string): boolean | null {
  try {
    const v = localStorage.getItem(clave);
    return v === null ? null : v === '1';
  } catch { return null; }
}
function guardarBool(clave: string, v: boolean) {
  try { localStorage.setItem(clave, v ? '1' : '0'); } catch { /* sin almacenamiento */ }
}
function irA(id: string) {
  window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
}

export default function Panel() {
  const aviso = useAviso();
  const movil = useEsMovil(768);
  const rol = leerSesion()?.usuario?.rol;
  const esEquipo = rol === 'setter' || rol === 'closer';
  const rangoElegido = usarRangoPanel();
  const { rango, setRango, renovar, params } = rangoElegido;

  // Datos del Panel. El pipeline del embudo viaja en el pedido (el último que
  // se eligió), pero cambiarlo no recarga todo: el embudo se pide solo.
  // Con los datos se guarda CÓMO se dice su período: mientras llega otro
  // período, los textos siguen describiendo lo que se ve (nada de «Comparado
  // con los 90 días anteriores» arriba de los números de este mes).
  const { datos: cargado, cargando, error, recargar } = useCarga(async () => {
    const pipe = leerPipelineGuardado();
    const d = await api<DatosPanel>(`/analitica/panel?${params}${pipe ? `&pipeline_id=${encodeURIComponent(pipe)}` : ''}`);
    return { d, rango, en: Date.now(), params, comparacion: rangoElegido.comparacion, texto: rangoElegido.texto };
  }, [params]);
  const datos = cargado?.d ?? null;
  const refrescando = cargando && Boolean(datos);
  const texto = cargado?.texto ?? rangoElegido.texto;
  const comparacion = cargado ? cargado.comparacion : rangoElegido.comparacion;

  const [estado, setEstado] = useState<EstadoCuenta | null>(null);
  const cargarEstado = useCallback(() => { api<EstadoCuenta>('/ux/panel/estado').then(setEstado).catch(() => {}); }, []);
  useEffect(() => { cargarEstado(); }, [cargarEstado]);

  // Si falla un cambio de período: aviso y el selector vuelve al anterior
  // (nada de "30 días" marcado con números de 90 días).
  // Un solo aviso por tropiezo: al volver al período anterior se pide de nuevo y,
  // sin conexión, eso también falla (antes salían dos avisos seguidos).
  const errorVisto = useRef<Error | null>(null);
  const ultimoAviso = useRef(0);
  useEffect(() => {
    if (!error || error === errorVisto.current || !cargado) return;
    errorVisto.current = error;
    const reciente = Date.now() - ultimoAviso.current < 6000;
    if (cargado.rango !== rango) {
      aviso.error(`No pudimos traer los datos de «${etiquetaRango(rango)}». ${error.message}`);
      ultimoAviso.current = Date.now();
      setRango(cargado.rango);
    } else if (!reciente) {
      aviso.error(`No pudimos actualizar el panel. ${error.message}`);
      ultimoAviso.current = Date.now();
    }
  }, [error, cargado, rango, setRango, aviso]);

  const actualizar = useCallback(() => {
    // "Todo" no tiene fechas que renovar: se pide de nuevo (con el período girando, como los demás).
    if (rango === 'todo') recargar(); else renovar();
    cargarEstado();
  }, [rango, recargar, renovar, cargarEstado]);

  // Volver a la pestaña después de un rato: datos frescos. Y el "hace 2 min" se mueve solo.
  const [, setTic] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTic((x) => x + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    const f = () => {
      if (document.visibilityState === 'visible' && cargado && Date.now() - cargado.en > 120_000) actualizar();
    };
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, [cargado, actualizar]);

  // Barra de arriba fija: con sombra cuando el contenido pasa por debajo.
  const centinela = useRef<HTMLDivElement>(null);
  const [pegado, setPegado] = useState(false);
  useEffect(() => {
    const el = centinela.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setPegado(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const [editandoObjetivo, setEditandoObjetivo] = useState(false);
  const [verMudos, setVerMudos] = useState(false);
  const detalle = useApilado('contenido');
  const contenidoAbierto = datos?.contenidos?.find((c) => c.id && c.id === detalle.valor) ?? null;

  const [quietosAbierto, setQuietosAbierto] = useState<boolean>(() => leerBool(CLAVE_QUIETOS) ?? esEquipo);
  const cambiarQuietos = useCallback((v: boolean) => { setQuietosAbierto(v); guardarBool(CLAVE_QUIETOS, v); }, []);

  const acciones = useMemo(() => (datos ? armarParaHoy(datos, estado, {
    verQuietos: () => { cambiarQuietos(true); irA('leads-quietos'); },
    verObjetivo: () => irA('objetivo-mes'),
    verMudos: () => setVerMudos(true),
  }) : []), [datos, estado, cambiarQuietos]);

  const nueva = Boolean(estado && estado.leads_total === 0);

  const encabezado = (
    <>
      <div ref={centinela} className="h-px" aria-hidden />
      <header className={`sticky top-0 z-20 -mx-4 mb-3 px-4 transition-shadow lg:-mx-8 lg:px-8 ${pegado ? 'border-b border-[var(--border-hairline)] shadow-sm' : ''}`}
        style={{ background: 'var(--page-plane)' }}>
        <div className="flex items-center justify-between gap-3 py-2.5 md:py-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-1.5 text-[18px] font-semibold tracking-tight sm:text-[20px]">
              Panel
              <span className="sm:hidden"><Ayuda titulo="Panel">{SUBTITULO}</Ayuda></span>
            </h1>
            <p className="mt-0.5 hidden text-[13px] text-[var(--text-secondary)] sm:block">{SUBTITULO}</p>
          </div>
          <SelectorRango rango={rango} onCambiar={setRango} cargando={refrescando} />
        </div>
      </header>
    </>
  );

  if (!datos) {
    return (
      <div className="px-4 pb-8 lg:px-8">
        {encabezado}
        {error
          ? <ErrorCarga error={error} titulo="No pudimos cargar tu panel" onReintentar={() => recargar()} />
          : <EsqueletoPanel />}
      </div>
    );
  }

  const quietos = !nueva && (
    <LeadsQuietos inicial={datos.estancados} plegable={movil} abierto={quietosAbierto} onCambiarAbierto={cambiarQuietos}
      soloMios={esEquipo ? true : undefined} />
  );

  return (
    <div className="px-4 pb-8 lg:px-8">
      {encabezado}

      <div className="space-y-5">
        {nueva && estado && <PrimerosPasos estado={estado} onObjetivo={() => setEditandoObjetivo(true)} />}

        <div className={nueva ? 'pointer-events-none select-none opacity-50' : undefined} aria-hidden={nueva || undefined}>
          {nueva && <p className="mb-2 text-[12px] font-medium text-[var(--text-secondary)]">Así se va a ver tu panel cuando entren leads:</p>}
          <FilaKpis k={datos.kpis} anterior={nueva ? null : datos.anterior} comparacion={comparacion} texto={texto} cargando={refrescando} />
        </div>

        {!nueva && <ParaHoy acciones={acciones} />}

        <ObjetivoMes metas={datos.metas} estado={estado} editando={editandoObjetivo}
          onEditar={() => setEditandoObjetivo(true)} onCerrar={() => setEditandoObjetivo(false)}
          onGuardado={() => { recargar(true); cargarEstado(); }} />

        {esEquipo && quietos}

        {/* Dos columnas recién desde 1280 px: en una laptop chica (1024) el embudo y la
            tabla quedaban apretados y la columna de plata se cortaba. */}
        <div className={`grid gap-4 xl:grid-cols-3 ${nueva ? 'pointer-events-none select-none opacity-50' : ''}`} aria-hidden={nueva || undefined}>
          <div className="min-w-0 xl:col-span-2"><Evolucion datos={datos} cargando={refrescando} /></div>
          <EmbudoPanel pipelines={datos.pipelines ?? []} inicial={datos.embudo ?? []} inicialId={datos.embudo_pipeline_id ?? null}
            paramsRango={cargado?.params ?? params} texto={texto} cargandoPanel={refrescando} />
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-3">
          <div className={`min-w-0 ${esEquipo ? 'xl:col-span-3' : 'xl:col-span-2'}`}>
            <MejorContenido contenidos={datos.contenidos ?? []} texto={texto} cargando={refrescando}
              onAbrir={(c) => c.id && detalle.abrir(c.id)} />
          </div>
          {!esEquipo && quietos}
        </div>

        {!nueva && (
          <div className="space-y-3">
            <Fiabilidad calidad={datos.calidad} texto={texto} />
            <Angulos angulos={datos.angulos ?? []} mezcla={datos.mezcla} abiertoInicial={!movil} />
            <Equipo personas={datos.closers ?? []} abiertoInicial={!movil} texto={texto} />
          </div>
        )}

        <p className="flex flex-wrap items-center justify-center gap-x-1 pt-1 text-[12px] text-[var(--text-secondary)]">
          <span>Actualizado {hace(new Date(cargado!.en))}</span>
          <span aria-hidden>·</span>
          <Boton variante="fantasma" onClick={actualizar} cargando={refrescando} className="!text-[var(--series-1)]">Actualizar</Boton>
        </p>
      </div>

      <DetalleContenido contenido={contenidoAbierto} onCerrar={detalle.cerrar} />
      <DialogoMudos abierto={verMudos} onCerrar={() => setVerMudos(false)} mudos={datos.mudos ?? []} texto={texto} />
    </div>
  );
}
