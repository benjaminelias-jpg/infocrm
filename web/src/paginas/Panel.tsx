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
import { DialogoObjetivo, ObjetivoMes, ritmoDelMes } from '../componentes/panel/Objetivo';
import { DialogoSimple, EmbudoCaja, FilaNumeros, ParaHoyCaja, QuietosCaja, Rendimiento, TablaContenidos, TarjetaMedidor } from '../componentes/panel/Tablero';
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

// Un gris apenas más oscuro que el resto de la app: las tarjetas blancas se despegan del fondo.
const FONDO = 'color-mix(in srgb, var(--page-plane) 94%, var(--text-primary) 6%)';

function saludo() {
  const h = new Date().getHours();
  return h < 13 ? 'Buen día' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
}

export default function Panel() {
  const primerNombre = String(leerSesion()?.usuario?.nombre ?? '').trim().split(/\s+/)[0] ?? '';
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
  const [verDetalle, setVerDetalle] = useState<null | 'evolucion' | 'contenido' | 'analisis'>(null);
  const detalle = useApilado('contenido');
  const contenidoAbierto = datos?.contenidos?.find((c) => c.id && c.id === detalle.valor) ?? null;

  const [quietosAbierto, setQuietosAbierto] = useState<boolean>(() => leerBool(CLAVE_QUIETOS) ?? esEquipo);
  const cambiarQuietos = useCallback((v: boolean) => { setQuietosAbierto(v); guardarBool(CLAVE_QUIETOS, v); }, []);

  const acciones = useMemo(() => (datos ? armarParaHoy(datos, estado, {
    verQuietos: () => { cambiarQuietos(true); irA('leads-quietos'); },
    verObjetivo: () => setEditandoObjetivo(true),
    verMudos: () => setVerMudos(true),
  }) : []), [datos, estado, cambiarQuietos]);

  const nueva = Boolean(estado && estado.leads_total === 0);

  const encabezado = (
    <>
      <div ref={centinela} className="h-px" aria-hidden />
      <header className={`sticky top-0 z-20 -mx-4 mb-3 px-4 transition-shadow lg:-mx-8 lg:px-8 ${pegado ? 'border-b border-[var(--border-hairline)] shadow-sm' : ''}`}
        style={{ background: FONDO }}>
        <div className="flex items-center justify-between gap-3 py-2.5 md:py-3">
          <div className="min-w-0">
            <h1 className="mt-0.5 text-[22px] font-semibold tracking-tight sm:text-[28px]">{saludo()}{primerNombre ? `, ${primerNombre}` : ''}</h1>
            <p className="mt-0.5 hidden text-[13px] text-[var(--text-secondary)] sm:block">Tu resumen de ventas y actividad</p>
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
    <div className="min-h-full px-4 pb-10 lg:px-8" style={{ background: FONDO }}>
      <div className="mx-auto max-w-[1280px]">
      {encabezado}

      <div className="space-y-4">
        {nueva && estado && <PrimerosPasos estado={estado} onObjetivo={() => setEditandoObjetivo(true)} />}

        <div className={nueva ? 'pointer-events-none select-none opacity-50' : undefined} aria-hidden={nueva || undefined}>
          {nueva && <p className="mb-2 text-[12px] font-medium text-[var(--text-secondary)]">Así se va a ver tu panel cuando entren leads:</p>}
          <FilaNumeros k={datos.kpis} anterior={nueva ? null : datos.anterior} />
        </div>

        {!nueva && (
          <>
            <div className="grid gap-4 lg:grid-cols-3">
              <Rendimiento datos={datos} />
              <TarjetaMedidor datos={datos} onObjetivo={() => setEditandoObjetivo(true)} />
            </div>
            <TablaContenidos datos={datos} onAbrir={(c) => c.id && detalle.abrir(c.id)} onVerTodos={() => setVerDetalle('contenido')} />
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <ParaHoyCaja acciones={acciones} />
              <QuietosCaja datos={datos} onVer={() => cambiarQuietos(true)} />
              <EmbudoCaja datos={datos} />
            </div>
          </>
        )}

        {!nueva && (
          <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-4 text-[12px] text-[var(--text-secondary)]">
            <button type="button" className="ui-foco hover:text-[var(--text-primary)]" onClick={() => setVerDetalle('evolucion')}>Gráficos día a día</button>
            <button type="button" className="ui-foco hover:text-[var(--text-primary)]" onClick={() => setVerDetalle('contenido')}>Todos tus contenidos</button>
            <button type="button" className="ui-foco hover:text-[var(--text-primary)]" onClick={() => setVerDetalle('analisis')}>Análisis completo</button>
            <span aria-hidden>·</span>
            <span>Actualizado {hace(new Date(cargado!.en))}</span>
            <button type="button" className="ui-foco font-medium" style={{ color: 'var(--series-1)' }} onClick={actualizar}>{refrescando ? 'Actualizando…' : 'Actualizar'}</button>
          </p>
        )}
      </div>

      </div>
      <DialogoSimple abierto={quietosAbierto} onCerrar={() => cambiarQuietos(false)} titulo="Leads para retomar">
        <LeadsQuietos inicial={datos.estancados} plegable={false} abierto onCambiarAbierto={() => {}} soloMios={esEquipo ? true : undefined} />
      </DialogoSimple>
      <DialogoSimple abierto={verDetalle === 'evolucion'} onCerrar={() => setVerDetalle(null)} titulo="Día a día">
        <Evolucion datos={datos} cargando={refrescando} />
        <div className="mt-4"><EmbudoPanel pipelines={datos.pipelines ?? []} inicial={datos.embudo ?? []} inicialId={datos.embudo_pipeline_id ?? null}
          paramsRango={cargado?.params ?? params} texto={texto} cargandoPanel={refrescando} /></div>
      </DialogoSimple>
      <DialogoSimple abierto={verDetalle === 'contenido'} onCerrar={() => setVerDetalle(null)} titulo="Tus contenidos">
        <MejorContenido contenidos={datos.contenidos ?? []} texto={texto} cargando={refrescando}
          onAbrir={(c) => { setVerDetalle(null); if (c.id) detalle.abrir(c.id); }} />
      </DialogoSimple>
      <DialogoSimple abierto={verDetalle === 'analisis'} onCerrar={() => setVerDetalle(null)} titulo="Análisis completo">
        <div className="space-y-3">
          <Angulos angulos={datos.angulos ?? []} mezcla={datos.mezcla} abiertoInicial />
          <Equipo personas={datos.closers ?? []} abiertoInicial texto={texto} />
          <Fiabilidad calidad={datos.calidad} texto={texto} />
        </div>
      </DialogoSimple>
      <DialogoObjetivo abierto={editandoObjetivo} onCerrar={() => setEditandoObjetivo(false)} metas={datos.metas} estado={estado}
        mes={ritmoDelMes().mes} onGuardado={() => { setEditandoObjetivo(false); recargar(true); cargarEstado(); }} />
      <DetalleContenido contenido={contenidoAbierto} onCerrar={detalle.cerrar} />
      <DialogoMudos abierto={verMudos} onCerrar={() => setVerMudos(false)} mudos={datos.mudos ?? []} texto={texto} />
    </div>
  );
}
