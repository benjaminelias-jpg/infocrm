import { useEffect, useState } from 'react';
import { api, fmtFecha, fmtNum } from '../api';
import { Cargando } from '../componentes/Graficas';
import Cabecera from '../componentes/Cabecera';

// Tipos de paso que entiende el motor (server/src/modules/instagram_dm.ts)
const TIPOS_PASO: { tipo: string; etiqueta: string; campo?: string; placeholder?: string }[] = [
  { tipo: 'enviar_dm', etiqueta: 'Enviar DM', campo: 'texto', placeholder: 'Hola 👋 gracias por comentar…' },
  { tipo: 'enviar_recurso', etiqueta: 'Enviar recurso/audio', campo: 'recurso_id', placeholder: '' },
  { tipo: 'entregar_recurso', etiqueta: 'Entregar recurso (texto)', campo: 'recurso', placeholder: 'Aquí tienes el PDF: https://…' },
  { tipo: 'etiquetar', etiqueta: 'Etiquetar lead', campo: 'etiqueta', placeholder: 'interesado-reel-x' },
  { tipo: 'mover_etapa', etiqueta: 'Mover de etapa', campo: 'etapa_slug', placeholder: 'conversacion' },
  { tipo: 'esperar', etiqueta: 'Esperar', campo: 'minutos', placeholder: '120' },
];

const DISPAROS = [
  { v: 'comentario', t: 'Comentario con palabra clave' },
  { v: 'dm', t: 'DM con palabra clave' },
  { v: 'historia', t: 'Respuesta a historia' },
  { v: 'mencion', t: 'Mención' },
];

const FLUJO_VACIO = {
  nombre: '', disparo: 'comentario', palabra_clave: '', contenido_id: '',
  pasos: [] as any[], activo: true,
};

function metaPaso(tipo: string) {
  // Fallback para pasos de tipos desconocidos (datos antiguos/externos): evita
  // que la página reviente al renderizar un paso que no está en TIPOS_PASO.
  return TIPOS_PASO.find((t) => t.tipo === tipo)
    ?? { tipo, etiqueta: tipo, campo: 'texto', placeholder: '' };
}

