import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fmtFecha, fmtNum, hace, plural } from '../../api';
import {
  Boton, BotonConfirmar, Campo, Chip, Entrada, EsqueletoPantalla, PasosGuiados, Verificacion, useAviso, useEsMovil,
} from '../../ui';
import PruebaEnVivo from './PruebaEnVivo';
import { B, Bloque, Direccion, Instrucciones, UltimosLlegados, useFuente, usePaso, type Subpaso } from './comun';
import { LogoApp, type App } from './LogoApp';
import { useConexiones, recargarConexiones } from './useConexiones';
import { estadoActual } from './useGuiaUrl';

// Guía para las integraciones que MANDAN datos al CRM: ManyChat, la agenda
// (Calendly, Cal.com…) y los pagos (Stripe, Hotmart…).
//  · Por dirección: copiar la dirección → pegarla en la otra app → probar.
//    La dirección se crea recién cuando el usuario la pide.
//  · Pegando una clave (Calendly, Stripe): el CRM crea solo el aviso en la
//    otra app y guarda el secreto de firma. Sin Zapier y sin nombres técnicos.

export type ClaseEntrada = 'manychat' | 'agenda' | 'pagos' | 'zapier';
type TipoFuente = 'manychat' | 'agenda' | 'stripe' | 'hotmart' | 'pagos' | 'zapier';

interface Base {
  id: string; nombre: string; logo: App; tipo: TipoFuente; app: string;
  prueba: React.ReactNode; causas: React.ReactNode[];
  /** Explicación del error según el código del servidor (sin_identidad…). */
  errores?: Partial<Record<string, React.ReactNode>>;
  nota?: React.ReactNode;
}
interface PorDireccion extends Base { modo: 'direccion'; pasos: () => Subpaso[] }
interface PorClave extends Base {
  modo: 'clave'; conexion: 'calendly' | 'stripe';
  abrir: { url: string; texto: string };
  pasosClave: Subpaso[];
  campo: { etiqueta: string; placeholder: string; ayuda: React.ReactNode };
  validar: (v: string) => string | null;
}
type Proveedor = PorDireccion | PorClave;

const MAL_PEGADA = 'La dirección quedó mal pegada (tiene que ser exactamente la del paso 1).';

const JSON_PAGO = JSON.stringify({
  event: 'venta', email: 'email del comprador', ig_username: 'su @ de Instagram (si lo tenés)',
  amount: 497, currency: 'EUR', product: 'Nombre del programa',
}, null, 2);
const JSON_LEAD = JSON.stringify({
  ig_username: 'usuario de Instagram', first_name: 'nombre', email: 'email', palabra_clave: 'palabra o campaña de donde vino',
}, null, 2);
const JSON_AGENDA = JSON.stringify({
  event: 'reunion_agendada', email: 'email del invitado', name: 'nombre', ig_username: 'su @ de Instagram (si lo preguntás)', start_time: 'fecha y hora',
}, null, 2);

const CLAVE_PALABRA = 'infocrm_palabra_manychat';
function leerPalabra() { try { return localStorage.getItem(CLAVE_PALABRA) ?? ''; } catch { return ''; } }

/** El JSON de ManyChat con la palabra clave completada en vivo. */
function JsonManychat() {
  const [palabra, setPalabra] = useState(leerPalabra);
  useEffect(() => { try { localStorage.setItem(CLAVE_PALABRA, palabra); } catch { /* sin almacenamiento */ } }, [palabra]);
  const texto = JSON.stringify({
    id: '{{user_id}}',
    first_name: '{{first_name}}',
    ig_username: '{{ig_username}}',
    email: '{{email}}',
    custom_fields: { palabra_clave: palabra.trim().toUpperCase() || 'TU_PALABRA', ig_media_id: '{{last_commented_media_id}}' },
  }, null, 2);
  return (
    <div className="space-y-2">
      <Campo etiqueta="¿Cuál es tu palabra clave?" ayuda="La que la gente comenta en tu reel. La completamos en el texto de abajo.">
        <Entrada value={palabra} onChange={(e) => setPalabra(e.target.value)} placeholder="Ej. QUIERO" autoComplete="off" autoCapitalize="characters" maxLength={40} />
      </Campo>
      <Bloque titulo="Body (JSON) · listo para pegar" texto={texto} />
      <p className="text-[11px] text-[var(--text-muted)]">Si ManyChat no reconoce las partes entre {'{{ }}'}, insertalas con <B>+ Variable</B>.</p>
    </div>
  );
}

