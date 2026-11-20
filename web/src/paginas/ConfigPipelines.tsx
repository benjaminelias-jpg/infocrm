import { useEffect, useState } from 'react';
import { api } from '../api';

const TIPOS_ACCION = [
  { tipo: 'etiquetar', etiqueta: '🏷️ Poner etiqueta', campo: 'etiqueta', ph: 'interesado' },
  { tipo: 'webhook', etiqueta: '🔗 Avisar a webhook (Meta/correos/Zapier)', campo: 'url', ph: 'https://hook.make.com/…' },
  { tipo: 'nota', etiqueta: '📝 Dejar nota', campo: 'texto', ph: 'Llamar en 24h' },
];
const campoAccion = (t: string) => TIPOS_ACCION.find((a) => a.tipo === t)?.campo ?? 'etiqueta';

export default function ConfigPipelines({ onCerrar }: { onCerrar: () => void }) {
  const [pipes, setPipes] = useState<any[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [expandida, setExpandida] = useState<string | null>(null);
  const [nuevaEtapa, setNuevaEtapa] = useState('');

  async function cargar() {
    const p = await api<any[]>('/pipelines');
    setPipes(p);
    setSel((s) => s && p.some((x) => x.id === s) ? s : p[0]?.id ?? null);
  }
  useEffect(() => { cargar(); }, []);
  const pipe = pipes.find((p) => p.id === sel);

  async function crearPipe() {
    const nombre = prompt('Nombre del nuevo pipeline (ej. "Cierre high-ticket")');
    if (!nombre) return;
    const p = await api<any>('/pipelines', { method: 'POST', json: { nombre } });
    await cargar(); setSel(p.id);
  }
  async function renombrarPipe() {
    if (!pipe) return;
    const nombre = prompt('Nuevo nombre del pipeline', pipe.nombre);
    if (!nombre) return;
    await api(`/pipelines/${pipe.id}`, { method: 'PATCH', json: { nombre } }); await cargar();
  }
  async function borrarPipe() {
    if (!pipe || !confirm(`¿Borrar el pipeline "${pipe.nombre}"?`)) return;
    try { await api(`/pipelines/${pipe.id}`, { method: 'DELETE' }); await cargar(); }
    catch (e: any) { setAviso(e.message); }
  }
  async function predeterminado() {
    if (!pipe) return;
    await api(`/pipelines/${pipe.id}`, { method: 'PATCH', json: { es_predeterminado: true } }); await cargar();
  }
  async function agregarEtapa() {
    if (!pipe || !nuevaEtapa.trim()) return;
    await api(`/pipelines/${pipe.id}/etapas`, { method: 'POST', json: { nombre: nuevaEtapa } });
    setNuevaEtapa(''); await cargar();
  }
  async function renombrarEtapa(e: any) {
    const nombre = prompt('Nuevo nombre de la etapa', e.nombre);
    if (!nombre) return;
    await api(`/etapas/${e.id}`, { method: 'PATCH', json: { nombre } }); await cargar();
  }
  async function duplicar(e: any) { await api(`/etapas/${e.id}/duplicar`, { method: 'POST' }); await cargar(); }
  async function borrarEtapa(e: any) {
    if (!confirm(`¿Borrar la etapa "${e.nombre}"?`)) return;
    try { await api(`/etapas/${e.id}`, { method: 'DELETE' }); await cargar(); }
    catch (err: any) { setAviso(err.message); }
  }
  async function reordenar(e: any, dir: -1 | 1) {
    if (!pipe) return;
    const ids = pipe.etapas.map((x: any) => x.id);
    const i = ids.indexOf(e.id); const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await api(`/pipelines/${pipe.id}/reordenar`, { method: 'POST', json: { orden: ids } }); await cargar();
  }
  async function guardarAcciones(e: any, acciones: any[]) {
    await api(`/etapas/${e.id}`, { method: 'PATCH', json: { acciones } }); await cargar();
  }

  return (
    <div className="px-5 py-5 lg:px-8">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-[18px] font-semibold tracking-tight">Configurar pipelines</div>
          <div className="text-[12px] text-[var(--text-muted)]">Crea pipelines, etapas, y qué pasa automáticamente al mover un lead</div>
        </div>
        <button onClick={onCerrar} className="rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] hover:bg-[var(--page-plane)]">← Volver al tablero</button>
      </div>

      {aviso && <div className="mb-3 rounded-md px-3 py-2 text-[12px]" style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>{aviso}</div>}

      {/* Selector de pipelines */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {pipes.map((p) => (
          <button key={p.id} onClick={() => setSel(p.id)}
            className={`rounded-md px-3 py-1.5 text-[12px] ${sel === p.id ? 'font-medium text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-1)]'}`}
            style={sel === p.id ? { background: 'var(--series-1)' } : {}}>
            {p.nombre}{p.es_predeterminado ? ' ★' : ''}
          </button>
        ))}
        <button onClick={crearPipe} className="rounded-md border border-dashed border-[var(--border-hairline)] px-3 py-1.5 text-[12px] hover:bg-[var(--page-plane)]">+ Nuevo pipeline</button>
      </div>

      {pipe && (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-[12px]">
            <button onClick={renombrarPipe} className="rounded border border-[var(--border-hairline)] px-2 py-1 hover:bg-[var(--page-plane)]">Renombrar</button>
            {!pipe.es_predeterminado && <button onClick={predeterminado} className="rounded border border-[var(--border-hairline)] px-2 py-1 hover:bg-[var(--page-plane)]">Hacer predeterminado</button>}
            <button onClick={borrarPipe} className="rounded border border-[var(--border-hairline)] px-2 py-1 hover:bg-[var(--page-plane)]" style={{ color: 'var(--status-critical)' }}>Borrar pipeline</button>
          </div>

          <div className="space-y-2">
            {pipe.etapas.map((e: any, i: number) => (
              <div key={e.id} className="tarjeta p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ background: e.color }} />
                  <span className="text-[13px] font-medium">{e.nombre}</span>
                  <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--gridline)' }}>{e.tipo}</span>
                  <span className="text-[11px] text-[var(--text-muted)]">{(e.acciones ?? []).length} acciones</span>
                  <div className="flex-1" />
                  <div className="flex gap-0.5 text-[12px]">
                    <button onClick={() => reordenar(e, -1)} disabled={i === 0} className="rounded px-1.5 py-1 text-[var(--text-muted)] hover:bg-[var(--page-plane)] disabled:opacity-30">↑</button>
                    <button onClick={() => reordenar(e, 1)} disabled={i === pipe.etapas.length - 1} className="rounded px-1.5 py-1 text-[var(--text-muted)] hover:bg-[var(--page-plane)] disabled:opacity-30">↓</button>
                    <button onClick={() => setExpandida(expandida === e.id ? null : e.id)} className="rounded px-2 py-1 hover:bg-[var(--page-plane)]">⚡ Acciones</button>
                    <button onClick={() => renombrarEtapa(e)} className="rounded px-2 py-1 hover:bg-[var(--page-plane)]">✏️</button>
                    <button onClick={() => duplicar(e)} className="rounded px-2 py-1 hover:bg-[var(--page-plane)]">⧉ copiar</button>
                    <button onClick={() => borrarEtapa(e)} className="rounded px-2 py-1 hover:bg-[var(--page-plane)]" style={{ color: 'var(--status-critical)' }}>✕</button>
                  </div>
                </div>
                {expandida === e.id && <EditorAcciones etapa={e} onGuardar={(acc) => guardarAcciones(e, acc)} />}
              </div>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <input value={nuevaEtapa} onChange={(e) => setNuevaEtapa(e.target.value)} placeholder="Nombre de la nueva etapa"
              className="w-[260px] rounded-md border border-[var(--border-hairline)] bg-transparent px-2.5 py-1.5 text-[12px] outline-none" />
            <button onClick={agregarEtapa} className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white" style={{ background: 'var(--series-1)' }}>+ Añadir etapa</button>
          </div>
        </>
      )}
    </div>
  );
}

function EditorAcciones({ etapa, onGuardar }: { etapa: any; onGuardar: (acc: any[]) => void }) {
  const [acc, setAcc] = useState<any[]>(etapa.acciones ?? []);
  function add(tipo: string) { setAcc((a) => [...a, { tipo, [campoAccion(tipo)]: '' }]); }
  function set(i: number, v: string) { setAcc((a) => a.map((x, k) => k === i ? { ...x, [campoAccion(x.tipo)]: v } : x)); }
  function quitar(i: number) { setAcc((a) => a.filter((_, k) => k !== i)); }
  return (
    <div className="mt-3 rounded-md border border-[var(--border-hairline)] p-3">
      <div className="mb-2 text-[11px] text-[var(--text-muted)]">Cuando un lead entra a esta etapa, hace esto solo:</div>
      <div className="space-y-1.5">
        {acc.map((a, i) => {
          const meta = TIPOS_ACCION.find((t) => t.tipo === a.tipo);
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="w-[200px] shrink-0 text-[12px]">{meta?.etiqueta ?? a.tipo}</span>
              <input value={a[campoAccion(a.tipo)] ?? ''} onChange={(e) => set(i, e.target.value)} placeholder={meta?.ph}
                className="min-w-0 flex-1 rounded-md border border-[var(--border-hairline)] bg-transparent px-2 py-1 text-[12px] outline-none" />
              <button onClick={() => quitar(i)} className="rounded px-1.5 py-1 text-[11px] hover:bg-[var(--page-plane)]" style={{ color: 'var(--status-critical)' }}>✕</button>
            </div>
          );
        })}
        {acc.length === 0 && <div className="text-[11px] text-[var(--text-muted)]">Sin acciones todavía.</div>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {TIPOS_ACCION.map((t) => (
          <button key={t.tipo} onClick={() => add(t.tipo)} className="rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]">+ {t.etiqueta}</button>
        ))}
        <div className="flex-1" />
        <button onClick={() => onGuardar(acc)} className="rounded-md px-3 py-1 text-[12px] font-medium text-white" style={{ background: 'var(--series-1)' }}>Guardar acciones</button>
      </div>
    </div>
  );
}
