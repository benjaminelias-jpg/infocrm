import { Suspense, lazy, useCallback, useEffect, useState, type ComponentType } from 'react';
import {
  BrowserRouter, Routes, Route, NavLink, Navigate, useNavigate, useLocation, useSearchParams,
} from 'react-router-dom';
import { api, cerrarSesion, guardarSesion, leerSesion, token, EVENTO_SESION_VENCIDA } from './api';
import Icono from './componentes/Iconos';
import { useFicha } from './componentes/useFicha';
import BuscadorGlobal, { useAtajoBuscar } from './componentes/BuscadorGlobal';
import ErrorPantalla from './componentes/ErrorPantalla';
import {
  ProveedorAvisos, Menu, ItemMenu, SeparadorMenu, Boton, Campo, Entrada, EsqueletoPantalla, useTema, type Tema,
} from './ui';

// Cada pantalla se descarga recién cuando se usa (la app abre mucho más
// rápido en el celular) y después se precargan las demás en segundo plano.
// Si después de un deploy falta un archivo viejo, se recarga una vez sola.
function pantalla<T extends ComponentType<any>>(cargar: () => Promise<{ default: T }>) {
  const Componente = lazy(() => cargar().then((m) => {
    try { sessionStorage.removeItem('infocrm_recargado'); } catch { /* sin almacenamiento */ }
    return m;
  }).catch((err) => {
    let ya = false;
    try { ya = sessionStorage.getItem('infocrm_recargado') === '1'; sessionStorage.setItem('infocrm_recargado', '1'); } catch { ya = true; }
    if (!ya) { window.location.reload(); return new Promise<{ default: T }>(() => {}); }
    throw err;
  }));
  return Object.assign(Componente, { precargar: () => { cargar().catch(() => {}); } });
}
const Panel = pantalla(() => import('./paginas/Panel'));
const Contenidos = pantalla(() => import('./paginas/Contenidos'));
const Pipeline = pantalla(() => import('./paginas/Pipeline'));
const Leads = pantalla(() => import('./paginas/Leads'));
const Conexiones = pantalla(() => import('./paginas/Conexiones'));
const Flujos = pantalla(() => import('./paginas/Flujos'));
const Finanzas = pantalla(() => import('./paginas/Finanzas'));
const Chat = pantalla(() => import('./paginas/Chat'));
const FichaLead = pantalla(() => import('./componentes/FichaLead'));
const PANTALLAS = [Panel, Chat, Pipeline, Leads, FichaLead, Contenidos, Flujos, Finanzas, Conexiones];

// Ocho destinos, nada más. Recursos vive dentro del Chat, las reglas dentro
// del Pipeline y las palabras de ManyChat dentro de Automensajes.
type Destino = { a: string; etiqueta: string; icono: string };
const PANEL: Destino = { a: '/', etiqueta: 'Panel', icono: 'panel' };
const CHAT: Destino = { a: '/chat', etiqueta: 'Chat', icono: 'bandeja' };
const PIPELINE: Destino = { a: '/pipeline', etiqueta: 'Pipeline', icono: 'pipeline' };
const LEADS: Destino = { a: '/leads', etiqueta: 'Leads', icono: 'leads' };
const CONTENIDOS: Destino = { a: '/contenidos', etiqueta: 'Contenidos', icono: 'contenidos' };
const AUTOMENSAJES: Destino = { a: '/flujos', etiqueta: 'Automensajes', icono: 'flujos' };
const FINANZAS: Destino = { a: '/finanzas', etiqueta: 'Finanzas', icono: 'finanzas' };
const CONFIG: Destino = { a: '/conexiones', etiqueta: 'Configuración', icono: 'reglas' };

const GRUPOS: Array<{ rotulo?: string; items: Destino[] }> = [
  { items: [PANEL] },
  { rotulo: 'Día a día', items: [CHAT, PIPELINE, LEADS] },
  { rotulo: 'Crecer', items: [CONTENIDOS, AUTOMENSAJES] },
  { rotulo: 'Negocio', items: [FINANZAS, CONFIG] },
];
const TODOS: Destino[] = [PANEL, CHAT, PIPELINE, LEADS, CONTENIDOS, AUTOMENSAJES, FINANZAS, CONFIG];