const PROVEEDORES: Record<ClaseEntrada, Proveedor[]> = {
  manychat: [{
    id: 'manychat', nombre: 'ManyChat', logo: 'manychat', modo: 'direccion', tipo: 'manychat', app: 'ManyChat',
    pasos: () => [
      <>Abrí el flujo de tu palabra clave y tocá <B>+ Acción → Solicitud externa</B> (External Request).</>,
      <>Método <B>POST</B> y en <B>URL</B> pegá tu dirección.</>,
      { texto: <>En <B>Body</B> elegí <B>JSON</B> y pegá esto:</>, extra: <JsonManychat /> },
      <>Guardá y <B>publicá</B> el flujo.</>,
    ],
    nota: <>Atajo: en vez de pegar el JSON, en Body podés tocar <B>Add Full Contact Data</B>. Entra igual, con la última palabra que escribió la persona.</>,
    prueba: <>Comentá tu palabra clave en un reel desde otra cuenta, o tocá <B>Test Request</B> dentro de la Solicitud externa.</>,
    causas: [
      MAL_PEGADA,
      'La Solicitud externa no está en el flujo que se disparó, o el flujo no está publicado.',
      'Tu ManyChat no es Pro: la Solicitud externa solo está en el plan pago.',
    ],
    errores: { sin_identidad: <>Llegó, pero <b>sin el @ de Instagram ni el email</b> de la persona. En ManyChat, revisá que el Body tenga <B>{'{{ig_username}}'}</B>.</> },
  }],
  agenda: [
    {
      id: 'calendly', nombre: 'Calendly', logo: 'calendly', modo: 'clave', conexion: 'calendly', tipo: 'agenda', app: 'Calendly',
      abrir: { url: 'https://calendly.com/integrations/api_webhooks', texto: 'Abrir Calendly' },
      pasosClave: [
        <>En Calendly: <B>Integraciones → API y webhooks</B>.</>,
        <>Tocá <B>Generar token</B> (token personal), ponele de nombre <B>InfoCRM</B> y copialo.</>,
      ],
      campo: { etiqueta: 'Tu token de Calendly', placeholder: 'eyJ…', ayuda: 'Es un texto largo que empieza con «eyJ». Al pegarlo se conecta solo.' },
      validar: (v) => (/\s/.test(v) ? 'El token no lleva espacios: copialo de nuevo.' : v.length < 20 ? 'Parece incompleto: copiá el token entero.' : null),
      nota: <>Los avisos de Calendly necesitan un plan pago (Standard o superior). Si no lo tenés, elegí <B>Otra agenda</B>.</>,
      prueba: <>Agendate una reunión de prueba con otro email (o cancelá una que tengas).</>,
      causas: [
        'El aviso de Calendly puede tardar unos segundos: esperá un poco.',
        'Agendaste en un tipo de reunión de otra persona del equipo: este token solo ve tus reuniones.',
        'Tu plan de Calendly dejó de ser pago (los avisos necesitan Standard o superior).',
      ],
      errores: { sin_identidad: <>Llegó la reunión, pero <b>sin el email</b> de la persona.</> },
    },
    {
      id: 'calcom', nombre: 'Cal.com', logo: 'calcom', modo: 'direccion', tipo: 'agenda', app: 'Cal.com',
      pasos: () => [
        <>Entrá a <B>Configuración → Desarrollador → Webhooks</B> y tocá <B>Nuevo</B>.</>,
        <>Pegá tu dirección en <B>URL del suscriptor</B>.</>,
        <>En eventos dejá <B>Reserva creada</B> (y si querés, <B>Reserva cancelada</B>).</>,
        <>Guardá.</>,
      ],
      prueba: <>Agendate una reunión de prueba con otro email.</>,
      causas: [MAL_PEGADA, 'El webhook quedó desactivado en Cal.com.', 'No marcaste «Reserva creada».'],
      errores: { sin_identidad: <>Llegó la reserva, pero <b>sin el email</b> de la persona.</> },
    },
    {
      id: 'otra', nombre: 'Otra agenda', logo: 'zapier', modo: 'direccion', tipo: 'agenda', app: 'Zapier o Make',
      pasos: () => [
        <>Creá un Zap (o escenario de Make) que arranque con tu agenda: <B>reunión nueva</B>.</>,
        <>Acción: <B>Webhooks by Zapier → POST</B> (en Make: <B>HTTP → Make a request</B>) y en URL pegá tu dirección.</>,
        { texto: <>Tipo de datos <B>JSON</B>, con estos datos (los nombres tal cual):</>, extra: <Bloque titulo="Datos (JSON)" texto={JSON_AGENDA} /> },
        <>Publicá el Zap.</>,
      ],
      prueba: <>Agendate una reunión de prueba con otro email.</>,
      causas: [MAL_PEGADA, 'El Zap o escenario no está publicado.', 'No mandaste el email ni el @ de la persona.'],
      errores: { sin_identidad: <>Llegó, pero <b>sin el email ni el @</b> de la persona: mandá <B>email</B> o <B>ig_username</B>.</> },
    },
  ],
  pagos: [
    {
      id: 'stripe', nombre: 'Stripe', logo: 'stripe', modo: 'clave', conexion: 'stripe', tipo: 'stripe', app: 'Stripe',
      abrir: { url: 'https://dashboard.stripe.com/apikeys/create?name=InfoCRM', texto: 'Abrir Stripe' },
      pasosClave: [
        <>En Stripe: <B>Desarrolladores → Claves de API → Crear clave restringida</B>.</>,
        <>Nombre: <B>InfoCRM</B>. En <B>Webhook Endpoints</B> elegí <B>Escritura</B>: es el único permiso que hace falta.</>,
        <>Tocá <B>Crear clave</B> y copiala (empieza con <B>rk_live_</B>).</>,
      ],
      campo: { etiqueta: 'Tu clave restringida de Stripe', placeholder: 'rk_live_…', ayuda: 'Empieza con «rk_live_» (o «rk_test_» para probar). Al pegarla se conecta sola.' },
      validar: (v) => {
        if (/^pk_/.test(v)) return 'Esa es la clave pública (pk_…). Necesitamos una clave restringida: empieza con «rk_».';
        if (!/^(rk|sk)_(live|test)_[A-Za-z0-9]{8,}$/.test(v)) return 'Tiene que empezar con «rk_live_» (o «rk_test_» para probar) y no llevar espacios.';
        return null;
      },
      nota: <>Ventas y devoluciones llegan solas y <b>verificadas</b> con la firma de Stripe. No hace falta elegir eventos.</>,
      prueba: <>Hacé una compra (con una clave <B>rk_test_</B>, una compra de prueba) o reenviá un evento desde Stripe.</>,
      causas: [
        'Pegaste una clave de prueba (rk_test_) y la compra fue real, o al revés.',
        'El pago todavía no terminó: Stripe avisa cuando se completa el checkout.',
        'La compra no fue por el checkout de Stripe (p. ej. con un link de otra plataforma).',
      ],
      errores: { sin_identidad: <>Llegó el pago, pero <b>sin el email del comprador</b>. En Stripe, pedí el email en el checkout.</> },
    },
    {
      id: 'hotmart', nombre: 'Hotmart', logo: 'hotmart', modo: 'direccion', tipo: 'hotmart', app: 'Hotmart',
      pasos: () => [
        <>Entrá a <B>Herramientas → Webhook</B> y tocá <B>Registrar webhook</B>.</>,
        <>Elegí tu producto y la versión <B>2.0</B>.</>,
        <>Pegá tu dirección y marcá <B>Compra aprobada</B>, <B>Compra reembolsada</B> y <B>Contracargo</B>.</>,
        <>Guardá.</>,
      ],
      prueba: <>Usá el botón de prueba del webhook en Hotmart o hacé una compra de prueba.</>,
      causas: [MAL_PEGADA, 'El webhook está registrado para otro producto.', 'Elegiste la versión 1.0 en vez de la 2.0.'],
      errores: { sin_identidad: <>Llegó la compra, pero <b>sin el email del comprador</b>.</> },
    },
    {
      id: 'otra', nombre: 'Otra plataforma', logo: 'pagos', modo: 'direccion', tipo: 'pagos', app: 'tu plataforma de pagos',
      pasos: () => [
        <>Buscá <B>Webhooks</B> o <B>Notificaciones</B> y pegá tu dirección para el aviso de <B>pago aprobado</B>.</>,
        { texto: <>Si podés elegir qué datos mandar, mandá algo así (para devoluciones, <B>"event": "reembolso"</B>):</>, extra: <Bloque titulo="Datos (JSON)" texto={JSON_PAGO} /> },
        <>¿No tiene avisos? Conectala con <B>Zapier</B> o <B>Make</B>: «pago nuevo» → POST a tu dirección con esos datos.</>,
      ],
      prueba: <>Hacé un pago de prueba.</>,
      causas: [MAL_PEGADA, 'Tu plataforma no tiene avisos: conectala con Zapier o Make.', 'El aviso no trae el email ni el @ del comprador.'],
      errores: { sin_identidad: <>Llegó el pago, pero <b>sin el email ni el @</b> del comprador.</> },
    },
  ],
  zapier: [{
    id: 'zapier', nombre: 'Zapier / Make', logo: 'zapier', modo: 'direccion', tipo: 'zapier', app: 'Zapier o Make',
    pasos: () => [
      <>Al final de tu Zap (o escenario) agregá <B>Webhooks by Zapier → POST</B> (en Make: <B>HTTP → Make a request</B>).</>,
      <>URL: pegá tu dirección. Tipo de datos: <B>JSON</B>.</>,
      { texto: <>Mandá estos datos (con los nombres tal cual):</>, extra: <Bloque titulo="Datos (JSON)" texto={JSON_LEAD} /> },
    ],
    prueba: <>Ejecutá el Zap o escenario una vez (en Zapier: <B>Test step</B>).</>,
    causas: [MAL_PEGADA, 'El Zap o escenario no está publicado.', 'No mandaste ningún dato que identifique a la persona (@ o email).'],
    errores: { sin_identidad: <>Llegó, pero <b>sin el @ ni el email</b> de la persona: mandá <B>ig_username</B> o <B>email</B>.</> },
  }],
};

