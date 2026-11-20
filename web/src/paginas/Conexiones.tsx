import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fmtFecha, fmtNum, hace, plural } from '../api';
import Cabecera from '../componentes/Cabecera';
import {
  Banner, Boton, ContenidoDeslizable, Dialogo, ErrorCarga, Esqueleto, Pestanas, TarjetaIntegracion, useAviso, useParamUrl,
} from '../ui';
import { useFicha } from '../componentes/useFicha';
import GuiaInstagram, { traducirErrorInstagram } from '../componentes/integraciones/GuiaInstagram';
import GuiaEntrada, { pagosPorApp } from '../componentes/integraciones/GuiaEntrada';
import GuiaSalida from '../componentes/integraciones/GuiaSalida';
import GuiaClaude from '../componentes/integraciones/GuiaClaude';
import ParaTecnicos from '../componentes/integraciones/ParaTecnicos';
import Negocio from '../componentes/integraciones/Negocio';
import PestanaEquipo from '../componentes/integraciones/PestanaEquipo';
import { LogoApp, LogosApilados, type App } from '../componentes/integraciones/LogoApp';
import { useGuiaUrl } from '../componentes/integraciones/useGuiaUrl';
import { useConexiones, esAgenda, type ClaveApp, type EstadoApp } from '../componentes/integraciones/useConexiones';

// Configuración, en pestañas que se pasan con el dedo (y quedan en la URL):
// Conexiones · Equipo · Tu negocio · Para técnicos.
// Conexiones = una tarjeta por app con su estado real (conectado, esperando
// el primer dato, revisar, sin conectar, o "no pudimos comprobarlo" si falló
// la red: nunca "Sin conectar" por un error) y la acción justa. Tocarla abre
// una guía paso a paso (en la URL: Atrás la cierra, recargar la mantiene).

type Tab = 'conexiones' | 'equipo' | 'negocio' | 'tecnicos';
const TABS: Array<{ id: Tab; etiqueta: string }> = [
  { id: 'conexiones', etiqueta: 'Conexiones' },
  { id: 'equipo', etiqueta: 'Equipo' },
  { id: 'negocio', etiqueta: 'Tu negocio' },
  { id: 'tecnicos', etiqueta: 'Para técnicos' },
];

const APPS: Record<ClaveApp, { titulo: string; descripcion: string; logo: App }> = {
  instagram: { titulo: 'Instagram', descripcion: 'Tus reels con métricas, y los DMs y comentarios en el Chat.', logo: 'instagram' },
  manychat: { titulo: 'ManyChat', descripcion: 'Cada lead de tus palabras clave entra solo, con el reel de donde vino.', logo: 'manychat' },
  agenda: { titulo: 'Agenda', descripcion: 'Cada llamada agendada mueve al lead solo en el pipeline.', logo: 'agenda' },
  pagos: { titulo: 'Pagos', descripcion: 'Cada venta (y devolución) se registra sola con su importe.', logo: 'pagos' },
  zapier: { titulo: 'Zapier / Make', descripcion: 'Conectá cualquier otra app, en las dos direcciones.', logo: 'zapier' },
  claude: { titulo: 'Tu Claude', descripcion: 'Preguntale a Claude por tus ventas y leads.', logo: 'claude' },
};
const CLAVES = Object.keys(APPS) as ClaveApp[];
const GRUPOS: Array<{ titulo: string; apps: ClaveApp[] }> = [
  { titulo: 'Para que entren leads', apps: ['instagram', 'manychat'] },
  { titulo: 'Para agendar y cobrar', apps: ['agenda', 'pagos'] },
  { titulo: 'Extras', apps: ['zapier', 'claude'] },
];
/** Orden recomendado: la primera sin conectar lleva "Empezá por acá". */
const ORDEN: ClaveApp[] = ['instagram', 'manychat', 'agenda', 'pagos'];

type EstadoTarjeta = React.ComponentProps<typeof TarjetaIntegracion>['estado'];