/**
 * Lo que ve cada rol. El setter y el closer, lo del día a día (sin plata ni
 * configuración); el dueño y los admins, todo. En el celular, los primeros 4
 * van en la barra de abajo y el resto en "Más".
 */
function permitidos(rol?: string): Destino[] {
  if (rol === 'setter') return [CHAT, PIPELINE, LEADS, CONTENIDOS];
  if (rol === 'closer') return [PIPELINE, CHAT, LEADS];
  return TODOS;
}

/** ¿Hay internet? Para avisar con una banda fina en vez de dejar que todo falle en silencio. */
function useEnLinea() {
  const [enLinea, setEnLinea] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const si = () => setEnLinea(true);
    const no = () => setEnLinea(false);
    window.addEventListener('online', si);
    window.addEventListener('offline', no);
    return () => { window.removeEventListener('online', si); window.removeEventListener('offline', no); };
  }, []);
  return enLinea;
}

const activo = (d: Destino, ruta: string) => (d.a === '/' ? ruta === '/' : ruta === d.a || ruta.startsWith(`${d.a}/`));

/** Subpantallas que ocupan todo el celular (con su propio "volver"): sin barra inferior. */
const SUBPANTALLA = /^\/(chat|flujos)\/[^/]+/;

const TEMAS: Array<{ id: Tema; nombre: string; icono: string }> = [
  { id: 'claro', nombre: 'Claro', icono: 'sol' },
  { id: 'oscuro', nombre: 'Oscuro', icono: 'luna' },
  { id: 'auto', nombre: 'Automático', icono: 'monitor' },
];

function iniciales(nombre?: string) {
  const p = (nombre ?? '').trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '·';
}

// ---------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------

