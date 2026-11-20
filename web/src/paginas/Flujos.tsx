import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fmtNum } from '../api';
import { Cargando } from '../componentes/Graficas';
import Cabecera from '../componentes/Cabecera';
import Automatizaciones from './Automatizaciones';

// =====================================================================
// Automensajes: tu ManyChat propio, en una pizarra con ramas.
// Un flujo es un árbol: los pasos van uno debajo del otro y una "pregunta
// con botones" o una "condición" abren ramas lado a lado. Las ramas solo
// pueden ir al final de una secuencia: así el árbol nunca queda ambiguo
// ni "se rompe".
// =====================================================================

type Paso = { id: string; tipo: string; [k: string]: any };

const uid = () => Math.random().toString(36).slice(2, 10);
const MAX_TEXTO = 1000;
const MAX_BOTONES = 13;
const MAX_TITULO = 20;

const NODOS: Record<string, { etiqueta: string; icono: string; color: string; grupo: 'Mensajes' | 'Lógica' | 'El lead'; ramifica?: boolean; ayuda: string }> = {
  enviar_dm: { etiqueta: 'Mandar mensaje', icono: '💬', color: 'var(--series-1)', grupo: 'Mensajes', ayuda: 'Un mensaje de texto por DM' },
  enviar_recurso: { etiqueta: 'Mandar audio o recurso', icono: '🎙️', color: '#9b5de5', grupo: 'Mensajes', ayuda: 'Le llega como nota de voz / archivo' },
  responder_comentario: { etiqueta: 'Responder el comentario', icono: '💭', color: 'var(--series-1)', grupo: 'Mensajes', ayuda: 'Respuesta pública debajo del reel' },
  pregunta: { etiqueta: 'Pregunta con botones', icono: '❓', color: '#e76f51', grupo: 'Lógica', ramifica: true, ayuda: 'Cada botón abre su propio camino' },
  condicion: { etiqueta: 'Condición (sí / no)', icono: '🔀', color: '#264653', grupo: 'Lógica', ramifica: true, ayuda: 'Un camino si se cumple y otro si no' },
  esperar_respuesta: { etiqueta: 'Esperar su respuesta', icono: '✍️', color: '#8d99ae', grupo: 'Lógica', ayuda: 'Pausa hasta que escriba (y guarda lo que dice)' },
  esperar: { etiqueta: 'Esperar un tiempo', icono: '⏳', color: '#8d99ae', grupo: 'Lógica', ayuda: 'Sigue solo después de X minutos/horas/días' },
  etiquetar: { etiqueta: 'Poner etiqueta', icono: '🏷️', color: '#f4a261', grupo: 'El lead', ayuda: 'Para filtrarlo después' },
  quitar_etiqueta: { etiqueta: 'Quitar etiqueta', icono: '🏷️', color: '#f4a261', grupo: 'El lead', ayuda: '' },
  mover_etapa: { etiqueta: 'Mover de etapa', icono: '➡️', color: '#2a9d8f', grupo: 'El lead', ayuda: 'Lo mueve en tu pipeline' },
  asignar: { etiqueta: 'Asignar al equipo', icono: '👤', color: '#2a9d8f', grupo: 'El lead', ayuda: 'Al setter o closer con menos carga' },
  notificar: { etiqueta: 'Avisar al equipo', icono: '🔔', color: '#e9c46a', grupo: 'El lead', ayuda: 'Lo marca en el Chat para que lo atiendan' },
  webhook: { etiqueta: 'Avisar a otra app', icono: '🔗', color: '#8d99ae', grupo: 'El lead', ayuda: 'Zapier, Make, tu email… (webhook)' },
};
const GRUPOS = ['Mensajes', 'Lógica', 'El lead'] as const;

const DISPAROS: Array<{ v: string; t: string; icono: string; palabra: boolean; ph: string; ayuda: string }> = [
  { v: 'comentario', t: 'Comenta en un reel o post', icono: '💭', palabra: true, ph: 'ej. GUIA', ayuda: 'Varias palabras separadas por coma. Vacío = cualquier comentario.' },
  { v: 'dm', t: 'Te escribe por DM', icono: '✉️', palabra: true, ph: 'ej. INFO', ayuda: 'Vacío = cualquier mensaje (respuesta automática de bienvenida).' },
  { v: 'historia', t: 'Responde a una historia', icono: '⭕', palabra: true, ph: 'opcional', ayuda: 'Vacío = cualquier respuesta a tus historias.' },
  { v: 'mencion', t: 'Te menciona en su historia', icono: '@', palabra: false, ph: '', ayuda: 'Se dispara cada vez que alguien te etiqueta en una historia.' },
  { v: 'reaccion', t: 'Reacciona a un mensaje', icono: '❤️', palabra: false, ph: '', ayuda: 'Cuando reacciona con un emoji a un mensaje tuyo.' },
  { v: 'boton', t: 'Toca un botón', icono: '👉', palabra: true, ph: 'texto o código del botón', ayuda: 'Botones de Instagram (menú, rompehielos).' },
  { v: 'anuncio', t: 'Viene de un anuncio', icono: '📣', palabra: true, ph: 'ref del anuncio (opcional)', ayuda: 'Anuncios de "enviar mensaje" o enlaces ig.me/…?ref=' },
];

