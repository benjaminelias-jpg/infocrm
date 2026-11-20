import { useEffect, useRef, useState } from 'react';
import { api, fmtNum, hace } from '../../api';
import { textoDe } from '../../textos';
import {
  Boton, BotonIcono, Campo, Chip, ContenidoDeslizable, Desplegable, Entrada, ErrorCarga, Esqueleto, FilaDeslizable, Insignia,
  Interruptor, ItemMenu, Menu, Pestanas, TituloSeccion, Verificacion, useAviso, useCarga, useEsMovil,
} from '../../ui';
import Icono from '../Iconos';
import GuiaEntrada from './GuiaEntrada';
import { B, BotonCopiar, Instrucciones, ItemConfirmar } from './comun';
import { LogoApp, type App } from './LogoApp';
import { useAppElegida } from './useGuiaUrl';

// Zapier / Make / n8n en las dos direcciones:
//  · "Avisar a otra app": el CRM manda un aviso cuando pasa algo. Con
//    conexiones hechas, primero la lista (con el + al lado del título);
//    cada una se renombra en el lugar, se pausa y muestra qué falló.
//  · "Recibir datos": otra app manda leads al CRM (usa GuiaEntrada).

const EVENTOS: Array<{ id: string; nombre: string }> = [
  { id: '*', nombre: 'Todo' },
  { id: 'lead_creado', nombre: 'Lead nuevo' },
  { id: 'recurso_entregado', nombre: 'Recurso entregado' },
  { id: 'respondio_dm', nombre: 'Respondió el DM' },
  { id: 'reunion_agendada', nombre: 'Reunión agendada' },
  { id: 'reunion_realizada', nombre: 'Reunión hecha' },
  { id: 'reunion_no_asistio', nombre: 'No asistió' },
  { id: 'venta', nombre: 'Venta' },
  { id: 'reembolso', nombre: 'Devolución' },
];
// Las conexiones que eligen las etapas y reglas del Pipeline llevan ['solo_etapas'].
const nombreEvento = (id: string) => (id === 'solo_etapas' ? 'Solo cuando una etapa o regla lo usa' : EVENTOS.find((e) => e.id === id)?.nombre ?? textoDe('evento', id));

export function nombrePorUrl(url: string) {
  if (/zapier\.com/i.test(url)) return 'Zapier';
  if (/make\.com|integromat/i.test(url)) return 'Make';
  if (/n8n/i.test(url)) return 'n8n';
  if (/slack\.com/i.test(url)) return 'Slack';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Mi app'; }
}
const logoPorUrl = (url: string): App => (/zapier\.com/i.test(url) ? 'zapier' : /make\.com|integromat/i.test(url) ? 'make' : /n8n/i.test(url) ? 'n8n' : 'otra');