function Login() {
  const navegar = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(import.meta.env.VITE_DEMO === '1' ? 'demo@infocrm.app' : '');
  const [password, setPassword] = useState(import.meta.env.VITE_DEMO === '1' ? 'infocrm2026' : '');
  const [ver, setVer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const motivo = params.get('motivo');
  const volver = params.get('volver');

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    try {
      const r = await api<any>('/auth/login', { method: 'POST', json: { email: email.trim(), password } });
      guardarSesion(r.token, r.usuario, r.cuenta);
      // Solo rutas internas (nada de redirigir a otro sitio).
      navegar(volver && volver.startsWith('/') && !volver.startsWith('//') ? volver : '/', { replace: true });
    } catch (err: any) {
      setError(err.message ?? 'No se pudo entrar');
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ minHeight: '100dvh' }}>
      <form onSubmit={enviar} className="tarjeta w-full max-w-sm space-y-4 p-6">
        <div>
          <div className="text-[18px] font-semibold tracking-tight">InfoCRM</div>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">CRM de infoproducción conectado a Instagram</p>
        </div>
        {motivo === 'sesion' && (
          <p className="rounded-lg px-3 py-2 text-[12px]" style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>
            Tu sesión se cerró por seguridad. Entrá de nuevo y seguís donde estabas.
          </p>
        )}
        <Campo etiqueta="Email" htmlFor="login-email">
          <Entrada id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
            autoComplete="username" inputMode="email" autoFocus />
        </Campo>
        <Campo etiqueta="Contraseña" htmlFor="login-clave">
          <div className="relative">
            <Entrada id="login-clave" type={ver ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
              required autoComplete="current-password" className="pr-16" />
            <button type="button" onClick={() => setVer((v) => !v)} aria-pressed={ver}
              className="ui-foco absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]">
              {ver ? 'Ocultar' : 'Ver'}
            </button>
          </div>
        </Campo>
        {error && <p role="alert" className="text-[12px]" style={{ color: 'var(--status-critical)' }}>{error}</p>}
        <Boton type="submit" variante="primario" cargando={cargando} className="w-full">Entrar</Boton>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------
// Marco: menú lateral (escritorio) y barra inferior (celular)
// ---------------------------------------------------------------------

/** Conversaciones con mensajes sin leer (para el globito del Chat). */
function useNoLeidos() {
  const [n, setN] = useState(0);
  const ubicacion = useLocation();
  const leer = useCallback(() => {
    if (document.visibilityState === 'hidden') return;
    api<{ conversaciones: number }>('/ux/global/no-leidos').then((r) => setN(r.conversaciones)).catch(() => {});
  }, []);
  useEffect(() => {
    leer();
    const t = window.setInterval(leer, 30_000);
    window.addEventListener('focus', leer);
    return () => { window.clearInterval(t); window.removeEventListener('focus', leer); };
  }, [leer]);
  // Al salir del Chat (donde se leen), refrescamos.
  useEffect(() => { leer(); }, [ubicacion.pathname, leer]);
  return n;
}

function Globito({ n, chico }: { n: number; chico?: boolean }) {
  if (!n) return null;
  return (
    <span className={`cifras inline-flex items-center justify-center rounded-[6px] font-bold text-white ${chico ? 'h-4 min-w-4 px-1 text-[10px]' : 'h-[18px] min-w-[18px] px-1.5 text-[10px]'}`}
      style={{ background: 'var(--status-critical)' }} aria-label={`${n} sin leer`}>
      {n > 99 ? '99+' : n}
    </span>
  );
}

function OpcionesCuenta({ tema, cambiarTema }: { tema: Tema; cambiarTema: (t: Tema) => void }) {
  return (
    <>
      <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Tema</div>
      {TEMAS.map((t) => (
        <ItemMenu key={t.id} icono={<Icono nombre={t.icono} tam={16} />} activo={tema === t.id} cerrarAlTocar={false}
          onClick={() => cambiarTema(t.id)}>{t.nombre}</ItemMenu>
      ))}
      <SeparadorMenu />
      <ItemMenu icono={<Icono nombre="salir" tam={16} />} onClick={cerrarSesion}>Salir</ItemMenu>
    </>
  );
}

function Marco({ children }: { children: React.ReactNode }) {
  const sesion = leerSesion();
  const ubicacion = useLocation();
  const navegar = useNavigate();
  const { tema, cambiar } = useTema();
  const noLeidos = useNoLeidos();
  const ficha = useFicha();
  const ruta = ubicacion.pathname;
  const conBarra = !SUBPANTALLA.test(ruta);
  const enLinea = useEnLinea();
  const [buscar, setBuscar] = useState(false);
  useAtajoBuscar(useCallback(() => setBuscar(true), []));
  const visibles = permitidos(sesion?.usuario?.rol);
  const grupos = GRUPOS.map((g) => ({ ...g, items: g.items.filter((d) => visibles.includes(d)) })).filter((g) => g.items.length);
  const BARRA = visibles.slice(0, 4);
  const EN_MAS = visibles.slice(4);
  const enMas = EN_MAS.some((d) => activo(d, ruta));
  const prohibida = TODOS.some((d) => !visibles.includes(d) && activo(d, ruta));

  // Sesión vencida (cualquier llamada a la API devolvió 401): al login sin
  // recargar, recordando a dónde volver.
  useEffect(() => {
    const f = (e: Event) => {
      e.preventDefault();
      const volver = (e as CustomEvent).detail?.volver ?? '/';
      navegar(`/login?motivo=sesion&volver=${encodeURIComponent(volver)}`, { replace: true });
    };
    window.addEventListener(EVENTO_SESION_VENCIDA, f);
    return () => window.removeEventListener(EVENTO_SESION_VENCIDA, f);
  }, [navegar]);

  // Título de la pestaña según la pantalla ("Chat · InfoCRM").
  useEffect(() => {
    const d = TODOS.find((x) => activo(x, ruta));
    document.title = d ? `${d.etiqueta} · InfoCRM` : 'InfoCRM';
  }, [ruta]);

  // Con la pantalla ya abierta, se bajan las demás sin apuro (navegar después es instantáneo).
  useEffect(() => {
    const w = window as any;
    const ocioso = (f: () => void) => (typeof w.requestIdleCallback === 'function' ? w.requestIdleCallback(f, { timeout: 4000 }) : w.setTimeout(f, 2500));
    ocioso(() => PANTALLAS.forEach((p) => p.precargar()));
  }, []);

  const nombre = sesion?.usuario?.nombre ?? '';
  // Una pantalla que este rol no usa: a la primera que sí.
  if (prohibida) return <Navigate to={visibles[0].a} replace />;

  return (
    <div className={`flex min-h-screen flex-col md:flex-row ${conBarra ? 'con-barra-inf' : ''}`}>
      {/* Menú lateral (escritorio) */}
      <aside className="sticky top-3 m-3 mr-0 hidden h-[calc(100vh-24px)] w-[212px] shrink-0 flex-col rounded-[24px] px-3 py-4 md:flex"
        style={{ background: 'var(--surface-1)' }}>
        <div className="mb-3 flex items-center gap-2.5 px-1.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-[13px] font-extrabold tracking-tight text-white" style={{ background: 'var(--accion)' }} aria-hidden>iC</span>
          <span className="min-w-0">
            <span className="block text-[15px] font-bold tracking-tight">InfoCRM</span>
            <span className="block truncate text-[11px] text-[var(--text-muted)]">{sesion?.cuenta?.nombre ?? ''}</span>
          </span>
        </div>
        <button type="button" onClick={() => setBuscar(true)}
          className="ui-foco mb-3 flex h-9 items-center gap-2 rounded-[12px] px-2.5 text-left text-[12px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          style={{ background: 'var(--surface-2)' }}>
          <Icono nombre="buscar" tam={15} />
          <span className="flex-1">Buscar lead…</span>
          <kbd className="rounded-[5px] px-1 font-sans text-[10px] font-semibold" style={{ background: 'var(--surface-1)' }}>⌘K</kbd>
        </button>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto" aria-label="Principal">
          {grupos.map((g, i) => (
            <div key={i} className={i ? 'mt-3' : ''}>
              {g.rotulo && <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{g.rotulo}</div>}
              {g.items.map((n) => (
                <NavLink key={n.a} to={n.a} end={n.a === '/'}
                  className={({ isActive }) => `ui-foco flex items-center gap-3 rounded-[12px] px-3 py-2 text-[13px] transition-colors ${isActive || activo(n, ruta)
                    ? 'bg-[var(--ink)] font-semibold text-[var(--on-ink)]'
                    : 'font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]'}`}>
                  <span className="shrink-0 opacity-80"><Icono nombre={n.icono} tam={19} /></span>
                  <span className="flex-1">{n.etiqueta}</span>
                  {n === CHAT && <Globito n={noLeidos} />}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="mt-3 border-t border-[var(--border-hairline)] pt-2.5">
          <Menu alinear="izquierda" ancho={220} disparador={({ alternar, abierto }) => (
            <button type="button" onClick={alternar} aria-expanded={abierto} aria-haspopup="menu"
              className="ui-foco flex w-full items-center gap-2.5 rounded-[12px] px-2 py-2 text-left hover:bg-[var(--surface-2)]">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white" style={{ background: 'var(--accion)' }} aria-hidden>
                {iniciales(nombre)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium">{nombre || 'Mi cuenta'}</span>
                <span className="block truncate text-[11px] text-[var(--text-muted)]">Tema y salir</span>
              </span>
              <span className="text-[var(--text-muted)]" aria-hidden><Icono nombre="puntos" tam={16} /></span>
            </button>
          )}>
            <OpcionesCuenta tema={tema} cambiarTema={cambiar} />
          </Menu>
        </div>
      </aside>

      <main className={`min-w-0 flex-1 ${conBarra ? 'pb-[var(--alto-barra-inf)] md:pb-0' : ''}`}>
        {!enLinea && (
          <div role="status" className="sticky top-0 z-30 px-4 py-1.5 text-center text-[12px] font-medium"
            style={{ background: 'var(--status-warning)', color: '#1a1a19' }}>
            Sin conexión: lo que hagas puede no guardarse hasta que vuelva internet.
          </div>
        )}
        <ErrorPantalla key={ruta}>
          <Suspense fallback={<div aria-busy="true" aria-label="Cargando"><EsqueletoPantalla /></div>}>{children}</Suspense>
        </ErrorPantalla>
      </main>
      <BuscadorGlobal abierto={buscar} onCerrar={() => setBuscar(false)} />

      {/* Ficha del lead global (?ficha=<id>): se abre desde cualquier pantalla y Atrás la cierra. */}
      {ficha.abierta && <Suspense fallback={null}><FichaLead key={ficha.abierta} leadId={ficha.abierta} alCerrar={ficha.cerrar} /></Suspense>}

      {/* Barra inferior (celular): lo del día a día a un toque; el resto en "Más". */}
      {conBarra && (
        <nav aria-label="Principal"
          className="ui-vidrio fixed inset-x-3 bottom-[max(10px,env(safe-area-inset-bottom))] z-40 grid rounded-[22px] px-1.5 md:hidden"
          style={{ gridTemplateColumns: `repeat(${BARRA.length + 1}, minmax(0, 1fr))` }}>
          {BARRA.map((n) => {
            const on = activo(n, ruta);
            return (
              <NavLink key={n.a} to={n.a} end={n.a === '/'} aria-current={on ? 'page' : undefined}
                className="ui-foco relative flex h-[60px] flex-col items-center justify-center gap-0.5 rounded-[14px] text-[11px]"
                style={{ color: on ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: on ? 700 : 500 }}>
                <span className="relative flex h-7 w-11 items-center justify-center rounded-[10px] transition-colors"
                  style={on ? { background: 'var(--ink)', color: 'var(--on-ink)' } : undefined}>
                  <Icono nombre={n.icono} tam={20} />
                  {n === CHAT && noLeidos > 0 && <span className="absolute -right-1.5 -top-1.5"><Globito n={noLeidos} chico /></span>}
                </span>
                {n.etiqueta}
              </NavLink>
            );
          })}
          <Menu titulo="Más" disparador={({ alternar, abierto }) => (
            <button type="button" onClick={alternar} aria-expanded={abierto} aria-haspopup="menu"
              className="ui-foco flex h-[60px] w-full flex-col items-center justify-center gap-0.5 rounded-[14px] text-[11px]"
              style={{ color: enMas ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: enMas ? 700 : 500 }}>
              <span className="flex h-7 w-11 items-center justify-center rounded-[10px]" style={enMas ? { background: 'var(--ink)', color: 'var(--on-ink)' } : undefined}>
                <Icono nombre="menu" tam={20} />
              </span>
              Más
            </button>
          )} className="w-full">
            <ItemMenu icono={<Icono nombre="buscar" tam={18} />} onClick={() => setBuscar(true)}>Buscar un lead</ItemMenu>
            {EN_MAS.length > 0 && <SeparadorMenu />}
            {EN_MAS.map((n) => (
              <ItemMenu key={n.a} icono={<Icono nombre={n.icono} tam={18} />} activo={activo(n, ruta)} onClick={() => navegar(n.a)}>
                {n.etiqueta}
              </ItemMenu>
            ))}
            <SeparadorMenu />
            <OpcionesCuenta tema={tema} cambiarTema={cambiar} />
            <div className="px-2.5 pb-1 pt-2 text-[11px] text-[var(--text-muted)]">{nombre}{sesion?.cuenta?.nombre ? ` · ${sesion.cuenta.nombre}` : ''}</div>
          </Menu>
        </nav>
      )}
    </div>
  );
}

function Protegida({ children }: { children: React.ReactNode }) {
  const ubicacion = useLocation();
  if (!token()) {
    const volver = `${ubicacion.pathname}${ubicacion.search}`;
    return <Navigate to={volver === '/' ? '/login' : `/login?volver=${encodeURIComponent(volver)}`} replace />;
  }
  return <Marco>{children}</Marco>;
}

export default function App() {
  return (
    <ProveedorAvisos>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Protegida><Panel /></Protegida>} />
        <Route path="/contenidos" element={<Protegida><Contenidos /></Protegida>} />
        <Route path="/pipeline" element={<Protegida><Pipeline /></Protegida>} />
        <Route path="/leads" element={<Protegida><Leads /></Protegida>} />
        <Route path="/flujos" element={<Protegida><Flujos /></Protegida>} />
        <Route path="/flujos/:flujoId" element={<Protegida><Flujos /></Protegida>} />
        <Route path="/finanzas" element={<Protegida><Finanzas /></Protegida>} />
        <Route path="/chat" element={<Protegida><Chat /></Protegida>} />
        <Route path="/chat/:leadId" element={<Protegida><Chat /></Protegida>} />
        {/* Enlaces viejos: ahora viven dentro de otras pantallas */}
        <Route path="/recursos" element={<Navigate to="/chat?recursos=1" replace />} />
        <Route path="/automatizaciones" element={<Navigate to="/flujos?tab=manychat" replace />} />
        <Route path="/reglas" element={<Navigate to="/pipeline?config=reglas" replace />} />
        <Route path="/conexiones" element={<Protegida><Conexiones /></Protegida>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </ProveedorAvisos>
  );
}