/** Slugs de la dirección de cada tipo (para contar lo que llegó por app). */
const SLUG: Record<TipoFuente, string> = {
  manychat: 'manychat-leads', agenda: 'reunion-agendada', stripe: 'stripe-ventas', hotmart: 'hotmart-ventas', pagos: 'venta', zapier: 'zapier-leads',
};

function explicador(prov: Proveedor) {
  return (codigo: string | null) => {
    if (codigo && prov.errores?.[codigo]) return prov.errores[codigo];
    if (codigo === 'firma_invalida') return <>Llegó un aviso con una firma que no coincide y lo descartamos por seguridad. Si reconectaste {prov.app}, probá de nuevo.</>;
    return <>Llegó, pero hubo un problema al guardarlo. Revisá los datos que manda {prov.app}.</>;
  };
}

export interface PropsGuiaEntrada {
  clase: ClaseEntrada;
  /** Proveedor que ya está en uso (para preseleccionarlo). */
  preferido?: string;
  onCambio?: () => void;
  onVerLead?: (leadId: string) => void;
  onListo?: () => void;
  onProgreso?: (texto: string | null) => void;
}

export default function GuiaEntrada({ clase, preferido, onCambio, onVerLead, onListo, onProgreso }: PropsGuiaEntrada) {
  const lista = PROVEEDORES[clase];
  const { resumen } = useConexiones();
  const [params, setParams] = useSearchParams();
  const pedido = params.get('app');
  const prov = lista.find((p) => p.id === pedido) ?? lista.find((p) => p.id === preferido) ?? lista[0];
  const cambio = () => { void recargarConexiones(); onCambio?.(); };

  function elegir(id: string) {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set('app', id);
      p.delete('paso');
      return p;
    }, { replace: true, state: estadoActual() });
  }

  // Punto y contador en cada chip: qué app ya está funcionando.
  const datos = (p: Proveedor) => {
    const ep = resumen?.endpoints?.find((e) => e.slug === SLUG[p.tipo]);
    const n = ep ? Number(ep.total_recibidos) - Number(ep.total_errores) : 0;
    const porClave = p.modo === 'clave' && Boolean(resumen?.conexiones?.[p.conexion]?.conectado);
    // La agenda comparte una dirección: el número no se puede atribuir a cada app.
    const contable = clase !== 'agenda';
    return { n: contable && n > 0 ? n : 0, conectado: porClave || (contable && n > 0) };
  };

  return (
    <div className="space-y-4">
      {lista.length > 1 && (
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-[var(--text-secondary)]">¿Cuál usás?</div>
          <div className="flex flex-wrap gap-1.5">
            {lista.map((p) => {
              const d = datos(p);
              return (
                <Chip key={p.id} activo={p.id === prov.id} onClick={() => elegir(p.id)} contador={d.n > 0 ? d.n : undefined}
                  icono={(
                    <span className="relative inline-flex">
                      <LogoApp app={p.logo} tam={14} />
                      {d.conectado && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full ring-2 ring-[var(--surface-1)]" style={{ background: 'var(--status-good)' }} aria-label="funcionando" />}
                    </span>
                  )}>
                  {p.nombre}
                </Chip>
              );
            })}
          </div>
        </div>
      )}

      {prov.modo === 'clave'
        ? <ConClave key={prov.id} prov={prov} onCambio={cambio} onVerLead={onVerLead} onListo={onListo} onProgreso={onProgreso} />
        : <ConDireccion key={prov.id} prov={prov} onCambio={cambio} onVerLead={onVerLead} onListo={onListo} onProgreso={onProgreso} />}
    </div>
  );
}

