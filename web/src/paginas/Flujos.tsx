import { useEffect, useState } from 'react';
import { api, fmtNum } from '../api';
import { Cargando } from '../componentes/Graficas';
import Cabecera from '../componentes/Cabecera';

// Catálogo de nodos que entiende el motor (server/src/modules/instagram_dm.ts)
const NODOS: Record<string, { etiqueta: string; icono: string; campo?: string; placeholder?: string; color: string }> = {
  enviar_dm: { etiqueta: 'Enviar mensaje', icono: '💬', campo: 'texto', placeholder: 'Hola 👋 ¡gracias por escribir!', color: 'var(--series-1)' },
  enviar_recurso: { etiqueta: 'Enviar audio / recurso', icono: '🎙️', campo: 'recurso_id', color: '#9b5de5' },
  entregar_recurso: { etiqueta: 'Entregar enlace (texto)', icono: '📎', campo: 'recurso', placeholder: 'Aquí tienes: https://…', color: 'var(--series-1)' },
  etiquetar: { etiqueta: 'Etiquetar lead', icono: '🏷️', campo: 'etiqueta', placeholder: 'pidió-guía', color: '#f4a261' },
  mover_etapa: { etiqueta: 'Mover de etapa', icono: '➡️', campo: 'etapa_slug', placeholder: 'conversacion', color: '#2a9d8f' },
  esperar: { etiqueta: 'Esperar', icono: '⏳', campo: 'minutos', placeholder: '120', color: '#8d99ae' },
};
const ORDEN_NODOS = ['enviar_dm', 'enviar_recurso', 'entregar_recurso', 'etiquetar', 'mover_etapa', 'esperar'];

const DISPAROS = [
  { v: 'comentario', t: 'Comenta en un reel/post', icono: '💭' },
  { v: 'dm', t: 'Me escribe por DM', icono: '✉️' },
  { v: 'historia', t: 'Responde a una historia', icono: '⭕' },
  { v: 'mencion', t: 'Me menciona', icono: '@' },
];

const PLANTILLAS = [
  { nombre: 'Recurso por comentario', disparo: 'comentario', palabra_clave: 'GUIA',
    pasos: [{ tipo: 'entregar_recurso', recurso: '¡Aquí tienes la guía! 👇 https://…' }, { tipo: 'etiquetar', etiqueta: 'pidió-guía' }, { tipo: 'mover_etapa', etapa_slug: 'conversacion' }] },
  { nombre: 'Audio del founder + agendar', disparo: 'comentario', palabra_clave: 'QUIERO',
    pasos: [{ tipo: 'enviar_recurso', recurso_id: '' }, { tipo: 'enviar_dm', texto: '¿Te viene bien una llamada corta para contarte cómo funciona?' }, { tipo: 'mover_etapa', etapa_slug: 'conversacion' }] },
  { nombre: 'Clase gratis', disparo: 'comentario', palabra_clave: 'CLASE',
    pasos: [{ tipo: 'enviar_dm', texto: '¡Gracias! Te dejo el acceso a la clase 🎥' }, { tipo: 'entregar_recurso', recurso: 'https://…' }, { tipo: 'etiquetar', etiqueta: 'vio-clase' }] },
];

const FLUJO_VACIO = { nombre: '', disparo: 'comentario', palabra_clave: '', contenido_id: '', pasos: [] as any[], activo: true };
const campoDe = (tipo: string) => NODOS[tipo]?.campo ?? 'texto';

