import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, fmtDinero, fmtNum } from '../api';
import FichaLead from '../componentes/FichaLead';
import ConfigPipelines from './ConfigPipelines';
import {
  SelectorConMas, Buscador, Menu, ItemMenu, SeparadorMenu, BotonIcono, EsqueletoPantalla, useAviso,
} from '../ui';

// Pipeline estilo Kommo: columnas por etapa con tarjetas compactas de tres
// renglones (quién lo atiende y cuándo · @usuario · etiquetas). En la
// computadora se arrastran; en el celular las columnas se pasan deslizando
// y cada tarjeta tiene "⋯" para moverla de etapa.

/** "Hoy 11:16", "Ayer 14:32" o "04/11" (con año si no es este). */
function fechaCorta(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const hoy = new Date();
  const ayer = new Date(Date.now() - 86_400_000);
  const mismoDia = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (mismoDia(d, hoy)) return `Hoy ${hora}`;
  if (mismoDia(d, ayer)) return `Ayer ${hora}`;
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', ...(d.getFullYear() !== hoy.getFullYear() ? { year: 'numeric' } : {}) });
}

function EtiquetaChica({ children, titulo }: { children: React.ReactNode; titulo?: string }) {
  return (
    <span title={titulo} className="max-w-[120px] shrink-0 truncate rounded border border-[var(--border-hairline)] px-1.5 py-px text-[11px] leading-[16px] text-[var(--text-secondary)]">
      {children}
    </span>
  );
}

