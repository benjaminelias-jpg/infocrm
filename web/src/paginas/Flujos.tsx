import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fmtNum } from '../api';
import { Cargando } from '../componentes/Graficas';
import Cabecera from '../componentes/Cabecera';
import Pizarra, { DISPAROS, NODOS, arbolAGrafo, uid, type Ctx, type Paso } from '../componentes/Pizarra';
import Automatizaciones from './Automatizaciones';
import { Dialogo, Boton } from '../ui';

// =====================================================================
// Automensajes: tu ManyChat propio. La lista de flujos + plantillas, y al
// abrir uno, la pizarra libre estilo n8n.
// =====================================================================

// Las plantillas se escriben como árbol (fácil de leer) y se convierten a
// la pizarra libre con posiciones al abrirlas.
type NodoArbol = { tipo: string; [k: string]: any };
const n = (tipo: string, datos: Record<string, any> = {}): NodoArbol => ({ id: uid(), tipo, ...datos });
const op = (titulo: string, pasos: NodoArbol[] = []) => ({ id: uid(), titulo, pasos });

function plantillas() {
  return [
    {
      nombre: 'Recurso por comentario', icono: '📄', disparo: 'comentario', palabra_clave: 'GUIA',
      desc: 'Comentan GUIA → respondés el comentario y por DM le preguntás; al tocar el botón le llega el recurso.',
      pasos: [
        n('responder_comentario', { texto: '¡Te lo mandé por DM! 📩' }),
        n('pregunta', { texto: '¡Hola {{nombre}}! 👋 ¿Te paso la guía?', opciones: [op('¡Sí, pasámela!', [
          n('enviar_recurso', { recurso_id: '', _prefiere: 'pdf' }),
          n('etiquetar', { etiqueta: 'pidió-guía' }),
          n('mover_etapa', { etapa_slug: '', _prefiere: 'conversa|interesad' }),
        ])] }),
      ],
    },
    {
      nombre: 'Audio del founder + agendar', icono: '🎙️', disparo: 'comentario', palabra_clave: 'QUIERO',
      desc: 'Le mandás tu audio y le proponés una llamada. Si dice que no, le hacés seguimiento al día siguiente.',
      pasos: [
        n('responder_comentario', { texto: '¡Te escribí por DM! 🙌' }),
        n('pregunta', { texto: '¡Hola {{nombre}}! ¿Te mando un audio contándote cómo funciona?', opciones: [op('Sí, dale 🙌', [
          n('enviar_recurso', { recurso_id: '', _prefiere: 'audio' }),
          n('pregunta', { texto: '¿Querés que agendemos una llamada corta para ver tu caso?', opciones: [
            op('Sí, agendemos', [n('enviar_dm', { texto: 'Elegí el horario que te quede cómodo 👉 https://' }), n('mover_etapa', { etapa_slug: '', _prefiere: 'llamada|reuni|agend' }), n('notificar', { texto: 'Quiere agendar llamada' })]),
            op('Ahora no', [n('etiquetar', { etiqueta: 'seguimiento' }), n('esperar', { minutos: 1440 }), n('enviar_dm', { texto: '¡Hola {{nombre}}! ¿Pudiste escuchar el audio? Cualquier duda acá estoy 🙌' })]),
          ] }),
        ])] }),
      ],
    },
    {
      nombre: 'Calificar al lead', icono: '🎯', disparo: 'dm', palabra_clave: 'INFO',
      desc: 'Le preguntás en qué etapa está y según lo que toca va a un camino distinto (el que factura, directo al closer).',
      pasos: [
        n('pregunta', { texto: '¡Gracias por escribir, {{nombre}}! Para ayudarte mejor: ¿en qué etapa estás?', opciones: [
          op('Recién empiezo', [n('etiquetar', { etiqueta: 'principiante' }), n('enviar_dm', { texto: '¡Genial! Te dejo por dónde arrancar 👇' })]),
          op('Ya facturo', [n('etiquetar', { etiqueta: 'factura' }), n('asignar', { rol: 'setter' }), n('notificar', { texto: 'Lead que ya factura' })]),
          op('Quiero escalar', [n('etiquetar', { etiqueta: 'high-ticket' }), n('asignar', { rol: 'closer' }), n('mover_etapa', { etapa_slug: '', _prefiere: 'conversa|interesad' }), n('notificar', { texto: 'Lead caliente: quiere escalar' })]),
        ] }),
      ],
    },
    {
      nombre: 'Clase gratis pidiendo email', icono: '🎥', disparo: 'comentario', palabra_clave: 'CLASE',
      desc: 'Le pedís el email, esperás su respuesta, lo guardás en su ficha y le mandás la clase.',
      pasos: [
        n('responder_comentario', { texto: '¡Listo! Mirá tus DMs 📩' }),
        n('pregunta', { texto: '¡Hola {{nombre}}! ¿Te paso la clase gratis?', opciones: [op('¡Sí!', [
          n('enviar_dm', { texto: 'Genial 🙌 ¿A qué email te la mando?' }),
          n('esperar_respuesta', { guardar_en: 'email' }),
          n('enviar_dm', { texto: '¡Listo! Acá tenés el acceso a la clase 🎥 https://' }),
          n('etiquetar', { etiqueta: 'vio-clase' }),
        ])] }),
      ],
    },
    {
      nombre: 'Respuesta a historias', icono: '⭕', disparo: 'historia', palabra_clave: '',
      desc: 'Cada vez que alguien responde una historia, le contestás al instante y avisás al setter.',
      pasos: [
        n('enviar_dm', { texto: '¡Gracias por responder, {{nombre}}! 🙌 ¿Qué te gustaría lograr?' }),
        n('notificar', { texto: 'Respondió una historia' }),
      ],
    },
    {
      nombre: 'Venta directa con link', icono: '💳', disparo: 'dm', palabra_clave: 'PRECIO, LINK',
      desc: 'Te piden el precio por DM → le mandás el link de pago y avisás al equipo.',
      pasos: [
        n('enviar_dm', { texto: '¡Hola {{nombre}}! Te paso todo 👇\n\nCurso: …\nPrecio: …\nLink de pago: https://' }),
        n('etiquetar', { etiqueta: 'pidió-precio' }),
        n('notificar', { texto: 'Pidió el precio: hacer seguimiento' }),
      ],
    },
  ];
}

