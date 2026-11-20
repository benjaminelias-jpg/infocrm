import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, fmtDinero, fmtNum, plural, token } from '../api';
import ConfigPipelines from './ConfigPipelines';
import {
  SelectorConMas, Buscador, BotonIcono, Boton, Dialogo, Chip, FilaChips, Ayuda, ErrorCarga, Vacio, Esqueleto,
  BotonFlotante, Menu, ItemMenu, useAviso, useEsMovil,
} from '../ui';
import Icono from '../componentes/Iconos';
import { useFicha } from '../componentes/useFicha';
import Tarjeta from '../componentes/pipeline/Tarjeta';
import LeadRapido from '../componentes/pipeline/LeadRapido';
import { DialogoVenta, DialogoPerdido } from '../componentes/pipeline/Dialogos';
import { accionesDe, resumirAccion, resumirAcciones, tieneExternas } from '../componentes/pipeline/acciones';
import { DialogoNuevoPipeline } from '../componentes/pipeline/config/DialogosPipeline';
import { EVENTOS } from '../componentes/pipeline/config/datos';

// Pipeline estilo Kommo: columnas por etapa con tarjetas compactas.
// - Todas las etapas se alcanzan: mapa de etapas arriba (chips), flechas y
//   barra fina en escritorio, rueda del mouse que mueve el tablero.
// - Buscar y filtrar (Míos / Sin asignar / Sin leer) se hace en el servidor:
//   encuentra a cualquiera, no solo a los primeros 50 de cada etapa.
// - Mover a una etapa con automatizaciones que salen afuera (DM, audio,
//   email…) espera 5 s con "Deshacer". Soltar en Venta registra la venta;
//   en Perdido pregunta por qué.
// - Pipeline elegido y configuración en la URL (?p=…&config=1): Atrás funciona.

type Filtro = 'todos' | 'mios' | 'sin' | 'sinleer';
const FILTROS: Array<{ id: Filtro; nombre: string }> = [
  { id: 'todos', nombre: 'Todos' }, { id: 'mios', nombre: 'Míos' },
  { id: 'sin', nombre: 'Sin asignar' }, { id: 'sinleer', nombre: 'Sin leer' },
];
const CLAVE_FILTRO = 'infocrm_pipeline_filtro';
const ESPERA_MS = 5000;

function leerFiltro(): Filtro {
  try { const f = localStorage.getItem(CLAVE_FILTRO) as Filtro | null; return f && FILTROS.some((x) => x.id === f) ? f : 'todos'; } catch { return 'todos'; }
}

function useRetardo<T>(valor: T, ms: number) {
  const [v, setV] = useState(valor);
  useEffect(() => { const t = window.setTimeout(() => setV(valor), ms); return () => window.clearTimeout(t); }, [valor, ms]);
  return v;
}

/** Mueve una tarjeta entre columnas en memoria (para que el tablero responda al instante). */
function moverEnTablero(etapas: any[], oppId: string, etapaId: string, cambios: Record<string, unknown> = {}) {
  let tarjeta: any = null;
  const sin = etapas.map((e) => {
    const i = e.tarjetas.findIndex((t: any) => t.oportunidad_id === oppId);
    if (i === -1) return e;
    tarjeta = e.tarjetas[i];
    return { ...e, total: Math.max(0, e.total - 1), coinciden: Math.max(0, (e.coinciden ?? e.total) - 1), tarjetas: e.tarjetas.filter((t: any) => t.oportunidad_id !== oppId) };
  });
  if (!tarjeta) return etapas;
  return sin.map((e) => (e.id === etapaId
    ? { ...e, total: e.total + 1, coinciden: (e.coinciden ?? e.total) + 1, tarjetas: [{ ...tarjeta, ...cambios, etapa_id: etapaId }, ...e.tarjetas] }
    : e));
}

