import { useEffect, useState } from 'react';
import { api, fmtNum, hace } from '../api';

// Configuración del Pipeline: pipelines, etapas, qué pasa SOLO al mover un
// lead de etapa, y las reglas automáticas ("cuando pasa X, hacé Y").

const TIPOS_ACCION: Array<{ tipo: string; etiqueta: string; ayuda?: string }> = [
  { tipo: 'etiquetar', etiqueta: '🏷️ Poner etiqueta' },
  { tipo: 'quitar_etiqueta', etiqueta: '🏷️ Quitar etiqueta' },
  { tipo: 'dm', etiqueta: '💬 Mandarle un DM por Instagram', ayuda: 'Sale por la API de Meta' },
  { tipo: 'recurso', etiqueta: '🎙️ Mandarle un audio o recurso' },
  { tipo: 'flujo', etiqueta: '⚡ Arrancar un automensaje' },
  { tipo: 'email', etiqueta: '📧 Sumarlo a una secuencia de email', ayuda: 'ActiveCampaign, Mailchimp, Brevo… o vía Zapier/Make' },
  { tipo: 'asignar', etiqueta: '👤 Asignarlo al equipo' },
  { tipo: 'nota', etiqueta: '📝 Dejar una nota' },
  { tipo: 'webhook', etiqueta: '🔗 Avisar a otra app (webhook)' },
];

const EVENTOS: Array<[string, string]> = [
  ['lead_creado', 'entra un lead nuevo'],
  ['recurso_entregado', 'recibe el recurso'],
  ['respondio_dm', 'responde por DM'],
  ['reunion_agendada', 'agenda una llamada'],
  ['reunion_realizada', 'hace la llamada'],
  ['reunion_no_asistio', 'no se presenta a la llamada'],
  ['venta', 'compra'],
  ['reembolso', 'pide reembolso'],
];

const ACCIONES_REGLA: Array<{ tipo: string; etiqueta: string; campo?: string; ph?: string }> = [
  { tipo: 'etiquetar', etiqueta: 'ponerle la etiqueta', campo: 'etiqueta', ph: 'ej. caliente' },
  { tipo: 'quitar_etiqueta', etiqueta: 'quitarle la etiqueta', campo: 'etiqueta', ph: 'ej. frío' },
  { tipo: 'mover_etapa', etiqueta: 'moverlo a la etapa', campo: 'etapa_slug' },
  { tipo: 'asignar', etiqueta: 'asignarlo al closer con menos carga' },
  { tipo: 'crear_nota', etiqueta: 'dejar una nota', campo: 'texto', ph: 'ej. Llamar hoy' },
  { tipo: 'webhook_saliente', etiqueta: 'avisar a otra app (webhook)', campo: 'url', ph: 'https://…' },
  { tipo: 'marcar_perdido', etiqueta: 'marcarlo como perdido', campo: 'motivo', ph: 'motivo' },
];

function describirAccionRegla(a: any) {
  const meta = ACCIONES_REGLA.find((x) => x.tipo === a.tipo);
  const valor = meta?.campo ? a[meta.campo] : '';
  return `${meta?.etiqueta ?? a.tipo}${valor ? ` «${valor}»` : ''}`;
}

const inp = 'rounded-md border border-[var(--border-hairline)] bg-transparent px-2 py-1 text-[12px] outline-none';
const sel = 'rounded-md border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1 text-[12px] outline-none';