export default function Flujos() {
  const [flujos, setFlujos] = useState<any[]>([]);
  const [contenidos, setContenidos] = useState<any[]>([]);
  const [recursos, setRecursos] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);
  const [form, setForm] = useState<any>({ ...FLUJO_VACIO });
  const [editando, setEditando] = useState<string | null>(null);
  const [simulacion, setSimulacion] = useState<any>(null);

  async function cargar() {
    const [f, c, rec] = await Promise.all([
      api<any[]>('/flujos'),
      api<any[]>('/contenidos?limite=100').catch(() => []),
      api<any[]>('/recursos').catch(() => []),
    ]);
    setFlujos(f);
    setContenidos(Array.isArray(c) ? c : (c as any)?.datos ?? []);
    setRecursos(rec);
    setCargando(false);
  }
  useEffect(() => { cargar(); }, []);

  function addPaso(tipo: string) {
    setForm((f: any) => ({ ...f, pasos: [...f.pasos, { tipo, [metaPaso(tipo).campo!]: '' }] }));
  }
  function setPaso(i: number, valor: string) {
    setForm((f: any) => {
      const pasos = [...f.pasos];
      pasos[i] = { ...pasos[i], [metaPaso(pasos[i].tipo).campo!]: valor };
      return { ...f, pasos };
    });
  }
  function quitarPaso(i: number) {
    setForm((f: any) => ({ ...f, pasos: f.pasos.filter((_: any, k: number) => k !== i) }));
  }
  function moverPaso(i: number, dir: -1 | 1) {
    setForm((f: any) => {
      const pasos = [...f.pasos];
      const j = i + dir;
      if (j < 0 || j >= pasos.length) return f;
      [pasos[i], pasos[j]] = [pasos[j], pasos[i]];
      return { ...f, pasos };
    });
  }

  function editar(fl: any) {
    setEditando(fl.id);
    setForm({
      nombre: fl.nombre, disparo: fl.disparo, palabra_clave: fl.palabra_clave ?? '',
      contenido_id: fl.contenido_id ?? '', pasos: fl.pasos ?? [], activo: fl.activo,
    });
    setSimulacion(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function cancelar() { setEditando(null); setForm({ ...FLUJO_VACIO }); setSimulacion(null); }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nombre.trim()) { setAviso('Ponle un nombre al flujo.'); return; }
    const cuerpo = {
      ...form,
      palabra_clave: form.palabra_clave.trim() || null,
      contenido_id: form.contenido_id || null,
    };
    try {
      if (editando) await api(`/flujos/${editando}`, { method: 'PATCH', json: cuerpo });
      else await api('/flujos', { method: 'POST', json: cuerpo });
      setAviso(editando ? 'Flujo actualizado.' : 'Flujo creado.');
      cancelar();
      await cargar();
    } catch (err: any) { setAviso(err.message); }
  }

  async function simular() {
    if (!editando) { setAviso('Guarda el flujo antes de simularlo.'); return; }
    try {
      const r = await api<any>(`/flujos/${editando}/simular`, { method: 'POST' });
      setSimulacion(r);
    } catch (err: any) { setAviso(err.message); }
  }

  async function toggle(fl: any) {
    await api(`/flujos/${fl.id}`, { method: 'PATCH', json: { activo: !fl.activo } });
    await cargar();
  }
  async function borrar(id: string) {
    await api(`/flujos/${id}`, { method: 'DELETE' });
    if (editando === id) cancelar();
    await cargar();
  }

  if (cargando) return <Cargando />;

  return (
    <div className="px-5 py-5 lg:px-8">
      <Cabecera
        titulo="Flujos de DM"
        subtitulo="Tu propio ManyChat: un comentario con palabra clave dispara una secuencia de DMs"
      />

      {aviso && (
        <div className="mt-3 rounded-md px-3 py-2 text-[12px]"
          style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>
          {aviso}
        </div>
      )}

      {/* Constructor */}
      <section className="mt-5">
        <div className="tarjeta p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[14px] font-semibold">
              {editando ? 'Editar flujo' : 'Nuevo flujo'}
            </h2>
            {editando && (
              <button onClick={cancelar}
                className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                + Crear uno nuevo
              </button>
            )}
          </div>

          <form onSubmit={guardar} className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <input
                value={form.nombre}
                onChange={(e) => setForm((f: any) => ({ ...f, nombre: e.target.value }))}
                placeholder="Nombre (p. ej. Recurso del reel de hooks)"
                className="w-[260px] rounded-md border border-[var(--border-hairline)] bg-transparent px-2.5 py-1.5 text-[12px] outline-none"
              />
              <select
                value={form.disparo}
                onChange={(e) => setForm((f: any) => ({ ...f, disparo: e.target.value }))}
                className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2.5 py-1.5 text-[12px] outline-none"
              >
                {DISPAROS.map((d) => <option key={d.v} value={d.v}>{d.t}</option>)}
              </select>
              <input
                value={form.palabra_clave}
                onChange={(e) => setForm((f: any) => ({ ...f, palabra_clave: e.target.value }))}
                placeholder="Palabra clave (p. ej. SISTEMA)"
                className="w-[200px] rounded-md border border-[var(--border-hairline)] bg-transparent px-2.5 py-1.5 text-[12px] outline-none"
              />
              <select
                value={form.contenido_id}
                onChange={(e) => setForm((f: any) => ({ ...f, contenido_id: e.target.value }))}
                className="min-w-[200px] flex-1 rounded-md border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2.5 py-1.5 text-[12px] outline-none"
              >
                <option value="">Contenido asociado (opcional)</option>
                {contenidos.map((c) => (
                  <option key={c.id} value={c.id}>{c.titulo ?? c.ig_media_id ?? c.id.slice(0, 8)}</option>
                ))}
              </select>
            </div>

            {/* Pasos */}
            <div className="rounded-md border border-[var(--border-hairline)] p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-medium">Pasos</span>
                <span className="text-[11px] text-[var(--text-muted)]">se ejecutan en orden →</span>
              </div>

              {form.pasos.length === 0 && (
                <p className="mb-2 text-[11px] text-[var(--text-muted)]">
                  Aún no hay pasos. Añade el primero abajo (normalmente «Entregar recurso»).
                </p>
              )}

              <div className="space-y-2">
                {form.pasos.map((p: any, i: number) => {
                  const m = metaPaso(p.tipo);
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-5 shrink-0 text-center text-[11px] text-[var(--text-muted)]">{i + 1}</span>
                      <span className="w-[130px] shrink-0 text-[12px]">{m.etiqueta}</span>
                      {p.tipo === 'enviar_recurso' ? (
                        <select
                          value={p.recurso_id ?? ''}
                          onChange={(e) => setPaso(i, e.target.value)}
                          className="min-w-0 flex-1 rounded-md border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1 text-[12px] outline-none"
                        >
                          <option value="">Elegí un recurso/audio…</option>
                          {recursos.map((rc) => <option key={rc.id} value={rc.id}>{rc.tipo === 'audio' ? '🎙️ ' : '📎 '}{rc.nombre}</option>)}
                        </select>
                      ) : (
                        <input
                          value={p[m.campo!] ?? ''}
                          onChange={(e) => setPaso(i, e.target.value)}
                          placeholder={m.placeholder}
                          type={p.tipo === 'esperar' ? 'number' : 'text'}
                          className="min-w-0 flex-1 rounded-md border border-[var(--border-hairline)] bg-transparent px-2 py-1 text-[12px] outline-none"
                        />
                      )}
                      <div className="flex shrink-0 gap-0.5">
                        <button type="button" onClick={() => moverPaso(i, -1)} disabled={i === 0}
                          className="rounded px-1.5 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--page-plane)] disabled:opacity-30">↑</button>
                        <button type="button" onClick={() => moverPaso(i, 1)} disabled={i === form.pasos.length - 1}
                          className="rounded px-1.5 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--page-plane)] disabled:opacity-30">↓</button>
                        <button type="button" onClick={() => quitarPaso(i)}
                          className="rounded px-1.5 py-1 text-[11px] hover:bg-[var(--page-plane)]"
                          style={{ color: 'var(--status-critical)' }}>✕</button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {TIPOS_PASO.map((t) => (
                  <button key={t.tipo} type="button" onClick={() => addPaso(t.tipo)}
                    className="rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]">
                    + {t.etiqueta}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="submit"
                className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white"
                style={{ background: 'var(--series-1)' }}>
                {editando ? 'Guardar cambios' : 'Crear flujo'}
              </button>
              {editando && (
                <button type="button" onClick={simular}
                  className="rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] hover:bg-[var(--page-plane)]">
                  ▷ Simular (sin enviar)
                </button>
              )}
              <label className="flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
                <input type="checkbox" checked={form.activo}
                  onChange={(e) => setForm((f: any) => ({ ...f, activo: e.target.checked }))} />
                Activo
              </label>
            </div>
          </form>

          {simulacion && (
            <div className="mt-3 rounded-md border border-[var(--border-hairline)] p-3">
              <div className="mb-1.5 text-[12px] font-medium">
                Simulación · estado <code className="rounded px-1" style={{ background: 'var(--gridline)' }}>{simulacion.estado}</code>
              </div>
              <ol className="space-y-1 text-[11px] text-[var(--text-secondary)]">
                {(simulacion.resultados ?? []).map((r: any, i: number) => (
                  <li key={i}>
                    <span className="text-[var(--text-muted)]">{i + 1}.</span>{' '}
                    {JSON.stringify(r)}
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                En modo simulación no se envía ningún DM real: así ves el flujo funcionando aunque
                Meta aún no haya aprobado el permiso de mensajería.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Lista */}
      <section className="mt-6">
        <h2 className="mb-2 text-[14px] font-semibold">Tus flujos</h2>
        {flujos.length === 0 ? (
          <div className="tarjeta p-6 text-center text-[13px] text-[var(--text-muted)]">
            Todavía no tienes flujos. Crea el primero arriba.
          </div>
        ) : (
          <div className="space-y-2">
            {flujos.map((fl) => (
              <div key={fl.id} className="tarjeta p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[13px] font-medium">
                      <span className="inline-block h-2 w-2 rounded-full"
                        style={{ background: fl.activo ? 'var(--status-good)' : 'var(--baseline)' }} aria-hidden />
                      {fl.nombre}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                      {DISPAROS.find((d) => d.v === fl.disparo)?.t ?? fl.disparo}
                      {fl.palabra_clave && <> · palabra «<strong>{fl.palabra_clave}</strong>»</>}
                      {fl.contenido_titulo && <> · {fl.contenido_titulo}</>}
                      {' · '}{(fl.pasos ?? []).length} pasos · {fmtNum(fl.ejecuciones)} ejecuciones
                    </div>
                    {fl.ultimo_disparo_en && (
                      <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                        último disparo {fmtFecha(fl.ultimo_disparo_en, true)}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button onClick={() => editar(fl)}
                      className="rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]">Editar</button>
                    <button onClick={() => toggle(fl)}
                      className="rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]">
                      {fl.activo ? 'Pausar' : 'Activar'}</button>
                    <button onClick={() => borrar(fl.id)}
                      className="rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]"
                      style={{ color: 'var(--status-critical)' }}>Borrar</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
