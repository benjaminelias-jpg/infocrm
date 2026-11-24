import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, fmtNum, hace, plural } from '../api';
import Cabecera from '../componentes/Cabecera';
import { DISPAROS, NODOS, arbolAGrafo, conVariables, uid, type Ctx, type Paso } from '../componentes/pizarra/modelo';
import Automatizaciones from './Automatizaciones';
import GuiaInstagram from '../componentes/integraciones/GuiaInstagram';
import MenuChat from '../componentes/MenuChat';
import Icono from '../componentes/Iconos';
import {
  Banner, Boton, BotonFlotante, Buscador, Carrusel, Chip, Desplegable, Dialogo, Entrada, ErrorCarga, EsqueletoPantalla,
  FilaChips, Girando, Insignia, Interruptor, ItemMenu, Menu, Pestanas, SeparadorMenu, TituloSeccion, Vacio, useAviso, useEsMovil, useParamUrl,
} from '../ui';

// El lienzo (React Flow, lo más pesado de la app) se descarga recién al abrir
// un automensaje: la lista abre rápido, sobre todo en el celular.
const cargarPizarra = () => import('../componentes/Pizarra');
const Pizarra = lazy(cargarPizarra);
/** Con la lista ya a la vista, se baja la pizarra sin apuro (abrir un automensaje queda instantáneo). */
function usePrecargarPizarra() {
  useEffect(() => {
    const w = window as any;
    const id = typeof w.requestIdleCallback === 'function' ? w.requestIdleCallback(() => { cargarPizarra().catch(() => {}); }, { timeout: 5000 }) : w.setTimeout(() => { cargarPizarra().catch(() => {}); }, 3000);
    return () => { if (typeof w.cancelIdleCallback === 'function') w.cancelIdleCallback(id); else w.clearTimeout(id); };
  }, []);
}

// =====================================================================
// Automensajes: tu ManyChat propio. Lista de automensajes + plantillas, y
// cada automensaje con su URL (/flujos/<id>, /flujos/nuevo?plantilla=…)
// para que Atrás y recargar funcionen. Probar NO guarda ni activa nada.
// =====================================================================

type NodoArbol = { tipo: string; [k: string]: any };
const n = (tipo: string, datos: Record<string, any> = {}): NodoArbol => ({ id: uid(), tipo, ...datos });
const op = (titulo: string, pasos: NodoArbol[] = []) => ({ id: uid(), titulo, pasos });

interface Plantilla {
  slug: string; nombre: string; icono: string; disparo: string; palabra_clave: string; desc: string;
  /** Qué tenés que tener para que funcione. */
  requiere?: 'audio' | 'pdf';
  pasos: () => NodoArbol[];
}

const PLANTILLAS: Plantilla[] = [
  {
    slug: 'recurso-por-comentario', nombre: 'Recurso por comentario', icono: '📄', disparo: 'comentario', palabra_clave: 'GUIA', requiere: 'pdf',
    desc: 'Comentan GUIA → respondés el comentario y por DM le preguntás; al tocar el botón le llega la guía.',
    pasos: () => [
      n('responder_comentario', { texto: '¡Te lo mandé por DM! 📩' }),
      n('pregunta', { texto: '¡Hola {{nombre}}! 👋 ¿Te paso la guía?', opciones: [op('¡Sí, pasámela!', [
        n('enviar_recurso', { recurso_id: '', _prefiere: 'pdf' }),
        n('etiquetar', { etiqueta: 'pidió-guía' }),
        n('mover_etapa', { etapa_slug: '', _prefiere: 'conversa|interesad' }),
      ])] }),
    ],
  },
  {
    slug: 'audio-y-agendar', nombre: 'Audio del founder + agendar', icono: '🎙️', disparo: 'comentario', palabra_clave: 'QUIERO', requiere: 'audio',
    desc: 'Le mandás tu audio y le proponés una llamada. Si dice que no, le hacés seguimiento al día siguiente.',
    pasos: () => [
      n('responder_comentario', { texto: '¡Te escribí por DM! 🙌' }),
      n('pregunta', { texto: '¡Hola {{nombre}}! ¿Te mando un audio contándote cómo funciona?', opciones: [op('Sí, dale 🙌', [
        n('enviar_recurso', { recurso_id: '', _prefiere: 'audio' }),
        n('pregunta', { texto: '¿Querés que agendemos una llamada corta para ver tu caso?', opciones: [
          op('Sí, agendemos', [n('enviar_dm', { texto: 'Elegí el horario que te quede cómodo 👉 https://' }), n('mover_etapa', { etapa_slug: '', _prefiere: 'llamada|reuni|agend' }), n('notificar', { texto: 'Quiere agendar llamada' })]),
          // 22 h (no 1 día): Instagram solo deja escribir dentro de las 24 h desde su último mensaje.
          op('Ahora no', [n('etiquetar', { etiqueta: 'seguimiento' }), n('esperar', { minutos: 1320 }), n('enviar_dm', { texto: '¡Hola {{nombre}}! ¿Pudiste escuchar el audio? Cualquier duda acá estoy 🙌' })]),
        ] }),
      ])] }),
    ],
  },
  {
    slug: 'calificar', nombre: 'Calificar al lead', icono: '🎯', disparo: 'dm', palabra_clave: 'INFO',
    desc: 'Le preguntás en qué etapa está y según lo que toca va a un camino distinto (el que factura, directo al closer).',
    pasos: () => [
      n('pregunta', { texto: '¡Gracias por escribir, {{nombre}}! Para ayudarte mejor: ¿en qué etapa estás?', opciones: [
        op('Recién empiezo', [n('etiquetar', { etiqueta: 'principiante' }), n('enviar_dm', { texto: '¡Genial! Te dejo por dónde arrancar 👇' })]),
        op('Ya facturo', [n('etiquetar', { etiqueta: 'factura' }), n('asignar', { rol: 'setter' }), n('notificar', { texto: 'Lead que ya factura' })]),
        op('Quiero escalar', [n('etiquetar', { etiqueta: 'high-ticket' }), n('asignar', { rol: 'closer' }), n('mover_etapa', { etapa_slug: '', _prefiere: 'conversa|interesad' }), n('notificar', { texto: 'Lead caliente: quiere escalar' })]),
      ] }),
    ],
  },
  {
    slug: 'clase-email', nombre: 'Clase gratis pidiendo email', icono: '🎥', disparo: 'comentario', palabra_clave: 'CLASE',
    desc: 'Le pedís el email, esperás su respuesta, lo guardás en su ficha y le mandás la clase.',
    pasos: () => [
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
    slug: 'historias', nombre: 'Respuesta a historias', icono: '⭕', disparo: 'historia', palabra_clave: '',
    desc: 'Cada vez que alguien responde una historia, le contestás al instante y avisás al setter.',
    pasos: () => [
      n('enviar_dm', { texto: '¡Gracias por responder, {{nombre}}! 🙌 ¿Qué te gustaría lograr?' }),
      n('notificar', { texto: 'Respondió una historia' }),
    ],
  },
  {
    slug: 'venta-link', nombre: 'Venta directa con link', icono: '💳', disparo: 'dm', palabra_clave: 'PRECIO, LINK',
    desc: 'Te piden el precio por DM → le mandás el link de pago y avisás al equipo.',
    pasos: () => [
      n('enviar_dm', { texto: '¡Hola {{nombre}}! Te paso todo 👇\n\nCurso: …\nPrecio: …\nLink de pago: https://' }),
      n('etiquetar', { etiqueta: 'pidió-precio' }),
      n('notificar', { texto: 'Pidió el precio: hacer seguimiento' }),
    ],
  },
];

const NOMBRE_REQUISITO = { audio: 'un audio 🎙️', pdf: 'una guía en PDF 📄' } as const;

function contarPasos(pasos: any[]): number {
  return (pasos ?? []).reduce((s: number, p: any) => s + (p.tipo === 'inicio' ? 0 : 1)
    + (p.tipo === 'pregunta' ? (p.opciones ?? []).reduce((a: number, o: any) => a + contarPasos(o.pasos ?? []), 0) : 0), 0);
}

const pasosVacios = (): Paso[] => [{ id: 'inicio', tipo: 'inicio', x: 0, y: 0, siguiente: null }];
// Todo automensaje nuevo nace EN PAUSA: se activa a propósito.
const flujoVacio = () => ({ nombre: '', disparo: 'comentario', palabra_clave: '', contenido_id: '', activo: false, pasos: pasosVacios() });

const PREFIJO_BORRADOR = 'infocrm_borrador_flujo_';
function leerBorradores(): Array<{ clave: string; nombre: string; en: number }> {
  const out: Array<{ clave: string; nombre: string; en: number }> = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(PREFIJO_BORRADOR)) continue;
      const b = JSON.parse(localStorage.getItem(k) ?? 'null');
      if (b?.form) out.push({ clave: k.slice(PREFIJO_BORRADOR.length), nombre: b.form.nombre || 'Sin nombre', en: Number(b.en) || 0 });
    }
  } catch { /* sin almacenamiento */ }
  return out.sort((a, b) => b.en - a.en);
}
function borrarBorrador(clave: string) { try { localStorage.removeItem(PREFIJO_BORRADOR + clave); } catch { /* sin almacenamiento */ } }