export default function ConfigPipelines({ onCerrar, foco }: { onCerrar: () => void; foco?: 'reglas' }) {
  const [pipes, setPipes] = useState<any[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [expandida, setExpandida] = useState<string | null>(null);
  const [nuevaEtapa, setNuevaEtapa] = useState('');
  const [recursos, setRecursos] = useState<any[]>([]);
  const [flujos, setFlujos] = useState<any[]>([]);
  const [editandoNombre, setEditandoNombre] = useState<string | null>(null);

  async function cargar() {
    const p = await api<any[]>('/pipelines');
    setPipes(p);
    setSelId((s) => (s && p.some((x) => x.id === s) ? s : p[0]?.id ?? null));
  }
  useEffect(() => {
    cargar();
    api<any[]>('/recursos').then(setRecursos).catch(() => {});
    api<any[]>('/flujos').then(setFlujos).catch(() => {});
    if (foco === 'reglas') setTimeout(() => document.getElementById('reglas')?.scrollIntoView({ behavior: 'smooth' }), 300);
  }, [foco]);
  const pipe = pipes.find((p) => p.id === selId);

  async function accion(f: () => Promise<any>, ok?: string) {
    try { await f(); await cargar(); if (ok) setAviso(ok); } catch (e: any) { setAviso(e.message); }
  }
  async function crearPipe() {
    const nombre = window.prompt('Nombre del nuevo pipeline (ej. "Cierre high-ticket")');
    if (!nombre?.trim()) return;
    const p = await api<any>('/pipelines', { method: 'POST', json: { nombre: nombre.trim() } });
    await cargar(); setSelId(p.id);
    setAviso(`Pipeline «${nombre}» creado con 5 etapas básicas. Cambiales el nombre o agregá las tuyas.`);
  }
  const renombrarPipe = (nombre: string) => pipe && nombre.trim() && nombre !== pipe.nombre
    && accion(() => api(`/pipelines/${pipe.id}`, { method: 'PATCH', json: { nombre: nombre.trim() } }));
  const agregarEtapa = () => pipe && nuevaEtapa.trim()
    && accion(async () => { await api(`/pipelines/${pipe.id}/etapas`, { method: 'POST', json: { nombre: nuevaEtapa.trim() } }); setNuevaEtapa(''); });
  const renombrarEtapa = (e: any, nombre: string) => {
    setEditandoNombre(null);
    if (nombre.trim() && nombre !== e.nombre) accion(() => api(`/etapas/${e.id}`, { method: 'PATCH', json: { nombre: nombre.trim() } }));
  };
  async function reordenar(e: any, dir: -1 | 1) {
    if (!pipe) return;
    const ids = pipe.etapas.map((x: any) => x.id);
    const i = ids.indexOf(e.id); const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await accion(() => api(`/pipelines/${pipe.id}/reordenar`, { method: 'POST', json: { orden: ids } }));
  }

  return (
    <div className="px-4 py-5 lg:px-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[18px] font-semibold tracking-tight">Configurar el pipeline</div>
          <div className="text-[12px] text-[var(--text-muted)]">Tus etapas, qué pasa solo cuando movés un lead, y las reglas automáticas</div>
        </div>
        <button onClick={onCerrar} className="rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] hover:bg-[var(--page-plane)]">← Volver al tablero</button>
      </div>

      {aviso && (
        <div className="mb-3 rounded-md px-3 py-2 text-[12px]" style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>
          {aviso} <button onClick={() => setAviso(null)} className="ml-1 underline">ok</button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {pipes.map((p) => (
          <button key={p.id} onClick={() => setSelId(p.id)}
            className={`rounded-md px-3 py-1.5 text-[12px] ${selId === p.id ? 'font-medium text-white' : 'border border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--surface-1)]'}`}
            style={selId === p.id ? { background: 'var(--series-1)' } : {}}>
            {p.nombre}{p.es_predeterminado ? ' ★' : ''}
          </button>
        ))}
        <button onClick={crearPipe} className="rounded-md border border-dashed border-[var(--border-hairline)] px-3 py-1.5 text-[12px] hover:bg-[var(--page-plane)]">+ Nuevo pipeline</button>
      </div>

      {pipe && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
            <input defaultValue={pipe.nombre} key={pipe.id} onBlur={(e) => renombrarPipe(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              className={`${inp} w-[220px] font-medium`} title="Nombre del pipeline (editalo y salí del campo)" />
            {!pipe.es_predeterminado && (
              <button onClick={() => accion(() => api(`/pipelines/${pipe.id}`, { method: 'PATCH', json: { es_predeterminado: true } }), 'Ahora los leads nuevos entran a este pipeline.')}
                className="rounded border border-[var(--border-hairline)] px-2 py-1 hover:bg-[var(--page-plane)]">★ Que los leads nuevos entren acá</button>
            )}
            {pipes.length > 1 && <Borrar texto="Borrar pipeline" onBorrar={() => accion(() => api(`/pipelines/${pipe.id}`, { method: 'DELETE' }))} />}
          </div>

          <div className="space-y-2">
            {pipe.etapas.map((e: any, i: number) => (
              <div key={e.id} className="tarjeta p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ background: e.color }} />
                  {editandoNombre === e.id ? (
                    <input autoFocus defaultValue={e.nombre} onBlur={(ev) => renombrarEtapa(e, ev.target.value)}
                      onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); if (ev.key === 'Escape') setEditandoNombre(null); }}
                      className={`${inp} w-[200px]`} />
                  ) : (
                    <button onClick={() => setEditandoNombre(e.id)} title="Cambiar nombre" className="text-[13px] font-medium">{e.nombre}</button>
                  )}
                  {e.tipo !== 'abierta' && (
                    <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--gridline)' }}>{e.tipo === 'ganada' ? 'venta' : 'perdido'}</span>
                  )}
                  <button onClick={() => setExpandida(expandida === e.id ? null : e.id)}
                    className="rounded-full px-2 py-0.5 text-[11px]"
                    style={(e.acciones ?? []).length ? { background: 'var(--series-1)', color: 'white' } : { border: '1px solid var(--border-hairline)' }}>
                    ⚡ {(e.acciones ?? []).length ? `${e.acciones.length} automática${e.acciones.length === 1 ? '' : 's'}` : 'Agregar automatización'}
                  </button>
                  <div className="flex-1" />
                  <div className="flex gap-0.5 text-[12px]">
                    <button onClick={() => reordenar(e, -1)} disabled={i === 0} className="rounded px-1.5 py-1 text-[var(--text-muted)] hover:bg-[var(--page-plane)] disabled:opacity-30" aria-label="Subir">↑</button>
                    <button onClick={() => reordenar(e, 1)} disabled={i === pipe.etapas.length - 1} className="rounded px-1.5 py-1 text-[var(--text-muted)] hover:bg-[var(--page-plane)] disabled:opacity-30" aria-label="Bajar">↓</button>
                    <button onClick={() => accion(() => api(`/etapas/${e.id}/duplicar`, { method: 'POST' }))} className="rounded px-2 py-1 hover:bg-[var(--page-plane)]">⧉ Duplicar</button>
                    <Borrar chico onBorrar={() => accion(() => api(`/etapas/${e.id}`, { method: 'DELETE' }), `Etapa «${e.nombre}» borrada. Sus leads pasaron a otra etapa.`)} />
                  </div>
                </div>
                {expandida === e.id && (
                  <EditorAcciones etapa={e} recursos={recursos} flujos={flujos}
                    onGuardar={(acc) => accion(() => api(`/etapas/${e.id}`, { method: 'PATCH', json: { acciones: acc } }), `Listo: cada lead que entre a «${e.nombre}» va a disparar ${acc.length} acción${acc.length === 1 ? '' : 'es'}.`)} />
                )}
              </div>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <input value={nuevaEtapa} onChange={(e) => setNuevaEtapa(e.target.value)} placeholder="Nombre de la nueva etapa"
              onKeyDown={(e) => { if (e.key === 'Enter') agregarEtapa(); }}
              className={`${inp} w-[260px] py-1.5`} />
            <button onClick={agregarEtapa} className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white" style={{ background: 'var(--series-1)' }}>+ Agregar etapa</button>
          </div>
        </>
      )}

      <ReglasSimples etapas={pipe?.etapas ?? []} />
    </div>
  );
}

function Borrar({ onBorrar, texto, chico }: { onBorrar: () => void; texto?: string; chico?: boolean }) {
  const [seguro, setSeguro] = useState(false);
  return seguro ? (
    <button autoFocus onBlur={() => setSeguro(false)} onClick={onBorrar}
      className="rounded px-2 py-1 text-[11px] font-medium text-white" style={{ background: 'var(--status-critical)' }}>¿Seguro? Borrar</button>
  ) : (
    <button onClick={() => setSeguro(true)} className={`rounded ${chico ? '' : 'border border-[var(--border-hairline)]'} px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]`}
      style={{ color: 'var(--status-critical)' }}>{texto ?? '✕'}</button>
  );
}

function EditorAcciones({ etapa, recursos, flujos, onGuardar }: { etapa: any; recursos: any[]; flujos: any[]; onGuardar: (acc: any[]) => void }) {
  const [acc, setAcc] = useState<any[]>(etapa.acciones ?? []);
  const [menu, setMenu] = useState(false);
  const set = (i: number, k: string, v: string) => setAcc((a) => a.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const quitar = (i: number) => setAcc((a) => a.filter((_, j) => j !== i));

  function campos(a: any, i: number) {
    switch (a.tipo) {
      case 'etiquetar':
      case 'quitar_etiqueta':
        return <input value={a.etiqueta ?? ''} onChange={(e) => set(i, 'etiqueta', e.target.value)} placeholder="ej. llamada-agendada" className={`${inp} min-w-0 flex-1`} />;
      case 'dm':
        return <input value={a.texto ?? ''} onChange={(e) => set(i, 'texto', e.target.value)} placeholder="¡Hola {{nombre}}! Te confirmo la llamada 🙌" className={`${inp} min-w-0 flex-1`} />;
      case 'nota':
        return <input value={a.texto ?? ''} onChange={(e) => set(i, 'texto', e.target.value)} placeholder="Llamar a {{nombre}} en 24 h" className={`${inp} min-w-0 flex-1`} />;
      case 'webhook':
        return <input value={a.url ?? ''} onChange={(e) => set(i, 'url', e.target.value)} placeholder="https://hook.make.com/…" className={`${inp} min-w-0 flex-1`} />;
      case 'recurso':
        return (
          <select value={a.recurso_id ?? ''} onChange={(e) => set(i, 'recurso_id', e.target.value)} className={`${sel} min-w-0 flex-1`}>
            <option value="">Elegí el audio o recurso…</option>
            {recursos.filter((r) => r.tipo !== 'texto').map((r) => <option key={r.id} value={r.id}>{r.tipo === 'audio' ? '🎙️' : '📎'} {r.nombre}</option>)}
          </select>
        );
      case 'flujo':
        return (
          <select value={a.flujo_id ?? ''} onChange={(e) => set(i, 'flujo_id', e.target.value)} className={`${sel} min-w-0 flex-1`}>
            <option value="">Elegí el automensaje…</option>
            {flujos.map((f) => <option key={f.id} value={f.id}>{f.nombre}{f.activo ? '' : ' (en pausa)'}</option>)}
          </select>
        );
      case 'email':
        return (
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            <input value={a.secuencia ?? ''} onChange={(e) => set(i, 'secuencia', e.target.value)} placeholder="Nombre de la secuencia" className={`${inp} w-[160px]`} />
            <input value={a.url ?? ''} onChange={(e) => set(i, 'url', e.target.value)} placeholder="URL del webhook de tu proveedor" className={`${inp} min-w-0 flex-1`} />
          </div>
        );
      case 'asignar':
        return (
          <select value={a.rol ?? ''} onChange={(e) => set(i, 'rol', e.target.value)} className={`${sel} min-w-0 flex-1`}>
            <option value="">A quien tenga menos leads</option>
            <option value="setter">A un setter</option>
            <option value="closer">A un closer</option>
          </select>
        );
      default:
        return <span className="text-[11px] text-[var(--text-muted)]">{a.tipo}</span>;
    }
  }

  return (
    <div className="mt-3 rounded-md border border-[var(--border-hairline)] p-3">
      <div className="mb-2 text-[12px] text-[var(--text-secondary)]">Cuando un lead entra a <b>{etapa.nombre}</b>, hacé esto solo:</div>
      <div className="space-y-1.5">
        {acc.map((a, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span className="w-full shrink-0 text-[12px] sm:w-[230px]">{TIPOS_ACCION.find((t) => t.tipo === a.tipo)?.etiqueta ?? a.tipo}</span>
            {campos(a, i)}
            <button onClick={() => quitar(i)} className="rounded px-1.5 py-1 text-[11px] hover:bg-[var(--page-plane)]" style={{ color: 'var(--status-critical)' }} aria-label="Quitar">✕</button>
          </div>
        ))}
        {acc.length === 0 && <div className="text-[11px] text-[var(--text-muted)]">Todavía nada. Por ejemplo: al pasar a «Llamada agendada», mandarle el audio del founder y avisar al closer.</div>}
      </div>
      <div className="relative mt-2 flex flex-wrap items-center gap-1.5">
        <button onClick={() => setMenu((v) => !v)} className="rounded border border-dashed border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]">+ Agregar acción</button>
        {menu && (
          <div className="absolute left-0 top-8 z-20 w-[300px] rounded-lg border p-1 shadow-lg" style={{ background: 'var(--surface-1)', borderColor: 'var(--border-hairline)' }}>
            {TIPOS_ACCION.map((t) => (
              <button key={t.tipo} onClick={() => { setAcc((a) => [...a, { tipo: t.tipo }]); setMenu(false); }}
                className="block w-full rounded px-2 py-1 text-left text-[12px] hover:bg-[var(--page-plane)]">
                {t.etiqueta}{t.ayuda && <span className="block text-[10px] text-[var(--text-muted)]">{t.ayuda}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1" />
        <button onClick={() => onGuardar(acc)} className="rounded-md px-3 py-1 text-[12px] font-medium text-white" style={{ background: 'var(--series-1)' }}>Guardar</button>
      </div>
    </div>
  );
}

function ReglasSimples({ etapas }: { etapas: any[] }) {
  const [reglas, setReglas] = useState<any[]>([]);
  const [evento, setEvento] = useState('venta');
  const [tipo, setTipo] = useState('etiquetar');
  const [valor, setValor] = useState('');
  const [error, setError] = useState<string | null>(null);

  const cargar = () => api<any[]>('/reglas').then(setReglas).catch(() => {});
  useEffect(() => { cargar(); }, []);

  const meta = ACCIONES_REGLA.find((a) => a.tipo === tipo)!;
  async function crear() {
    if (meta.campo && !valor.trim()) { setError('Completá el valor de la acción.'); return; }
    setError(null);
    const ev = EVENTOS.find(([v]) => v === evento)?.[1] ?? evento;
    const accionNueva: any = { tipo, ...(meta.campo ? { [meta.campo]: valor.trim() } : {}) };
    await api('/reglas', {
      method: 'POST',
      json: { nombre: `Cuando ${ev}: ${describirAccionRegla(accionNueva)}`, disparador: { evento }, acciones: [accionNueva] },
    });
    setValor('');
    cargar();
  }

  return (
    <section id="reglas" className="mt-8">
      <h2 className="text-[15px] font-semibold">Reglas automáticas</h2>
      <p className="mb-3 text-[12px] text-[var(--text-muted)]">
        Pasan solas cuando el lead hace algo (agenda, compra, pide reembolso…), esté en la etapa que esté.
        Las etapas ya se mueven solas con cada evento: esto es para todo lo demás.
      </p>

      <div className="tarjeta mb-3 flex flex-wrap items-center gap-2 p-3 text-[12px]">
        <span>Cuando el lead</span>
        <select value={evento} onChange={(e) => setEvento(e.target.value)} className={sel}>
          {EVENTOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
        <span>→</span>
        <select value={tipo} onChange={(e) => { setTipo(e.target.value); setValor(''); }} className={sel}>
          {ACCIONES_REGLA.map((a) => <option key={a.tipo} value={a.tipo}>{a.etiqueta}</option>)}
        </select>
        {meta.campo === 'etapa_slug' ? (
          <select value={valor} onChange={(e) => setValor(e.target.value)} className={sel}>
            <option value="">Elegí la etapa…</option>
            {etapas.map((e) => <option key={e.id} value={e.slug}>{e.nombre}</option>)}
          </select>
        ) : meta.campo ? (
          <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder={meta.ph} className={`${inp} w-[180px]`} />
        ) : null}
        <button onClick={crear} className="rounded-md px-3 py-1 font-medium text-white" style={{ background: 'var(--series-1)' }}>+ Crear regla</button>
        {error && <span className="w-full text-[11px]" style={{ color: 'var(--status-critical)' }}>{error}</span>}
      </div>

      <div className="space-y-1.5">
        {reglas.length === 0 && <div className="text-[12px] text-[var(--text-muted)]">Todavía no hay reglas.</div>}
        {reglas.map((r) => {
          const ev = EVENTOS.find(([v]) => v === r.disparador?.evento)?.[1] ?? r.disparador?.evento;
          return (
            <div key={r.id} className="tarjeta flex flex-wrap items-center gap-2 p-3">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: r.activo ? 'var(--status-good)' : 'var(--baseline)' }} />
              <div className="min-w-0 flex-1 text-[12px]">
                <span className="text-[var(--text-muted)]">Cuando el lead </span><b>{ev}</b>
                <span className="text-[var(--text-muted)]"> → </span>{(r.acciones ?? []).map(describirAccionRegla).join(', y ')}
                <div className="text-[10px] text-[var(--text-muted)]">
                  {fmtNum(r.ejecuciones_ok)} veces{Number(r.ejecuciones_error) > 0 ? ` · ${fmtNum(r.ejecuciones_error)} con error` : ''}
                  {r.ultima_ejecucion_en ? ` · última ${hace(r.ultima_ejecucion_en)}` : ''}
                </div>
              </div>
              <button onClick={async () => { await api(`/reglas/${r.id}`, { method: 'PATCH', json: { activo: !r.activo } }); cargar(); }}
                className="rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]">{r.activo ? 'Pausar' : 'Activar'}</button>
              <Borrar chico onBorrar={async () => { await api(`/reglas/${r.id}`, { method: 'DELETE' }); cargar(); }} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
