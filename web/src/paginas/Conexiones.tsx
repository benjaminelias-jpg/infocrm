import { useCallback, useEffect, useState } from 'react';
import { api, fmtNum, hace } from '../api';
import Cabecera from '../componentes/Cabecera';
import { Dialogo, Desplegable, EsqueletoPantalla, TarjetaIntegracion, useAviso } from '../ui';
import GuiaInstagram from '../componentes/integraciones/GuiaInstagram';
import GuiaEntrada from '../componentes/integraciones/GuiaEntrada';
import GuiaSalida from '../componentes/integraciones/GuiaSalida';
import GuiaClaude from '../componentes/integraciones/GuiaClaude';
import ParaTecnicos from '../componentes/integraciones/ParaTecnicos';

// Configuración = integraciones, en simple: una tarjeta por app con su estado
// (conectada / sin conectar / revisar) y UN botón. Tocarla abre una guía paso
// a paso que termina con una prueba en vivo. Lo técnico va plegado al final.

type Clave = 'instagram' | 'manychat' | 'agenda' | 'pagos' | 'zapier' | 'claude';
type EstadoTarjeta = 'conectado' | 'desconectado' | 'atencion';

const DIALOGOS: Record<Clave, { titulo: string; descripcion: string }> = {
  instagram: { titulo: 'Instagram', descripcion: 'Tus reels con métricas, y los DMs y comentarios en el Chat.' },
  manychat: { titulo: 'ManyChat', descripcion: 'Cada lead de tus palabras clave entra solo, con el reel de donde vino.' },
  agenda: { titulo: 'Agenda', descripcion: 'Cada llamada agendada mueve al lead sola en el pipeline.' },
  pagos: { titulo: 'Pagos', descripcion: 'Cada venta (y devolución) se registra sola con su importe.' },
  zapier: { titulo: 'Zapier / Make', descripcion: 'Conectá cualquier otra app, en las dos direcciones.' },
  claude: { titulo: 'Tu Claude', descripcion: 'Preguntale a Claude por tus ventas y leads, y que actúe en el CRM.' },
};

const CLAVES = Object.keys(DIALOGOS) as Clave[];

function IconoInstagram() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <defs>
        <linearGradient id="ig-grad" x1="0" y1="24" x2="24" y2="0">
          <stop offset="0" stopColor="#fcb045" /><stop offset="0.5" stopColor="#fd1d1d" /><stop offset="1" stopColor="#833ab4" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="18" height="18" rx="5" stroke="url(#ig-grad)" strokeWidth="2" />
      <circle cx="12" cy="12" r="4" stroke="url(#ig-grad)" strokeWidth="2" />
      <circle cx="17.3" cy="6.7" r="1.2" fill="url(#ig-grad)" />
    </svg>
  );
}