export default function Flujos() {
  const [flujos, setFlujos] = useState<any[]>([]);
  const [recursos, setRecursos] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);
  const [form, setForm] = useState<any>({ ...FLUJO_VACIO });
  const [editando, setEditando] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [simulacion, setSimulacion] = useState<any>(null);
  const [menuAbierto, setMenuAbierto] = useState<number | null>(null);

  async function cargar() {
    const [f, rec] = await Promise.all([
      api<any[]>('/flujos'),
      api<any[]>('/recursos').catch(() => []),
    ]);
    setFlujos(f); setRecursos(rec); setCargando(false);
  }
  useEffect(() => { cargar(); }, []);

  function insertarPaso(pos: number, tipo: string) {
    setForm((f: any) => {
      const pasos = [...f.pasos];
      pasos.splice(pos, 0, { tipo, [campoDe(tipo)]: '' });
      return { ...f, pasos };
    });
    setMenuAbierto(null);
  }
  function setCampo(i: number, valor: string) {
    setForm((f: any) => {
      const pasos = [...f.pasos];
      pasos[i] = { ...pasos[i], [campoDe(pasos[i].tipo)]: valor };
      return { ...f, pasos };
    });
  }
  function quitar(i: number) { setForm((f: any) => ({ ...f, pasos: f.pasos.filter((_: any, k: number) => k !== i) })); }
  function mover(i: number, d: -1 | 1) {
    setForm((f: any) => {
      const pasos = [...f.pasos]; const j = i + d;
      if (j < 0 || j >= pasos.length) return f;
      [pasos[i], pasos[j]] = [pasos[j], pasos[i]];
      return { ...f, pasos };
    });
  }

  function nuevoFlujo(plantilla?: any) {
    setEditando(null); setNuevo(true); setSimulacion(null);
    setForm(plantilla ? { ...FLUJO_VACIO, ...plantilla, pasos: plantilla.pasos.map((p: any) => ({ ...p })) } : { ...FLUJO_VACIO });
  }
  function editar(fl: any) {
    setEditando(fl.id); setNuevo(true); setSimulacion(null);
    setForm({ nombre: fl.nombre, disparo: fl.disparo, palabra_clave: fl.palabra_clave ?? '', contenido_id: fl.contenido_id ?? '', pasos: (fl.pasos ?? []).map((p: any) => ({ ...p })), activo: fl.activo });
  }
  function cerrar() { setNuevo(false); setEditando(null); setForm({ ...FLUJO_VACIO }); setSimulacion(null); }

  async function guardar() {
    if (!form.nombre.trim()) { setAviso('Ponle un nombre al flujo.'); return; }
    const cuerpo = { ...form, palabra_clave: form.palabra_clave.trim() || null, contenido_id: form.contenido_id || null };
    try {
      if (editando) await api(`/flujos/${editando}`, { method: 'PATCH', json: cuerpo });
      else await api('/flujos', { method: 'POST', json: cuerpo });
      setAviso(editando ? 'Flujo guardado.' : 'Flujo creado.');
      cerrar(); await cargar();
    } catch (err: any) { setAviso(err.message); }
  }
  async function simular() {
    if (!editando) { setAviso('Guarda el flujo antes de probarlo.'); return; }
    try { setSimulacion(await api(`/flujos/${editando}/simular`, { method: 'POST' })); }
    catch (err: any) { setAviso(err.message); }
  }
  async function toggle(fl: any) { await api(`/flujos/${fl.id}`, { method: 'PATCH', json: { activo: !fl.activo } }); await cargar(); }
  async function borrar(id: string) { await api(`/flujos/${id}`, { method: 'DELETE' }); if (editando === id) cerrar(); await cargar(); }

  if (cargando) return <Cargando />;
  const disp = DISPAROS.find((d) => d.v === form.disparo);

  // ---- Lienzo (pizarra) ----
  function Conector({ pos }: { pos: number }) {
    return (
      <div className="relative flex h-7 items-center justify-center">
        <div className="absolute h-full w-px" style={{ background: 'var(--border-hairline)' }} />
        <button onClick={() => setMenuAbierto(menuAbierto === pos ? null : pos)}
          className="relative z-10 flex h-5 w-5 items-center justify-center rounded-full border text-[12px] leading-none"
          style={{ background: 'var(--surface-1)', borderColor: 'var(--border-hairline)' }} title="Añadir paso">+</button>
        {menuAbierto === pos && (
          <div className="absolute top-6 z-20 w-56 rounded-lg border p-1 shadow-lg"
            style={{ background: 'var(--surface-1)', borderColor: 'var(--border-hairline)' }}>
            {ORDEN_NODOS.map((t) => (
              <button key={t} onClick={() => insertarPaso(pos, t)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] hover:bg-[var(--page-plane)]">
                <span>{NODOS[t].icono}</span>{NODOS[t].etiqueta}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="px-5 py-5 lg:px-8">
      <Cabecera titulo="Automensajes (Flujos)" subtitulo="Tu ManyChat propio: alguien comenta una palabra y el CRM responde solo" />

      {aviso && <div className="mt-3 rounded-md px-3 py-2 text-[12px]" style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>{aviso}</div>}

      {!nuevo ? (
        <>
          {/* Plantillas + nuevo */}
          <section className="mt-5">
            <h2 className="mb-2 text-[13px] font-semibold">Empezar rápido con una plantilla</h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {PLANTILLAS.map((p) => (
                <button key={p.nombre} onClick={() => nuevoFlujo(p)}
                  className="tarjeta p-3 text-left hover:border-[var(--series-1)]">
                  <div className="text-[13px] font-medium">{p.nombre}</div>
                  <div className="mt-1 text-[11px] text-[var(--text-muted)]">palabra «{p.palabra_clave}» · {p.pasos.length} pasos</div>
                </button>
              ))}
              <button onClick={() => nuevoFlujo()} className="tarjeta flex items-center justify-center p-3 text-[13px] font-medium hover:border-[var(--series-1)]" style={{ color: 'var(--series-1)' }}>
                + Crear desde cero
              </button>
            </div>
          </section>

          {/* Lista de flujos */}
          <section className="mt-6">
            <h2 className="mb-2 text-[13px] font-semibold">Tus flujos</h2>
            {flujos.length === 0 ? (
              <div className="tarjeta p-6 text-center text-[13px] text-[var(--text-muted)]">Aún no tienes flujos. Elegí una plantilla arriba.</div>
            ) : (
              <div className="space-y-2">
                {flujos.map((fl) => (
                  <div key={fl.id} className="tarjeta flex flex-wrap items-center justify-between gap-2 p-3.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[13px] font-medium">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ background: fl.activo ? 'var(--status-good)' : 'var(--baseline)' }} />
                        {fl.nombre}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                        {DISPAROS.find((d) => d.v === fl.disparo)?.t ?? fl.disparo}
                        {fl.palabra_clave && <> · «{fl.palabra_clave}»</>} · {(fl.pasos ?? []).length} pasos · {fmtNum(fl.ejecuciones)} ejecuciones
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button onClick={() => editar(fl)} className="rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]">Abrir pizarra</button>
                      <button onClick={() => toggle(fl)} className="rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]">{fl.activo ? 'Pausar' : 'Activar'}</button>
                      <button onClick={() => borrar(fl.id)} className="rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]" style={{ color: 'var(--status-critical)' }}>Borrar</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        /* ---- PIZARRA ---- */
        <section className="mt-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input value={form.nombre} onChange={(e) => setForm((f: any) => ({ ...f, nombre: e.target.value }))}
              placeholder="Nombre del flujo" className="w-[280px] rounded-md border border-[var(--border-hairline)] bg-transparent px-2.5 py-1.5 text-[13px] font-medium outline-none" />
            <div className="flex-1" />
            <button onClick={cerrar} className="rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] hover:bg-[var(--page-plane)]">← Volver</button>
            {editando && <button onClick={simular} className="rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] hover:bg-[var(--page-plane)]">▷ Probar</button>}
            <button onClick={guardar} className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white" style={{ background: 'var(--series-1)' }}>Guardar</button>
          </div>

          <div className="mx-auto flex max-w-[460px] flex-col items-stretch">
            {/* Nodo disparador */}
            <div className="tarjeta p-3" style={{ borderColor: 'var(--status-good)' }}>
              <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--status-good)' }}>Cuando… (disparador)</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <select value={form.disparo} onChange={(e) => setForm((f: any) => ({ ...f, disparo: e.target.value }))}
                  className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1 text-[12px] outline-none">
                  {DISPAROS.map((d) => <option key={d.v} value={d.v}>{d.icono} {d.t}</option>)}
                </select>
                <input value={form.palabra_clave} onChange={(e) => setForm((f: any) => ({ ...f, palabra_clave: e.target.value }))}
                  placeholder="palabra clave (ej. GUIA)" className="min-w-0 flex-1 rounded-md border border-[var(--border-hairline)] bg-transparent px-2 py-1 text-[12px] outline-none" />
              </div>
              <div className="mt-1 text-[11px] text-[var(--text-muted)]">{disp?.t} y escribe «{form.palabra_clave || '…'}»</div>
            </div>

            {/* Pasos conectados */}
            {form.pasos.map((p: any, i: number) => {
              const n = NODOS[p.tipo] ?? { etiqueta: p.tipo, icono: '•', campo: 'texto', color: 'var(--baseline)' };
              return (
                <div key={i}>
                  <Conector pos={i} />
                  <div className="tarjeta p-3" style={{ borderLeft: `3px solid ${n.color}` }}>
                    <div className="flex items-center justify-between">
                      <div className="text-[12px] font-medium">{n.icono} {n.etiqueta}</div>
                      <div className="flex gap-0.5">
                        <button onClick={() => mover(i, -1)} disabled={i === 0} className="rounded px-1.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--page-plane)] disabled:opacity-30">↑</button>
                        <button onClick={() => mover(i, 1)} disabled={i === form.pasos.length - 1} className="rounded px-1.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--page-plane)] disabled:opacity-30">↓</button>
                        <button onClick={() => quitar(i)} className="rounded px-1.5 text-[11px] hover:bg-[var(--page-plane)]" style={{ color: 'var(--status-critical)' }}>✕</button>
                      </div>
                    </div>
                    {p.tipo === 'enviar_recurso' ? (
                      <select value={p.recurso_id ?? ''} onChange={(e) => setCampo(i, e.target.value)}
                        className="mt-2 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1 text-[12px] outline-none">
                        <option value="">Elegí un audio/recurso…</option>
                        {recursos.map((rc) => <option key={rc.id} value={rc.id}>{rc.tipo === 'audio' ? '🎙️ ' : '📎 '}{rc.nombre}</option>)}
                      </select>
                    ) : (
                      <input value={p[n.campo!] ?? ''} onChange={(e) => setCampo(i, e.target.value)} placeholder={n.placeholder}
                        type={p.tipo === 'esperar' ? 'number' : 'text'}
                        className="mt-2 w-full rounded-md border border-[var(--border-hairline)] bg-transparent px-2 py-1 text-[12px] outline-none" />
                    )}
                  </div>
                </div>
              );
            })}

            <Conector pos={form.pasos.length} />
            <button onClick={() => setMenuAbierto(menuAbierto === form.pasos.length ? null : form.pasos.length)}
              className="tarjeta border-dashed p-3 text-center text-[12px] text-[var(--text-muted)] hover:border-[var(--series-1)] hover:text-[var(--series-1)]">
              + Añadir paso
            </button>

            <label className="mt-3 flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
              <input type="checkbox" checked={form.activo} onChange={(e) => setForm((f: any) => ({ ...f, activo: e.target.checked }))} /> Flujo activo
            </label>

            {simulacion && (
              <div className="tarjeta mt-3 p-3">
                <div className="mb-1 text-[12px] font-medium">Prueba · {simulacion.estado}</div>
                <ol className="space-y-1 text-[11px] text-[var(--text-secondary)]">
                  {(simulacion.resultados ?? []).map((r: any, i: number) => <li key={i}>{i + 1}. {JSON.stringify(r)}</li>)}
                </ol>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