export default function Pipeline() {
  const aviso = useAviso();
  const navegar = useNavigate();
  const ficha = useFicha();
  const movil = useEsMovil(768);
  const [params, setParams] = useSearchParams();
  const configAbierta = params.get('config');

  const [pipes, setPipes] = useState<any[] | null>(null);
  const [conteos, setConteos] = useState<Record<string, number>>({});
  const [usuarios, setUsuarios] = useState<Array<{ id: string; nombre: string }>>([]);
  const [etapas, setEtapas] = useState<any[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [recargando, setRecargando] = useState(false);
  const [q, setQ] = useState('');
  const qRet = useRetardo(q, 250);
  const [filtro, setFiltroEstado] = useState<Filtro>(leerFiltro);
  const [buscadorMovil, setBuscadorMovil] = useState(false);
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [rapido, setRapido] = useState<string | null>(null);
  const [rapidoMovil, setRapidoMovil] = useState(false);
  const [venta, setVenta] = useState<{ t: any; etapa: any } | null>(null);
  const [perdido, setPerdido] = useState<{ t: any; etapa: any } | null>(null);
  const [nuevoPipe, setNuevoPipe] = useState(false);
  const [nuevaEtapa, setNuevaEtapa] = useState<string | null>(null);
  const [creandoEtapa, setCreandoEtapa] = useState(false);
  const [visibles, setVisibles] = useState<[number, number]>([0, 0]);
  const [bordes, setBordes] = useState({ izq: false, der: false });
  const tablero = useRef<HTMLDivElement>(null);
  const filaChips = useRef<HTMLDivElement>(null);
  const turno = useRef(0);
  /** Movimientos que esperan 5 s (con "Deshacer") antes de ir al servidor. */
  const pendientes = useRef(new Map<string, { timer: number; etapaId: string; desde: string }>());

  const pipeParam = params.get('p');
  const pipeId = useMemo(() => {
    if (!pipes?.length) return null;
    if (pipeParam && pipes.some((p) => p.id === pipeParam)) return pipeParam;
    return pipes.find((p) => p.es_predeterminado)?.id ?? pipes[0].id;
  }, [pipes, pipeParam]);

  function setFiltro(f: Filtro) {
    setFiltroEstado(f);
    try { localStorage.setItem(CLAVE_FILTRO, f); } catch { /* sin almacenamiento */ }
  }

  const cargarPipes = useCallback(async () => {
    const [p, c, u] = await Promise.all([
      api<any[]>('/pipelines'),
      api<Record<string, number>>('/ux/pipeline/conteos').catch(() => ({})),
      api<any[]>('/usuarios').catch(() => []),
    ]);
    setPipes(p); setConteos(c);
    setUsuarios(u.filter((x: any) => x.activo !== false).map((x: any) => ({ id: x.id, nombre: x.nombre })));
    return p;
  }, []);

  const cargarTablero = useCallback(async (silencioso = false) => {
    if (!pipeId) return;
    const yo = ++turno.current;
    if (!silencioso) setRecargando(true);
    try {
      const qs = new URLSearchParams({ pipeline_id: pipeId });
      if (qRet.trim()) qs.set('q', qRet.trim());
      if (filtro === 'mios' || filtro === 'sin') qs.set('propietario', filtro);
      if (filtro === 'sinleer') qs.set('sin_leer', '1');
      let datos = await api<any[]>(`/kanban?${qs}`);
      if (yo !== turno.current) return;
      // Lo que todavía espera su "Deshacer" se ve donde el usuario lo soltó.
      for (const [opp, p] of pendientes.current) datos = moverEnTablero(datos, opp, p.etapaId);
      setEtapas(datos);
      setError(null);
    } catch (e: any) {
      if (yo !== turno.current) return;
      if (silencioso) return;
      setError(e);
    } finally {
      if (yo === turno.current) setRecargando(false);
    }
  }, [pipeId, qRet, filtro]);

  useEffect(() => { cargarPipes().catch((e) => setError(e)); }, [cargarPipes]);
  useEffect(() => { cargarTablero(); }, [cargarTablero]);

  // Refresco silencioso cada 60 s y al volver a la pestaña (si no estás arrastrando).
  useEffect(() => {
    const f = () => {
      if (document.visibilityState === 'hidden' || arrastrando || pendientes.current.size) return;
      cargarTablero(true);
    };
    const t = window.setInterval(f, 60_000);
    window.addEventListener('focus', f);
    return () => { window.clearInterval(t); window.removeEventListener('focus', f); };
  }, [cargarTablero, arrastrando]);

  // Al cerrar la ficha, refrescamos (puede haber cambiado etapa, etiquetas…).
  const fichaAntes = useRef(ficha.abierta);
  useEffect(() => {
    if (fichaAntes.current && !ficha.abierta) cargarTablero(true);
    fichaAntes.current = ficha.abierta;
  }, [ficha.abierta, cargarTablero]);

  // Si te vas de la pantalla con un movimiento esperando, se manda igual.
  useEffect(() => {
    const vaciar = () => {
      for (const [opp, p] of pendientes.current) {
        window.clearTimeout(p.timer);
        fetch(`/api/oportunidades/${opp}/etapa`, {
          method: 'POST', keepalive: true,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token() ?? ''}` },
          body: JSON.stringify({ etapa_id: p.etapaId }),
        }).catch(() => {});
      }
      pendientes.current.clear();
    };
    window.addEventListener('pagehide', vaciar);
    return () => { window.removeEventListener('pagehide', vaciar); vaciar(); };
  }, []);

  function elegirPipe(id: string) {
    setParams((prev) => { const p = new URLSearchParams(prev); p.set('p', id); return p; }, { replace: true });
    tablero.current?.scrollTo({ left: 0 });
  }

  async function pipeCreado(nuevo: { id: string }) {
    setNuevoPipe(false);
    await cargarPipes();
    elegirPipe(nuevo.id);
  }

  async function crearEtapa(e?: React.FormEvent) {
    e?.preventDefault();
    const nombre = (nuevaEtapa ?? '').trim();
    if (!nombre || !pipeId) return;
    setCreandoEtapa(true);
    try {
      const cierre = etapas?.find((x) => x.tipo !== 'abierta');
      await api(`/pipelines/${pipeId}/etapas`, { method: 'POST', json: { nombre } });
      setNuevaEtapa(null);
      await Promise.all([cargarPipes(), cargarTablero(true)]);
      aviso.exito(cierre ? `Etapa «${nombre}» creada, antes de «${cierre.nombre}».` : `Etapa «${nombre}» creada.`, {
        texto: 'Ponerle automatizaciones', onClick: () => abrirConfig(),
      });
    } catch (err: any) { aviso.error(err.message); } finally { setCreandoEtapa(false); }
  }

  function abrirConfig(foco?: 'reglas', etapaId?: string) {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set('config', foco ?? '1'); if (pipeId) p.set('p', pipeId);
      if (etapaId) p.set('etapa', etapaId); else p.delete('etapa');
      return p;
    }, { state: { configApilada: true } });
  }
  function cerrarConfig() {
    if ((window.history.state as any)?.usr?.configApilada) { window.history.back(); return; }
    setParams((prev) => { const p = new URLSearchParams(prev); p.delete('config'); p.delete('etapa'); return p; }, { replace: true });
  }

  // ---------------- Mover ----------------

  const quienDe = (t: any) => (t.ig_username ? `@${t.ig_username}` : t.nombre || 'El lead');

  async function enviarMovimiento(oppId: string, etapaId: string, sinAcciones = false) {
    pendientes.current.delete(oppId);
    try {
      await api(`/oportunidades/${oppId}/etapa`, { method: 'POST', json: { etapa_id: etapaId, ...(sinAcciones ? { sin_acciones: true } : {}) } });
    } catch (err: any) {
      aviso.error(err.message ?? 'No se pudo mover');
      cargarTablero(true);
    }
  }

  function moverA(t: any, etapaId: string) {
    if (!etapas) return;
    const destino = etapas.find((e) => e.id === etapaId);
    if (!destino || t.etapa_id === etapaId) return;
    if (destino.tipo === 'ganada') { setVenta({ t, etapa: destino }); return; }
    if (destino.tipo === 'perdida') { setPerdido({ t, etapa: destino }); return; }
    const desde = t.etapa_id;
    const quien = quienDe(t);
    const resumen = resumirAcciones(destino);
    setEtapas((prev) => (prev ? moverEnTablero(prev, t.oportunidad_id, etapaId) : prev));

    if (tieneExternas(destino)) {
      // Sale algo hacia afuera (DM, audio, email…): 5 s para arrepentirse.
      const previo = pendientes.current.get(t.oportunidad_id);
      if (previo) window.clearTimeout(previo.timer);
      const timer = window.setTimeout(() => enviarMovimiento(t.oportunidad_id, etapaId), ESPERA_MS);
      pendientes.current.set(t.oportunidad_id, { timer, etapaId, desde: previo?.desde ?? desde });
      aviso.info(<>{quien} → «{destino.nombre}». En 5 s {resumen}.</>, {
        texto: 'Deshacer',
        onClick: () => {
          const p = pendientes.current.get(t.oportunidad_id);
          if (!p) return;
          window.clearTimeout(p.timer);
          pendientes.current.delete(t.oportunidad_id);
          setEtapas((prev) => (prev ? moverEnTablero(prev, t.oportunidad_id, p.desde) : prev));
        },
      });
      return;
    }
    enviarMovimiento(t.oportunidad_id, etapaId);
    aviso.exito(<>{quien} → «{destino.nombre}»{resumen ? <> · {resumen}</> : null}</>, {
      texto: 'Deshacer',
      onClick: () => {
        setEtapas((prev) => (prev ? moverEnTablero(prev, t.oportunidad_id, desde) : prev));
        enviarMovimiento(t.oportunidad_id, desde, true); // volver SIN repetir automatizaciones
      },
    });
  }

  async function asignar(t: any, usuarioId: string | null) {
    const nombre = usuarios.find((u) => u.id === usuarioId)?.nombre ?? null;
    setEtapas((prev) => prev?.map((e) => ({
      ...e, tarjetas: e.tarjetas.map((x: any) => (x.oportunidad_id === t.oportunidad_id ? { ...x, propietario_id: usuarioId, propietario_nombre: nombre } : x)),
    })) ?? prev);
    try {
      await api('/ux/pipeline/asignar', { method: 'POST', json: { oportunidad_id: t.oportunidad_id, usuario_id: usuarioId } });
      aviso.exito(nombre ? `${quienDe(t)} ahora lo atiende ${nombre}.` : `${quienDe(t)} quedó sin asignar.`);
    } catch (e: any) { aviso.error(e.message); cargarTablero(true); }
  }

  // ---------------- Desplazamiento del tablero ----------------

  const anchoColumna = () => {
    const el = tablero.current;
    const col = el?.querySelector<HTMLElement>('[data-columna]');
    return (col?.offsetWidth ?? 288) + 12;
  };

  const alDesplazar = useCallback(() => {
    const el = tablero.current;
    if (!el) return;
    const ancho = anchoColumna();
    const margen = parseFloat(getComputedStyle(el).paddingLeft) || 0;
    const primera = Math.max(0, Math.round((el.scrollLeft - margen) / ancho));
    // Una columna cuenta como "a la vista" si se ve entera (con 24 px de tolerancia).
    const ultima = Math.max(primera, Math.floor((el.scrollLeft + el.clientWidth - margen + 24) / ancho) - 1);
    setVisibles((v) => (v[0] === primera && v[1] === ultima ? v : [primera, ultima]));
    setBordes({ izq: el.scrollLeft > 4, der: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);

  useEffect(() => { alDesplazar(); }, [etapas, alDesplazar]);

  // Enlaces de otras pantallas (?etapa=<id>, p. ej. una fila del embudo del
  // Panel): lleva a esa columna y la resalta un momento.
  const [resaltada, setResaltada] = useState<string | null>(null);
  const etapaPedida = !configAbierta ? params.get('etapa') : null;
  useEffect(() => {
    if (!etapaPedida || !etapas?.length) return;
    const i = etapas.findIndex((e) => e.id === etapaPedida);
    setParams((prev) => { const p = new URLSearchParams(prev); p.delete('etapa'); return p; }, { replace: true });
    if (i < 0) return;
    window.requestAnimationFrame(() => irAColumna(i));
    setResaltada(etapaPedida);
    const t = window.setTimeout(() => setResaltada(null), 2600);
    return () => window.clearTimeout(t);
  }, [etapaPedida, etapas]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    window.addEventListener('resize', alDesplazar);
    return () => window.removeEventListener('resize', alDesplazar);
  }, [alDesplazar]);

  // El chip de la columna a la vista siempre visible en la fila de chips.
  useEffect(() => {
    const chip = filaChips.current?.querySelector<HTMLElement>(`[data-chip="${visibles[0]}"]`);
    chip?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [visibles]);

  // Rueda del mouse: si no estás sobre una lista que pueda bajar, mueve el tablero de costado.
  useEffect(() => {
    const el = tablero.current;
    if (!el) return;
    const rueda = (e: WheelEvent) => {
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const lista = (e.target as HTMLElement).closest<HTMLElement>('[data-lista]');
      if (lista) {
        const puedeBajar = e.deltaY > 0 ? lista.scrollTop + lista.clientHeight < lista.scrollHeight - 1 : lista.scrollTop > 0;
        if (puedeBajar) return;
      }
      if (el.scrollWidth <= el.clientWidth) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener('wheel', rueda, { passive: false });
    return () => el.removeEventListener('wheel', rueda);
  }, [etapas]);

  function irAColumna(i: number) {
    const el = tablero.current;
    const col = el?.querySelectorAll<HTMLElement>('[data-columna]')[i];
    if (el && col) el.scrollTo({ left: col.offsetLeft - el.offsetLeft - (movil ? 16 : 0), behavior: 'smooth' });
  }
  function correr(dir: 1 | -1) {
    tablero.current?.scrollBy({ left: dir * anchoColumna(), behavior: 'smooth' });
  }

  // ---------------- Pantalla ----------------

  if (configAbierta) {
    return (
      <ConfigPipelines foco={configAbierta === 'reglas' ? 'reglas' : undefined} pipelineId={pipeId}
        onElegirPipeline={(id) => setParams((prev) => { const p = new URLSearchParams(prev); p.set('p', id); return p; }, { replace: true, state: window.history.state?.usr })}
        onCerrar={async () => { cerrarConfig(); await cargarPipes(); cargarTablero(true); }} />
    );
  }

  if (error && !etapas) {
    return <div className="px-4 py-8"><ErrorCarga error={error} titulo="No pudimos cargar el pipeline" onReintentar={() => { setError(null); cargarPipes().then(() => cargarTablero()).catch((e) => setError(e)); }} /></div>;
  }

  const items = (pipes ?? []).map((p) => ({ id: p.id, nombre: p.nombre }));
  const pipeActual = pipes?.find((p) => p.id === pipeId);
  const busqueda = Boolean(qRet.trim()) || filtro !== 'todos';
  const columnaParaRapido = etapas?.[visibles[0]] ?? etapas?.[0];

  const selector = (
    <SelectorConMas items={items} actualId={pipeId} onElegir={elegirPipe} onNuevo={() => setNuevoPipe(true)}
      queEs="pipeline" extra={(p) => [
        conteos[p.id] !== undefined ? plural(conteos[p.id], 'lead abierto', 'leads abiertos') : null,
        pipes?.find((x) => x.id === p.id)?.es_predeterminado ? '★ acá entran los nuevos' : null,
      ].filter(Boolean).join(' · ') || undefined}
      onGestionar={() => abrirConfig()} textoGestionar="Configurar etapas y automatizaciones" />
  );
  const chipsFiltro = (
    <FilaChips>
      {FILTROS.map((f) => <Chip key={f.id} activo={filtro === f.id} onClick={() => setFiltro(f.id)}>{f.nombre}</Chip>)}
    </FilaChips>
  );

  return (
    <div className="alto-app flex flex-col">
      {/* Barra: pipeline (+) · buscar · filtros · ⚙ */}
      <div className="px-4 pb-2 pt-3 md:pt-4 lg:px-8">
        {movil ? (
          buscadorMovil ? (
            <div className="flex items-center gap-2">
              <Buscador valor={q} onCambiar={setQ} placeholder="Buscar @usuario, nombre, etiqueta…" className="min-w-0 flex-1" autoFocus />
              <Boton variante="fantasma" tamano="sm" onClick={() => { setQ(''); setBuscadorMovil(false); }}>Cancelar</Boton>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">{selector}</div>
              <BotonIcono etiqueta="Buscar" variante="secundario" onClick={() => setBuscadorMovil(true)}><Icono nombre="buscar" tam={18} /></BotonIcono>
              <Menu alinear="derecha" titulo="Mostrar" disparador={({ alternar, abierto }) => (
                <span className="relative inline-flex">
                  <BotonIcono etiqueta="Filtrar" variante="secundario" onClick={alternar} aria-expanded={abierto}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M3 5h18M6 12h12M10 19h4" /></svg>
                  </BotonIcono>
                  {filtro !== 'todos' && <span className="absolute right-1 top-1 h-2 w-2 rounded-full" style={{ background: 'var(--series-1)' }} aria-hidden />}
                </span>
              )}>
                {FILTROS.map((f) => <ItemMenu key={f.id} activo={filtro === f.id} onClick={() => setFiltro(f.id)}>{f.nombre}</ItemMenu>)}
              </Menu>
              <BotonIcono etiqueta="Configurar etapas y automatizaciones" variante="secundario" onClick={() => abrirConfig()}><Icono nombre="reglas" tam={18} /></BotonIcono>
            </div>
          )
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {selector}
            {chipsFiltro}
            <div className="ml-auto flex items-center gap-2">
              <Buscador valor={q} onCambiar={setQ} placeholder="Buscar @usuario, nombre, etiqueta…" className="w-[260px]" />
              <BotonIcono etiqueta="Configurar etapas y automatizaciones" variante="secundario" onClick={() => abrirConfig()}><Icono nombre="reglas" tam={18} /></BotonIcono>
            </div>
          </div>
        )}
        {movil && filtro !== 'todos' && !buscadorMovil && (
          <div className="mt-2 flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
            Mostrando: <b>{FILTROS.find((f) => f.id === filtro)?.nombre}</b>
            <button type="button" className="ui-foco underline" onClick={() => setFiltro('todos')}>ver todos</button>
          </div>
        )}
      </div>

      {/* Mapa de etapas: saltar a cualquier columna (celular y escritorio) */}
      {etapas && etapas.length > 0 && (
        <div ref={filaChips} data-no-deslizar className="sin-barra flex shrink-0 gap-1.5 overflow-x-auto px-4 pb-2 lg:px-8" role="tablist" aria-label="Etapas">
          {etapas.map((e, i) => {
            const enVista = i >= visibles[0] && i <= visibles[1];
            const n = busqueda ? (e.coinciden ?? 0) : e.total;
            return (
              <button key={e.id} type="button" data-chip={i} onClick={() => irAColumna(i)} role="tab" aria-selected={enVista}
                aria-current={i === visibles[0] ? 'true' : undefined}
                className={`ui-foco inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] border px-3 text-[12px] transition-colors ${enVista ? 'border-transparent font-semibold' : 'border-[var(--border-hairline)] bg-[var(--surface-1)] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-2)]'}`}
                style={enVista ? { background: 'var(--tint)', color: 'var(--series-1)' } : undefined}>
                <span className="h-2 w-2 rounded-full" style={{ background: e.color }} aria-hidden />
                {e.nombre}
                <span className="cifras text-[10px] opacity-80">{fmtNum(n)}</span>
                {accionesDe(e).length > 0 && <span className="text-[10px]" aria-label="tiene automatizaciones">⚡</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Tablero */}
      <div className="relative min-h-0 flex-1">
        {!etapas ? (
          <div className="flex gap-3 overflow-hidden px-4 lg:px-8" aria-busy="true" aria-label="Cargando el pipeline">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="w-[86vw] max-w-[340px] shrink-0 space-y-2 rounded-xl p-2 md:w-[288px]" style={{ background: 'color-mix(in srgb, var(--surface-2) 55%, var(--page-plane))' }}>
                <Esqueleto alto={14} ancho="60%" /><Esqueleto alto={64} /><Esqueleto alto={64} /><Esqueleto alto={64} />
              </div>
            ))}
          </div>
        ) : etapas.length === 0 ? (
          <Vacio icono="🧩" titulo="Este pipeline no tiene etapas" texto="Agregale etapas para empezar a mover leads."
            accion={<Boton variante="primario" onClick={() => abrirConfig()}>Configurar etapas</Boton>} />
        ) : (
          <>
            {!movil && bordes.izq && (
              <button type="button" onClick={() => correr(-1)} aria-label="Ver etapas anteriores"
                className="ui-foco absolute left-1 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full shadow-lg"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-hairline)' }}><Icono nombre="volver" tam={18} /></button>
            )}
            {!movil && bordes.der && (
              <button type="button" onClick={() => correr(1)} aria-label="Ver más etapas"
                className="ui-foco absolute right-1 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full shadow-lg"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-hairline)' }}><Icono nombre="siguiente" tam={18} /></button>
            )}
            <div ref={tablero} onScroll={alDesplazar} data-no-deslizar
              className={`sin-barra md:barra-fina flex h-full snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-3 transition-opacity md:snap-none lg:px-8 ${recargando ? 'pointer-events-none opacity-50' : ''}`}
              aria-busy={recargando}>
              {etapas.map((etapa) => {
                const acciones = accionesDe(etapa);
                const n = busqueda ? (etapa.coinciden ?? 0) : etapa.total;
                return (
                  <section key={etapa.id} data-columna aria-label={etapa.nombre}
                    onDragOver={(e) => { e.preventDefault(); if (sobre !== etapa.id) setSobre(etapa.id); }}
                    onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setSobre((s) => (s === etapa.id ? null : s)); }}
                    onDrop={() => {
                      setSobre(null);
                      const t = etapas.flatMap((x) => x.tarjetas).find((x: any) => x.oportunidad_id === arrastrando);
                      if (t) moverA(t, etapa.id);
                      setArrastrando(null);
                    }}
                    className="relative flex w-[86vw] max-w-[340px] shrink-0 snap-start flex-col rounded-xl transition-colors md:w-[288px]"
                    style={{
                      background: sobre === etapa.id ? 'var(--tint)' : 'color-mix(in srgb, var(--surface-2) 55%, var(--page-plane))',
                      outline: sobre === etapa.id ? '2px dashed var(--series-1)' : resaltada === etapa.id ? '2px solid var(--series-1)' : 'none', outlineOffset: -2,
                      transition: 'outline-color .3s',
                    }}>
                    <header className="px-2.5 pb-2 pt-2.5">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: etapa.color }} aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold uppercase tracking-wide">{etapa.nombre}</span>
                        {acciones.length > 0 && (
                          <span className="inline-flex items-center gap-0.5 rounded-[6px] px-1.5 text-[11px] font-semibold"
                            style={{ background: 'var(--tint)', color: 'var(--series-1)' }}>
                            ⚡{acciones.length}
                            <Ayuda titulo={`Al entrar a «${etapa.nombre}»`}>
                              <ul className="list-disc space-y-0.5 pl-4">{acciones.map((a, i) => <li key={i}>{resumirAccion(a)}</li>)}</ul>
                              <button type="button" className="mt-2 underline" onClick={() => abrirConfig()}>Editar automatizaciones</button>
                            </Ayuda>
                          </span>
                        )}
                        {!movil && (
                          <BotonIcono etiqueta={`Agregar un lead a ${etapa.nombre}`} variante="fantasma" tamano="xs" onClick={() => setRapido(rapido === etapa.id ? null : etapa.id)}>
                            <Icono nombre="mas" tam={15} />
                          </BotonIcono>
                        )}
                        <BotonIcono etiqueta={`Editar «${etapa.nombre}» (nombre, color y automatizaciones)`} variante="fantasma" tamano="xs" onClick={() => abrirConfig(undefined, etapa.id)}>
                          <Icono nombre="reglas" tam={14} />
                        </BotonIcono>
                      </div>
                      <div className="cifras mt-0.5 truncate pl-[18px] text-[11px] text-[var(--text-muted)]">
                        {busqueda ? `${fmtNum(n)} de ${fmtNum(etapa.total)}` : plural(etapa.total, 'lead')}
                        {Number(etapa.valor_total) > 0 ? ` · ${fmtDinero(etapa.valor_total)}` : ''}
                        {etapa.evento_asociado && EVENTOS.some((ev) => ev.id === etapa.evento_asociado) && (
                          <span title={`Se mueve sola cuando el lead ${EVENTOS.find((ev) => ev.id === etapa.evento_asociado)!.lead}`}>
                            {' · ↻ '}{EVENTOS.find((ev) => ev.id === etapa.evento_asociado)!.corto}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 h-[3px] rounded-full" style={{ background: etapa.color, opacity: 0.55 }} aria-hidden />
                    </header>

                    <div data-lista className="flex-1 space-y-1.5 overflow-y-auto px-2 pb-24 md:pb-2">
                      {rapido === etapa.id && (
                        <LeadRapido etapa={etapa} pipelineId={pipeId} onCerrar={() => setRapido(null)}
                          onCreado={async (txt) => { aviso.exito(txt); await Promise.all([cargarTablero(true), cargarPipes()]); }} />
                      )}

                      {etapa.tarjetas.map((t: any) => (
                        <Tarjeta key={t.oportunidad_id} t={t} etapas={etapas} usuarios={usuarios}
                          onAbrir={() => ficha.abrir(t.lead_id)}
                          onChat={() => navegar(`/chat/${t.lead_id}`)}
                          onMover={(etapaId) => moverA(t, etapaId)}
                          onAsignar={(u) => asignar(t, u)}
                          onArrastrar={(v) => setArrastrando(v ? t.oportunidad_id : null)} />
                      ))}

                      {etapa.tarjetas.length === 0 && (
                        <div className="px-2 py-6 text-center text-[12px] text-[var(--text-muted)]">
                          {busqueda ? 'Nadie coincide acá' : 'Nadie acá todavía'}
                        </div>
                      )}
                      {n > etapa.tarjetas.length && (
                        <div className="py-1 text-center text-[11px] text-[var(--text-muted)]">
                          Mostrando los {fmtNum(etapa.tarjetas.length)} más recientes de {fmtNum(n)}
                          {!busqueda && ' · buscá para encontrar al resto'}
                        </div>
                      )}
                    </div>
                  </section>
                );
              })}
              {/* "+ Nueva etapa": se crea antes de las de cierre (venta / perdido). */}
              <div className="flex w-[70vw] max-w-[260px] shrink-0 snap-start flex-col md:w-[220px]">
                {nuevaEtapa === null ? (
                  <button type="button" onClick={() => setNuevaEtapa('')}
                    className="ui-foco flex h-12 items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--border-hairline)] text-[13px] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]">
                    <Icono nombre="mas" tam={15} /> Nueva etapa
                  </button>
                ) : (
                  <form onSubmit={crearEtapa} className="space-y-2 rounded-xl border border-dashed p-2" style={{ borderColor: 'var(--series-1)' }}>
                    <input autoFocus value={nuevaEtapa} onChange={(e) => setNuevaEtapa(e.target.value)} maxLength={40}
                      onKeyDown={(e) => { if (e.key === 'Escape') setNuevaEtapa(null); }} placeholder="Nombre (ej. Seguimiento)" aria-label="Nombre de la nueva etapa"
                      className="ui-control h-10 w-full rounded-lg px-3 text-[16px] md:h-9 md:text-[13px]" />
                    <div className="flex gap-1.5">
                      <Boton type="submit" variante="primario" tamano="sm" cargando={creandoEtapa} disabled={!nuevaEtapa.trim()}>Crear</Boton>
                      <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setNuevaEtapa(null)}>Cancelar</Boton>
                    </div>
                    {etapas.some((x) => x.tipo !== 'abierta') && (
                      <p className="text-[11px] text-[var(--text-muted)]">Va antes de «{etapas.find((x) => x.tipo !== 'abierta')!.nombre}».</p>
                    )}
                  </form>
                )}
              </div>
            </div>
          </>
        )}
        {error && etapas && (
          <div className="absolute inset-x-4 top-2 z-10"><ErrorCarga compacto error={error} titulo="No pudimos actualizar el pipeline" onReintentar={() => cargarTablero()} /></div>
        )}
      </div>

      {/* Celular: "+" para cargar un lead en la etapa que tenés a la vista */}
      {movil && etapas && etapas.length > 0 && columnaParaRapido && (
        <BotonFlotante etiqueta={`Agregar un lead a ${columnaParaRapido.nombre}`} onClick={() => setRapidoMovil(true)} />
      )}
      {rapidoMovil && columnaParaRapido && (
        <Dialogo abierto onCerrar={() => setRapidoMovil(false)} titulo={`Agregar a «${columnaParaRapido.nombre}»`}
          descripcion={pipeActual ? `Pipeline ${pipeActual.nombre}` : undefined}>
          <LeadRapido etapa={columnaParaRapido} pipelineId={pipeId} compacto={false} onCerrar={() => setRapidoMovil(false)}
            onCreado={async (txt) => { aviso.exito(txt); setRapidoMovil(false); await Promise.all([cargarTablero(true), cargarPipes()]); }} />
        </Dialogo>
      )}

      <DialogoNuevoPipeline abierto={nuevoPipe} pipes={pipes ?? []} actualId={pipeId} onCerrar={() => setNuevoPipe(false)} onCreado={pipeCreado} />
      {venta && (
        <DialogoVenta tarjeta={venta.t} etapa={venta.etapa} onCerrar={() => setVenta(null)}
          onListo={async (_registrada, texto) => {
            setEtapas((prev) => (prev ? moverEnTablero(prev, venta.t.oportunidad_id, venta.etapa.id) : prev));
            setVenta(null); aviso.exito(texto); await cargarTablero(true);
          }} />
      )}
      {perdido && (
        <DialogoPerdido tarjeta={perdido.t} etapa={perdido.etapa} onCerrar={() => setPerdido(null)}
          onListo={async (texto) => {
            setEtapas((prev) => (prev ? moverEnTablero(prev, perdido.t.oportunidad_id, perdido.etapa.id) : prev));
            setPerdido(null); aviso.exito(texto); await cargarTablero(true);
          }} />
      )}
    </div>
  );
}