export default function Pipeline() {
  const aviso = useAviso();
  const navegar = useNavigate();
  const [params, setParams] = useSearchParams();
  const [config, setConfig] = useState(!!params.get('config'));
  const [pipes, setPipes] = useState<any[]>([]);
  const [conteos, setConteos] = useState<Record<string, number>>({});
  const [pipeId, setPipeId] = useState<string | null>(null);
  const [etapas, setEtapas] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [leadAbierto, setLeadAbierto] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [rapido, setRapido] = useState<string | null>(null);
  const [columnaVisible, setColumnaVisible] = useState(0);
  const tablero = useRef<HTMLDivElement>(null);

  const cargarPipes = useCallback(async () => {
    const [p, c] = await Promise.all([
      api<any[]>('/pipelines'),
      api<Record<string, number>>('/ux/pipeline/conteos').catch(() => ({})),
    ]);
    setPipes(p);
    setConteos(c);
    return p;
  }, []);

  const cargarTablero = useCallback(async (pid: string | null) => {
    if (!pid) { setCargando(false); return; }
    setEtapas(await api<any[]>(`/kanban?pipeline_id=${pid}`));
    setCargando(false);
  }, []);

  useEffect(() => {
    (async () => {
      const p = await cargarPipes();
      const inicial = p.find((x: any) => x.es_predeterminado)?.id ?? p[0]?.id ?? null;
      setPipeId(inicial);
      await cargarTablero(inicial);
    })();
  }, [cargarPipes, cargarTablero]);

  async function elegirPipe(id: string) {
    setPipeId(id);
    setCargando(true);
    await cargarTablero(id);
    tablero.current?.scrollTo({ left: 0 });
    setColumnaVisible(0);
  }

  async function crearPipe(nombre: string) {
    try {
      const nuevo = await api<any>('/pipelines', { method: 'POST', json: { nombre } });
      await cargarPipes();
      await elegirPipe(nuevo.id);
      aviso.exito(`Pipeline «${nombre}» creado con 5 etapas. Cambiales el nombre en ⚙ si querés.`);
    } catch (err: any) { aviso.error(err.message); }
  }

  async function moverA(oportunidadId: string, etapaId: string) {
    const destino = etapas.find((e) => e.id === etapaId);
    let cambio = false;
    setEtapas((prev) => {
      let tarjeta: any = null;
      const sin = prev.map((e) => {
        const i = e.tarjetas.findIndex((t: any) => t.oportunidad_id === oportunidadId);
        if (i === -1) return e;
        tarjeta = e.tarjetas[i];
        return { ...e, total: e.total - 1, tarjetas: e.tarjetas.filter((t: any) => t.oportunidad_id !== oportunidadId) };
      });
      if (!tarjeta || tarjeta.etapa_id === etapaId) return prev;
      cambio = true;
      return sin.map((e) => (e.id === etapaId ? { ...e, total: e.total + 1, tarjetas: [{ ...tarjeta, etapa_id: etapaId }, ...e.tarjetas] } : e));
    });
    if (!cambio && etapas.some((e) => e.id === etapaId && e.tarjetas.some((t: any) => t.oportunidad_id === oportunidadId))) return;
    try {
      await api(`/oportunidades/${oportunidadId}/etapa`, { method: 'POST', json: { etapa_id: etapaId } });
      if (destino && (destino.acciones ?? []).length) aviso.info(`Movido a «${destino.nombre}»: se ejecutaron sus automatizaciones.`);
    } catch (err: any) {
      aviso.error(err.message ?? 'No se pudo mover');
      cargarTablero(pipeId);
    }
  }

  // En el celular: qué columna está a la vista (para los chips de etapas).
  function alDesplazar() {
    const el = tablero.current;
    if (!el) return;
    const ancho = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? el.clientWidth;
    setColumnaVisible(Math.round(el.scrollLeft / (ancho + 12)));
  }
  function irAColumna(i: number) {
    const col = tablero.current?.children[i] as HTMLElement | undefined;
    if (col && tablero.current) tablero.current.scrollTo({ left: col.offsetLeft - tablero.current.offsetLeft - 16, behavior: 'smooth' });
  }

  const filtro = q.trim().toLowerCase();
  const visibles = useMemo(() => (filtro
    ? etapas.map((e) => ({
      ...e,
      tarjetas: e.tarjetas.filter((t: any) => `${t.ig_username ?? ''} ${t.nombre ?? ''} ${(t.etiquetas ?? []).join(' ')} ${t.propietario_nombre ?? ''}`.toLowerCase().includes(filtro)),
    }))
    : etapas), [etapas, filtro]);

  if (config) {
    return (
      <ConfigPipelines foco={params.get('config') === 'reglas' ? 'reglas' : undefined}
        onCerrar={async () => {
          setConfig(false);
          if (params.get('config')) { params.delete('config'); setParams(params, { replace: true }); }
          await cargarPipes();
          await cargarTablero(pipeId);
        }} />
    );
  }
  if (cargando && !etapas.length) return <EsqueletoPantalla tarjetas={0} filas={5} />;

  const items = pipes.map((p) => ({ id: p.id, nombre: p.nombre }));

  return (
    <div className="alto-app flex flex-col">
      {/* Barra superior: pipeline actual (desplegable) + "+" para crear */}
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-4 lg:px-8">
        <SelectorConMas items={items} actualId={pipeId} onElegir={elegirPipe} onCrear={crearPipe}
          queEs="pipeline" extra={(p) => `${fmtNum(conteos[p.id] ?? 0)} leads abiertos`}
          onGestionar={() => setConfig(true)} textoGestionar="Configurar etapas y automatizaciones" />
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <Buscador valor={q} onCambiar={setQ} placeholder="Buscar en el pipeline…" className="min-w-0 flex-1 sm:w-[240px] sm:flex-none" />
          <BotonIcono etiqueta="Configurar etapas y automatizaciones" variante="secundario" onClick={() => setConfig(true)}>⚙</BotonIcono>
        </div>
      </div>

      {/* Celular: chips de etapas para saltar entre columnas */}
      <div data-no-deslizar className="sin-barra flex gap-1.5 overflow-x-auto px-4 pb-2 md:hidden">
        {visibles.map((e, i) => (
          <button key={e.id} type="button" onClick={() => irAColumna(i)}
            className={`ui-foco inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] ${i === columnaVisible ? 'font-medium text-white' : 'border border-[var(--border-hairline)] text-[var(--text-secondary)]'}`}
            style={i === columnaVisible ? { background: 'var(--series-1)' } : undefined}>
            <span className="h-2 w-2 rounded-full" style={{ background: e.color }} aria-hidden />
            {e.nombre}
            <span className="text-[10px] opacity-80">{fmtNum(e.total)}</span>
          </button>
        ))}
      </div>

      {/* Tablero */}
      <div ref={tablero} onScroll={alDesplazar} data-no-deslizar
        className="sin-barra flex flex-1 snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 md:snap-none lg:px-8">
        {visibles.map((etapa) => (
          <section key={etapa.id}
            onDragOver={(e) => { e.preventDefault(); if (sobre !== etapa.id) setSobre(etapa.id); }}
            onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setSobre((s) => (s === etapa.id ? null : s)); }}
            onDrop={() => { setSobre(null); if (arrastrando) { moverA(arrastrando, etapa.id); setArrastrando(null); } }}
            className="flex w-[86vw] max-w-[340px] shrink-0 snap-start flex-col rounded-xl transition-colors md:w-[288px]"
            style={{
              background: sobre === etapa.id ? 'color-mix(in srgb, var(--series-1) 8%, var(--page-plane))' : 'var(--page-plane)',
              outline: sobre === etapa.id ? '2px dashed var(--series-1)' : 'none', outlineOffset: -2,
            }}>
            <header className="px-2.5 pb-2 pt-2.5">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: etapa.color }} aria-hidden />
                <span className="truncate text-[12px] font-semibold uppercase tracking-wide">{etapa.nombre}</span>
              </div>
              <div className="cifras mt-0.5 pl-[18px] text-[11px] text-[var(--text-muted)]">
                {fmtNum(etapa.total)} lead{etapa.total === 1 ? '' : 's'}{Number(etapa.valor_total) > 0 ? ` · ${fmtDinero(etapa.valor_total)}` : ''}
              </div>
              <div className="mt-1.5 h-[3px] rounded-full" style={{ background: etapa.color, opacity: 0.55 }} aria-hidden />
            </header>

            <div className="flex-1 space-y-1.5 overflow-y-auto px-2 pb-2">
              {rapido === etapa.id ? (
                <LeadRapido etapaId={etapa.id} onCerrar={() => setRapido(null)}
                  onCreado={async (txt) => { aviso.exito(txt); await Promise.all([cargarTablero(pipeId), cargarPipes()]); }} />
              ) : (
                <button type="button" onClick={() => setRapido(etapa.id)}
                  className="ui-foco w-full rounded-lg border border-dashed py-2.5 text-center text-[13px] text-[var(--text-secondary)] hover:border-[var(--series-1)] hover:text-[var(--series-1)]"
                  style={{ borderColor: 'var(--baseline)' }}>
                  + Lead rápido
                </button>
              )}

              {etapa.tarjetas.map((t: any) => (
                <Tarjeta key={t.oportunidad_id} t={t} etapas={etapas}
                  onAbrir={() => setLeadAbierto(t.lead_id)}
                  onChat={() => navegar(`/chat?lead=${t.lead_id}`)}
                  onMover={(etapaId) => moverA(t.oportunidad_id, etapaId)}
                  onArrastrar={(v) => setArrastrando(v ? t.oportunidad_id : null)} />
              ))}

              {etapa.tarjetas.length === 0 && (
                <div className="px-2 py-6 text-center text-[12px] text-[var(--text-muted)]">
                  {filtro ? 'Nadie coincide con la búsqueda' : 'Nadie acá todavía'}
                </div>
              )}
              {etapa.total > etapa.tarjetas.length && !filtro && (
                <div className="py-1 text-center text-[11px] text-[var(--text-muted)]">+{fmtNum(etapa.total - etapa.tarjetas.length)} más · usá el buscador</div>
              )}
            </div>
          </section>
        ))}
      </div>

      {leadAbierto && <FichaLead leadId={leadAbierto} alCerrar={() => { setLeadAbierto(null); cargarTablero(pipeId); }} />}
    </div>
  );
}