function n(tipo: string, datos: Record<string, any> = {}): Paso {
  const base: Paso = { id: uid(), tipo, ...datos };
  if (tipo === 'pregunta' && !base.opciones) base.opciones = [{ id: uid(), titulo: '', pasos: [] }];
  if (tipo === 'condicion') { base.si = base.si ?? []; base.no = base.no ?? []; base.campo = base.campo ?? 'etiqueta'; }
  return base;
}
const op = (titulo: string, pasos: Paso[] = []) => ({ id: uid(), titulo, pasos });

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

/** Recorre el árbol aplicando f a cada paso. */
function mapearArbol(pasos: Paso[], f: (p: Paso) => Paso): Paso[] {
  return pasos.map((p0) => {
    const p = f({ ...p0 });
    if (p.tipo === 'pregunta') p.opciones = (p.opciones ?? []).map((o: any) => ({ ...o, pasos: mapearArbol(o.pasos ?? [], f) }));
    if (p.tipo === 'condicion') { p.si = mapearArbol(p.si ?? [], f); p.no = mapearArbol(p.no ?? [], f); }
    return p;
  });
}
function recolectar(pasos: Paso[], tipo: string, out: Paso[] = []): Paso[] {
  for (const p of pasos) {
    if (p.tipo === tipo) out.push(p);
    if (p.tipo === 'pregunta') (p.opciones ?? []).forEach((o: any) => recolectar(o.pasos ?? [], tipo, out));
    if (p.tipo === 'condicion') { recolectar(p.si ?? [], tipo, out); recolectar(p.no ?? [], tipo, out); }
  }
  return out;
}
function contar(pasos: Paso[]): number {
  return pasos.reduce((s, p) => s + 1
    + (p.tipo === 'pregunta' ? (p.opciones ?? []).reduce((a: number, o: any) => a + contar(o.pasos ?? []), 0) : 0)
    + (p.tipo === 'condicion' ? contar(p.si ?? []) + contar(p.no ?? []) : 0), 0);
}

interface Ctx { recursos: any[]; etapas: any[]; etiquetas: string[]; contenidos: any[] }

const FLUJO_VACIO = { nombre: '', disparo: 'comentario', palabra_clave: '', contenido_id: '', pasos: [] as Paso[], activo: true };
const input = 'w-full rounded-md border border-[var(--border-hairline)] bg-transparent px-2 py-1 text-[12px] outline-none';
const select = 'w-full rounded-md border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1 text-[12px] outline-none';
const anchoCarta = (nivel: number) => (nivel === 0 ? 'min(440px, 84vw)' : 'min(300px, 76vw)');