/** "hooks.zapier.com/…" → "https://hooks.zapier.com/…" (si se pegó sin https://). */
function completarUrl(v: string) {
  const t = v.trim();
  if (!t || /^https?:\/\//i.test(t)) return t;
  return /^[\w-]+(\.[\w-]+)+(\/|$)/.test(t) ? `https://${t}` : t;
}
function urlValida(v: string) {
  try { const u = new URL(v.trim()); return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.'); } catch { return false; }
}

/** Los fallos en simple, sin códigos sueltos. */
export function explicarFallo(e: { http_status?: number | null; error?: string | null }) {
  const s = e.http_status ?? null;
  const txt = e.error ?? '';
  if (s === 410) return 'La otra app dice que esa dirección ya no existe (410): el Zap está apagado o se borró.';
  if (s === 404) return 'Esa dirección no existe (404): revisá que esté bien copiada y que el Zap siga encendido.';
  if (s === 401 || s === 403) return `La otra app rechazó el aviso (${s}): pide una clave o un permiso.`;
  if (s && s >= 500) return `La otra app tuvo un problema (${s}). Suele arreglarse solo: reintentá en un rato.`;
  if (s && s >= 400) return `La otra app no aceptó los datos (${s}).`;
  if (/timeout|aborted|timed out/i.test(txt)) return 'La otra app no respondió a tiempo.';
  if (/ENOTFOUND|getaddrinfo|fetch failed|ECONNREFUSED/i.test(txt)) return 'No encontramos esa dirección en internet: revisá que esté bien escrita.';
  return 'No le llegó el aviso.';
}

type Prueba = { estado: 'esperando' | 'ok' | 'error'; texto?: string };

export default function GuiaSalida({ onCambio, onVerLead, onListo }: { onCambio?: () => void; onVerLead?: (id: string) => void; onListo?: () => void }) {
  const [pestana, setPestana] = useAppElegida(['avisar', 'recibir'] as const, 'avisar');
  const pestanas = [{ id: 'avisar' as const, etiqueta: 'Avisar a otra app' }, { id: 'recibir' as const, etiqueta: 'Recibir datos' }];
  return (
    <div className="space-y-4">
      <Pestanas pestanas={pestanas} actual={pestana} onCambiar={setPestana} />
      <ContenidoDeslizable pestanas={pestanas} actual={pestana} onCambiar={setPestana}>
        {pestana === 'avisar'
          ? <Avisar onCambio={onCambio} />
          : <GuiaEntrada clase="zapier" onCambio={onCambio} onVerLead={onVerLead} onListo={onListo} />}
      </ContenidoDeslizable>
    </div>
  );
}

function Avisar({ onCambio }: { onCambio?: () => void }) {
  const aviso = useAviso();
  const { datos: lista, setDatos, error, recargar } = useCarga(() => api<any[]>('/webhooks/salida'), []);
  const [creando, setCreando] = useState(false);
  const borrando = useRef(new Map<string, number>());
  useEffect(() => () => { borrando.current.forEach((t) => window.clearTimeout(t)); }, []);

  /** Quitar con "Deshacer": se saca de la lista ya y se borra de verdad a los 6 s. */
  function quitar(s: any) {
    setDatos((l) => l?.filter((x) => x.id !== s.id) ?? l);
    const t = window.setTimeout(async () => {
      borrando.current.delete(s.id);
      try { await api(`/webhooks/salida/${s.id}`, { method: 'DELETE' }); onCambio?.(); } catch (e: any) { aviso.error(e.message); void recargar(true); }
    }, 6000);
    borrando.current.set(s.id, t);
    aviso.exito(`Ya no avisamos a ${s.nombre}.`, {
      texto: 'Deshacer',
      onClick: () => { window.clearTimeout(t); borrando.current.delete(s.id); void recargar(true); },
    });
  }

  if (error && !lista) return <ErrorCarga compacto error={error} titulo="No pudimos ver tus conexiones" onReintentar={() => recargar()} />;
  if (!lista) return <div className="space-y-2"><Esqueleto alto={56} /><Esqueleto alto={56} /></div>;

  const vacia = lista.length === 0;
  return (
    <div className="space-y-4">
      {vacia ? (
        <>
          <Instrucciones pasos={[
            <>En Zapier creá un Zap que arranque con <B>Webhooks by Zapier → Catch Hook</B> (en Make: <B>Webhooks → Custom webhook</B>) y copiá la dirección que te da.</>,
            <>Pegala acá abajo y elegí <B>cuándo</B> querés que avisemos.</>,
            <>Tocá <B>Conectar</B>: mandamos un aviso de prueba para que Zapier o Make vea los datos.</>,
          ]} />
          <FormularioNuevo onCreada={() => { void recargar(true); onCambio?.(); }} />
        </>
      ) : (
        <div>
          <TituloSeccion titulo="Apps a las que avisamos" onMas={() => setCreando(true)} textoMas="Conectar otra app" />
          {creando && (
            <div className="mb-3">
              <FormularioNuevo onCancelar={() => setCreando(false)} onCreada={() => { setCreando(false); void recargar(true); onCambio?.(); }} />
            </div>
          )}
          <div className="space-y-2">
            {lista.map((s) => (
              <FilaConexion key={s.id} s={s} onQuitar={() => quitar(s)}
                onCambiada={(nueva) => { setDatos((l) => l?.map((x) => (x.id === s.id ? { ...x, ...nueva } : x)) ?? l); onCambio?.(); }}
                onRecargar={() => { void recargar(true); onCambio?.(); }} />
            ))}
          </div>
        </div>
      )}
      <Ideas />
    </div>
  );
}

/** Formulario en línea: se despliega debajo del título con el +, y Cancelar o Esc lo pliega. */
function FormularioNuevo({ onCreada, onCancelar }: { onCreada: () => void; onCancelar?: () => void }) {
  const aviso = useAviso();
  const [url, setUrl] = useState('');
  const [nombre, setNombre] = useState('');
  const [eventos, setEventos] = useState<string[]>(['*']);
  const [creando, setCreando] = useState(false);
  const [prueba, setPrueba] = useState<Prueba | null>(null);
  const completa = completarUrl(url);
  const valida = urlValida(completa);

  function alternar(id: string) {
    setEventos((ev) => {
      if (id === '*') return ['*'];
      const sin = ev.filter((x) => x !== '*' && x !== id);
      const nuevo = ev.includes(id) ? sin : [...sin, id];
      return nuevo.length ? nuevo : ['*'];
    });
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!valida) return;
    setCreando(true);
    try {
      const s = await api<any>('/webhooks/salida', { method: 'POST', json: { nombre: nombre.trim() || nombrePorUrl(completa), url: completa, eventos } });
      setPrueba({ estado: 'esperando' });
      const r = await api<any>(`/webhooks/salida/${s.id}/probar`, { method: 'POST' }).catch((err) => ({ estado: 'error', error: err.message }));
      if (r.estado === 'entregado') aviso.exito(`Listo: avisamos a ${s.nombre}. Ya le mandamos un aviso de prueba.`);
      else aviso.error(`Conectada, pero el aviso de prueba no llegó: ${explicarFallo(r)}`);
      setUrl(''); setNombre(''); setEventos(['*']); setPrueba(null);
      onCreada();
    } catch (err: any) {
      aviso.error(err.message);
      setPrueba(null);
    } finally { setCreando(false); }
  }

  return (
    <form onSubmit={crear} onKeyDown={(e) => { if (e.key === 'Escape' && onCancelar) { e.stopPropagation(); onCancelar(); } }}
      className="ui-fundido space-y-3 rounded-[14px] p-3" style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>
      <Campo etiqueta="Dirección de la otra app" error={url && !valida ? 'Pegá la dirección completa que te dio Zapier o Make.' : undefined}>
        <Entrada value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => setUrl((v) => completarUrl(v))}
          placeholder="https://hooks.zapier.com/hooks/catch/…" inputMode="url" autoComplete="off" spellCheck={false} invalido={!!url && !valida} autoFocus={Boolean(onCancelar)} />
      </Campo>
      <Campo etiqueta="Nombre (para reconocerla)" ayuda="Opcional. Ej.: «Zapier · planilla de ventas».">
        <Entrada value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={valida ? nombrePorUrl(completa) : 'Zapier · planilla de ventas'} maxLength={60} />
      </Campo>
      <div>
        <div className="mb-1.5 text-[12px] font-medium text-[var(--text-secondary)]">¿Cuándo avisamos?</div>
        {/* En el formulario, los chips bajan de línea (no se salen de la tarjeta). */}
        <div className="flex flex-wrap gap-1.5">
          {EVENTOS.map((ev) => <Chip key={ev.id} activo={eventos.includes(ev.id)} onClick={() => alternar(ev.id)}>{ev.nombre}</Chip>)}
        </div>
      </div>
      {prueba && <Verificacion estado="escuchando" esperando="Conectando y mandando un aviso de prueba…" />}
      <div className="flex flex-wrap gap-2">
        <Boton type="submit" variante="primario" cargando={creando} disabled={!valida}>Conectar</Boton>
        {onCancelar && <Boton variante="fantasma" onClick={onCancelar}>Cancelar</Boton>}
      </div>
    </form>
  );
}

