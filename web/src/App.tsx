import { useEffect, useState } from 'react';
import {
  BrowserRouter, Routes, Route, NavLink, Navigate, useNavigate, useLocation,
} from 'react-router-dom';
import { api, cerrarSesion, guardarSesion, leerSesion, token } from './api';
import Panel from './paginas/Panel';
import Contenidos from './paginas/Contenidos';
import Pipeline from './paginas/Pipeline';
import Leads from './paginas/Leads';
import Conexiones from './paginas/Conexiones';
import Flujos from './paginas/Flujos';
import Finanzas from './paginas/Finanzas';
import Chat from './paginas/Chat';
import Icono from './componentes/Iconos';

// Ocho destinos, nada más. Recursos vive dentro del Chat, las reglas dentro
// del Pipeline y las palabras de ManyChat dentro de Automensajes.
const NAV = [
  { a: '/', etiqueta: 'Panel', icono: 'panel' },
  { a: '/chat', etiqueta: 'Chat', icono: 'bandeja' },
  { a: '/contenidos', etiqueta: 'Contenidos', icono: 'contenidos' },
  { a: '/pipeline', etiqueta: 'Pipeline', icono: 'pipeline' },
  { a: '/leads', etiqueta: 'Leads', icono: 'leads' },
  { a: '/flujos', etiqueta: 'Automensajes', icono: 'flujos' },
  { a: '/finanzas', etiqueta: 'Finanzas', icono: 'finanzas' },
  { a: '/conexiones', etiqueta: 'Configuración', icono: 'conexiones' },
];