interface PropsPasos { onCambio: () => void; onVerLead?: (id: string) => void; onListo?: () => void; onProgreso?: (t: string | null) => void }

/** Copiar la dirección → pegarla en la otra app → probar. */
function ConDireccion({ prov, onCambio, onVerLead, onListo, onProgreso }: PropsPasos & { prov: PorDireccion }) {
  const aviso = useAviso();
  const movil = useEsMovil();
  const { fuente, error, cargando, crear, setFuente } = useFuente(prov.tipo, { crear: false });
  const [creando, setCreando] = useState(false);
  const [refrescar, setRefrescar] = useState(0);
  const recibidos = Number(fuente?.total_recibidos ?? 0);
  const buenos = recibidos - Number(fuente?.total_errores ?? 0);
  const yaFunciona = buenos > 0;
  const configurado = Boolean(fuente?.configurado_en);
  const { paso, estado, siguiente, ir } = usePaso(3, yaFunciona || configurado ? 2 : 0, 'paso');

  useEffect(() => { onProgreso?.(fuente || !cargando ? `Paso ${paso + 1} de 3` : null); }, [paso, fuente, cargando, onProgreso]);

  async function pedirDireccion() {
    setCreando(true);
    try { await crear(); onCambio(); } catch (e: any) { aviso.error(e.message); } finally { setCreando(false); }
  }

  async function yaLaPegue() {
    if (fuente && !fuente.configurado_en) {
      try {
        const f = await api<any>(`/ux/integraciones/fuente/${fuente.id}/configurado`, { method: 'POST' });
        setFuente(f);
        onCambio();
      } catch { /* no frena: el paso sigue */ }
    }
    siguiente();
  }

  if (error) return <Verificacion estado="error" error={error} />;
  if (cargando) return <EsqueletoPantalla tarjetas={0} filas={3} />;

  return (
    <div className="space-y-4">
      {yaFunciona && fuente && (
        <Verificacion estado="ok" ok={<>Funcionando: {buenos === 1 ? 'ya llegó' : 'ya llegaron'} <b className="cifras">{fmtNum(buenos)}</b>{fuente.ultimo_evento_en ? <> · el último {hace(fuente.ultimo_evento_en)}</> : null}</>} />
      )}
      {!yaFunciona && configurado && fuente?.configurado_en && (
        <Verificacion estado="esperando" esperando={<>Lo configuraste el {fmtFecha(fuente.configurado_en)} · todavía no llegó nada. Probá que llega.</>} />
      )}
      <PasosGuiados pasos={[
        {
          titulo: 'Copiá tu dirección',
          estado: estado(0),
          resumen: <button type="button" className="underline" onClick={() => ir(0)}>Ver la dirección</button>,
          contenido: fuente ? (
            <div className="space-y-2">
              <Direccion url={fuente.url} secreta onCopiado={() => window.setTimeout(siguiente, 900)} />
              <button type="button" onClick={siguiente} className="ui-foco text-[12px] font-medium underline text-[var(--text-secondary)]">Ya la tengo, seguir</button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[13px] text-[var(--text-secondary)]">Es tu dirección personal para {prov.app}: es secreta, como una contraseña.</p>
              <Boton variante="primario" onClick={pedirDireccion} cargando={creando} anchoCompleto={movil}>Mostrar mi dirección</Boton>
            </div>
          ),
        },
        {
          titulo: `Pegala en ${prov.app}`,
          estado: estado(1),
          resumen: <button type="button" className="underline" onClick={() => ir(1)}>Ver los pasos</button>,
          contenido: (
            <div className="space-y-3">
              <Instrucciones pasos={prov.pasos()} />
              {prov.nota && <p className="text-[12px] text-[var(--text-muted)]">{prov.nota}</p>}
              <div className="flex flex-wrap gap-2">
                <Boton variante="primario" onClick={yaLaPegue}>Listo, ya la pegué</Boton>
                <Boton variante="fantasma" onClick={() => ir(0)}>Volver</Boton>
              </div>
            </div>
          ),
        },
        {
          titulo: 'Probá que llega',
          estado: estado(2),
          contenido: fuente ? (
            <div className="space-y-3">
              <PruebaEnVivo tipo="webhook" endpointId={fuente.id} instruccion={prov.prueba} causas={prov.causas}
                clave={`${prov.id}_${fuente.id}`} explicarError={explicador(prov)} onVerPaso={() => ir(1)}
                onVerLead={onVerLead} onListo={onListo}
                onOk={() => { setRefrescar((n) => n + 1); onCambio(); }} />
              <UltimosLlegados endpointId={fuente.id} refrescar={refrescar} onVerLead={onVerLead} />
            </div>
          ) : (
            <Boton onClick={() => ir(0)}>Primero pedí tu dirección</Boton>
          ),
        },
      ]} />
    </div>
  );
}