/** Una app a la que avisamos: nombre editable, interruptor, ⋯ y lo que falló (con Reintentar). */
function FilaConexion({ s, onQuitar, onCambiada, onRecargar }: {
  s: any; onQuitar: () => void; onCambiada: (nueva: any) => void; onRecargar: () => void;
}) {
  const aviso = useAviso();
  const movil = useEsMovil();
  const [renombrando, setRenombrando] = useState(false);
  const [nombre, setNombre] = useState(s.nombre);
  const [prueba, setPrueba] = useState<Prueba | null>(null);
  const [verFallos, setVerFallos] = useState(false);
  const [fallos, setFallos] = useState<any[] | null>(null);
  const [secreto, setSecreto] = useState<string | null>(null);
  const [verSecreto, setVerSecreto] = useState(false);
  const fallaron = Number(s.total_fallos) > 0 && Boolean(s.ultimo_error);

  async function probar() {
    setPrueba({ estado: 'esperando' });
    try {
      const r = await api<any>(`/webhooks/salida/${s.id}/probar`, { method: 'POST' });
      setPrueba(r.estado === 'entregado'
        ? { estado: 'ok', texto: 'La otra app recibió el aviso de prueba.' }
        : { estado: 'error', texto: explicarFallo(r) });
      onRecargar();
    } catch (e: any) { setPrueba({ estado: 'error', texto: e.message }); }
  }

  async function activar(activo: boolean) {
    onCambiada({ activo });
    try { await api(`/webhooks/salida/${s.id}`, { method: 'PATCH', json: { activo } }); }
    catch (e: any) { aviso.error(e.message); onCambiada({ activo: !activo }); }
  }

  async function guardarNombre() {
    const n = nombre.trim();
    setRenombrando(false);
    if (!n || n === s.nombre) { setNombre(s.nombre); return; }
    onCambiada({ nombre: n });
    try { await api(`/webhooks/salida/${s.id}`, { method: 'PATCH', json: { nombre: n } }); }
    catch (e: any) { aviso.error(e.message); onCambiada({ nombre: s.nombre }); setNombre(s.nombre); }
  }

  /** Los avisos que fallaron DESPUÉS del último que llegó bien (los viejos ya no importan). */
  async function pedirFallos() {
    const filas = await api<any[]>(`/webhooks/salida/entregas?suscripcion_id=${s.id}&limite=15`);
    const corte = filas.findIndex((f) => f.estado === 'entregado');
    return (corte === -1 ? filas : filas.slice(0, corte)).filter((f) => f.estado === 'error').slice(0, 5);
  }

  async function cargarFallos() {
    setVerFallos((v) => !v);
    if (fallos) return;
    try { setFallos(await pedirFallos()); } catch (e: any) { aviso.error(e.message); setFallos([]); }
  }

  async function reintentar(id: number) {
    try {
      const r = await api<any>(`/webhooks/salida/entregas/${id}/reintentar`, { method: 'POST' });
      if (r?.estado === 'entregado') aviso.exito('Listo: esta vez llegó.');
      else aviso.error(`Tampoco llegó: ${explicarFallo(r ?? {})}`);
      setFallos(await pedirFallos());
      onRecargar();
    } catch (e: any) { aviso.error(e.message); }
  }

  async function mostrarSecreto() {
    setVerSecreto((v) => !v);
    if (secreto) return;
    try { setSecreto((await api<{ secreto: string }>(`/webhooks/salida/${s.id}/secreto`)).secreto); } catch (e: any) { aviso.error(e.message); }
  }

  const estado = !s.activo ? <Insignia>En pausa</Insignia> : fallaron ? <Insignia tono="amarillo" punto>Con fallos</Insignia> : <Insignia tono="verde" punto>Activa</Insignia>;
  const cuerpo = (
    <div className="space-y-2 p-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]" style={{ background: 'var(--surface-2, var(--page-plane))' }}><LogoApp app={logoPorUrl(s.url)} tam={17} /></span>
        <div className="min-w-0 flex-1">
          {renombrando ? (
            <Entrada autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} onBlur={guardarNombre} maxLength={60}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void guardarNombre(); } if (e.key === 'Escape') { e.stopPropagation(); setNombre(s.nombre); setRenombrando(false); } }}
              aria-label="Nombre de la conexión" />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setRenombrando(true)} title="Tocá para cambiarle el nombre"
                className="ui-foco min-w-0 truncate rounded text-left text-[13px] font-semibold hover:underline">{s.nombre}</button>
              {estado}
            </div>
          )}
          <div className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
            {(s.eventos ?? []).map(nombreEvento).join(' · ')} · <span className="cifras">{fmtNum(s.total_enviados)}</span> enviados
            {s.ultimo_envio_en ? <> · último {hace(s.ultimo_envio_en)}</> : null}
          </div>
          {Number(s.total_fallos) > 0 && (
            <button type="button" onClick={cargarFallos} aria-expanded={verFallos}
              className="ui-foco mt-0.5 text-[12px] font-semibold underline" style={{ color: fallaron ? 'var(--status-critical)' : 'var(--text-muted)' }}>
              {fmtNum(s.total_fallos)} {Number(s.total_fallos) === 1 ? 'falló' : 'fallaron'} · {verFallos ? 'ocultar' : 'ver qué pasó'}
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Interruptor activo={s.activo} onCambiar={activar} etiqueta={<span className="sr-only">{s.activo ? 'Activa' : 'En pausa'}</span>} />
          <Menu alinear="derecha" ancho={240} titulo={s.nombre} disparador={({ alternar, abierto, ref }) => (
            <BotonIcono ref={ref} etiqueta="Más acciones" onClick={alternar} aria-expanded={abierto}><Icono nombre="puntos" tam={18} /></BotonIcono>
          )}>
            <ItemMenu onClick={probar}>Probar ahora</ItemMenu>
            <ItemMenu onClick={() => setRenombrando(true)}>Cambiar el nombre</ItemMenu>
            <ItemMenu onClick={mostrarSecreto} descripcion="Para comprobar que el aviso viene de tu CRM">Firma de seguridad</ItemMenu>
            <ItemConfirmar onConfirmar={onQuitar} confirmar="¿Dejar de avisar? Tocá de nuevo">Quitar</ItemConfirmar>
          </Menu>
        </div>
      </div>
      {prueba && <Verificacion estado={prueba.estado === 'esperando' ? 'escuchando' : prueba.estado} esperando="Mandando un aviso de prueba…" ok={prueba.texto} error={prueba.texto} />}
      {verFallos && (
        <div className="ui-fundido space-y-1.5 rounded-[12px] p-2.5" style={{ background: 'var(--page-plane)' }}>
          {!fallos ? <Esqueleto alto={32} /> : fallos.length === 0 ? (
            <p className="text-[12px] text-[var(--text-muted)]">No quedan avisos sin entregar.</p>
          ) : fallos.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
              <span className="min-w-0 flex-1">
                <b>{textoDe('evento', f.tipo_evento)}</b> · {explicarFallo(f)} <span className="text-[var(--text-muted)]">{hace(f.creado_en)}</span>
              </span>
              <Boton tamano="xs" onClick={() => reintentar(f.id)}>Reintentar</Boton>
            </div>
          ))}
        </div>
      )}
      {verSecreto && (
        <div className="ui-fundido space-y-1.5 text-[12px] text-[var(--text-secondary)]">
          <p>Cada aviso va firmado en la cabecera <code>x-infocrm-firma</code> con este secreto (solo hace falta si la otra app lo pide):</p>
          {secreto
            ? <div className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded-[8px] px-2 py-1.5 text-[11px]" style={{ background: 'var(--page-plane)' }}>{secreto}</code><BotonCopiar texto={secreto} /></div>
            : <Esqueleto alto={28} />}
        </div>
      )}
    </div>
  );

  return (
    <div className="tarjeta overflow-hidden">
      {movil ? (
        <FilaDeslizable acciones={[
          { etiqueta: 'Probar', color: 'var(--accion, var(--series-1))', onClick: probar },
          { etiqueta: 'Quitar', color: 'var(--status-critical)', onClick: onQuitar },
        ]}>
          <div style={{ background: 'var(--surface-1)' }}>{cuerpo}</div>
        </FilaDeslizable>
      ) : cuerpo}
    </div>
  );
}