function Login() {
  const navegar = useNavigate();
  const [email, setEmail] = useState('demo@infocrm.app');
  const [password, setPassword] = useState('infocrm2026');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    try {
      const r = await api<any>('/auth/login', { method: 'POST', json: { email, password } });
      guardarSesion(r.token, r.usuario, r.cuenta);
      navegar('/');
    } catch (err: any) {
      setError(err.message ?? 'No se pudo entrar');
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={enviar} className="tarjeta w-full max-w-sm p-6">
        <div className="mb-1 text-[18px] font-semibold tracking-tight">InfoCRM</div>
        <p className="mb-5 text-[13px] text-[var(--text-muted)]">
          CRM de infoproducción conectado a Instagram
        </p>

        <label className="mb-1 block text-[12px] text-[var(--text-secondary)]">Email</label>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
          className="mb-3 w-full rounded-md border border-[var(--border-hairline)] bg-transparent px-3 py-2 text-[14px] outline-none focus:border-[var(--series-1)]"
        />

        <label className="mb-1 block text-[12px] text-[var(--text-secondary)]">Contraseña</label>
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
          className="mb-4 w-full rounded-md border border-[var(--border-hairline)] bg-transparent px-3 py-2 text-[14px] outline-none focus:border-[var(--series-1)]"
        />

        {error && (
          <p className="mb-3 text-[12px] text-[var(--status-critical)]">⚠ {error}</p>
        )}

        <button
          type="submit" disabled={cargando}
          className="w-full rounded-md px-3 py-2 text-[14px] font-medium text-white disabled:opacity-60"
          style={{ background: 'var(--series-1)' }}
        >
          {cargando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

function Marco({ children }: { children: React.ReactNode }) {
  const sesion = leerSesion();
  const [menuMovil, setMenuMovil] = useState(false);
  const ubicacion = useLocation();
  useEffect(() => { setMenuMovil(false); }, [ubicacion.pathname]);
  const actual = NAV.find((n) => (n.a === '/' ? ubicacion.pathname === '/' : ubicacion.pathname.startsWith(n.a)));
  const [tema, setTema] = useState<string>(
    () => document.documentElement.getAttribute('data-theme') ?? 'auto',
  );

  function alternarTema() {
    const siguiente = tema === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', siguiente);
    localStorage.setItem('infocrm_tema', siguiente);
    setTema(siguiente);
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Barra superior en el celular */}
      <header className="sticky top-0 z-30 flex h-[49px] items-center gap-3 border-b border-[var(--border-hairline)] px-3 md:hidden"
        style={{ background: 'var(--page-plane)' }}>
        <button onClick={() => setMenuMovil((v) => !v)} aria-label="Menú" className="rounded-md px-2 py-1 text-[18px]">☰</button>
        <span className="text-[14px] font-semibold">{actual?.etiqueta ?? 'InfoCRM'}</span>
      </header>
      {menuMovil && (
        <nav className="fixed inset-x-0 top-[49px] z-30 grid grid-cols-2 gap-1 border-b border-[var(--border-hairline)] p-3 shadow-lg md:hidden"
          style={{ background: 'var(--page-plane)' }}>
          {NAV.map((n) => (
            <NavLink key={n.a} to={n.a} end={n.a === '/'}
              className={({ isActive }) => `flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[14px] ${isActive ? 'bg-[var(--surface-1)] font-medium' : 'text-[var(--text-secondary)]'}`}>
              <Icono nombre={n.icono} tam={20} />{n.etiqueta}
            </NavLink>
          ))}
          <button onClick={cerrarSesion} className="col-span-2 mt-1 rounded-lg px-3 py-2 text-left text-[13px] text-[var(--text-secondary)]">
            Salir · {sesion?.usuario?.nombre ?? ''}
          </button>
        </nav>
      )}

      <aside className="sticky top-0 hidden h-screen w-[218px] shrink-0 flex-col border-r border-[var(--border-hairline)] px-3 py-4 md:flex">
        <div className="mb-5 px-2">
          <div className="text-[15px] font-semibold tracking-tight">InfoCRM</div>
          <div className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
            {sesion?.cuenta?.nombre ?? ''}
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5">
          {NAV.map((n) => (
            <NavLink
              key={n.a}
              to={n.a}
              end={n.a === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors ${
                  isActive
                    ? 'bg-[var(--surface-1)] font-medium text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--surface-1)]'
                }`
              }
            >
              <span className="shrink-0 opacity-80"><Icono nombre={n.icono} tam={19} /></span>
              {n.etiqueta}
            </NavLink>
          ))}
        </nav>

        <div className="mt-4 border-t border-[var(--border-hairline)] pt-3">
          <button
            onClick={alternarTema}
            className="mb-1 w-full rounded-md px-2.5 py-[7px] text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface-1)]"
          >
            {tema === 'dark' ? '☀ Modo claro' : '☾ Modo oscuro'}
          </button>
          <button
            onClick={cerrarSesion}
            className="w-full rounded-md px-2.5 py-[7px] text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface-1)]"
          >
            Salir · {sesion?.usuario?.nombre ?? ''}
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

function Protegida({ children }: { children: React.ReactNode }) {
  if (!token()) return <Navigate to="/login" replace />;
  return <Marco>{children}</Marco>;
}

export default function App() {
  useEffect(() => {
    const guardado = localStorage.getItem('infocrm_tema');
    if (guardado) document.documentElement.setAttribute('data-theme', guardado);
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Protegida><Panel /></Protegida>} />
        <Route path="/contenidos" element={<Protegida><Contenidos /></Protegida>} />
        <Route path="/pipeline" element={<Protegida><Pipeline /></Protegida>} />
        <Route path="/leads" element={<Protegida><Leads /></Protegida>} />
        <Route path="/flujos" element={<Protegida><Flujos /></Protegida>} />
        <Route path="/finanzas" element={<Protegida><Finanzas /></Protegida>} />
        <Route path="/chat" element={<Protegida><Chat /></Protegida>} />
        {/* Enlaces viejos: ahora viven dentro de otras pantallas */}
        <Route path="/recursos" element={<Navigate to="/chat?recursos=1" replace />} />
        <Route path="/automatizaciones" element={<Navigate to="/flujos?tab=manychat" replace />} />
        <Route path="/reglas" element={<Navigate to="/pipeline?config=reglas" replace />} />
        <Route path="/conexiones" element={<Protegida><Conexiones /></Protegida>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