function Tarjeta({ t, etapas, onAbrir, onChat, onMover, onArrastrar }: {
  t: any; etapas: any[]; onAbrir: () => void; onChat: () => void;
  onMover: (etapaId: string) => void; onArrastrar: (v: boolean) => void;
}) {
  const etiquetas: string[] = t.etiquetas ?? [];
  const max = t.contenido_titulo ? 1 : 2;
  const resto = etiquetas.length - max;
  const quien = t.ig_username ? `@${t.ig_username}` : (t.nombre || 'Lead sin nombre');
  return (
    <article draggable onDragStart={() => onArrastrar(true)} onDragEnd={() => onArrastrar(false)}
      onClick={onAbrir} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onAbrir(); }}
      className="group ui-foco cursor-pointer rounded-lg border border-[var(--border-hairline)] px-3 py-2 transition-shadow hover:shadow-md"
      style={{ background: 'var(--surface-1)' }}>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className={`truncate ${t.propietario_nombre ? 'text-[var(--text-primary)]' : 'italic text-[var(--text-muted)]'}`}>
          {t.propietario_nombre ?? 'Sin asignar'}
        </span>
        <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{fechaCorta(t.ultima_actividad ?? t.abierta_en)}</span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-2">
        <span className="truncate text-[14px] font-medium" style={{ color: 'var(--series-1)' }} title={t.nombre && t.ig_username ? t.nombre : undefined}>
          {quien}
        </span>
        {Number(t.valor) > 0 && <span className="cifras shrink-0 text-[12px] font-semibold">{fmtDinero(t.valor)}</span>}
      </div>
      <div className="mt-1 flex min-h-[20px] items-center gap-1 overflow-hidden">
        {t.contenido_titulo && <EtiquetaChica titulo={`Vino de: ${t.contenido_titulo}`}>▶ {t.contenido_titulo}</EtiquetaChica>}
        {etiquetas.slice(0, max).map((e) => <EtiquetaChica key={e}>{e}</EtiquetaChica>)}
        {resto > 0 && <EtiquetaChica titulo={etiquetas.slice(max).join(', ')}>+{resto}</EtiquetaChica>}
        <span className="ml-auto flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {Number(t.mensajes_sin_leer) > 0 && (
            <button type="button" onClick={onChat} title={`${t.mensajes_sin_leer} mensaje(s) sin leer`} aria-label="Abrir chat: hay mensajes sin leer"
              className="flex h-6 w-6 items-center justify-center">
              <span className="h-2 w-2 rounded-full" style={{ background: 'var(--status-warning)' }} />
            </button>
          )}
          <Menu alinear="derecha" ancho={240} titulo="Mover a"
            disparador={({ alternar, ref, abierto }) => (
              <button ref={ref} type="button" onClick={alternar} aria-label="Más acciones" aria-expanded={abierto}
                className={`ui-foco flex h-6 w-6 items-center justify-center rounded text-[14px] leading-none text-[var(--text-muted)] hover:bg-[var(--page-plane)] ${abierto ? '' : 'md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100'}`}>⋯</button>
            )}>
            {etapas.map((e) => (
              <ItemMenu key={e.id} activo={e.id === t.etapa_id} onClick={() => onMover(e.id)}
                icono={<span className="h-2 w-2 rounded-full" style={{ background: e.color }} />}>{e.nombre}</ItemMenu>
            ))}
            <SeparadorMenu />
            <ItemMenu icono="💬" onClick={onChat}>Abrir chat</ItemMenu>
            <ItemMenu icono="👤" onClick={onAbrir}>Ver ficha</ItemMenu>
          </Menu>
        </span>
      </div>
    </article>
  );
}