const enDias = (d: number) => (d <= 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d} días`);

export default function Conexiones() {
  const aviso = useAviso();
  const ficha = useFicha();
  const [, setParams] = useSearchParams();
  const [tab, setTab] = useParamUrl<Tab>('tab', 'conexiones');
  const { resumen, ig, errorResumen, errorIg, cargando, primeraVez, estados, recargar } = useConexiones({ maxEdadMs: 0 });
  const guia = useGuiaUrl(CLAVES);
  // "Paso 2 de 3" que informa la guía abierta (se guarda junto con cuál guía lo dijo).
  const [progresoDe, setProgresoDe] = useState<{ guia: string | null; texto: string | null }>({ guia: null, texto: null });
  const [ultimoSync, setUltimoSync] = useState<string | null>(null);
  const [renovando, setRenovando] = useState(false);

  // Cuándo se trajo el contenido de Instagram (para la guía).
  useEffect(() => {
    api<any[]>('/integraciones').then((l) => setUltimoSync(l.find((x) => x.tipo === 'instagram')?.ultimo_sync_en ?? null)).catch(() => {});
  }, [ig?.conectado]);

  // Vuelta de Instagram (/conexiones?instagram=ok&ig=usuario): aviso y la guía abierta en el paso que sigue.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const r = p.get('instagram');
    if (!r) return;
    if (r === 'ok') aviso.exito(`Instagram conectado${p.get('ig') ? ` como @${p.get('ig')}` : ''}. Ahora probalo con un DM.`);
    else if (r === 'denegado') aviso.info('Cancelaste la conexión con Instagram.');
    else aviso.error('No se pudo conectar Instagram. En la guía te contamos qué pasó.');
    setParams((prev) => {
      const q = new URLSearchParams(prev);
      q.delete('instagram'); q.delete('ig');
      if (r !== 'denegado') q.set('abrir', 'instagram');
      return q;
    }, { replace: true });
    void recargar();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const progreso = progresoDe.guia === guia.abierta ? progresoDe.texto : null;
  const abiertaAhora = guia.abierta;
  const setProgreso = useCallback((texto: string | null) => setProgresoDe({ guia: abiertaAhora, texto }), [abiertaAhora]);

  const cerrarGuia = useCallback(() => { guia.cerrar(); void recargar(); }, [guia, recargar]);
  const cambio = useCallback(() => { void recargar(); }, [recargar]);

  /** "Renovar conexión" desde la tarjeta: directo a Instagram (si no hay app, abre la guía). */
  async function renovarInstagram() {
    if (!ig?.puede_conectar) { guia.abrir('instagram'); return; }
    setRenovando(true);
    try {
      const r = await api<{ url: string }>('/instagram/oauth/start');
      window.location.href = r.url;
    } catch (e: any) { aviso.error(e.message); setRenovando(false); }
  }

  // ---------- Textos de cada tarjeta según su estado ----------
  const endpoints = resumen?.endpoints ?? [];
  function tarjeta(clave: ClaveApp): { estado: EstadoTarjeta; para: React.ReactNode; detalle?: React.ReactNode; etiqueta?: string; logo: React.ReactNode; accion?: { texto: string; onClick: () => void; cargando?: boolean }; textoBoton?: string } {
    const e: EstadoApp = estados[clave];
    const base = APPS[clave];
    const configurado = e.configuradoEn ? `Lo configuraste el ${fmtFecha(e.configuradoEn)} · todavía no llegó nada` : 'Todavía no llegó nada';
    const desconocido = { estado: 'desconocido' as const, para: 'No pudimos comprobar el estado. Tus apps siguen funcionando.' };
    switch (clave) {
      case 'instagram': {
        const logo = <LogoApp app="instagram" />;
        if (e.estado === 'desconocido') return { ...desconocido, logo };
        if (e.estado === 'desconectado') return { estado: 'desconectado', para: base.descripcion, logo };
        if (e.estado === 'atencion') {
          if (e.motivo === 'error') return { estado: 'atencion', etiqueta: 'Con error', para: traducirErrorInstagram(ig?.ultimo_error ?? '').titulo, textoBoton: 'Ver qué pasó →', logo };
          if (e.motivo === 'cortado') return { estado: 'atencion', etiqueta: 'Se cortó', para: 'Los DMs no llegan ni salen: reconectala.', logo, accion: { texto: 'Reconectar', onClick: renovarInstagram, cargando: renovando } };
          return {
            estado: 'atencion', etiqueta: `Vence ${enDias(e.dias ?? 0)}`, logo,
            para: `@${ig?.username ?? '—'} · ${e.motivo === 'renovacion' ? 'no pudimos renovarla sola' : 'hay que renovarla'}`,
            detalle: <span style={{ color: 'color-mix(in srgb, var(--status-warning) 60%, var(--text-primary))' }}>Vence el {fmtFecha(ig?.token_expira_en)}</span>,
            accion: { texto: 'Renovar conexión', onClick: renovarInstagram, cargando: renovando },
          };
        }
        const dms = Number(ig?.dms_7d ?? resumen?.instagram?.dms_7d ?? 0);
        return {
          estado: 'conectado', logo, textoBoton: 'Ver / probar →',
          para: `@${ig?.username ?? '—'} · ${dms ? `${fmtNum(dms)} ${dms === 1 ? 'DM' : 'DMs'} esta semana` : 'sin DMs esta semana'}`,
          detalle: <span className="text-[var(--text-secondary)]">{ig?.se_renueva_sola ? 'La conexión se renueva sola' : ig?.token_expira_en ? `La conexión vence el ${fmtFecha(ig.token_expira_en)}` : 'La conexión no vence'}</span>,
        };
      }
      case 'manychat': {
        const logo = <LogoApp app="manychat" />;
        if (e.estado === 'desconocido') return { ...desconocido, logo };
        if (e.estado === 'conectado') return { estado: 'conectado', logo, para: `${plural(e.recibidos ?? 0, 'lead')}${e.ultimo ? ` · último ${hace(e.ultimo)}` : ''}` };
        if (e.estado === 'esperando') return { estado: 'esperando', logo, para: configurado };
        if (e.estado === 'atencion') return { estado: 'atencion', etiqueta: 'Con errores', logo, textoBoton: 'Ver qué pasó →', para: 'Llegan datos que no se pudieron guardar: revisá el paso 2.' };
        return { estado: 'desconectado', logo, para: base.descripcion };
      }
      case 'agenda': {
        const cal = resumen?.conexiones?.calendly;
        const logo = cal?.conectado ? <LogoApp app="calendly" /> : <LogosApilados apps={['calendly', 'calcom']} />;
        if (e.estado === 'desconocido') return { ...desconocido, logo };
        const n = endpoints.filter(esAgenda).reduce((s, x) => s + Number(x.total_recibidos) - Number(x.total_errores), 0);
        if (e.estado === 'conectado') return { estado: 'conectado', logo, para: `${cal?.conectado ? 'Calendly · ' : ''}${plural(n, 'llamada')}${e.ultimo ? ` · última ${hace(e.ultimo)}` : ''}` };
        if (e.estado === 'esperando') return { estado: 'esperando', logo, para: cal?.conectado ? `Calendly conectado${cal.email ? ` (${cal.email})` : ''} · todavía no llegó ninguna reunión` : configurado };
        if (e.estado === 'atencion') return { estado: 'atencion', etiqueta: 'Con errores', logo, textoBoton: 'Ver qué pasó →', para: 'Llegan reuniones que no se pudieron guardar: revisá la guía.' };
        return { estado: 'desconectado', logo, para: `${base.descripcion} Calendly, Cal.com…` };
      }
      case 'pagos': {
        const str = resumen?.conexiones?.stripe;
        const porApp = pagosPorApp(endpoints);
        const principal: App | null = str?.conectado ? 'stripe' : porApp[0]?.nombre === 'Stripe' ? 'stripe' : porApp[0]?.nombre === 'Hotmart' ? 'hotmart' : null;
        const logo = principal ? <LogoApp app={principal} /> : <LogosApilados apps={['stripe', 'hotmart']} />;
        if (e.estado === 'desconocido') return { ...desconocido, logo };
        if (e.estado === 'conectado') {
          const total = porApp.reduce((s, x) => s + x.n, 0);
          const nombres = porApp.map((x) => x.nombre);
          const quien = nombres.length > 1 ? `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}` : nombres[0] ?? '';
          return { estado: 'conectado', logo, para: `${quien ? `${quien} · ` : ''}${plural(total || (e.recibidos ?? 0), 'venta')}${e.ultimo ? ` · última ${hace(e.ultimo)}` : ''}` };
        }
        if (e.estado === 'esperando') return { estado: 'esperando', logo, para: str?.conectado ? `Stripe conectado${str.modo === 'prueba' ? ' (modo de prueba)' : ''} · todavía no llegó ninguna venta` : configurado };
        if (e.estado === 'atencion') return { estado: 'atencion', etiqueta: 'Con errores', logo, textoBoton: 'Ver qué pasó →', para: 'Llegan pagos que no se pudieron guardar: revisá la guía.' };
        return { estado: 'desconectado', logo, para: `${base.descripcion} Stripe, Hotmart…` };
      }
      case 'zapier': {
        const logo = <LogosApilados apps={['zapier', 'make']} />;
        if (e.estado === 'desconocido') return { ...desconocido, logo };
        const activos = Number(resumen?.salientes?.activos ?? 0);
        if (e.estado === 'atencion') return { estado: 'atencion', etiqueta: 'Con fallos', logo, textoBoton: 'Ver qué pasó →', para: 'Hay avisos que no llegaron: tocá para ver qué pasó y reintentar.' };
        if (e.estado === 'conectado') return { estado: 'conectado', logo, para: activos ? `Avisando a ${plural(activos, 'app')}${e.ultimo ? ` · último ${hace(e.ultimo)}` : ''}` : `Recibiendo datos${e.ultimo ? ` · último ${hace(e.ultimo)}` : ''}` };
        if (e.estado === 'esperando') return { estado: 'esperando', logo, para: configurado };
        return { estado: 'desconectado', logo, para: base.descripcion };
      }
      case 'claude':
      default: {
        const logo = <LogoApp app="claude" />;
        if (e.estado === 'desconocido') return { ...desconocido, logo };
        if (e.estado === 'conectado') return { estado: 'conectado', logo, para: `Lo usaste ${hace(e.ultimo)}` };
        if (e.estado === 'esperando') return { estado: 'esperando', logo, para: 'Conexión creada · todavía no la usaste', textoBoton: 'Probar →' };
        return { estado: 'desconectado', logo, para: base.descripcion };
      }
    }
  }

  const listas = Boolean(resumen);
  const recomendada = listas ? ORDEN.find((k) => estados[k].estado === 'desconectado') ?? null : null;
  const conectadas = CLAVES.filter((k) => estados[k].estado === 'conectado').length;

  const contenidoConexiones = primeraVez && !resumen && !errorResumen ? (
    <div className="grid gap-4 lg:grid-cols-3">
      {GRUPOS.map((g) => (
        <div key={g.titulo} className="space-y-2">
          <Esqueleto alto={14} ancho={140} />
          <Esqueleto alto={110} className="rounded-[18px]" /><Esqueleto alto={110} className="rounded-[18px]" />
        </div>
      ))}
    </div>
  ) : errorResumen && !resumen ? (
    <div className="tarjeta">
      <ErrorCarga titulo="No pudimos ver el estado de tus conexiones"
        error={{ message: `${errorResumen.message} Tus apps siguen funcionando: solo no pudimos comprobarlo.` }}
        onReintentar={() => { void recargar(); }} />
    </div>
  ) : (
    <div className="space-y-3">
      {errorResumen && (
        <Banner tono="aviso" accion={<Boton tamano="sm" onClick={() => { void recargar(); }} cargando={cargando}>Reintentar</Boton>}>
          No pudimos actualizar el estado (¿mala señal?). Te mostramos el último que vimos.
        </Banner>
      )}
      <div className="flex items-center justify-between gap-2 text-[12px] text-[var(--text-secondary)]">
        <span><span className="cifras font-semibold text-[var(--text-primary)]">{conectadas}</span> de {CLAVES.length} conectadas</span>
        {cargando && <span className="text-[var(--text-muted)]">Actualizando…</span>}
      </div>
      <div className="grid gap-x-4 gap-y-5 lg:grid-cols-3">
        {GRUPOS.map((g) => (
          <section key={g.titulo} aria-label={g.titulo}>
            <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{g.titulo}</h2>
            <div className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-1">
              {g.apps.map((k) => {
                const t = tarjeta(k);
                return (
                  <TarjetaIntegracion key={k} logo={t.logo} nombre={APPS[k].titulo} para={t.para} detalle={t.detalle}
                    estado={t.estado} etiquetaEstado={t.etiqueta} textoBoton={t.textoBoton} accion={t.accion}
                    recomendada={recomendada === k}
                    onReintentar={() => { void recargar(); }}
                    onClick={() => guia.abrir(k)} />
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );

  const k = guia.abierta;
  return (
    <div className="px-4 py-5 lg:px-8">
      <Cabecera titulo="Configuración" subtitulo="Conectá tus apps, sumá a tu equipo y cargá los datos de tu negocio." />

      <div className="sticky top-0 z-20 mt-3 md:static" style={{ background: 'var(--page-plane)' }}>
        <Pestanas pestanas={TABS} actual={tab} onCambiar={setTab} />
      </div>

      <ContenidoDeslizable pestanas={TABS} actual={tab} onCambiar={setTab} className="mt-4">
        {tab === 'conexiones' && contenidoConexiones}
        {tab === 'equipo' && <PestanaEquipo />}
        {tab === 'negocio' && <Negocio />}
        {tab === 'tecnicos' && (
          <ParaTecnicos endpoints={endpoints} onCambio={cambio} ig={ig} onCambioIg={cambio} onVerLead={ficha.abrir} />
        )}
      </ContenidoDeslizable>

      {k && (
        <Dialogo abierto onCerrar={cerrarGuia} ancho={600} autoFoco={false}
          titulo={<span className="flex items-center gap-2"><LogoApp app={APPS[k].logo} tam={20} />{APPS[k].titulo}</span>}
          descripcion={progreso ? <><b className="font-semibold text-[var(--text-secondary)]">{progreso}</b> · {APPS[k].descripcion}</> : APPS[k].descripcion}>
          {k === 'instagram' && (
            errorIg && !ig
              ? <ErrorCarga compacto titulo="No pudimos comprobar tu Instagram" error={errorIg} onReintentar={() => { void recargar(); }} />
              : <GuiaInstagram ig={ig} ultimoSync={ultimoSync} onCambio={cambio} onVerLead={guia.verLead} onListo={cerrarGuia} onProgreso={setProgreso} />
          )}
          {k === 'manychat' && <GuiaEntrada clase="manychat" onCambio={cambio} onVerLead={guia.verLead} onListo={cerrarGuia} onProgreso={setProgreso} />}
          {k === 'agenda' && (
            <GuiaEntrada clase="agenda" onCambio={cambio} onVerLead={guia.verLead} onListo={cerrarGuia} onProgreso={setProgreso}
              preferido={resumen?.conexiones?.calendly?.conectado ? 'calendly' : undefined} />
          )}
          {k === 'pagos' && (
            <GuiaEntrada clase="pagos" onCambio={cambio} onVerLead={guia.verLead} onListo={cerrarGuia} onProgreso={setProgreso}
              preferido={resumen?.conexiones?.stripe?.conectado ? 'stripe'
                : ({ Stripe: 'stripe', Hotmart: 'hotmart', 'Otra plataforma': 'otra' } as Record<string, string>)[pagosPorApp(endpoints)[0]?.nombre ?? ''] } />
          )}
          {k === 'zapier' && <GuiaSalida onCambio={cambio} onVerLead={guia.verLead} onListo={cerrarGuia} />}
          {k === 'claude' && <GuiaClaude apiUrl={resumen?.api_url ?? window.location.origin} onCambio={cambio} onListo={cerrarGuia} />}
        </Dialogo>
      )}
    </div>
  );
}