export default function Flujos() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'manychat' ? 'manychat' : 'flujos';
  const [flujos, setFlujos] = useState<any[]>([]);
  const [ctx, setCtx] = useState<Ctx>({ recursos: [], etapas: [], etiquetas: [], contenidos: [] });
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [form, setForm] = useState<any>({ ...FLUJO_VACIO });
  const [editando, setEditando] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [prueba, setPrueba] = useState<{ abierta: boolean; respuestas: Record<string, string>; texto: string; resultado: any }>({ abierta: false, respuestas: {}, texto: '', resultado: null });
  const [guardando, setGuardando] = useState(false);

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

  function rellenarPlantilla(pasos: Paso[]): Paso[] {
    return mapearArbol(pasos, (p) => {
      if (p.tipo === 'enviar_recurso' && !p.recurso_id) {
        const pref = p._prefiere;
        const r = ctx.recursos.find((x) => (pref === 'audio' ? x.tipo === 'audio' : x.tipo !== 'audio' && x.tipo !== 'texto'))
          ?? ctx.recursos.find((x) => x.tipo !== 'texto');
        p.recurso_id = r?.id ?? '';
      }
      if (p.tipo === 'mover_etapa' && !p.etapa_slug) {
        const e = ctx.etapas.find((x) => new RegExp(p._prefiere ?? 'conversa', 'i').test(`${x.nombre} ${x.slug}`)) ?? ctx.etapas[1] ?? ctx.etapas[0];
        p.etapa_slug = e?.slug ?? '';
      }
      delete p._prefiere;
      return p;
    });
  }

  function nuevoFlujo(pl?: any) {
    setEditando(null); setAbierto(true); setAvisos([]); setAviso(null);
    setPrueba({ abierta: false, respuestas: {}, texto: '', resultado: null });
    setForm(pl
      ? { ...FLUJO_VACIO, nombre: pl.nombre, disparo: pl.disparo, palabra_clave: pl.palabra_clave, pasos: rellenarPlantilla(pl.pasos) }
      : { ...FLUJO_VACIO, pasos: [] });
  }
  function editar(fl: any) {
    setEditando(fl.id); setAbierto(true); setAvisos([]); setAviso(null);
    setPrueba({ abierta: false, respuestas: {}, texto: '', resultado: null });
    // Los flujos viejos ("entregar enlace") se ven como "mandar mensaje".
    const pasos = mapearArbol(fl.pasos ?? [], (p) => (p.tipo === 'entregar_recurso'
      ? { id: p.id ?? uid(), tipo: 'enviar_dm', texto: p.recurso ?? p.texto ?? '' }
      : { ...p, id: p.id ?? uid() }));
    setForm({ nombre: fl.nombre, disparo: fl.disparo, palabra_clave: fl.palabra_clave ?? '', contenido_id: fl.contenido_id ?? '', pasos, activo: fl.activo });
  }
  function cerrar() { setAbierto(false); setEditando(null); setForm({ ...FLUJO_VACIO }); setAvisos([]); }

  async function guardar(activar?: boolean) {
    if (!form.nombre.trim()) { setAviso('Ponele un nombre al automensaje.'); return; }
    setGuardando(true);
    const cuerpo = {
      ...form,
      activo: activar ?? form.activo,
      palabra_clave: String(form.palabra_clave ?? '').trim() || null,
      contenido_id: form.contenido_id || null,
    };
    try {
      const r = editando
        ? await api<any>(`/flujos/${editando}`, { method: 'PATCH', json: cuerpo })
        : await api<any>('/flujos', { method: 'POST', json: cuerpo });
      setEditando(r.id);
      setForm((f: any) => ({ ...f, activo: r.activo, pasos: r.pasos }));
      setAvisos(r.avisos ?? []);
      setAviso(r.avisos?.length
        ? 'Guardado en PAUSA: corregí lo que falta (abajo) y activalo.'
        : r.activo ? '✓ Guardado y activo.' : '✓ Guardado (en pausa).');
      await cargar();
    } catch (err: any) { setAviso(err.message); } finally { setGuardando(false); }
  }

  async function probar() {
    if (!editando) { setAviso('Guardá el automensaje para poder probarlo.'); return; }
    await guardar();
    try {
      const r = await api<any>(`/flujos/${editando}/simular`, {
        method: 'POST', json: { respuestas: prueba.respuestas, texto: prueba.texto || undefined },
      });
      setPrueba((p) => ({ ...p, abierta: true, resultado: r }));
    } catch (err: any) { setAviso(err.message); }
  }

  async function toggle(fl: any) {
    const r = await api<any>(`/flujos/${fl.id}`, { method: 'PATCH', json: { activo: !fl.activo } });
    if (r.avisos?.length) setAviso(`«${fl.nombre}» no se puede activar todavía: ${r.avisos[0]}`);
    await cargar();
  }
  async function duplicar(fl: any) { await api(`/flujos/${fl.id}/duplicar`, { method: 'POST' }); await cargar(); }
  async function borrar(id: string) { await api(`/flujos/${id}`, { method: 'DELETE' }); if (editando === id) cerrar(); await cargar(); }

  const preguntas = useMemo(() => recolectar(form.pasos ?? [], 'pregunta'), [form.pasos]);
  const condiciones = useMemo(() => recolectar(form.pasos ?? [], 'condicion'), [form.pasos]);

  if (cargando) return <Cargando />;
  const disp = DISPAROS.find((d) => d.v === form.disparo) ?? DISPAROS[0];

  function cambiarTab(t: string) {
    if (t === 'manychat') params.set('tab', 'manychat'); else params.delete('tab');
    setParams(params, { replace: true });
  }

  return (
    <div className="px-4 py-5 lg:px-8">
      <Cabecera titulo="Automensajes" subtitulo="Tu ManyChat propio: alguien comenta o te escribe y el CRM responde solo, con ramas según lo que toque" />

      {!abierto && (
        <div className="mt-3 flex gap-1 border-b border-[var(--border-hairline)] text-[13px]">
          {([['flujos', 'Mis automensajes'], ['manychat', 'Palabras de ManyChat']] as const).map(([v, t]) => (
            <button key={v} onClick={() => cambiarTab(v)}
              className={`-mb-px border-b-2 px-3 py-2 ${tab === v ? 'border-[var(--series-1)] font-medium' : 'border-transparent text-[var(--text-secondary)]'}`}>{t}</button>
          ))}
        </div>
      )}

      {aviso && <div className="mt-3 rounded-md px-3 py-2 text-[12px]" style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>{aviso}</div>}

      {!abierto && tab === 'manychat' && (
        <div className="mt-2">
          <p className="mb-2 text-[12px] text-[var(--text-secondary)]">
            ¿Seguís usando ManyChat? Acá unís cada palabra clave de ManyChat con su reel, para saber de qué contenido viene cada lead.
            Los automensajes del CRM no necesitan esto: ya saben de qué reel vino cada uno.
          </p>
          <Automatizaciones embebido />
        </div>
      )}

      {!abierto && tab === 'flujos' && (
        <>
          <section className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold">Empezá rápido con una plantilla</h2>
              <button onClick={() => nuevoFlujo()} className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white" style={{ background: 'var(--series-1)' }}>
                + Crear en la pizarra
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {plantillas().map((p) => (
                <button key={p.nombre} onClick={() => nuevoFlujo(p)} className="tarjeta p-3 text-left hover:border-[var(--series-1)]">
                  <div className="text-[13px] font-medium">{p.icono} {p.nombre}</div>
                  <div className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">{p.desc}</div>
                  <div className="mt-1.5 text-[10px] text-[var(--text-muted)]">
                    {DISPAROS.find((d) => d.v === p.disparo)?.t}{p.palabra_clave ? ` · «${p.palabra_clave}»` : ''} · {contar(p.pasos)} pasos
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
                {flujos.map((fl) => (
                  <div key={fl.id} className="tarjeta flex flex-wrap items-center justify-between gap-2 p-3.5">
                    <button onClick={() => editar(fl)} className="min-w-0 text-left">
                      <div className="flex items-center gap-2 text-[13px] font-medium">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ background: fl.activo ? 'var(--status-good)' : 'var(--baseline)' }} />
                        {fl.nombre}
                        {!fl.activo && <span className="text-[11px] font-normal text-[var(--text-muted)]">en pausa</span>}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                        {DISPAROS.find((d) => d.v === fl.disparo)?.icono} {DISPAROS.find((d) => d.v === fl.disparo)?.t ?? fl.disparo}
                        {fl.palabra_clave && <> · «{fl.palabra_clave}»</>}
                        {fl.contenido_titulo && <> · solo en «{fl.contenido_titulo}»</>}
                        {' '}· {contar(fl.pasos ?? [])} pasos · {fmtNum(fl.ejecuciones)} veces
                      </div>
                    </button>
                    <div className="flex shrink-0 gap-1.5">
                      <button onClick={() => editar(fl)} className="rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]">Abrir pizarra</button>
                      <button onClick={() => toggle(fl)} className="rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]">{fl.activo ? 'Pausar' : 'Activar'}</button>
                      <button onClick={() => duplicar(fl)} className="rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]">Duplicar</button>
                      <BotonBorrar onBorrar={() => borrar(fl.id)} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {abierto && (
        <section className="mt-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button onClick={cerrar} className="rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] hover:bg-[var(--page-plane)]">← Volver</button>
            <input value={form.nombre} onChange={(e) => setForm((f: any) => ({ ...f, nombre: e.target.value }))}
              placeholder="Nombre del automensaje" className="min-w-[200px] flex-1 rounded-md border border-[var(--border-hairline)] bg-transparent px-2.5 py-1.5 text-[13px] font-medium outline-none sm:max-w-[320px] sm:flex-none" />
            <label className="flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
              <input type="checkbox" checked={form.activo} onChange={(e) => setForm((f: any) => ({ ...f, activo: e.target.checked }))} /> Activo
            </label>
            <div className="flex-1" />
            <button onClick={() => setPrueba((p) => ({ ...p, abierta: !p.abierta }))} className="rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] hover:bg-[var(--page-plane)]">▷ Probar</button>
            <button onClick={() => guardar()} disabled={guardando} className="rounded-md px-4 py-1.5 text-[12px] font-medium text-white disabled:opacity-60" style={{ background: 'var(--series-1)' }}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>

          {avisos.length > 0 && (
            <div className="mb-3 rounded-md p-3 text-[12px]" style={{ background: 'var(--page-plane)', border: '1px solid var(--status-warning)' }}>
              <div className="mb-1 font-medium">Para activarlo falta:</div>
              <ul className="list-disc space-y-0.5 pl-5 text-[var(--text-secondary)]">{avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </div>
          )}

          {prueba.abierta && (
            <div className="tarjeta mb-3 p-3">
              <div className="mb-1 text-[13px] font-medium">Prueba en seco</div>
              <p className="mb-2 text-[11px] text-[var(--text-muted)]">Recorre el automensaje sin mandar nada ni tocar tus leads. Elegí qué haría el lead en cada bifurcación:</p>
              <div className="flex flex-wrap gap-2">
                {preguntas.map((p) => (
                  <label key={p.id} className="text-[11px]">
                    <span className="mr-1 text-[var(--text-secondary)]">❓ «{String(p.texto ?? '').slice(0, 28)}» → toca</span>
                    <select value={prueba.respuestas[p.id] ?? ''} onChange={(e) => setPrueba((x) => ({ ...x, respuestas: { ...x.respuestas, [p.id]: e.target.value } }))}
                      className="rounded border border-[var(--border-hairline)] bg-[var(--surface-1)] px-1 py-0.5">
                      <option value="">(el primero)</option>
                      {(p.opciones ?? []).map((o: any) => <option key={o.id} value={o.id}>{o.titulo || 'sin texto'}</option>)}
                    </select>
                  </label>
                ))}
                {condiciones.map((c) => (
                  <label key={c.id} className="text-[11px]">
                    <span className="mr-1 text-[var(--text-secondary)]">🔀 condición →</span>
                    <select value={prueba.respuestas[c.id] ?? 'si'} onChange={(e) => setPrueba((x) => ({ ...x, respuestas: { ...x.respuestas, [c.id]: e.target.value } }))}
                      className="rounded border border-[var(--border-hairline)] bg-[var(--surface-1)] px-1 py-0.5">
                      <option value="si">Sí</option><option value="no">No</option>
                    </select>
                  </label>
                ))}
              </div>
              <button onClick={probar} className="mt-2 rounded-md px-3 py-1.5 text-[12px] font-medium text-white" style={{ background: 'var(--series-1)' }}>▷ Probar este camino</button>
              {prueba.resultado && (
                <ol className="mt-3 space-y-1 border-t border-[var(--border-hairline)] pt-2 text-[12px]">
                  {(prueba.resultado.resultados ?? []).map((r: any, i: number) => (
                    <li key={i} className="flex gap-2"><span className="text-[var(--text-muted)]">{i + 1}.</span><span>{r.texto ?? r.paso}</span></li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {/* PIZARRA */}
          <div className="overflow-x-auto rounded-lg p-3 sm:p-5" style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>
            <div className="mx-auto w-max min-w-full">
              <div className="flex flex-col items-center">
                {/* Disparador */}
                <div className="tarjeta p-3" style={{ borderColor: 'var(--status-good)', borderWidth: 1.5, width: anchoCarta(0) }}>
                  <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--status-good)' }}>Cuando…</div>
                  <select value={form.disparo} onChange={(e) => setForm((f: any) => ({ ...f, disparo: e.target.value }))} className={`${select} mt-2`}>
                    {DISPAROS.map((d) => <option key={d.v} value={d.v}>{d.icono}  {d.t}</option>)}
                  </select>
                  {disp.palabra && (
                    <input value={form.palabra_clave ?? ''} onChange={(e) => setForm((f: any) => ({ ...f, palabra_clave: e.target.value }))}
                      placeholder={`palabra clave (${disp.ph})`} className={`${input} mt-2`} />
                  )}
                  {(form.disparo === 'comentario' || form.disparo === 'historia') && ctx.contenidos.length > 0 && (
                    <select value={form.contenido_id ?? ''} onChange={(e) => setForm((f: any) => ({ ...f, contenido_id: e.target.value }))} className={`${select} mt-2`}>
                      <option value="">en cualquier publicación</option>
                      {ctx.contenidos.filter((c: any) => c.ig_media_id).map((c: any) => <option key={c.id} value={c.id}>solo en: {String(c.titulo).slice(0, 50)}</option>)}
                    </select>
                  )}
                  <div className="mt-1.5 text-[11px] text-[var(--text-muted)]">{disp.ayuda}</div>
                  {form.disparo === 'comentario' && (
                    <div className="mt-1.5 rounded px-2 py-1 text-[11px]" style={{ background: 'var(--page-plane)' }}>
                      💡 Instagram deja mandarle <b>un solo mensaje</b> a quien comenta hasta que te responda. Por eso el primer DM conviene que sea una <b>pregunta con botón</b>: cuando lo toca, ya podés mandarle todo lo demás.
                    </div>
                  )}
                </div>

                <Secuencia pasos={form.pasos} onChange={(pasos) => setForm((f: any) => ({ ...f, pasos }))} ctx={ctx} nivel={0} />
              </div>
            </div>
          </div>

          <datalist id="etiquetas-existentes">{ctx.etiquetas.map((e) => <option key={e} value={e} />)}</datalist>
        </section>
      )}
    </div>
  );
}

function BotonBorrar({ onBorrar, chico }: { onBorrar: () => void; chico?: boolean }) {
  const [seguro, setSeguro] = useState(false);
  if (seguro) {
    return (
      <button onClick={onBorrar} onBlur={() => setSeguro(false)} autoFocus
        className={`rounded ${chico ? 'px-1.5 text-[10px]' : 'px-2 py-1 text-[11px]'} font-medium text-white`} style={{ background: 'var(--status-critical)' }}>
        ¿Borrar?
      </button>
    );
  }
  return (
    <button onClick={() => setSeguro(true)} aria-label="Borrar"
      className={`rounded ${chico ? 'px-1.5 text-[11px]' : 'border border-[var(--border-hairline)] px-2 py-1 text-[11px]'} hover:bg-[var(--page-plane)]`}
      style={{ color: 'var(--status-critical)' }}>
      {chico ? '✕' : 'Borrar'}
    </button>
  );
}

/** Menú "+" para insertar un paso. Las ramas solo al final de la secuencia. */
function Conector({ onElegir, conRamas, final }: { onElegir: (tipo: string) => void; conRamas: boolean; final?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="relative flex flex-col items-center">
      <div className="h-4 w-px" style={{ background: 'var(--baseline)' }} />
      {final ? (
        <button onClick={() => setAbierto((v) => !v)}
          className="w-full rounded-lg border border-dashed px-3 py-2 text-[12px] text-[var(--text-muted)] hover:border-[var(--series-1)] hover:text-[var(--series-1)]"
          style={{ borderColor: 'var(--baseline)', background: 'var(--surface-1)' }}>
          + Agregar paso
        </button>
      ) : (
        <button onClick={() => setAbierto((v) => !v)} title="Insertar un paso acá"
          className="relative z-10 flex h-5 w-5 items-center justify-center rounded-full border text-[12px] leading-none hover:border-[var(--series-1)]"
          style={{ background: 'var(--surface-1)', borderColor: 'var(--baseline)' }}>+</button>
      )}
      {!final && <div className="h-3 w-px" style={{ background: 'var(--baseline)' }} />}
      {abierto && (
        <div className="absolute top-8 z-30 w-[290px] rounded-lg border p-1.5 shadow-lg" style={{ background: 'var(--surface-1)', borderColor: 'var(--border-hairline)' }}>
          {GRUPOS.map((g) => (
            <div key={g} className="mb-1">
              <div className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{g}</div>
              {Object.entries(NODOS).filter(([, m]) => m.grupo === g && (conRamas || !m.ramifica)).map(([t, m]) => (
                <button key={t} onClick={() => { onElegir(t); setAbierto(false); }}
                  className="flex w-full items-start gap-2 rounded px-2 py-1 text-left hover:bg-[var(--page-plane)]">
                  <span className="w-5 text-center">{m.icono}</span>
                  <span><span className="block text-[12px]">{m.etiqueta}</span>{m.ayuda && <span className="block text-[10px] text-[var(--text-muted)]">{m.ayuda}</span>}</span>
                </button>
              ))}
            </div>
          ))}
          {!conRamas && <div className="px-2 pb-1 text-[10px] text-[var(--text-muted)]">Las preguntas y condiciones se agregan al final de un camino.</div>}
        </div>
      )}
    </div>
  );
}

function Secuencia({ pasos, onChange, ctx, nivel }: { pasos: Paso[]; onChange: (p: Paso[]) => void; ctx: Ctx; nivel: number }) {
  const ultimo = pasos[pasos.length - 1];
  const terminaEnRama = !!ultimo && !!NODOS[ultimo.tipo]?.ramifica;
  const insertar = (pos: number, tipo: string) => { const c = [...pasos]; c.splice(pos, 0, n(tipo)); onChange(c); };
  const reemplazar = (i: number, p: Paso) => onChange(pasos.map((x, k) => (k === i ? p : x)));
  const quitar = (i: number) => onChange(pasos.filter((_, k) => k !== i));
  const mover = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= pasos.length) return;
    const c = [...pasos]; [c[i], c[j]] = [c[j], c[i]]; onChange(c);
  };
  return (
    <div className="flex flex-col items-center">
      {pasos.map((p, i) => {
        const ramifica = !!NODOS[p.tipo]?.ramifica;
        const siguienteRamifica = !!NODOS[pasos[i + 1]?.tipo]?.ramifica;
        return (
          <div key={p.id} className="flex flex-col items-center">
            <Conector conRamas={false} onElegir={(t) => insertar(i, t)} />
            <Nodo paso={p} ctx={ctx} nivel={nivel}
              onChange={(np) => reemplazar(i, np)} onQuitar={() => quitar(i)}
              onSubir={!ramifica && i > 0 ? () => mover(i, -1) : undefined}
              onBajar={!ramifica && i < pasos.length - 1 && !siguienteRamifica ? () => mover(i, 1) : undefined} />
          </div>
        );
      })}
      {!terminaEnRama && (
        <div style={{ width: anchoCarta(nivel) }}>
          <Conector final conRamas={nivel < 6} onElegir={(t) => insertar(pasos.length, t)} />
        </div>
      )}
    </div>
  );
}

function Nodo({ paso: p, onChange, onQuitar, onSubir, onBajar, ctx, nivel }: {
  paso: Paso; onChange: (p: Paso) => void; onQuitar: () => void;
  onSubir?: () => void; onBajar?: () => void; ctx: Ctx; nivel: number;
}) {
  const m = NODOS[p.tipo] ?? { etiqueta: p.tipo, icono: '•', color: 'var(--baseline)', grupo: 'Lógica', ayuda: '' };
  const set = (k: string, v: any) => onChange({ ...p, [k]: v });
  return (
    <div className="flex flex-col items-center">
      <div className="tarjeta p-3" style={{ borderLeft: `3px solid ${m.color}`, width: anchoCarta(nivel) }}>
        <div className="flex items-center justify-between gap-2">
          <div className="text-[12px] font-medium">{m.icono} {m.etiqueta}</div>
          <div className="flex shrink-0 gap-0.5">
            {onSubir && <button onClick={onSubir} className="rounded px-1.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--page-plane)]" aria-label="Subir">↑</button>}
            {onBajar && <button onClick={onBajar} className="rounded px-1.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--page-plane)]" aria-label="Bajar">↓</button>}
            <BotonBorrar chico onBorrar={onQuitar} />
          </div>
        </div>
        <CamposNodo p={p} set={set} onChange={onChange} ctx={ctx} />
      </div>

      {p.tipo === 'pregunta' && (
        <Ramas nivel={nivel} ramas={(p.opciones ?? []).map((o: any, j: number) => ({
          id: o.id, titulo: `👉 Si toca «${o.titulo || `botón ${j + 1}`}»`, pasos: o.pasos ?? [],
          onChange: (pasos: Paso[]) => onChange({ ...p, opciones: p.opciones.map((x: any) => (x.id === o.id ? { ...x, pasos } : x)) }),
        }))} ctx={ctx} />
      )}
      {p.tipo === 'condicion' && (
        <Ramas nivel={nivel} ctx={ctx} ramas={[
          { id: 'si', titulo: '✅ Sí', pasos: p.si ?? [], onChange: (pasos: Paso[]) => onChange({ ...p, si: pasos }) },
          { id: 'no', titulo: '❌ No', pasos: p.no ?? [], onChange: (pasos: Paso[]) => onChange({ ...p, no: pasos }) },
        ]} />
      )}
    </div>
  );
}

function Ramas({ ramas, ctx, nivel }: { ramas: Array<{ id: string; titulo: string; pasos: Paso[]; onChange: (p: Paso[]) => void }>; ctx: Ctx; nivel: number }) {
  return (
    <div className="relative mt-0 flex flex-col items-center">
      <div className="h-4 w-px" style={{ background: 'var(--baseline)' }} />
      <div className="flex gap-3">
        {ramas.map((r) => (
          <div key={r.id} className="w-max shrink-0 rounded-lg border border-dashed p-2" style={{ borderColor: 'var(--baseline)' }}>
            <div className="text-center text-[11px] font-semibold text-[var(--text-secondary)]">{r.titulo}</div>
            <Secuencia pasos={r.pasos} onChange={r.onChange} ctx={ctx} nivel={nivel + 1} />
          </div>
        ))}
      </div>
    </div>
  );
}

function CamposNodo({ p, set, onChange, ctx }: { p: Paso; set: (k: string, v: any) => void; onChange: (p: Paso) => void; ctx: Ctx }) {
  switch (p.tipo) {
    case 'enviar_dm':
      return (
        <div className="mt-2">
          <textarea value={p.texto ?? ''} onChange={(e) => set('texto', e.target.value)} rows={3} placeholder="Hola {{nombre}} 👋 …"
            className={`${input} resize-y`} />
          <div className="mt-0.5 flex items-center justify-between text-[10px] text-[var(--text-muted)]">
            <button onClick={() => set('texto', `${p.texto ?? ''}{{nombre}}`)} className="underline">+ nombre del lead</button>
            <span style={{ color: (p.texto ?? '').length > MAX_TEXTO ? 'var(--status-critical)' : undefined }}>{(p.texto ?? '').length}/{MAX_TEXTO}</span>
          </div>
        </div>
      );
    case 'responder_comentario':
    case 'notificar':
      return <input value={p.texto ?? ''} onChange={(e) => set('texto', e.target.value)} className={`${input} mt-2`}
        placeholder={p.tipo === 'notificar' ? 'Qué tiene que saber el equipo' : '¡Te lo mandé por DM! 📩'} />;
    case 'enviar_recurso': {
      const lista = ctx.recursos.filter((r) => r.tipo !== 'texto');
      return (
        <div className="mt-2">
          <select value={p.recurso_id ?? ''} onChange={(e) => set('recurso_id', e.target.value)} className={select}>
            <option value="">Elegí qué mandar…</option>
            {lista.map((r) => <option key={r.id} value={r.id}>{r.tipo === 'audio' ? '🎙️' : r.tipo === 'pdf' ? '📄' : r.tipo === 'imagen' ? '🖼️' : r.tipo === 'video' ? '🎬' : '🔗'} {r.nombre}</option>)}
          </select>
          {lista.length === 0 && <div className="mt-1 text-[10px] text-[var(--text-muted)]">No tenés recursos todavía: grabalos en Chat → 🎙️ Recursos.</div>}
        </div>
      );
    }
    case 'etiquetar':
    case 'quitar_etiqueta':
      return <input value={p.etiqueta ?? ''} onChange={(e) => set('etiqueta', e.target.value)} list="etiquetas-existentes" placeholder="ej. pidió-guía" className={`${input} mt-2`} />;
    case 'mover_etapa':
      return (
        <select value={p.etapa_slug ?? ''} onChange={(e) => set('etapa_slug', e.target.value)} className={`${select} mt-2`}>
          <option value="">Elegí la etapa…</option>
          {ctx.etapas.map((e) => <option key={e.slug} value={e.slug}>{e.nombre}</option>)}
        </select>
      );
    case 'asignar':
      return (
        <select value={p.rol ?? ''} onChange={(e) => set('rol', e.target.value)} className={`${select} mt-2`}>
          <option value="">A quien tenga menos leads</option>
          <option value="setter">A un setter</option>
          <option value="closer">A un closer</option>
        </select>
      );
    case 'webhook':
      return <input value={p.url ?? ''} onChange={(e) => set('url', e.target.value)} placeholder="https://hook.make.com/…" className={`${input} mt-2`} />;
    case 'esperar': {
      const min = Number(p.minutos) || 0;
      const unidad = min && min % 1440 === 0 ? 1440 : min && min % 60 === 0 ? 60 : 1;
      return (
        <div className="mt-2 flex gap-2">
          <input type="number" min={1} value={min ? min / unidad : ''} onChange={(e) => set('minutos', Math.max(0, Number(e.target.value)) * unidad)} className={`${input} w-24`} placeholder="1" />
          <select value={unidad} onChange={(e) => set('minutos', (min ? min / unidad : 1) * Number(e.target.value))} className={select}>
            <option value={1}>minutos</option><option value={60}>horas</option><option value={1440}>días</option>
          </select>
        </div>
      );
    }
    case 'esperar_respuesta':
      return (
        <div className="mt-2">
          <select value={p.guardar_en ?? ''} onChange={(e) => set('guardar_en', e.target.value)} className={select}>
            <option value="">Solo esperar (no guardar nada)</option>
            <option value="email">Guardar lo que escribe como su EMAIL</option>
            <option value="telefono">Guardar como su TELÉFONO</option>
            <option value="nombre">Guardar como su NOMBRE</option>
            <option value="nota">Guardarlo como nota en su ficha</option>
          </select>
          <div className="mt-1 text-[10px] text-[var(--text-muted)]">El automensaje se pausa acá hasta que el lead escriba, aunque pasen horas.</div>
        </div>
      );
    case 'pregunta': {
      const opciones = p.opciones ?? [];
      return (
        <div className="mt-2 space-y-1.5">
          <textarea value={p.texto ?? ''} onChange={(e) => set('texto', e.target.value)} rows={2} placeholder="¿Te paso la guía?" className={`${input} resize-y`} />
          {opciones.map((o: any, j: number) => (
            <div key={o.id} className="flex items-center gap-1.5">
              <span className="text-[11px] text-[var(--text-muted)]">{j + 1}.</span>
              <input value={o.titulo} maxLength={MAX_TITULO} placeholder={`Botón ${j + 1}`}
                onChange={(e) => onChange({ ...p, opciones: opciones.map((x: any) => (x.id === o.id ? { ...x, titulo: e.target.value } : x)) })}
                className={`${input} flex-1`} />
              <span className="w-9 text-right text-[10px] text-[var(--text-muted)]">{o.titulo.length}/{MAX_TITULO}</span>
              {opciones.length > 1 && (
                <button onClick={() => onChange({ ...p, opciones: opciones.filter((x: any) => x.id !== o.id) })}
                  className="rounded px-1 text-[11px]" style={{ color: 'var(--status-critical)' }} aria-label="Quitar botón">✕</button>
              )}
            </div>
          ))}
          {opciones.length < MAX_BOTONES && (
            <button onClick={() => onChange({ ...p, opciones: [...opciones, { id: uid(), titulo: '', pasos: [] }] })}
              className="text-[11px] underline text-[var(--text-secondary)]">+ otro botón ({opciones.length}/{MAX_BOTONES})</button>
          )}
          <div className="text-[10px] text-[var(--text-muted)]">Si escribe en vez de tocar, igual se entiende si coincide con un botón.</div>
        </div>
      );
    }
    case 'condicion':
      return (
        <div className="mt-2 space-y-1.5">
          <select value={p.campo ?? 'etiqueta'} onChange={(e) => onChange({ ...p, campo: e.target.value, valor: '' })} className={select}>
            <option value="etiqueta">¿Tiene la etiqueta…?</option>
            <option value="etapa">¿Está en la etapa…?</option>
            <option value="texto">¿Su mensaje dice…?</option>
            <option value="email">¿Ya tenemos su email?</option>
            <option value="telefono">¿Ya tenemos su teléfono?</option>
          </select>
          {p.campo === 'etapa' ? (
            <select value={p.valor ?? ''} onChange={(e) => set('valor', e.target.value)} className={select}>
              <option value="">Elegí la etapa…</option>
              {ctx.etapas.map((e) => <option key={e.slug} value={e.slug}>{e.nombre}</option>)}
            </select>
          ) : (p.campo === 'etiqueta' || p.campo === 'texto' || !p.campo) ? (
            <input value={p.valor ?? ''} onChange={(e) => set('valor', e.target.value)} list={p.campo === 'texto' ? undefined : 'etiquetas-existentes'}
              placeholder={p.campo === 'texto' ? 'ej. precio, cuánto' : 'ej. cliente'} className={input} />
          ) : null}
        </div>
      );
    default:
      return null;
  }
}