/** Palabras clave normalizadas para detectar choques entre automensajes activos. */
function palabras(f: any): string[] {
  return String(f.palabra_clave ?? '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
}

export default function Flujos() {
  usePrecargarPizarra();
  const { flujoId } = useParams();
  const [params] = useSearchParams();
  const navegar = useNavigate();
  const aviso = useAviso();
  const movil = useEsMovil(768);
  const [tab, setTab] = useParamUrl<'flujos' | 'manychat'>('tab', 'flujos');

  const [flujos, setFlujos] = useState<any[] | null>(null);
  const [ctx, setCtx] = useState<Ctx>({ recursos: [], etapas: [], etiquetas: [], contenidos: [] });
  const [ig, setIg] = useState<any>(null);
  const [error, setError] = useState<Error | null>(null);
  const [guiaIg, setGuiaIg] = useState(false);
  const [nuevo, setNuevo] = useState(false);
  const [borradores, setBorradores] = useState(leerBorradores);

  const cargar = useCallback(async () => {
    try {
      const [f, rec, pipes, et, cont, est, campos] = await Promise.all([
        api<any[]>('/flujos'),
        api<any[]>('/recursos').catch(() => []),
        api<any[]>('/pipelines').catch(() => []),
        api<any[]>('/etiquetas').catch(() => []),
        api<any>('/contenidos').catch(() => []),
        api<any>('/instagram/estado').catch(() => null),
        api<string[]>('/ux/automensajes/campos').catch(() => []),
      ]);
      setFlujos(f);
      // Todas las etapas, con su pipeline (el predeterminado primero).
      const etapas: any[] = [];
      for (const p of [...pipes].sort((a, b) => Number(b.es_predeterminado) - Number(a.es_predeterminado))) {
        for (const e of p.etapas ?? []) etapas.push({ ...e, pipeline: p.nombre, predeterminado: p.es_predeterminado });
      }
      setCtx({
        recursos: rec, etapas,
        etiquetas: (et ?? []).map((x: any) => (typeof x === 'string' ? x : x.etiqueta ?? x.nombre)).filter(Boolean),
        contenidos: Array.isArray(cont) ? cont : cont?.contenidos ?? [],
        campos,
        recargarRecursos: async () => {
          const r = await api<any[]>('/recursos');
          setCtx((c) => ({ ...c, recursos: r }));
          return r;
        },
      });
      setIg(est);
      setError(null);
    } catch (e: any) { setError(e); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { if (!flujoId) setBorradores(leerBorradores()); }, [flujoId]);

  const igDesconectado = ig && !ig.conectado;
  const bannerIg = igDesconectado ? (
    <Banner tono="aviso" icono="⚠" accion={<Boton tamano="sm" variante="primario" onClick={() => setGuiaIg(true)}>Conectar Instagram</Boton>}>
      <b>Instagram no está conectado:</b> tus automensajes todavía no responden.
    </Banner>
  ) : null;
  const dialogoIg = (
    <Dialogo abierto={guiaIg} onCerrar={() => { setGuiaIg(false); cargar(); }} titulo="Instagram" ancho={580} autoFoco={false}
      descripcion="Conectalo para que tus automensajes respondan solos.">
      {guiaIg && <GuiaInstagram ig={ig} onCambio={cargar} />}
    </Dialogo>
  );

  if (error && !flujos) {
    return <div className="px-4 py-8"><ErrorCarga error={error} titulo="No pudimos cargar tus automensajes" onReintentar={cargar} /></div>;
  }
  if (!flujos) return <div className="px-4 py-5 lg:px-8"><EsqueletoPantalla tarjetas={3} filas={4} /></div>;

  if (flujoId) {
    return (
      <>
        <Editor key={`${flujoId}|${params.get('plantilla') ?? ''}`} flujoId={flujoId} flujos={flujos} ctx={ctx} ig={ig}
          plantilla={params.get('plantilla')} probarAlAbrir={params.get('probar') === '1'} borradorAlAbrir={params.get('borrador') === '1'}
          bannerIg={bannerIg} onCambio={cargar} />
        {dialogoIg}
      </>
    );
  }

  // ---------------- Lista ----------------
  return (
    <div className="px-4 py-5 lg:px-8">
      <Cabecera titulo="Automensajes" subtitulo="Tu ManyChat propio: armá tus automensajes en una pizarra libre y el CRM responde solo." />
      <Pestanas className="mt-3" actual={tab} onCambiar={setTab}
        pestanas={[{ id: 'flujos', etiqueta: 'Mis automensajes', contador: flujos.length }, { id: 'manychat', etiqueta: 'Palabras de ManyChat' }]} />

      {tab === 'manychat' ? (
        <div className="mt-3">
          <p className="mb-2 text-[13px] text-[var(--text-secondary)]">
            ¿Seguís usando ManyChat? Acá unís cada palabra clave con su reel, para saber de qué contenido viene cada lead.
            Los automensajes del CRM no lo necesitan: ya saben de qué reel vino cada uno.
          </p>
          <Automatizaciones embebido />
        </div>
      ) : (
        <ListaAutomensajes flujos={flujos} ctx={ctx} ig={ig} bannerIg={bannerIg} borradores={borradores}
          onDescartarBorrador={(clave) => { borrarBorrador(clave); setBorradores(leerBorradores()); }}
          onNuevo={() => setNuevo(true)} onCambio={cargar} />
      )}

      <Dialogo abierto={nuevo} onCerrar={() => setNuevo(false)} titulo="Nuevo automensaje" ancho={720} autoFoco={false}
        descripcion="Empezá con una plantilla (la ajustás en 1 minuto) o desde una pizarra en blanco.">
        <ElegirComienzo ctx={ctx} onElegir={(slug) => { setNuevo(false); navegar(slug ? `/flujos/nuevo?plantilla=${slug}` : '/flujos/nuevo'); }} />
      </Dialogo>
      {movil && tab === 'flujos' && <BotonFlotante etiqueta="Nuevo automensaje" onClick={() => setNuevo(true)} />}
      {dialogoIg}
    </div>
  );
}

// ---------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------

function ListaAutomensajes({ flujos, ctx, ig, bannerIg, borradores, onDescartarBorrador, onNuevo, onCambio }: {
  flujos: any[]; ctx: Ctx; ig: any; bannerIg: React.ReactNode;
  borradores: Array<{ clave: string; nombre: string; en: number }>;
  onDescartarBorrador: (clave: string) => void; onNuevo: () => void; onCambio: () => Promise<void> | void;
}) {
  const [menuChat, setMenuChat] = useState(false);
  const navegar = useNavigate();
  const aviso = useAviso();
  const [filtro, setFiltro] = useState<'todos' | 'activos' | 'pausa'>('todos');
  const [q, setQ] = useState('');
  const activos = flujos.filter((f) => f.activo).length;

  // Choques: dos automensajes activos que responden a lo mismo (solo contesta el más viejo).
  const choques = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const f of flujos.filter((x) => x.activo)) {
      for (const p of palabras(f).length ? palabras(f) : ['*']) {
        const k = `${f.disparo}|${p}|${f.contenido_id ?? '*'}`;
        m.set(k, [...(m.get(k) ?? []), f.id]);
      }
    }
    const conChoque = new Set<string>();
    for (const ids of m.values()) if (ids.length > 1) ids.forEach((id) => conChoque.add(id));
    return conChoque;
  }, [flujos]);

  const visibles = flujos.filter((f) => (filtro === 'todos' || (filtro === 'activos' ? f.activo : !f.activo))
    && (!q.trim() || `${f.nombre} ${f.palabra_clave ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())));

  async function cambiarActivo(fl: any, activo: boolean) {
    try {
      const r = await api<any>(`/flujos/${fl.id}`, { method: 'PATCH', json: { activo } });
      if (activo && !r.activo) {
        aviso.error(<>«{fl.nombre}» no se puede activar todavía: {r.avisos?.[0] ?? 'le falta completar algo'}</>, { texto: 'Abrir', onClick: () => navegar(`/flujos/${fl.id}`) });
      } else aviso.exito(activo ? `«${fl.nombre}» está activo` : `«${fl.nombre}» quedó en pausa`);
      await onCambio();
    } catch (e: any) { aviso.error(e.message); }
  }
  async function duplicar(fl: any) {
    try {
      const c = await api<any>(`/flujos/${fl.id}/duplicar`, { method: 'POST' });
      await onCambio();
      aviso.exito(`Copia creada (en pausa): «${c.nombre}»`, { texto: 'Abrir', onClick: () => navegar(`/flujos/${c.id}`) });
    } catch (e: any) { aviso.error(e.message); }
  }
  async function borrar(fl: any) {
    try { await api(`/flujos/${fl.id}`, { method: 'DELETE' }); await onCambio(); aviso.exito(`«${fl.nombre}» borrado`); } catch (e: any) { aviso.error(e.message); }
  }

  const plantillas = (
    <Carrusel etiqueta="Plantillas" anchoItem="min(80vw, 280px)">
      {PLANTILLAS.map((p) => <TarjetaPlantilla key={p.slug} p={p} ctx={ctx} onElegir={() => navegar(`/flujos/nuevo?plantilla=${p.slug}`)} />)}
    </Carrusel>
  );

  return (
    <div className="mt-4 space-y-4">
      {bannerIg}
      {borradores.map((b) => (
        <Banner key={b.clave} tono="info" icono="📝"
          accion={<>
            <Boton tamano="sm" variante="fantasma" onClick={() => onDescartarBorrador(b.clave)}>Descartar</Boton>
            <Boton tamano="sm" variante="primario" onClick={() => navegar(b.clave.startsWith('nuevo')
              ? `/flujos/nuevo?${b.clave.slice(6) ? `plantilla=${b.clave.slice(6)}&` : ''}borrador=1`
              : `/flujos/${b.clave}?borrador=1`)}>Seguir editando</Boton>
          </>}>
          Quedaron cambios sin guardar en <b>«{b.nombre}»</b> {b.en ? `(${hace(new Date(b.en).toISOString())})` : ''}.
        </Banner>
      ))}

      {flujos.length === 0 ? (
        <>
          <Vacio icono="⚡" titulo="Todavía no tenés automensajes" texto="Elegí una plantilla: en 1 minuto tenés uno andando."
            accion={<Boton variante="primario" onClick={onNuevo}>+ Nuevo automensaje</Boton>} />
          <div>
            <h2 className="mb-2 text-[13px] font-semibold">Plantillas para empezar rápido</h2>
            {plantillas}
          </div>
        </>
      ) : (
        <>
          <section>
            <TituloSeccion titulo="Tus automensajes" subtitulo={`${plural(activos, 'activo')} de ${fmtNum(flujos.length)}`} onMas={onNuevo} textoMas="Nuevo"
              derecha={<Boton tamano="sm" variante="secundario" onClick={() => setMenuChat(true)}>☰ Menú del chat</Boton>} />
            <MenuChat abierto={menuChat} onCerrar={() => setMenuChat(false)}
              palabras={[...new Set(flujos.filter((f: any) => f.disparo === 'boton' && f.palabra_clave).flatMap((f: any) => String(f.palabra_clave).split(',').map((x: string) => x.trim().toUpperCase()).filter(Boolean)))]} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <FilaChips>
                <Chip activo={filtro === 'todos'} onClick={() => setFiltro('todos')} contador={flujos.length}>Todos</Chip>
                <Chip activo={filtro === 'activos'} onClick={() => setFiltro('activos')} contador={activos}>Activos</Chip>
                <Chip activo={filtro === 'pausa'} onClick={() => setFiltro('pausa')} contador={flujos.length - activos}>En pausa</Chip>
              </FilaChips>
              {flujos.length > 5 && <Buscador valor={q} onCambiar={setQ} placeholder="Buscar por nombre o palabra" className="w-full sm:ml-auto sm:w-[240px]" />}
            </div>
            <div className="mt-2 space-y-2">
              {visibles.map((fl) => (
                <FilaAutomensaje key={fl.id} fl={fl} ig={ig} choque={choques.has(fl.id)}
                  onAbrir={() => navegar(`/flujos/${fl.id}`)} onProbar={() => navegar(`/flujos/${fl.id}?probar=1`)}
                  onActivo={(v) => cambiarActivo(fl, v)} onDuplicar={() => duplicar(fl)} onBorrar={() => borrar(fl)} />
              ))}
              {visibles.length === 0 && <Vacio compacto icono="🔎" titulo="Ninguno coincide" texto="Probá con otro filtro o búsqueda." />}
            </div>
          </section>
          <Desplegable clave="automensajes_plantillas" titulo={`Plantillas para empezar rápido (${PLANTILLAS.length})`}
            subtitulo="Recurso por comentario, audio + agendar, calificar, clase gratis…">
            {plantillas}
          </Desplegable>
        </>
      )}
    </div>
  );
}

function FilaAutomensaje({ fl, ig, choque, onAbrir, onProbar, onActivo, onDuplicar, onBorrar }: {
  fl: any; ig: any; choque: boolean; onAbrir: () => void; onProbar: () => void;
  onActivo: (v: boolean) => void; onDuplicar: () => void; onBorrar: () => void;
}) {
  const [seguro, setSeguro] = useState(false);
  const d = DISPAROS.find((x) => x.v === fl.disparo);
  const ps = palabras(fl);
  return (
    <div className="tarjeta flex items-center gap-3 px-3 py-2.5 hover:shadow-md" role="button" tabIndex={0} onClick={onAbrir}
      onKeyDown={(e) => { if (e.key === 'Enter') onAbrir(); }} style={{ cursor: 'pointer' }}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[14px] font-semibold">{fl.nombre}</span>
          {fl.activo && ig && !ig.conectado && <Insignia tono="amarillo">Esperando Instagram</Insignia>}
          {choque && <Insignia tono="amarillo">Palabra repetida</Insignia>}
          {Number(fl.errores_7d) > 0 && <Insignia tono="rojo">{plural(fl.errores_7d, 'falló', 'fallaron')}</Insignia>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
          <span>{d?.icono} {d?.t ?? fl.disparo}</span>
          {ps.map((p) => <Insignia key={p} tono="azul">{p}</Insignia>)}
          {fl.contenido_titulo && <span className="max-w-[200px] truncate">· solo en «{fl.contenido_titulo}»</span>}
          <span className="sm:ml-auto">
            {Number(fl.ejecuciones) > 0 ? `${plural(fl.ejecuciones, 'vez', 'veces')}${fl.ultima_ejecucion ? ` · última ${hace(fl.ultima_ejecucion)}` : ''}` : 'Todavía no corrió'}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <Interruptor activo={fl.activo} onCambiar={onActivo} etiqueta={<span className="hidden sm:inline">{fl.activo ? 'Activo' : 'En pausa'}</span>} />
        <Menu alinear="derecha" ancho={220} disparador={({ alternar, ref, abierto }) => (
          <button ref={ref} type="button" onClick={alternar} aria-label="Más acciones" aria-expanded={abierto}
            className="ui-foco flex h-9 w-9 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--page-plane)]">
            <Icono nombre="puntos" tam={18} />
          </button>
        )}>
          <ItemMenu icono="✏️" onClick={onAbrir}>Abrir la pizarra</ItemMenu>
          <ItemMenu icono="▷" onClick={onProbar}>Probar</ItemMenu>
          <ItemMenu icono="⧉" onClick={onDuplicar}>Duplicar</ItemMenu>
          <SeparadorMenu />
          <ItemMenu icono="🗑" peligro cerrarAlTocar={seguro} onClick={() => { if (seguro) onBorrar(); else setSeguro(true); }}>
            {seguro ? '¿Seguro? Tocá de nuevo' : 'Borrar'}
          </ItemMenu>
        </Menu>
      </div>
    </div>
  );
}

function TarjetaPlantilla({ p, ctx, onElegir }: { p: Plantilla; ctx: Ctx; onElegir: () => void }) {
  const d = DISPAROS.find((x) => x.v === p.disparo);
  const tiene = !p.requiere || ctx.recursos.some((r) => r.tipo === p.requiere);
  return (
    <button type="button" onClick={onElegir} className="tarjeta ui-foco flex h-full w-full flex-col gap-1.5 p-3 text-left hover:border-[var(--series-1)]">
      <div className="text-[22px]" aria-hidden>{p.icono}</div>
      <div className="text-[14px] font-semibold">{p.nombre}</div>
      <div className="line-clamp-2 text-[12px] leading-snug text-[var(--text-muted)]">{p.desc}</div>
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1 text-[11px] text-[var(--text-muted)]">
        <span>{d?.icono} {p.palabra_clave ? `«${p.palabra_clave}»` : d?.t}</span>
        <span>· {plural(contarPasos(p.pasos()), 'paso')}</span>
        {p.requiere && <Insignia tono={tiene ? 'neutro' : 'amarillo'}>{tiene ? `Usa ${NOMBRE_REQUISITO[p.requiere]}` : `Necesitás ${NOMBRE_REQUISITO[p.requiere]}`}</Insignia>}
      </div>
    </button>
  );
}

function ElegirComienzo({ ctx, onElegir }: { ctx: Ctx; onElegir: (slug: string | null) => void }) {
  return (
    <div className="space-y-3">
      <button type="button" onClick={() => onElegir(null)}
        className="tarjeta ui-foco flex w-full items-center gap-3 p-3 text-left hover:border-[var(--series-1)]">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl text-[20px]" style={{ background: 'var(--page-plane)' }} aria-hidden>＋</span>
        <span><span className="block text-[14px] font-semibold">Pizarra en blanco</span><span className="block text-[12px] text-[var(--text-muted)]">Lo armás vos paso a paso.</span></span>
      </button>
      <div className="grid gap-2 sm:grid-cols-2">
        {PLANTILLAS.map((p) => <TarjetaPlantilla key={p.slug} p={p} ctx={ctx} onElegir={() => onElegir(p.slug)} />)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------

/** Completa los huecos de una plantilla con TUS recursos y etapas (solo del tipo que pide). */
function prepararPlantilla(pasos: any[], ctx: Ctx): any[] {
  const fijar = (lista: any[]): any[] => lista.map((p0) => {
    const p = { ...p0 };
    if (p.tipo === 'enviar_recurso' && !p.recurso_id) {
      // Solo el tipo pedido: si no tenés un audio, NO se pone el link del calendario "en su lugar".
      const r = ctx.recursos.find((x) => x.tipo === (p._prefiere === 'audio' ? 'audio' : 'pdf'));
      p.recurso_id = r?.id ?? '';
    }
    if (p.tipo === 'mover_etapa' && !p.etapa_slug) {
      const re = new RegExp(p._prefiere ?? 'conversa', 'i');
      const e = ctx.etapas.find((x) => x.predeterminado && re.test(`${x.nombre} ${x.slug}`)) ?? ctx.etapas.find((x) => re.test(`${x.nombre} ${x.slug}`));
      p.etapa_slug = e?.slug ?? '';
    }
    delete p._prefiere;
    if (p.tipo === 'pregunta') p.opciones = (p.opciones ?? []).map((o: any) => ({ ...o, pasos: fijar(o.pasos ?? []) }));
    return p;
  });
  return fijar(pasos);
}

/** "Cuando alguien comente «GUIA» en cualquier publicación, le respondés el comentario y le mandás una pregunta por DM." */
function resumenFlujo(form: any, ctx: Ctx): string {
  const d = DISPAROS.find((x) => x.v === form.disparo);
  const ps = palabras(form);
  const cont = form.contenido_id ? ctx.contenidos.find((c: any) => c.id === form.contenido_id)?.titulo : null;
  const cuando = {
    comentario: `Cuando alguien comente ${ps.length ? `«${ps.join('» o «')}»` : 'cualquier cosa'} ${cont ? `en «${cont}»` : 'en cualquier publicación'}`,
    dm: `Cuando alguien te escriba ${ps.length ? `«${ps.join('» o «')}»` : 'cualquier mensaje'} por DM`,
    historia: 'Cuando alguien responda una de tus historias',
    mencion: 'Cuando alguien te mencione en su historia',
    reaccion: 'Cuando alguien reaccione a un mensaje tuyo',
    boton: 'Cuando alguien toque un botón',
    anuncio: 'Cuando alguien venga de un anuncio',
  }[form.disparo as string] ?? d?.t ?? 'Cuando pase el disparador';
  const mapa = new Map<string, Paso>((form.pasos ?? []).map((p: Paso) => [p.id, p]));
  const primeros: string[] = [];
  let id = mapa.get('inicio')?.siguiente;
  while (id && primeros.length < 2) {
    const p = mapa.get(id);
    if (!p) break;
    primeros.push((NODOS[p.tipo]?.etiqueta ?? p.tipo).toLowerCase());
    id = p.tipo === 'pregunta' ? null : p.siguiente;
  }
  return `${cuando}${primeros.length ? `, el CRM va a ${primeros.join(' y después ')}` : ''}.`;
}

function Editor({ flujoId, flujos, ctx, ig, plantilla, probarAlAbrir, borradorAlAbrir, bannerIg, onCambio }: {
  flujoId: string; flujos: any[]; ctx: Ctx; ig: any; plantilla: string | null; probarAlAbrir: boolean; borradorAlAbrir: boolean;
  bannerIg: React.ReactNode; onCambio: () => Promise<void> | void;
}) {
  const navegar = useNavigate();
  const aviso = useAviso();
  const movil = useEsMovil(768);
  const esNuevo = flujoId === 'nuevo';
  const existente = esNuevo ? null : flujos.find((f) => f.id === flujoId) ?? null;
  const claveInicial = esNuevo ? `nuevo${plantilla ? `_${plantilla}` : ''}` : flujoId;

  const inicial = useMemo(() => {
    if (existente) {
      const pasos = (existente.pasos ?? []).map((p: any) => (p.tipo === 'entregar_recurso' ? { ...p, tipo: 'enviar_dm', texto: p.recurso ?? p.texto ?? '' } : p));
      return { nombre: existente.nombre, disparo: existente.disparo, palabra_clave: existente.palabra_clave ?? '', contenido_id: existente.contenido_id ?? '', pasos, activo: existente.activo };
    }
    const pl = PLANTILLAS.find((p) => p.slug === plantilla);
    return pl
      ? { ...flujoVacio(), nombre: pl.nombre, disparo: pl.disparo, palabra_clave: pl.palabra_clave, pasos: arbolAGrafo(prepararPlantilla(pl.pasos(), ctx)) }
      : flujoVacio();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [form, setForm] = useState<any>(inicial);
  const [base, setBase] = useState(() => JSON.stringify(inicial));
  const [editando, setEditando] = useState<string | null>(existente?.id ?? null);
  const [guardando, setGuardando] = useState(false);
  const [autoguardado, setAutoguardado] = useState<number | null>(null);
  // Estadísticas por paso (últimos 30 días) de un automensaje ya guardado.
  const [conteos, setConteos] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    if (!editando) return;
    api<{ total: number; nodos: Record<string, number> }>(`/ux/automensajes/${editando}/estadisticas?dias=30`)
      .then((r) => setConteos(r.total > 0 ? { ...r.nodos, __total: r.total } : null)).catch(() => {});
  }, [editando]);
  const [salir, setSalir] = useState(false);
  const [activar, setActivar] = useState(false);
  const [renombrar, setRenombrar] = useState(false);
  const [enfocar, setEnfocar] = useState<{ id: string; n: number } | null>(null);
  const [revision, setRevision] = useState<{ problemas: any[]; advertencias: any[] }>({ problemas: [], advertencias: [] });
  const [prueba, setPrueba] = useState<{ abierta: boolean; respuestas: Record<string, string>; texto: string; resultado: any; cargando: boolean }>(
    { abierta: false, respuestas: {}, texto: '', resultado: null, cargando: false });
  // Después del primer guardado, el borrador ya va con el id del automensaje.
  const clave = editando ?? claveInicial;
  const [borrador, setBorrador] = useState<{ form: any; en: number } | null>(() => {
    try { const b = localStorage.getItem(PREFIJO_BORRADOR + claveInicial); return b ? JSON.parse(b) : null; } catch { return null; }
  });
  const cambios = JSON.stringify(form) !== base;

  // Abrir "Seguir editando" desde la lista recupera el borrador directo.
  useEffect(() => {
    if (borradorAlAbrir && borrador) { setForm(borrador.form); setBorrador(null); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Borrador automático SOLO después de un cambio real (mirar y salir no deja nada).
  useEffect(() => {
    if (!cambios) return;
    const t = window.setTimeout(() => {
      try { localStorage.setItem(PREFIJO_BORRADOR + clave, JSON.stringify({ form, en: Date.now() })); } catch { /* sin almacenamiento */ }
    }, 600);
    return () => window.clearTimeout(t);
  }, [form, cambios, clave]);

  // Revisión en vivo: qué falta completar y qué avisos hay (sin guardar).
  useEffect(() => {
    const t = window.setTimeout(() => {
      api<any>('/ux/automensajes/simular', { method: 'POST', json: { pasos: form.pasos } })
        .then((r) => setRevision({ problemas: r.problemas ?? [], advertencias: r.advertencias ?? [] }))
        .catch(() => {});
    }, 700);
    return () => window.clearTimeout(t);
  }, [form.pasos]);

  const probar = useCallback(async (resp?: Record<string, string>, texto?: string) => {
    const respuestas = resp ?? prueba.respuestas;
    const t = texto ?? prueba.texto;
    setPrueba((p) => ({ ...p, abierta: true, cargando: true, respuestas, texto: t }));
    try {
      const r = await api<any>('/ux/automensajes/simular', { method: 'POST', json: { pasos: form.pasos, respuestas, texto: t || undefined, nombre: form.nombre } });
      setPrueba((p) => ({ ...p, resultado: r, cargando: false }));
    } catch (e: any) { aviso.error(e.message); setPrueba((p) => ({ ...p, cargando: false })); }
  }, [form.pasos, form.nombre, prueba.respuestas, prueba.texto, aviso]);
  useEffect(() => { if (probarAlAbrir) probar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function guardar(silencioso = false): Promise<any | null> {
    if (!String(form.nombre ?? '').trim()) {
      if (silencioso) return null;
      aviso.error('Ponele un nombre al automensaje.');
      if (movil) setRenombrar(true); else document.getElementById('nombre-automensaje')?.focus();
      return null;
    }
    if (!silencioso) setGuardando(true);
    const formEnviado = form;
    const cuerpo = { ...form, palabra_clave: String(form.palabra_clave ?? '').trim() || null, contenido_id: form.contenido_id || null };
    try {
      const r = editando
        ? await api<any>(`/flujos/${editando}`, { method: 'PATCH', json: cuerpo })
        : await api<any>('/flujos', { method: 'POST', json: cuerpo });
      borrarBorrador(clave);
      borrarBorrador(claveInicial);
      const guardado = { ...formEnviado, activo: r.activo, pasos: r.pasos };
      // Si siguió editando mientras se guardaba, no le pisamos lo nuevo.
      setForm((f: any) => (f === formEnviado ? guardado : { ...f, activo: r.activo }));
      setBase(JSON.stringify(guardado));
      setAutoguardado(Date.now());
      const eraNuevo = !editando;
      setEditando(r.id);
      if (eraNuevo) window.history.replaceState(window.history.state, '', `/flujos/${r.id}`);
      if (silencioso) { onCambio(); return r; }
      if (r.avisos?.length) {
        const primero = (r.marcados ?? [])[0];
        aviso.error(`Se guardó en pausa: ${plural(r.avisos.length, 'cosa', 'cosas')} por completar.`, primero ? { texto: 'Ver', onClick: () => setEnfocar({ id: primero, n: Date.now() }) } : undefined);
      } else {
        aviso.exito(r.activo ? 'Guardado ✓ · está activo' : 'Guardado ✓ (en pausa)');
        if (!r.activo && eraNuevo) setActivar(true);
      }
      onCambio();
      return r;
    } catch (err: any) { if (!silencioso) aviso.error(err.message); return null; } finally { setGuardando(false); }
  }

  // Autoguardado: 2,5 s después del último cambio. Si el automensaje está
  // ACTIVO y todavía le falta completar algo, no se guarda solo (lo pausaría):
  // queda el borrador local hasta que esté listo o toques Guardar.
  const autoRef = useRef(guardar);
  autoRef.current = guardar;
  useEffect(() => {
    if (!cambios || !String(form.nombre ?? '').trim()) return;
    if (form.activo && revision.problemas.length) return;
    const t = window.setTimeout(() => { autoRef.current(true); }, 2500);
    return () => window.clearTimeout(t);
  }, [form, cambios, revision.problemas.length]);

  // Ctrl/Cmd + S = guardar.
  const guardarRef = useRef(guardar);
  guardarRef.current = guardar;
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); guardarRef.current(); } };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);

  async function cambiarActivo(v: boolean) {
    if (editando && !cambios) {
      try {
        const r = await api<any>(`/flujos/${editando}`, { method: 'PATCH', json: { activo: v } });
        const nuevo = { ...form, activo: r.activo };
        setForm(nuevo); setBase(JSON.stringify(nuevo));
        if (v && !r.activo) aviso.error(`Todavía no se puede activar: ${r.avisos?.[0] ?? 'falta completar algo'}`);
        else aviso.exito(v ? 'Activo: ya responde solo' : 'En pausa');
        onCambio();
      } catch (e: any) { aviso.error(e.message); }
    } else setForm((f: any) => ({ ...f, activo: v }));
  }

  function volver() { if (cambios) setSalir(true); else navegar('/flujos'); }
  function salirSinGuardar() { borrarBorrador(clave); setSalir(false); navegar('/flujos'); }

  if (!esNuevo && !existente && !editando) {
    return (
      <div className="px-4 py-8">
        <Vacio icono="🔎" titulo="No encontramos ese automensaje" texto="Puede que lo hayan borrado."
          accion={<Boton variante="primario" onClick={() => navegar('/flujos')}>Ver mis automensajes</Boton>} />
      </div>
    );
  }

  const marcados = [...new Set(revision.problemas.map((p) => p.nodo).filter(Boolean))] as string[];
  const advertidos = [...new Set(revision.advertencias.map((p) => p.nodo).filter(Boolean))] as string[];
  const notas: Record<string, string[]> = {};
  for (const p of [...revision.problemas, ...revision.advertencias]) if (p.nodo) (notas[p.nodo] ??= []).push(String(p.texto).replace(/^[^:]+:\s*/, ''));
  const recorrido: string[] = prueba.abierta ? (prueba.resultado?.resultados ?? []).map((r: any) => r.nodo).filter(Boolean) : [];
  const totalRevision = revision.problemas.length + revision.advertencias.length;

  const chipRevision = (
    <Menu alinear="derecha" ancho={320} titulo={revision.problemas.length ? 'Para completar' : 'Avisos'} disparador={({ alternar, abierto }) => (
      <button type="button" onClick={totalRevision ? alternar : undefined} aria-expanded={abierto}
        className="ui-foco inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[12px] font-medium"
        style={revision.problemas.length
          ? { background: 'color-mix(in srgb, var(--status-critical) 12%, transparent)', color: 'var(--status-critical)' }
          : revision.advertencias.length
            ? { background: 'color-mix(in srgb, var(--status-warning) 14%, transparent)', color: 'var(--status-warning)' }
            : { background: 'color-mix(in srgb, var(--status-good) 12%, transparent)', color: 'var(--status-good)' }}>
        {revision.problemas.length ? `${revision.problemas.length} por completar ▾` : revision.advertencias.length ? `${plural(revision.advertencias.length, 'aviso')} ▾` : 'Todo listo ✓'}
      </button>
    )}>
      {[...revision.problemas, ...revision.advertencias].map((p, i) => (
        <ItemMenu key={i} icono={i < revision.problemas.length ? '⛔' : '⚠'} onClick={() => p.nodo && setEnfocar({ id: p.nodo, n: Date.now() })}>
          <span className="whitespace-normal">{p.texto}</span>
        </ItemMenu>
      ))}
    </Menu>
  );

  return (
    <div className="alto-app flex flex-col">
      {/* Cabecera: una sola fila (en el celular, lo secundario va al ⋯) */}
      <div className="flex items-center gap-2 border-b border-[var(--border-hairline)] px-2 py-2 sm:px-3">
        <button type="button" onClick={volver} aria-label="Volver a mis automensajes"
          className="ui-foco flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-[var(--page-plane)]"><Icono nombre="volver" tam={20} /></button>
        {movil ? (
          <button type="button" onClick={() => setRenombrar(true)} className="ui-foco min-w-0 flex-1 truncate text-left text-[15px] font-semibold">
            {form.nombre || <span className="text-[var(--text-muted)]">Ponele un nombre</span>}
          </button>
        ) : (
          <Entrada id="nombre-automensaje" value={form.nombre} onChange={(e) => setForm((f: any) => ({ ...f, nombre: e.target.value }))}
            placeholder="Nombre del automensaje" className="!w-[280px] font-medium" aria-label="Nombre del automensaje" />
        )}
        {!movil && <Interruptor activo={form.activo} onCambiar={cambiarActivo} etiqueta={form.activo ? 'Activo' : 'En pausa'} />}
        {!movil && chipRevision}
        <div className="flex-1" />
        {movil ? (
          <Menu alinear="derecha" titulo={form.nombre || 'Automensaje'} disparador={({ alternar, abierto }) => (
            <button type="button" onClick={alternar} aria-label="Más acciones" aria-expanded={abierto}
              className="ui-foco flex h-9 w-9 items-center justify-center rounded-full hover:bg-[var(--page-plane)]"><Icono nombre="puntos" tam={18} /></button>
          )}>
            <ItemMenu icono="▷" onClick={() => probar()}>Probar (no guarda ni manda nada)</ItemMenu>
            <ItemMenu icono={form.activo ? '⏸' : '▶'} onClick={() => cambiarActivo(!form.activo)}>{form.activo ? 'Pausar' : 'Activar'}</ItemMenu>
            <ItemMenu icono="✏️" onClick={() => setRenombrar(true)}>Cambiar el nombre</ItemMenu>
          </Menu>
        ) : (
          <Boton variante="secundario" tamano="sm" icono="▷" onClick={() => (prueba.abierta ? setPrueba((p) => ({ ...p, abierta: false })) : probar())}>
            {prueba.abierta ? 'Cerrar prueba' : 'Probar'}
          </Boton>
        )}
        <span className="hidden text-[11px] text-[var(--text-muted)] sm:inline" aria-live="polite">
          {cambios ? (form.activo && revision.problemas.length ? 'Sin guardar: falta completar' : 'Guardando…') : autoguardado ? 'Guardado ✓' : ''}
        </span>
        <Boton variante="primario" tamano="sm" onClick={() => guardar()} cargando={guardando}>
          Guardar{cambios && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-white" aria-label="hay cambios sin guardar" />}
        </Boton>
      </div>
      {movil && totalRevision > 0 && <div className="flex justify-end border-b border-[var(--border-hairline)] px-2 py-1.5">{chipRevision}</div>}

      {(bannerIg || borrador) && (
        <div className="space-y-2 border-b border-[var(--border-hairline)] px-3 py-2">
          {bannerIg}
          {borrador && (
            <Banner tono="info" icono="📝" accion={<>
              <Boton tamano="sm" variante="fantasma" onClick={() => { borrarBorrador(clave); setBorrador(null); }}>Descartar</Boton>
              <Boton tamano="sm" variante="primario" onClick={() => { setForm(borrador.form); setBorrador(null); }}>Recuperar</Boton>
            </>}>
              Quedaron cambios sin guardar de la última vez{borrador.form?.nombre ? ` en «${borrador.form.nombre}»` : ''}.
            </Banner>
          )}
        </div>
      )}

      {/* Prueba (escritorio): como un chat de Instagram, arriba de la pizarra */}
      {prueba.abierta && !movil && (
        <div className="max-h-[42vh] overflow-y-auto border-b border-[var(--border-hairline)] px-3 py-2" style={{ background: 'var(--page-plane)' }}>
          <PanelPrueba form={form} prueba={prueba} onProbar={probar} />
        </div>
      )}

      <div className="min-h-0 flex-1">
        <Suspense fallback={<div className="flex h-full items-center justify-center gap-2 text-[13px] text-[var(--text-muted)]" aria-busy="true"><Girando /> Abriendo la pizarra…</div>}>
          <Pizarra form={form} setForm={setForm} ctx={ctx} marcados={marcados} advertidos={advertidos} notas={notas} conteos={conteos}
            recorrido={recorrido} enfocar={enfocar} />
        </Suspense>
      </div>

      {movil && (
        <Dialogo abierto={prueba.abierta} onCerrar={() => setPrueba((p) => ({ ...p, abierta: false }))} titulo="Prueba" autoFoco={false}
          descripcion="No se guarda, no se manda nada y no toca tus leads.">
          <PanelPrueba form={form} prueba={prueba} onProbar={probar} />
        </Dialogo>
      )}

      <Dialogo abierto={renombrar} onCerrar={() => setRenombrar(false)} titulo="Nombre del automensaje"
        pie={<Boton variante="primario" onClick={() => setRenombrar(false)}>Listo</Boton>}>
        <Entrada value={form.nombre} onChange={(e) => setForm((f: any) => ({ ...f, nombre: e.target.value }))}
          placeholder="Ej.: Guía por comentario" onKeyDown={(e) => { if (e.key === 'Enter') setRenombrar(false); }} />
      </Dialogo>

      <Dialogo abierto={salir} onCerrar={() => setSalir(false)} titulo="Tenés cambios sin guardar"
        descripcion="Si salís sin guardar, se descartan."
        pie={(
          <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
            <Boton variante="fantasma" onClick={() => setSalir(false)}>Seguir editando</Boton>
            <Boton variante="peligro" onClick={salirSinGuardar}>Salir sin guardar</Boton>
            <Boton variante="primario" cargando={guardando} onClick={async () => { const r = await guardar(); if (r) { setSalir(false); navegar('/flujos'); } }}>Guardar y salir</Boton>
          </div>
        )} />

      <Dialogo abierto={activar} onCerrar={() => setActivar(false)} titulo="¿Lo activamos?"
        descripcion="Mientras esté en pausa no responde a nadie."
        pie={<>
          <Boton variante="fantasma" onClick={() => setActivar(false)}>Dejar en pausa</Boton>
          <Boton variante="primario" onClick={async () => { setActivar(false); await cambiarActivo(true); }}>Activar ahora</Boton>
        </>}>
        <p className="text-[14px] leading-relaxed">{resumenFlujo(form, ctx)}</p>
        {ig && !ig.conectado && <p className="mt-2 text-[12px]" style={{ color: 'var(--status-warning)' }}>⚠ Instagram no está conectado: hasta que lo conectes no va a responder.</p>}
      </Dialogo>
    </div>
  );
}

// ---------------------------------------------------------------------
// Prueba como un chat de Instagram
// ---------------------------------------------------------------------

const MANDA = new Set(['enviar_dm', 'enviar_recurso', 'enviar_calendario', 'pregunta', 'entregar_recurso']);

function PanelPrueba({ form, prueba, onProbar }: {
  form: any;
  prueba: { respuestas: Record<string, string>; texto: string; resultado: any; cargando: boolean };
  onProbar: (respuestas?: Record<string, string>, texto?: string) => void;
}) {
  const [escrito, setEscrito] = useState(prueba.texto);
  const mapa = new Map<string, Paso>((form.pasos ?? []).map((p: Paso) => [p.id, p]));
  const ps = palabras(form);
  const contexto = {
    comentario: `@lead_de_prueba comentó «${ps[0] ?? 'Me interesa'}» en tu reel`,
    dm: `@lead_de_prueba te escribió «${ps[0] ?? 'Hola'}» por DM`,
    historia: '@lead_de_prueba respondió tu historia',
    mencion: '@lead_de_prueba te mencionó en su historia',
    reaccion: '@lead_de_prueba reaccionó a tu mensaje',
    boton: '@lead_de_prueba tocó un botón',
    anuncio: '@lead_de_prueba llegó desde un anuncio',
  }[form.disparo as string] ?? '@lead_de_prueba activó el disparador';
  const resultados: any[] = prueba.resultado?.resultados ?? [];

  return (
    <div className="space-y-2 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-medium">Prueba: no se guarda, no se manda nada y no toca tus leads.</span>
        <Boton tamano="xs" variante="fantasma" onClick={() => { setEscrito(''); onProbar({}, ''); }}>Empezar de nuevo</Boton>
        {prueba.cargando && <span className="text-[11px] text-[var(--text-muted)]">Probando…</span>}
      </div>
      <div className="text-center text-[11px] text-[var(--text-muted)]">{contexto}</div>
      {resultados.length === 0 && !prueba.cargando && <div className="text-center text-[12px] text-[var(--text-muted)]">Conectá el disparador con un primer paso para ver qué pasaría.</div>}
      {resultados.map((r, i) => {
        const nodo = r.nodo ? mapa.get(r.nodo) : undefined;
        const esMensaje = r.paso === 'enviar' && nodo && MANDA.has(nodo.tipo);
        if (esMensaje) {
          return (
            <div key={i} className="flex flex-col items-end gap-1">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-xl rounded-br-md px-3 py-2 text-[13px] text-white" style={{ background: 'var(--series-1)' }}>
                {conVariables(String(r.cuerpo ?? r.texto ?? '')).replace(/\[nombre\]|\[Nombre\]/g, 'Sofía')}
              </div>
              {nodo?.tipo === 'pregunta' && (
                <FilaChips className="justify-end">
                  {(nodo.opciones ?? []).map((o: any, j: number) => {
                    const elegida = (prueba.respuestas[nodo.id] ?? nodo.opciones?.[0]?.id) === o.id;
                    return (
                      <Chip key={o.id} activo={elegida} onClick={() => onProbar({ ...prueba.respuestas, [nodo.id]: o.id })}>
                        {o.titulo || `Botón ${j + 1}`}
                      </Chip>
                    );
                  })}
                </FilaChips>
              )}
            </div>
          );
        }
        if (r.paso === 'condicion' && nodo) {
          const actual = prueba.respuestas[nodo.id] ?? 'si';
          return (
            <div key={i} className="flex flex-wrap items-center justify-center gap-1.5 text-[12px] text-[var(--text-muted)]">
              <span>{r.texto}</span>
              <Chip activo={actual === 'si'} onClick={() => onProbar({ ...prueba.respuestas, [nodo.id]: 'si' })}>Sí</Chip>
              <Chip activo={actual === 'no'} onClick={() => onProbar({ ...prueba.respuestas, [nodo.id]: 'no' })}>No</Chip>
            </div>
          );
        }
        if (r.paso === 'respuesta') {
          return <div key={i} className="flex justify-start"><div className="max-w-[85%] rounded-xl rounded-bl-md px-3 py-2 text-[13px]" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-hairline)' }}>{String(r.texto).replace(/^[^«]*«|»[^»]*$/g, '') || r.texto}</div></div>;
        }
        if (nodo?.tipo === 'esperar_respuesta' || r.paso === 'pausa') {
          return (
            <div key={i} className="space-y-1">
              <div className="text-center text-[11px] text-[var(--text-muted)]">{r.texto}</div>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); onProbar(prueba.respuestas, escrito); }}>
                <Entrada value={escrito} onChange={(e) => setEscrito(e.target.value)} placeholder="Escribí como si fueras el lead…" className="flex-1" />
                <Boton tamano="sm" type="submit">Enviar</Boton>
              </form>
            </div>
          );
        }
        return <div key={i} className="text-center text-[11px] text-[var(--text-muted)]">{r.texto}</div>;
      })}
    </div>
  );
}