function LeadRapido({ etapaId, onCerrar, onCreado }: { etapaId: string; onCerrar: () => void; onCreado: (txt: string) => Promise<void> }) {
  const aviso = useAviso();
  const [usuario, setUsuario] = useState('');
  const [etiqueta, setEtiqueta] = useState('');
  const [ocupado, setOcupado] = useState(false);
  async function crear(e: React.FormEvent) {
    e.preventDefault();
    const v = usuario.trim();
    if (!v) return;
    setOcupado(true);
    try {
      const esUsuario = v.startsWith('@') || !/\s/.test(v);
      const r = await api<any>('/ux/pipeline/lead-rapido', {
        method: 'POST',
        json: { etapa_id: etapaId, ...(esUsuario ? { usuario: v } : { nombre: v }), etiqueta: etiqueta.trim() || undefined },
      });
      setUsuario(''); setEtiqueta('');
      await onCreado(r.ya_existia ? `${v} ya estaba en el CRM: lo moví a esta etapa.` : `${v} cargado.`);
    } catch (err: any) {
      aviso.error(err.message);
    } finally { setOcupado(false); }
  }
  return (
    <form onSubmit={crear} onKeyDown={(e) => { if (e.key === 'Escape') onCerrar(); }}
      className="ui-aparecer space-y-1.5 rounded-lg border p-2" style={{ background: 'var(--surface-1)', borderColor: 'var(--series-1)' }}>
      <input autoFocus value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="@usuario de Instagram o nombre"
        className="ui-control h-9 w-full rounded-md px-2.5 text-[16px] md:h-8 md:text-[13px]" />
      <input value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} placeholder="Etiqueta (opcional)"
        className="ui-control h-9 w-full rounded-md px-2.5 text-[16px] md:h-8 md:text-[13px]" />
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onCerrar} className="ui-foco h-8 rounded-md px-2.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]">Cancelar</button>
        <button type="submit" disabled={!usuario.trim() || ocupado}
          className="ui-foco h-8 rounded-md px-3 text-[12px] font-medium text-white disabled:opacity-50" style={{ background: 'var(--series-1)' }}>
          {ocupado ? 'Cargando…' : 'Agregar'}
        </button>
      </div>
    </form>
  );
}