function contarPasos(pasos: any[]): number {
  return (pasos ?? []).reduce((s: number, p: any) => s + (p.tipo === 'inicio' ? 0 : 1)
    + (p.tipo === 'pregunta' ? (p.opciones ?? []).reduce((a: number, o: any) => a + contarPasos(o.pasos ?? []), 0) : 0)
    + (p.tipo === 'condicion' && Array.isArray(p.si) ? contarPasos(p.si) + contarPasos(p.no ?? []) : 0), 0);
}

const FLUJO_VACIO = {
  nombre: '', disparo: 'comentario', palabra_clave: '', contenido_id: '', activo: true,
  pasos: [{ id: 'inicio', tipo: 'inicio', x: 0, y: 0, siguiente: null }] as Paso[],
};

export default function Flujos() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'manychat' ? 'manychat' : 'flujos';
  const [flujos, setFlujos] = useState<any[]>([]);
  const [ctx, setCtx] = useState<Ctx>({ recursos: [], etapas: [], etiquetas: [], contenidos: [] });
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [form, setForm] = useState<any>(FLUJO_VACIO);
  const [editando, setEditando] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [prueba, setPrueba] = useState<{ abierta: boolean; respuestas: Record<string, string>; resultado: any }>({ abierta: false, respuestas: {}, resultado: null });
  const [guardando, setGuardando] = useState(false);
  const [cambios, setCambios] = useState(false);
  const [salir, setSalir] = useState(false);
  const [borrador, setBorrador] = useState<{ form: any; en: number } | null>(null);

  async function cargar() {
    const [f, rec, pipes, et, cont] = await Promise.all([
      api<any[]>('/flujos'),
      api<any[]>('/recursos').catch(() => []),
      api<any[]>('/pipelines').catch(() => []),
      api<any[]>('/etiquetas').catch(() => []),
      api<any[]>('/contenidos').catch(() => []),
    ]);
    setFlujos(f);
    const etapas: any[] = [];
    const vistos = new Set<string>();
    for (const p of pipes) for (const e of p.etapas ?? []) {
      if (vistos.has(e.slug)) continue;
      vistos.add(e.slug);
      etapas.push({ ...e, pipeline: p.nombre });
    }
    setCtx({
      recursos: rec, etapas,
      etiquetas: (et ?? []).map((x: any) => (typeof x === 'string' ? x : x.etiqueta ?? x.nombre)).filter(Boolean),
      contenidos: Array.isArray(cont) ? cont : (cont as any)?.contenidos ?? [],
    });
    setCargando(false);
  }
  useEffect(() => { cargar(); }, []);

  // Borrador automático (sin ventanas del navegador): si se cierra la pestaña
  // o se corta la luz, los cambios sin guardar quedan para recuperarlos.
  const claveBorrador = (id: string | null) => `infocrm_borrador_flujo_${id ?? 'nuevo'}`;
  useEffect(() => {
    if (!abierto || !cambios) return;
    const t = window.setTimeout(() => {
      try { localStorage.setItem(claveBorrador(editando), JSON.stringify({ form, en: Date.now() })); } catch { /* sin almacenamiento */ }
    }, 500);
    return () => window.clearTimeout(t);
  }, [abierto, cambios, form, editando]);
  function borrarBorrador(id: string | null) {
    try { localStorage.removeItem(claveBorrador(id)); } catch { /* sin almacenamiento */ }
  }

  const setFormEditado = (f: (x: any) => any) => { setForm(f); setCambios(true); };

  /** Completa los huecos de una plantilla con tus recursos y tus etapas. */
  function prepararPlantilla(pasos: any[]): any[] {
    const fijar = (lista: any[]): any[] => lista.map((p0) => {
      const p = { ...p0 };
      if (p.tipo === 'enviar_recurso' && !p.recurso_id) {
        const r = ctx.recursos.find((x) => (p._prefiere === 'audio' ? x.tipo === 'audio' : x.tipo !== 'audio' && x.tipo !== 'texto'))
          ?? ctx.recursos.find((x) => x.tipo !== 'texto');
        p.recurso_id = r?.id ?? '';
      }
      if (p.tipo === 'mover_etapa' && !p.etapa_slug) {
        const e = ctx.etapas.find((x) => new RegExp(p._prefiere ?? 'conversa', 'i').test(`${x.nombre} ${x.slug}`)) ?? ctx.etapas[1] ?? ctx.etapas[0];
        p.etapa_slug = e?.slug ?? '';
      }
      delete p._prefiere;
      if (p.tipo === 'pregunta') p.opciones = (p.opciones ?? []).map((o: any) => ({ ...o, pasos: fijar(o.pasos ?? []) }));
      return p;
    });
    return fijar(pasos);
  }

  function abrir(datos: any, id: string | null) {
    setEditando(id); setAbierto(true); setAvisos([]); setMarcados([]); setAviso(null); setCambios(!id);
    setPrueba({ abierta: false, respuestas: {}, resultado: null });
    setForm(datos);
    // ¿Quedó un borrador sin guardar de la última vez?
    try {
      const b = localStorage.getItem(claveBorrador(id));
      setBorrador(b ? JSON.parse(b) : null);
    } catch { setBorrador(null); }
  }
  function nuevoFlujo(pl?: any) {
    abrir(pl
      ? { ...FLUJO_VACIO, nombre: pl.nombre, disparo: pl.disparo, palabra_clave: pl.palabra_clave, pasos: arbolAGrafo(prepararPlantilla(pl.pasos)) }
      : { ...FLUJO_VACIO }, null);
  }
  function editar(fl: any) {
    const pasos = (fl.pasos ?? []).map((p: any) => (p.tipo === 'entregar_recurso' ? { ...p, tipo: 'enviar_dm', texto: p.recurso ?? p.texto ?? '' } : p));
    abrir({ nombre: fl.nombre, disparo: fl.disparo, palabra_clave: fl.palabra_clave ?? '', contenido_id: fl.contenido_id ?? '', pasos, activo: fl.activo }, fl.id);
  }
  function cerrarDefinitivo() {
    if (cambios) borrarBorrador(editando);
    setSalir(false); setAbierto(false); setEditando(null); setForm(FLUJO_VACIO);
    setAvisos([]); setMarcados([]); setCambios(false); setBorrador(null);
  }
  function cerrar() {
    if (cambios) { setSalir(true); return; }
    cerrarDefinitivo();
  }

  async function guardar(): Promise<string | null> {
    if (!String(form.nombre ?? '').trim()) { setAviso('Ponele un nombre al automensaje (arriba a la izquierda).'); return null; }
    setGuardando(true);
    const cuerpo = {
      ...form,
      palabra_clave: String(form.palabra_clave ?? '').trim() || null,
      contenido_id: form.contenido_id || null,
    };
    try {
      const r = editando
        ? await api<any>(`/flujos/${editando}`, { method: 'PATCH', json: cuerpo })
        : await api<any>('/flujos', { method: 'POST', json: cuerpo });
      borrarBorrador(editando);
      setBorrador(null);
      setEditando(r.id);
      setForm((f: any) => ({ ...f, activo: r.activo, pasos: r.pasos }));
      setAvisos(r.avisos ?? []);
      setMarcados(r.marcados ?? []);
      setCambios(false);
      setAviso(r.avisos?.length
        ? 'Guardado en PAUSA: corregí lo marcado en rojo y activalo.'
        : r.activo ? '✓ Guardado y activo.' : '✓ Guardado (en pausa).');
      cargar();
      return r.id;
    } catch (err: any) { setAviso(err.message); return null; } finally { setGuardando(false); }
  }

  async function probar() {
    const id = await guardar();
    if (!id) return;
    try {
      const r = await api<any>(`/flujos/${id}/simular`, { method: 'POST', json: { respuestas: prueba.respuestas } });
      setPrueba((p) => ({ ...p, abierta: true, resultado: r }));
    } catch (err: any) { setAviso(err.message); }
  }

  async function toggle(fl: any) {
    const r = await api<any>(`/flujos/${fl.id}`, { method: 'PATCH', json: { activo: !fl.activo } });
    setAviso(r.avisos?.length ? `«${fl.nombre}» no se puede activar todavía: ${r.avisos[0]}` : null);
    await cargar();
  }
  async function duplicar(fl: any) { await api(`/flujos/${fl.id}/duplicar`, { method: 'POST' }); await cargar(); }
  async function borrar(id: string) { await api(`/flujos/${id}`, { method: 'DELETE' }); await cargar(); }

  const preguntas = useMemo(() => (form.pasos ?? []).filter((p: any) => p.tipo === 'pregunta'), [form.pasos]);
  const condiciones = useMemo(() => (form.pasos ?? []).filter((p: any) => p.tipo === 'condicion'), [form.pasos]);
  const recorrido: string[] = useMemo(
    () => (prueba.abierta ? (prueba.resultado?.resultados ?? []).map((r: any) => r.nodo).filter(Boolean) : []),
    [prueba]);

  if (cargando) return <Cargando />;

  function cambiarTab(t: string) {
    if (t === 'manychat') params.set('tab', 'manychat'); else params.delete('tab');
    setParams(params, { replace: true });
  }

  // ---------------- Pizarra ----------------
  if (abierto) {
    return (
      <div className="alto-app flex flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-hairline)] px-3 py-2">
          <button onClick={cerrar} className="rounded-md border border-[var(--border-hairline)] px-2.5 py-1.5 text-[12px] hover:bg-[var(--surface-1)]">←</button>
          <input value={form.nombre} onChange={(e) => setFormEditado((f: any) => ({ ...f, nombre: e.target.value }))}
            placeholder="Nombre del automensaje" className="min-w-[160px] flex-1 rounded-md border border-[var(--border-hairline)] bg-transparent px-2.5 py-1.5 text-[13px] font-medium outline-none sm:max-w-[300px]" />
          <label className="flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
            <input type="checkbox" checked={form.activo} onChange={(e) => setFormEditado((f: any) => ({ ...f, activo: e.target.checked }))} /> Activo
          </label>
          {cambios && <span className="text-[11px] text-[var(--text-muted)]">· sin guardar</span>}
          <div className="flex-1" />
          <button onClick={() => setPrueba((p) => ({ ...p, abierta: !p.abierta }))}
            className="rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] hover:bg-[var(--surface-1)]">▷ Probar</button>
          <button onClick={guardar} disabled={guardando} className="rounded-md px-4 py-1.5 text-[12px] font-medium text-white disabled:opacity-60" style={{ background: 'var(--series-1)' }}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>

        {borrador && (
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-hairline)] px-3 py-2 text-[12px]" style={{ background: 'color-mix(in srgb, var(--status-warning) 12%, var(--page-plane))' }}>
            <span>📝 Quedaron cambios sin guardar{borrador.form?.nombre ? ` en «${borrador.form.nombre}»` : ''} de la última vez.</span>
            <Boton tamano="xs" variante="primario" onClick={() => { setForm(borrador.form); setCambios(true); setBorrador(null); }}>Recuperarlos</Boton>
            <Boton tamano="xs" variante="fantasma" onClick={() => { borrarBorrador(editando); setBorrador(null); }}>Descartar</Boton>
          </div>
        )}

        {(aviso || avisos.length > 0) && (
          <div className="border-b border-[var(--border-hairline)] px-3 py-2 text-[12px]" style={{ background: 'var(--page-plane)' }}>
            {aviso && <div>{aviso}</div>}
            {avisos.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-[var(--text-secondary)]">{avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
            )}
          </div>
        )}

        {prueba.abierta && (
          <div className="max-h-[38vh] overflow-y-auto border-b border-[var(--border-hairline)] px-3 py-2" style={{ background: 'var(--page-plane)' }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-medium">Prueba en seco</span>
              <span className="text-[11px] text-[var(--text-muted)]">no manda nada ni toca tus leads · elegí qué haría el lead:</span>
              {preguntas.map((p: any) => (
                <label key={p.id} className="text-[11px]">
                  <span className="mr-1 text-[var(--text-secondary)]">❓ «{String(p.texto ?? '').slice(0, 24)}» →</span>
                  <select value={prueba.respuestas[p.id] ?? ''} onChange={(e) => setPrueba((x) => ({ ...x, respuestas: { ...x.respuestas, [p.id]: e.target.value } }))}
                    className="rounded border border-[var(--border-hairline)] bg-[var(--surface-1)] px-1 py-0.5">
                    <option value="">(el primero)</option>
                    {(p.opciones ?? []).map((o: any) => <option key={o.id} value={o.id}>{o.titulo || 'sin texto'}</option>)}
                  </select>
                </label>
              ))}
              {condiciones.map((c: any) => (
                <label key={c.id} className="text-[11px]">
                  <span className="mr-1 text-[var(--text-secondary)]">🔀 →</span>
                  <select value={prueba.respuestas[c.id] ?? 'si'} onChange={(e) => setPrueba((x) => ({ ...x, respuestas: { ...x.respuestas, [c.id]: e.target.value } }))}
                    className="rounded border border-[var(--border-hairline)] bg-[var(--surface-1)] px-1 py-0.5">
                    <option value="si">Sí</option><option value="no">No</option>
                  </select>
                </label>
              ))}
              <button onClick={probar} className="rounded-md px-3 py-1 text-[12px] font-medium text-white" style={{ background: 'var(--status-good)' }}>▷ Probar este camino</button>
            </div>
            {prueba.resultado && (
              <ol className="mt-2 space-y-0.5 text-[12px]">
                {(prueba.resultado.resultados ?? []).map((r: any, i: number) => (
                  <li key={i} className="flex gap-2"><span className="text-[var(--text-muted)]">{i + 1}.</span><span>{r.texto ?? r.paso}</span></li>
                ))}
                <li className="pt-1 text-[11px] text-[var(--text-muted)]">El camino recorrido quedó pintado en verde en la pizarra.</li>
              </ol>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1">
          <Pizarra form={form} setForm={setFormEditado} ctx={ctx} marcados={marcados} recorrido={recorrido} />
        </div>

        <Dialogo abierto={salir} onCerrar={() => setSalir(false)} titulo="Tenés cambios sin guardar"
          descripcion="Si salís sin guardar, se descartan."
          pie={(
            <>
              <Boton variante="fantasma" onClick={() => setSalir(false)}>Seguir editando</Boton>
              <Boton variante="secundario" onClick={cerrarDefinitivo}>Salir sin guardar</Boton>
              <Boton variante="primario" cargando={guardando} onClick={async () => { const id = await guardar(); if (id) cerrarDefinitivo(); }}>Guardar y salir</Boton>
            </>
          )} />
      </div>
    );
  }

  // ---------------- Lista ----------------
  return (
    <div className="px-4 py-5 lg:px-8">
      <Cabecera titulo="Automensajes" subtitulo="Tu ManyChat propio: armá tus flujos en una pizarra libre y el CRM responde solo" />

      <div className="mt-3 flex gap-1 border-b border-[var(--border-hairline)] text-[13px]">
        {([['flujos', 'Mis automensajes'], ['manychat', 'Palabras de ManyChat']] as const).map(([v, t]) => (
          <button key={v} onClick={() => cambiarTab(v)}
            className={`-mb-px border-b-2 px-3 py-2 ${tab === v ? 'border-[var(--series-1)] font-medium' : 'border-transparent text-[var(--text-secondary)]'}`}>{t}</button>
        ))}
      </div>

      {aviso && <div className="mt-3 rounded-md px-3 py-2 text-[12px]" style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>{aviso}</div>}

      {tab === 'manychat' && (
        <div className="mt-2">
          <p className="mb-2 text-[12px] text-[var(--text-secondary)]">
            ¿Seguís usando ManyChat? Acá unís cada palabra clave de ManyChat con su reel, para saber de qué contenido viene cada lead.
            Los automensajes del CRM no necesitan esto: ya saben de qué reel vino cada uno.
          </p>
          <Automatizaciones embebido />
        </div>
      )}

      {tab === 'flujos' && (
        <>
          <section className="mt-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[13px] font-semibold">Empezá con una plantilla o desde una pizarra en blanco</h2>
              <button onClick={() => nuevoFlujo()} className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white" style={{ background: 'var(--series-1)' }}>
                + Pizarra en blanco
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {plantillas().map((p) => (
                <button key={p.nombre} onClick={() => nuevoFlujo(p)} className="tarjeta p-3 text-left hover:border-[var(--series-1)]">
                  <div className="text-[13px] font-medium">{p.icono} {p.nombre}</div>
                  <div className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">{p.desc}</div>
                  <div className="mt-1.5 text-[10px] text-[var(--text-muted)]">
                    {DISPAROS.find((d) => d.v === p.disparo)?.t}{p.palabra_clave ? ` · «${p.palabra_clave}»` : ''} · {contarPasos(p.pasos)} pasos
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="mt-6">
            <h2 className="mb-2 text-[13px] font-semibold">Tus automensajes</h2>
            {flujos.length === 0 ? (
              <div className="tarjeta p-6 text-center text-[13px] text-[var(--text-muted)]">
                Todavía no tenés ninguno. Elegí una plantilla de arriba: en 1 minuto lo tenés andando.
              </div>
            ) : (
              <div className="space-y-2">
                {flujos.map((fl) => {
                  const d = DISPAROS.find((x) => x.v === fl.disparo);
                  const tipos = (fl.pasos ?? []).filter((p: any) => p.tipo !== 'inicio');
                  return (
                    <div key={fl.id} className="tarjeta flex flex-wrap items-center justify-between gap-2 p-3.5">
                      <button onClick={() => editar(fl)} className="min-w-0 text-left">
                        <div className="flex items-center gap-2 text-[13px] font-medium">
                          <span className="inline-block h-2 w-2 rounded-full" style={{ background: fl.activo ? 'var(--status-good)' : 'var(--baseline)' }} />
                          {fl.nombre}
                          {!fl.activo && <span className="text-[11px] font-normal text-[var(--text-muted)]">en pausa</span>}
                        </div>
                        <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                          {d?.icono} {d?.t ?? fl.disparo}
                          {fl.palabra_clave && <> · «{fl.palabra_clave}»</>}
                          {fl.contenido_titulo && <> · solo en «{fl.contenido_titulo}»</>}
                          {' '}· {tipos.length} pasos {tipos.slice(0, 6).map((p: any) => NODOS[p.tipo]?.icono ?? '').join('')}
                          {' '}· {fmtNum(fl.ejecuciones)} veces
                        </div>
                      </button>
                      <div className="flex shrink-0 gap-1.5">
                        <button onClick={() => editar(fl)} className="rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]">Abrir pizarra</button>
                        <button onClick={() => toggle(fl)} className="rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]">{fl.activo ? 'Pausar' : 'Activar'}</button>
                        <button onClick={() => duplicar(fl)} className="rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]">Duplicar</button>
                        <BotonBorrar onBorrar={() => borrar(fl.id)} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function BotonBorrar({ onBorrar }: { onBorrar: () => void }) {
  const [seguro, setSeguro] = useState(false);
  return seguro ? (
    <button onClick={onBorrar} onBlur={() => setSeguro(false)} autoFocus
      className="rounded px-2 py-1 text-[11px] font-medium text-white" style={{ background: 'var(--status-critical)' }}>¿Borrar?</button>
  ) : (
    <button onClick={() => setSeguro(true)} className="rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]"
      style={{ color: 'var(--status-critical)' }}>Borrar</button>
  );
}
