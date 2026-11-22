import { useMemo, useState } from 'react';
import { api, fmtFecha, fmtNum, hace, plural } from '../../api';
import { textoDe, tonoDe } from '../../textos';
import {
  Boton, BotonConfirmar, BotonIcono, Campo, Chip, Desplegable, Dialogo, Entrada, ErrorCarga, Esqueleto, IdentidadLead, Insignia,
  ItemMenu, ListaDesplegable, Menu, Vacio, useAviso, useCarga,
} from '../../ui';
import Icono from '../Iconos';
import { BotonCopiar, DetalleTecnico, Direccion, ItemConfirmar } from './comun';
import { AvisosMeta, FormApp } from './GuiaInstagram';
import { explicarFallo } from './GuiaSalida';
import { LogoApp, type App } from './LogoApp';

// Todo lo técnico, junto y fuera del camino: direcciones de entrada
// (enmascaradas, con pausa y cambio de dirección), el historial de lo que
// llegó (con el JSON, abrir el lead y reprocesar), los avisos enviados, la
// app propia de Meta (avanzado) y las demás claves técnicas.

const ESTADOS = [
  { id: '', nombre: 'Todo' },
  { id: 'error', nombre: 'Con error' },
  { id: 'procesado', nombre: 'Procesados' },
  { id: 'duplicado', nombre: 'Repetidos' },
];

const POR_SLUG: Record<string, { nombre: string; logo: App }> = {
  'manychat-leads': { nombre: 'ManyChat', logo: 'manychat' },
  'reunion-agendada': { nombre: 'Agenda (Calendly, Cal.com…)', logo: 'agenda' },
  'stripe-ventas': { nombre: 'Stripe', logo: 'stripe' },
  'hotmart-ventas': { nombre: 'Hotmart', logo: 'hotmart' },
  venta: { nombre: 'Otra plataforma de pagos', logo: 'pagos' },
  'zapier-leads': { nombre: 'Zapier / Make (recibir datos)', logo: 'zapier' },
};
const nombreDe = (e: any) => POR_SLUG[e.slug]?.nombre ?? e.nombre;
const logoDe = (e: any): App => POR_SLUG[e.slug]?.logo ?? (e.fuente === 'manychat' ? 'manychat' : 'otra');

const EXPLICA_CODIGO: Record<string, string> = {
  sin_identidad: 'Llegó sin nada que identifique a la persona (ni @ de Instagram, ni email, ni id de ManyChat).',
  firma_invalida: 'Se descartó por seguridad: la firma no coincide (no vino de tu cuenta o el secreto cambió).',
  error_interno: 'Hubo un problema al guardarlo. Probá reprocesarlo.',
};