/** Tres recetas para arrancar, con su plantilla. */
function Ideas() {
  const ideas = [
    { titulo: 'Cada venta → una fila en Google Sheets', como: 'Elegí «Venta» y en Zapier sumá Google Sheets → Crear fila.', url: 'https://zapier.com/apps/webhook/integrations/google-sheets' },
    { titulo: 'Reunión agendada → aviso en Slack', como: 'Elegí «Reunión agendada» y en Zapier sumá Slack → Mandar mensaje.', url: 'https://zapier.com/apps/webhook/integrations/slack' },
    { titulo: 'Lead nuevo → tu email marketing', como: 'Elegí «Lead nuevo» y sumá tu herramienta de email (Mailchimp, ActiveCampaign, Brevo…).', url: 'https://zapier.com/apps/webhook/integrations/mailchimp' },
  ];
  return (
    <Desplegable titulo={<span className="text-[13px]">Ideas para empezar</span>} tarjeta={false} clave="zapier_ideas">
      <ul className="space-y-2">
        {ideas.map((i) => (
          <li key={i.titulo} className="rounded-[12px] p-3 text-[12px]" style={{ background: 'var(--page-plane)' }}>
            <div className="text-[13px] font-semibold">{i.titulo}</div>
            <div className="mt-0.5 text-[var(--text-secondary)]">{i.como}</div>
            <a href={i.url} target="_blank" rel="noreferrer" className="mt-1 inline-block font-semibold underline" style={{ color: 'var(--accion, var(--series-1))' }}>Ver la plantilla ↗</a>
          </li>
        ))}
      </ul>
    </Desplegable>
  );
}