export default function Conexiones() {
  const aviso = useAviso();
  const [ig, setIg] = useState<any>(null);
  const [res, setRes] = useState<any>(null);
  const [integs, setIntegs] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [abierta, setAbierta] = useState<Clave | null>(() => {
    const p = new URLSearchParams(window.location.search).get('abrir');
    return CLAVES.includes(p as Clave) ? (p as Clave) : null;
  });

  const cargar = useCallback(async () => {
    try {
      const [e, r, i] = await Promise.all([
        api<any>('/instagram/estado').catch(() => null),
        api<any>('/ux/integraciones/resumen'),
        api<any[]>('/integraciones').catch(() => []),
      ]);
      setIg(e); setRes(r); setIntegs(i);
    } catch (err: any) {
      aviso.error(err.message);
    } finally { setCargando(false); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { cargar(); }, [cargar]);

  // Vuelta de Instagram (/conexiones?instagram=ok&ig=usuario): avisamos y
  // abrimos la guía en el paso siguiente (permitir mensajes + probar).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const r = p.get('instagram');
    if (!r && !p.get('abrir')) return;
    if (r === 'ok') { aviso.exito(`Instagram conectado${p.get('ig') ? ` como @${p.get('ig')}` : ''}.`); setAbierta('instagram'); }
    else if (r === 'denegado') aviso.info('Cancelaste la conexión con Instagram.');
    else if (r) { aviso.error('No se pudo conectar Instagram. Revisá los datos de la app de Meta.'); setAbierta('instagram'); }
    window.history.replaceState({}, '', '/conexiones');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cerrar = useCallback(() => { setAbierta(null); cargar(); }, [cargar]);

  if (cargando) return <div className="px-4 py-5 lg:px-8"><EsqueletoPantalla tarjetas={6} filas={0} /></div>;

  const endpoints: any[] = res?.endpoints ?? [];
  const recibidos = (pred: (e: any) => boolean) => endpoints.filter(pred).reduce((s, e) => s + Number(e.total_recibidos ?? 0), 0);
  const ultimo = (pred: (e: any) => boolean) => {
    const fechas = endpoints.filter(pred).map((e) => e.ultimo_evento_en).filter(Boolean).sort();
    return fechas[fechas.length - 1] as string | undefined;
  };
  const esPago = (e: any) => e.fuente === 'stripe' || e.fuente === 'hotmart' || e.evento_defecto === 'venta';
  const esAgenda = (e: any) => e.fuente === 'calendly';
  const esManychat = (e: any) => e.fuente === 'manychat';
  const esZapier = (e: any) => e.slug === 'zapier-leads';

  const igIntegracion = integs.find((x) => x.tipo === 'instagram');
  const dias = ig?.token_expira_en ? Math.ceil((new Date(ig.token_expira_en).getTime() - Date.now()) / 86_400_000) : null;
  const dms = Number(res?.instagram?.dms_7d ?? 0);

  const linea = (n: number, cosa: [string, string], cuando?: string) =>
    `${fmtNum(n)} ${n === 1 ? cosa[0] : cosa[1]}${cuando ? ` · último ${hace(cuando)}` : ''}`;

  const tarjetas: Array<{ clave: Clave; icono: React.ReactNode; estado: EstadoTarjeta; para: React.ReactNode; boton?: string }> = [
    {
      clave: 'instagram', icono: <IconoInstagram />,
      estado: ig?.conectado ? (dias !== null && dias <= 10 ? 'atencion' : 'conectado') : ig?.ultimo_error ? 'atencion' : 'desconectado',
      para: ig?.conectado
        ? <>@{ig.username ?? '—'} · {dms ? `${fmtNum(dms)} DMs esta semana` : 'sin DMs esta semana'}{dias !== null && dias <= 10 ? ' · vence pronto' : ''}</>
        : DIALOGOS.instagram.descripcion,
      boton: ig?.conectado ? 'Ver / probar →' : 'Conectar →',
    },
    {
      clave: 'manychat', icono: '💬',
      estado: recibidos(esManychat) > 0 ? 'conectado' : 'desconectado',
      para: recibidos(esManychat) > 0 ? linea(recibidos(esManychat), ['lead', 'leads'], ultimo(esManychat)) : DIALOGOS.manychat.descripcion,
    },
    {
      clave: 'agenda', icono: '📅',
      estado: recibidos(esAgenda) > 0 ? 'conectado' : 'desconectado',
      para: recibidos(esAgenda) > 0 ? linea(recibidos(esAgenda), ['llamada', 'llamadas'], ultimo(esAgenda)) : `${DIALOGOS.agenda.descripcion} Calendly, Cal.com…`,
    },
    {
      clave: 'pagos', icono: '💳',
      estado: recibidos(esPago) > 0 ? 'conectado' : 'desconectado',
      para: recibidos(esPago) > 0 ? linea(recibidos(esPago), ['pago', 'pagos'], ultimo(esPago)) : `${DIALOGOS.pagos.descripcion} Stripe, Hotmart…`,
    },
    {
      clave: 'zapier', icono: '⚡',
      estado: Number(res?.salientes?.activos ?? 0) > 0 || recibidos(esZapier) > 0 ? 'conectado' : 'desconectado',
      para: Number(res?.salientes?.activos ?? 0) > 0
        ? `Avisando a ${fmtNum(res.salientes.activos)} ${Number(res.salientes.activos) === 1 ? 'app' : 'apps'}${res.salientes.ultimo_envio_en ? ` · último ${hace(res.salientes.ultimo_envio_en)}` : ''}`
        : DIALOGOS.zapier.descripcion,
    },
    {
      clave: 'claude', icono: '✦',
      estado: res?.claves?.ultimo_uso_en ? 'conectado' : 'desconectado',
      para: res?.claves?.ultimo_uso_en ? `Usado ${hace(res.claves.ultimo_uso_en)}` : DIALOGOS.claude.descripcion,
    },
  ];
  const conectadas = tarjetas.filter((t) => t.estado === 'conectado').length;

  return (
    <div className="px-4 py-5 lg:px-8">
      <Cabecera titulo="Configuración" subtitulo="Conectá tus apps: tocá una tarjeta y seguí los pasos. Cada una termina con una prueba en vivo." />

      <div className="mt-5 flex items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold">Integraciones</h2>
        <span className="text-[12px] text-[var(--text-muted)]"><span className="cifras">{conectadas}</span> de {tarjetas.length} conectadas</span>
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tarjetas.map((t) => (
          <TarjetaIntegracion key={t.clave} icono={t.icono} nombre={DIALOGOS[t.clave].titulo} para={t.para}
            estado={t.estado} textoBoton={t.boton} destacada={t.clave === 'instagram' && t.estado !== 'conectado'}
            onClick={() => setAbierta(t.clave)} />
        ))}
      </div>

      <Desplegable className="mt-8" clave="conexiones_tecnicos" icono="⚙"
        titulo="Para técnicos" subtitulo="Direcciones secretas, historial de lo que llegó y avisos enviados">
        <ParaTecnicos endpoints={endpoints} onCambio={cargar} />
      </Desplegable>

      {abierta && (
        <Dialogo abierto onCerrar={cerrar} ancho={580} autoFoco={false}
          titulo={DIALOGOS[abierta].titulo} descripcion={DIALOGOS[abierta].descripcion}>
          {abierta === 'instagram' && <GuiaInstagram ig={ig} ultimoSync={igIntegracion?.ultimo_sync_en} onCambio={cargar} />}
          {abierta === 'manychat' && <GuiaEntrada clase="manychat" onCambio={cargar} />}
          {abierta === 'agenda' && <GuiaEntrada clase="agenda" onCambio={cargar} />}
          {abierta === 'pagos' && (
            <GuiaEntrada clase="pagos" onCambio={cargar}
              preferido={endpoints.find((e) => esPago(e) && Number(e.total_recibidos) > 0)?.fuente === 'stripe' ? 'stripe'
                : endpoints.find((e) => esPago(e) && Number(e.total_recibidos) > 0)?.fuente === 'hotmart' ? 'hotmart'
                  : endpoints.some((e) => esPago(e) && e.fuente === 'generico' && Number(e.total_recibidos) > 0) ? 'otra' : undefined} />
          )}
          {abierta === 'zapier' && <GuiaSalida onCambio={cargar} />}
          {abierta === 'claude' && <GuiaClaude apiUrl={res?.api_url ?? window.location.origin} onCambio={cargar} />}
        </Dialogo>
      )}
    </div>
  );
}