export default function ParaTecnicos({ endpoints, onCambio, ig, onCambioIg, onVerLead }: {
  endpoints: any[]; onCambio?: () => void;
  ig?: any; onCambioIg?: () => void;
  onVerLead?: (leadId: string) => void;
}) {
  const [filtro, setFiltro] = useState('');
  const [deEndpoint, setDeEndpoint] = useState<any | null>(null);
  const [historialAbierto, setHistorialAbierto] = useState<boolean | undefined>(undefined);

  const usadas = useMemo(() => endpoints
    .filter((e) => Number(e.total_recibidos) > 0 || e.configurado_en || e.verificada)
    .sort((a, b) => String(b.ultimo_evento_en ?? '').localeCompare(String(a.ultimo_evento_en ?? ''))), [endpoints]);
  const sinUsar = endpoints.filter((e) => !usadas.includes(e));

  function verLoQueLlego(e: any) {
    setDeEndpoint(e);
    setFiltro('');
    setHistorialAbierto(true);
    window.setTimeout(() => document.getElementById('tec-historial')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  return (
    <div className="space-y-3">
      <Desplegable clave="tec_direcciones" abiertoInicial icono={<LogoApp app="otra" tam={16} />}
        titulo={`Direcciones de entrada (${endpoints.length})`}
        subtitulo={endpoints.length ? `${plural(usadas.length, 'en uso', 'en uso')} · ${sinUsar.length} sin usar. Cada una es secreta.` : 'Se crean cuando las pedís en una guía.'}>
        <div className="space-y-2">
          {endpoints.length === 0 && <p className="text-[12px] text-[var(--text-muted)]">Todavía no pediste ninguna dirección. Se crean cuando seguís la guía de una app.</p>}
          {usadas.map((e) => <FilaDireccion key={e.id} e={e} onCambio={onCambio} onVer={() => verLoQueLlego(e)} />)}
          {sinUsar.length > 0 && (
            <Desplegable tarjeta={false} titulo={<span className="text-[13px]">Sin usar ({sinUsar.length})</span>} clave="tec_sin_usar">
              <div className="space-y-2">{sinUsar.map((e) => <FilaDireccion key={e.id} e={e} onCambio={onCambio} onVer={() => verLoQueLlego(e)} />)}</div>
            </Desplegable>
          )}
          <p className="text-[12px] text-[var(--text-muted)]">El CRM entiende los datos de ManyChat, Calendly, Cal.com, Stripe, Hotmart, Zapier y Make sin configurar nada.</p>
        </div>
      </Desplegable>

      <div id="tec-historial" className="scroll-mt-20">
        <Historial filtro={filtro} setFiltro={setFiltro} deEndpoint={deEndpoint} setDeEndpoint={setDeEndpoint}
          abierto={historialAbierto} setAbierto={setHistorialAbierto} onCambio={onCambio} onVerLead={onVerLead} />
      </div>

      <Entregas />

      <AppPropia ig={ig} onCambio={onCambioIg ?? onCambio} />

      <OtrasClaves />
    </div>
  );
}

function FilaDireccion({ e, onCambio, onVer }: { e: any; onCambio?: () => void; onVer: () => void }) {
  const aviso = useAviso();
  const [url, setUrl] = useState<string>(e.url);
  const [activo, setActivo] = useState<boolean>(e.activo !== false);

  async function pausar(v: boolean) {
    setActivo(v);
    try {
      await api(`/webhooks/endpoints/${e.id}`, { method: 'PATCH', json: { activo: v } });
      aviso.exito(v ? 'Dirección reanudada: vuelve a recibir datos.' : 'Dirección en pausa: lo que llegue se rechaza hasta que la reanudes.');
      onCambio?.();
    } catch (err: any) { setActivo(!v); aviso.error(err.message); }
  }
  async function rotar() {
    try {
      const r = await api<any>(`/webhooks/endpoints/${e.id}/rotar`, { method: 'POST' });
      setUrl(r.url);
      aviso.exito('Listo: la dirección vieja ya no funciona. Pegá la nueva en la otra app.');
      onCambio?.();
    } catch (err: any) { aviso.error(err.message); }
  }

  return (
    <div className="space-y-2 rounded-lg p-3" style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5"><LogoApp app={logoDe(e)} tam={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] font-semibold">{nombreDe(e)}</span>
            {!activo && <Insignia>En pausa</Insignia>}
            {e.verificada && <Insignia tono="verde">Verificada</Insignia>}
          </div>
          <div className="cifras text-[12px] text-[var(--text-secondary)]">
            {fmtNum(e.total_recibidos)} recibidos
            {Number(e.total_errores) > 0 && <span style={{ color: 'var(--status-critical)' }}> · {fmtNum(e.total_errores)} con error</span>}
            {e.ultimo_evento_en ? <> · último {hace(e.ultimo_evento_en)}</> : null}
          </div>
        </div>
        <Menu alinear="derecha" ancho={250} titulo={nombreDe(e)} disparador={({ alternar, abierto, ref }) => (
          <BotonIcono ref={ref} etiqueta="Más acciones" onClick={alternar} aria-expanded={abierto}><Icono nombre="puntos" tam={18} /></BotonIcono>
        )}>
          <ItemMenu onClick={onVer}>Ver lo que llegó</ItemMenu>
          <ItemMenu onClick={() => pausar(!activo)}>{activo ? 'Pausar' : 'Reanudar'}</ItemMenu>
          {e.verificada
            ? <ItemMenu deshabilitado descripcion="La maneja tu conexión con Stripe o Calendly">Cambiar dirección</ItemMenu>
            : <ItemConfirmar onConfirmar={rotar} confirmar="¿Cambiarla? La vieja deja de andar">Cambiar dirección</ItemConfirmar>}
        </Menu>
      </div>
      <Direccion url={url} enmascarar />
    </div>
  );
}

function Historial({ filtro, setFiltro, deEndpoint, setDeEndpoint, abierto, setAbierto, onCambio, onVerLead }: {
  filtro: string; setFiltro: (f: string) => void; deEndpoint: any | null; setDeEndpoint: (e: any | null) => void;
  abierto?: boolean; setAbierto: (v: boolean) => void; onCambio?: () => void; onVerLead?: (id: string) => void;
}) {
  const aviso = useAviso();
  const [reintentando, setReintentando] = useState(false);
  const [abiertoId, setAbiertoId] = useState<number | null>(null);
  const { datos: eventos, error, recargar } = useCarga(() => {
    const p = new URLSearchParams({ limite: '60' });
    if (filtro) p.set('estado', filtro);
    if (deEndpoint) p.set('endpoint_id', deEndpoint.id);
    return api<any[]>(`/webhooks/eventos?${p}`);
  }, [filtro, deEndpoint?.id]);

  async function reintentarTodos() {
    setReintentando(true);
    try {
      const r = await api<any>('/webhooks/reprocesar-errores', { method: 'POST' });
      aviso.exito(`Reintentamos ${plural(r.intentados, 'aviso', 'avisos')}: ${r.recuperados === 1 ? 'se recuperó 1' : `se recuperaron ${fmtNum(r.recuperados)}`}.`);
      await recargar(true); onCambio?.();
    } catch (e: any) { aviso.error(e.message); } finally { setReintentando(false); }
  }
  async function reprocesar(id: number) {
    try {
      const r = await api<any>(`/webhooks/eventos/${id}/reprocesar`, { method: 'POST' });
      if (r.estado === 'procesado') aviso.exito('Listo: esta vez entró bien.');
      else aviso.error(`Sigue con error: ${EXPLICA_CODIGO[r.codigo] ?? r.error ?? 'revisá los datos'}`);
      await recargar(true); onCambio?.();
    } catch (e: any) { aviso.error(e.message); }
  }

  const conError = eventos?.filter((e) => e.estado === 'error').length ?? 0;
  const vacio = filtro === 'error'
    ? <Vacio compacto icono={<span style={{ color: 'var(--status-good)' }}>✓</span>} titulo="Nada con error" texto="Todo lo que llegó entró bien." />
    : filtro === 'duplicado'
      ? <Vacio compacto icono="↺" titulo="No llegó nada repetido" />
      : filtro === 'procesado'
        ? <Vacio compacto icono="·" titulo="Todavía no entró nada" texto="Cuando una app mande datos, vas a verlos acá." />
        : <Vacio compacto icono="·" titulo="Todavía no llegó nada" texto="Cuando una app mande datos, vas a verlos acá." />;

  return (
    <Desplegable clave={abierto === undefined ? 'tec_historial' : undefined} abierto={abierto} onCambiar={setAbierto}
      titulo={`Historial de lo que llegó${eventos ? ` (${eventos.length}${eventos.length === 60 ? '+' : ''})` : ''}`}
      subtitulo="Todo se guarda antes de procesarlo: si algo falla, no se pierde y se puede reprocesar.">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {ESTADOS.map((s) => <Chip key={s.id || 'todo'} activo={filtro === s.id} onClick={() => setFiltro(s.id)}>{s.nombre}</Chip>)}
          {deEndpoint && (
            <Chip activo onClick={() => setDeEndpoint(null)} icono={<LogoApp app={logoDe(deEndpoint)} tam={13} />}>
              De: {nombreDe(deEndpoint)} ✕
            </Chip>
          )}
          {conError > 0 && filtro !== 'procesado' && (
            <Boton tamano="xs" className="ml-auto" onClick={reintentarTodos} cargando={reintentando}>Reintentar {conError} con error</Boton>
          )}
        </div>
        {error && !eventos ? <ErrorCarga compacto error={error} onReintentar={() => recargar()} /> : !eventos ? <Esqueleto alto={120} /> : eventos.length === 0 ? vacio : (
          <ul className="space-y-1.5">
            <ListaDesplegable items={eventos} inicial={10} textoMas="Ver todos" render={(f) => {
              const abiertoAca = abiertoId === f.id;
              return (
                <li key={f.id} className="rounded-lg" style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>
                  <button type="button" onClick={() => setAbiertoId(abiertoAca ? null : f.id)} aria-expanded={abiertoAca}
                    className="ui-foco flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left">
                    <span className="min-w-0 flex-1">
                      {f.lead_id
                        ? <IdentidadLead id={f.lead_id} nombre={f.lead_nombre} usuario={f.ig_username} foto={f.avatar_url} />
                        : <span className="block truncate text-[13px] text-[var(--text-secondary)]">{f.codigo_error === 'firma_invalida' ? 'Aviso rechazado' : 'Sin identificar'}</span>}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      <Insignia tono={tonoDe('webhook', f.estado)}>{textoDe('webhook', f.estado)}</Insignia>
                      <span className="text-[11px] text-[var(--text-muted)]">{f.endpoint_nombre ? `${POR_SLUG_NOMBRE(f.endpoint_nombre)} · ` : ''}{fmtFecha(f.recibido_en, true)}</span>
                    </span>
                  </button>
                  {abiertoAca && (
                    <div className="ui-fundido space-y-2 px-3 pb-3">
                      {f.estado === 'error' && (
                        <p className="text-[12px]" style={{ color: 'var(--status-critical)' }}>{EXPLICA_CODIGO[f.codigo_error] ?? f.error}</p>
                      )}
                      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-md p-2.5 text-[11px] leading-relaxed" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-hairline)' }}>
                        {JSON.stringify(f.payload, null, 2)}
                      </pre>
                      <div className="flex flex-wrap gap-2">
                        {f.lead_id && onVerLead && <Boton tamano="sm" onClick={() => onVerLead(f.lead_id)}>Abrir lead</Boton>}
                        {f.estado === 'error' && <Boton tamano="sm" variante="primario" onClick={() => reprocesar(f.id)}>Reprocesar</Boton>}
                        <BotonCopiar texto={JSON.stringify(f.payload, null, 2)} etiqueta="Copiar datos" />
                      </div>
                      {f.estado === 'error' && f.error && <DetalleTecnico>{f.error}</DetalleTecnico>}
                    </div>
                  )}
                </li>
              );
            }} />
          </ul>
        )}
      </div>
    </Desplegable>
  );
}

/** "ManyChat — entrada de leads" → "ManyChat". */
function POR_SLUG_NOMBRE(nombre: string) { return String(nombre).split(' — ')[0]; }

function Entregas() {
  const aviso = useAviso();
  const { datos: entregas, error, recargar } = useCarga(() => api<any[]>('/webhooks/salida/entregas?limite=30'), []);
  async function reintentar(id: number) {
    try {
      const r = await api<any>(`/webhooks/salida/entregas/${id}/reintentar`, { method: 'POST' });
      if (r?.estado === 'entregado') aviso.exito('Listo: esta vez llegó.'); else aviso.error(`Tampoco llegó: ${explicarFallo(r ?? {})}`);
      await recargar(true);
    } catch (e: any) { aviso.error(e.message); }
  }
  return (
    <Desplegable clave="tec_entregas" titulo={`Avisos enviados a otras apps${entregas ? ` (${entregas.length})` : ''}`}
      subtitulo="Lo que el CRM le mandó a Zapier, Make y las demás apps conectadas.">
      {error && !entregas ? <ErrorCarga compacto error={error} onReintentar={() => recargar()} /> : !entregas ? <Esqueleto alto={80} /> : entregas.length === 0 ? (
        <Vacio compacto icono="·" titulo="Todavía no mandamos avisos" texto="Cuando conectes una app en «Zapier / Make → Avisar a otra app», vas a verlos acá." />
      ) : (
        <ul className="space-y-1.5">
          <ListaDesplegable items={entregas} inicial={8} render={(f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>
              <span className="min-w-0 flex-1">
                <b className="text-[13px]">{f.tipo_evento === 'prueba' ? 'Aviso de prueba' : textoDe('evento', f.tipo_evento)}</b>
                <span className="text-[var(--text-secondary)]"> → {f.suscripcion}</span>
                {f.estado === 'error' && <span className="block text-[var(--text-secondary)]">{explicarFallo(f)}</span>}
              </span>
              <Insignia tono={tonoDe('entrega', f.estado)}>{textoDe('entrega', f.estado)}</Insignia>
              <span className="text-[var(--text-muted)]">{fmtFecha(f.creado_en, true)}</span>
              {f.estado === 'error' && <Boton tamano="xs" onClick={() => reintentar(f.id)}>Reintentar</Boton>}
            </li>
          )} />
        </ul>
      )}
    </Desplegable>
  );
}

function AppPropia({ ig, onCambio }: { ig?: any; onCambio?: () => void }) {
  const aviso = useAviso();
  const [volviendo, setVolviendo] = useState(false);
  if (!ig) return null;
  const plataforma = Boolean(ig.app_plataforma_disponible ?? ig.app_de_plataforma);
  const propia = Boolean(ig.tiene_app);
  async function volver() {
    setVolviendo(true);
    try {
      await api('/instagram/app', { method: 'DELETE' });
      aviso.exito('Listo: volviste a la app de InfoCRM. Reconectá Instagram desde su guía.');
      onCambio?.();
    } catch (e: any) { aviso.error(e.message); } finally { setVolviendo(false); }
  }
  return (
    <Desplegable clave="tec_app_meta" icono={<LogoApp app="instagram" tam={16} />}
      titulo="Usar mi propia app de Meta (avanzado)"
      subtitulo={propia ? `Estás usando tu propia app (identificador ${ig.app_id}).` : plataforma ? 'Hoy usás la app de InfoCRM (lo recomendado).' : 'Instagram se conecta con tu propia app de Meta.'}>
      <div className="space-y-4">
        {plataforma && !propia && (
          <p className="text-[12px] text-[var(--text-secondary)]">Usá tu propia app solo si te lo pidió quien te ayuda con lo técnico: vas a tener que configurar los avisos de Meta y pedir la aprobación de tu app.</p>
        )}
        <FormApp ig={ig} onGuardada={() => onCambio?.()} />
        {(propia || !plataforma) && (
          <div className="space-y-2">
            <div className="text-[13px] font-semibold">Avisos de Meta (DMs y comentarios al instante)</div>
            <AvisosMeta ig={ig} />
          </div>
        )}
        {propia && plataforma && (
          <BotonConfirmar onConfirmar={volver} confirmar="¿Volver? Tocá de nuevo" variante="secundario">
            {volviendo ? 'Volviendo…' : 'Volver a la app de InfoCRM'}
          </BotonConfirmar>
        )}
      </div>
    </Desplegable>
  );
}

function OtrasClaves() {
  const aviso = useAviso();
  const { datos: claves, error, recargar } = useCarga(() => api<any[]>('/ux/integraciones/claves'), []);
  const [creando, setCreando] = useState(false);
  const [nombre, setNombre] = useState('');
  const [nueva, setNueva] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setOcupado(true);
    try {
      const r = await api<any>('/api-keys', { method: 'POST', json: { nombre: nombre.trim() } });
      setNueva(r.clave);
      setNombre('');
      await recargar(true);
    } catch (err: any) { aviso.error(err.message); } finally { setOcupado(false); }
  }
  async function quitar(id: string) {
    try { await api(`/api-keys/${id}`, { method: 'DELETE' }); aviso.exito('Listo: esa clave ya no tiene acceso.'); await recargar(true); }
    catch (err: any) { aviso.error(err.message); }
  }

  return (
    <Desplegable clave="tec_claves" titulo={`Otras conexiones técnicas${claves ? ` (${claves.length})` : ''}`}
      subtitulo="Claves de API para scripts o programas propios (las de Claude están en «Tu Claude»)."
      derecha={<BotonIcono etiqueta="Crear una clave" variante="primario" onClick={() => { setNueva(null); setCreando(true); }}><Icono nombre="mas" tam={16} /></BotonIcono>}>
      {error && !claves ? <ErrorCarga compacto error={error} onReintentar={() => recargar()} /> : !claves ? <Esqueleto alto={48} /> : claves.length === 0 ? (
        <p className="text-[12px] text-[var(--text-muted)]">No hay otras claves. Tocá + para crear una.</p>
      ) : (
        <ul className="space-y-1.5">
          {claves.map((c) => (
            <li key={c.id} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{c.nombre}</div>
                <div className="text-[12px] text-[var(--text-secondary)]">{c.ultimo_uso_en ? `Usada ${hace(c.ultimo_uso_en)}` : `Creada ${hace(c.creado_en)} · sin usar`} · empieza con {c.prefijo}</div>
              </div>
              <BotonConfirmar tamano="xs" variante="fantasma" onConfirmar={() => quitar(c.id)} confirmar="¿Quitar? Tocá de nuevo">Quitar acceso</BotonConfirmar>
            </li>
          ))}
        </ul>
      )}
      <Dialogo abierto={creando} onCerrar={() => { setCreando(false); setNueva(null); }} titulo="Nueva clave técnica"
        descripcion="Para conectar un programa propio a la API del CRM.">
        {nueva ? (
          <div className="space-y-2 pb-1">
            <Direccion url={nueva} etiqueta="Tu clave (se muestra una sola vez)" secreta />
            <Boton variante="primario" onClick={() => { setCreando(false); setNueva(null); }}>Listo</Boton>
          </div>
        ) : (
          <form onSubmit={crear} className="space-y-3 pb-1">
            <Campo etiqueta="Nombre (para reconocerla)">
              <Entrada value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Script de reportes" maxLength={60} />
            </Campo>
            <Boton type="submit" variante="primario" cargando={ocupado} disabled={!nombre.trim()}>Crear clave</Boton>
          </form>
        )}
      </Dialogo>
    </Desplegable>
  );
}