/** Calendly / Stripe: crear una clave en la app → pegarla acá → probar. */
function ConClave({ prov, onCambio, onVerLead, onListo, onProgreso }: PropsPasos & { prov: PorClave }) {
  const aviso = useAviso();
  const movil = useEsMovil();
  const { resumen } = useConexiones();
  const conexion = resumen?.conexiones?.[prov.conexion] ?? null;
  const conectado = Boolean(conexion?.conectado);
  const ep = resumen?.endpoints?.find((e) => e.slug === SLUG[prov.tipo]) ?? null;
  const buenos = ep ? Number(ep.total_recibidos) - Number(ep.total_errores) : 0;
  const { paso, estado, siguiente, ir } = usePaso(3, conectado ? 2 : 0, 'paso');
  const [valor, setValor] = useState('');
  const [errorCampo, setErrorCampo] = useState<string | null>(null);
  const [conectando, setConectando] = useState(false);
  const [refrescar, setRefrescar] = useState(0);
  const entrada = useRef<HTMLInputElement>(null);
  const abrioLaApp = useRef(false);
  const ruta = prov.conexion === 'calendly' ? '/ux/integraciones/calendly' : '/ux/integraciones/stripe';

  useEffect(() => { onProgreso?.(conectado ? null : `Paso ${paso + 1} de 3`); }, [paso, conectado, onProgreso]);

  // Al volver de la otra app con el paso 1 abierto: pasar a "Pegala acá" con el campo listo.
  useEffect(() => {
    if (conectado || paso !== 0) return;
    const volver = () => { if (document.visibilityState === 'visible' && abrioLaApp.current) { abrioLaApp.current = false; siguiente(); } };
    document.addEventListener('visibilitychange', volver);
    return () => document.removeEventListener('visibilitychange', volver);
  }, [conectado, paso, siguiente]);
  useEffect(() => { if (paso === 1 && !conectado) window.setTimeout(() => entrada.current?.focus({ preventScroll: true }), 80); }, [paso, conectado]);

  async function conectar(texto = valor) {
    const limpio = texto.trim();
    const problema = prov.validar(limpio);
    if (problema) { setErrorCampo(problema); return; }
    setConectando(true); setErrorCampo(null);
    try {
      const r = await api<any>(ruta, { method: 'POST', json: prov.conexion === 'calendly' ? { token: limpio } : { clave: limpio } });
      setValor('');
      aviso.exito(prov.conexion === 'calendly'
        ? `Calendly conectado${r.email ? ` como ${r.email}` : ''}${r.tipos_evento ? ` · ${plural(r.tipos_evento, 'tipo de reunión', 'tipos de reunión')}` : ''}.`
        : `Stripe conectado${r.modo === 'prueba' ? ' (modo de prueba)' : ''}: las ventas llegan solas.`);
      onCambio();
      ir(2);
    } catch (e: any) { setErrorCampo(e.message); } finally { setConectando(false); }
  }

  async function desconectar() {
    try {
      await api(ruta, { method: 'DELETE' });
      aviso.exito(`${prov.nombre} desconectado.`);
      ir(0);
      onCambio();
    } catch (e: any) { aviso.error(e.message); }
  }

  const detalleConexion = prov.conexion === 'calendly' && conexion && 'email' in conexion
    ? <>{conexion.email ? <> como <b>{conexion.email}</b></> : null}{conexion.tipos_evento ? <> · {plural(conexion.tipos_evento, 'tipo de reunión', 'tipos de reunión')}</> : null}</>
    : conexion && 'modo' in conexion ? <> {conexion.modo === 'prueba' ? '(modo de prueba)' : '(ventas reales)'} · cada aviso llega verificado</> : null;

  if (conectado) {
    return (
      <div className="space-y-4">
        <Verificacion estado={buenos > 0 ? 'ok' : 'esperando'}
          ok={<><b>{prov.nombre} conectado</b>{detalleConexion} · {buenos === 1 ? 'ya llegó 1' : `ya llegaron ${fmtNum(buenos)}`}{ep?.ultimo_evento_en ? <>, el último {hace(ep.ultimo_evento_en)}</> : null}.</>}
          esperando={<><b>{prov.nombre} conectado</b>{detalleConexion}. Todavía no llegó nada: probá que llega.</>} />
        {ep && (
          <div className="space-y-3">
            <div className="text-[13px] font-semibold">Probá que llega</div>
            <PruebaEnVivo tipo="webhook" endpointId={ep.id} instruccion={prov.prueba} causas={prov.causas}
              clave={`${prov.id}_${ep.id}`} explicarError={explicador(prov)}
              onVerLead={onVerLead} onListo={onListo}
              onOk={() => { setRefrescar((n) => n + 1); onCambio(); }} />
            <UltimosLlegados endpointId={ep.id} refrescar={refrescar} onVerLead={onVerLead} />
          </div>
        )}
        <div className="flex justify-end">
          <BotonConfirmar tamano="sm" variante="fantasma" onConfirmar={desconectar} confirmar="¿Desconectar? Tocá de nuevo">Desconectar {prov.nombre}</BotonConfirmar>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <PasosGuiados pasos={[
        {
          titulo: `Creá tu ${prov.conexion === 'calendly' ? 'token' : 'clave'} en ${prov.app}`,
          estado: estado(0),
          resumen: <button type="button" className="underline" onClick={() => ir(0)}>Ver cómo</button>,
          contenido: (
            <div className="space-y-3">
              <a href={prov.abrir.url} target="_blank" rel="noreferrer" onClick={() => { abrioLaApp.current = true; }}
                className={`ui-foco inline-flex h-10 items-center justify-center gap-2 rounded-[12px] px-4 text-[13px] font-semibold text-white md:h-9 ${movil ? 'w-full' : ''}`}
                style={{ background: 'var(--accion, var(--series-1))' }}>
                <span className="flex h-5 w-5 items-center justify-center rounded-[6px] bg-white"><LogoApp app={prov.logo} tam={14} /></span>
                {prov.abrir.texto} ↗
              </a>
              <Instrucciones pasos={prov.pasosClave} />
              <Boton onClick={siguiente}>Ya lo tengo, seguir</Boton>
            </div>
          ),
        },
        {
          titulo: 'Pegalo acá',
          estado: estado(1),
          contenido: (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void conectar(); }}>
              <Campo etiqueta={prov.campo.etiqueta} error={errorCampo ?? undefined} ayuda={prov.campo.ayuda}>
                <Entrada ref={entrada} value={valor} placeholder={prov.campo.placeholder} autoComplete="off" spellCheck={false} autoCapitalize="off"
                  invalido={Boolean(errorCampo)}
                  onChange={(e) => { setValor(e.target.value); setErrorCampo(null); }}
                  onPaste={(e) => {
                    const t = e.clipboardData.getData('text').trim();
                    if (t && !prov.validar(t)) { e.preventDefault(); setValor(t); void conectar(t); }
                  }} />
              </Campo>
              {prov.nota && <p className="text-[12px] text-[var(--text-muted)]">{prov.nota}</p>}
              <div className="flex flex-wrap gap-2">
                <Boton type="submit" variante="primario" cargando={conectando} disabled={!valor.trim()}>Conectar</Boton>
                <Boton variante="fantasma" onClick={() => ir(0)}>Volver</Boton>
              </div>
            </form>
          ),
        },
        { titulo: 'Probá que llega', estado: estado(2) },
      ]} />
    </div>
  );
}

/** Para la tarjeta de Pagos: de qué app vienen las ventas ("Stripe · 12 ventas"). */
export function pagosPorApp(endpoints: Array<{ slug: string; total_recibidos: any; total_errores: any; ultimo_evento_en: string | null }>) {
  const nombres: Record<string, string> = { 'stripe-ventas': 'Stripe', 'hotmart-ventas': 'Hotmart', venta: 'Otra plataforma' };
  return endpoints
    .filter((e) => nombres[e.slug])
    .map((e) => ({ nombre: nombres[e.slug], n: Number(e.total_recibidos) - Number(e.total_errores), ultimo: e.ultimo_evento_en }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
}

export const PROVEEDORES_ENTRADA = PROVEEDORES;
