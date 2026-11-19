import { useEffect, useState } from 'react';
import { api, fmtFecha, fmtNum, hace } from '../api';
import { Cargando } from '../componentes/Graficas';
import Cabecera from '../componentes/Cabecera';

const EJEMPLO_MANYCHAT = {
  id: '{{user_id}}',
  first_name: '{{first_name}}',
  ig_username: '{{ig_username}}',
  email: '{{email}}',
  custom_fields: {
    palabra_clave: 'SISTEMA',
    ig_media_id: '{{last_commented_media_id}}',
  },
};

function Copiable({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(texto);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 1600);
      }}
      className="shrink-0 rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]"
    >
      {copiado ? '✓ Copiado' : 'Copiar'}
    </button>
  );
}

export default function Conexiones() {
  const [endpoints, setEndpoints] = useState<any[]>([]);
  const [integraciones, setIntegraciones] = useState<any[]>([]);
  const [eventos, setEventos] = useState<any[]>([]);
  const [salientes, setSalientes] = useState<any[]>([]);
  const [entregas, setEntregas] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [igUserId, setIgUserId] = useState('');
  const [igEstado, setIgEstado] = useState<any>(null);
  const [appForm, setAppForm] = useState({ app_id: '', app_secret: '', config_id: '', ig_user_id: '' });
  const [conectando, setConectando] = useState(false);
  const [filtroEstado, setFiltroEstado] = useState('');
  const [nuevoSal, setNuevoSal] = useState({ nombre: '', url: '', eventos: ['*'] as string[] });

  async function cargar() {
    const p = new URLSearchParams({ limite: '60' });
    if (filtroEstado) p.set('estado', filtroEstado);
    const [e, i, w, s, es, ige] = await Promise.all([
      api<any[]>('/webhooks/endpoints'),
      api<any[]>('/integraciones'),
      api<any[]>(`/webhooks/eventos?${p}`),
      api<any[]>('/webhooks/salida'),
      api<any[]>('/webhooks/salida/entregas?limite=40'),
      api<any>('/instagram/estado').catch(() => null),
    ]);
    setEndpoints(e);
    setIntegraciones(i);
    setEventos(w);
    setSalientes(s);
    setEntregas(es);
    setIgEstado(ige);
    if (ige) setAppForm((f) => ({
      ...f,
      app_id: f.app_id || ige.app_id || '',
      config_id: f.config_id || ige.config_id || '',
      ig_user_id: f.ig_user_id || ige.ig_user_id || '',
    }));
    setCargando(false);
  }

  async function guardarApp(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('/instagram/app', {
        method: 'PUT',
        json: {
          app_id: appForm.app_id, app_secret: appForm.app_secret,
          config_id: appForm.config_id || undefined,
          ig_user_id: appForm.ig_user_id || undefined,
        },
      });
      setAviso('App de Meta guardada. Ya puedes pulsar «Conectar Instagram».');
      await cargar();
    } catch (err: any) { setAviso(err.message); }
  }

  async function conectarInstagram() {
    setConectando(true);
    try {
      const r = await api<{ url: string }>('/instagram/oauth/start');
      window.location.href = r.url; // Meta nos devuelve a /instagram/callback
    } catch (err: any) {
      setAviso(err.message);
      setConectando(false);
    }
  }

  async function crearSalida(e: React.FormEvent) {
    e.preventDefault();
    if (!nuevoSal.nombre || !nuevoSal.url) return;
    try {
      await api('/webhooks/salida', { method: 'POST', json: nuevoSal });
      setNuevoSal({ nombre: '', url: '', eventos: ['*'] });
      setAviso('Webhook de salida creado. Pulsa "Probar" para comprobar la conexión.');
      await cargar();
    } catch (err: any) { setAviso(err.message); }
  }

  async function probarSalida(id: string) {
    try {
      const r = await api<any>(`/webhooks/salida/${id}/probar`, { method: 'POST' });
      setAviso(r.estado === 'entregado'
        ? `Prueba entregada correctamente (HTTP ${r.http_status}).`
        : `La prueba falló: ${r.error ?? 'sin respuesta'}`);
      await cargar();
    } catch (err: any) { setAviso(err.message); }
  }

  async function toggleSalida(s: any) {
    await api(`/webhooks/salida/${s.id}`, { method: 'PATCH', json: { activo: !s.activo } });
    await cargar();
  }

  async function borrarSalida(id: string) {
    await api(`/webhooks/salida/${id}`, { method: 'DELETE' });
    await cargar();
  }

  useEffect(() => { cargar(); }, [filtroEstado]);

  // Resultado de la vuelta de Instagram (/conexiones?instagram=ok&ig=usuario)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const r = p.get('instagram');
    if (!r) return;
    const ig = p.get('ig');
    setAviso(
      r === 'ok' ? `Instagram conectado${ig ? ` como @${ig}` : ''}.`
      : r === 'denegado' ? 'Cancelaste la conexión con Instagram.'
      : 'No se pudo conectar Instagram. Revisa la App de Meta y la redirect URI.');
    window.history.replaceState({}, '', '/conexiones');
  }, []);

  async function guardarInstagram(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('/instagram/credenciales', {
        method: 'PUT', json: { access_token: token, ig_user_id: igUserId },
      });
      const r = await api<any>('/instagram/probar', { method: 'POST' });
      setAviso(r.ok ? `Conectado con @${r.cuenta?.username}` : `No conecta: ${r.mensaje}`);
      setToken('');
      await cargar();
    } catch (err: any) {
      setAviso(err.message);
    }
  }

  async function reprocesarTodos() {
    const r = await api<any>('/webhooks/reprocesar-errores', { method: 'POST' });
    setAviso(`Reintentados ${r.intentados}, recuperados ${r.recuperados}.`);
    await cargar();
  }

  const ig = integraciones.find((i) => i.tipo === 'instagram');
  const conErrores = eventos.filter((e) => e.estado === 'error').length;
  // El App ID de Meta es numérico: avisamos si pegan un email o el usuario.
  const appIdInvalido = appForm.app_id.length > 0 && !/^\d{6,}$/.test(appForm.app_id);

  if (cargando) return <Cargando />;

  return (
    <div className="px-5 py-5 lg:px-8">
      <Cabecera
        titulo="Conexiones"
        subtitulo="Las URLs que pegas en ManyChat, Calendly y tu pasarela de pago"
      />

      {aviso && (
        <div
          className="mt-3 rounded-md px-3 py-2 text-[12px]"
          style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}
        >
          {aviso}
        </div>
      )}

      {/* Webhooks */}
      <section className="mt-5">
        <h2 className="mb-2 text-[14px] font-semibold">Webhooks de entrada</h2>
        <div className="space-y-2">
          {endpoints.map((e) => (
            <div key={e.id} className="tarjeta p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-[13px] font-medium">{e.nombre}</div>
                  <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                    Fuente {e.fuente} · evento por defecto{' '}
                    <code className="rounded px-1" style={{ background: 'var(--gridline)' }}>
                      {e.evento_defecto}
                    </code>
                  </div>
                </div>
                <div className="cifras text-right text-[11px] text-[var(--text-muted)]">
                  <div>{fmtNum(e.total_recibidos)} recibidos</div>
                  {Number(e.total_errores) > 0 && (
                    <div style={{ color: 'var(--status-critical)' }}>
                      {fmtNum(e.total_errores)} con error
                    </div>
                  )}
                  {e.ultimo_evento_en && <div>último {hace(e.ultimo_evento_en)}</div>}
                </div>
              </div>

              <div className="mt-2.5 flex items-center gap-2">
                <code
                  className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-[11px]"
                  style={{ background: 'var(--page-plane)' }}
                >
                  {e.url}
                </code>
                <Copiable texto={e.url} />
              </div>
            </div>
          ))}
        </div>

        <details className="tarjeta mt-3 p-3.5">
          <summary className="cursor-pointer text-[13px] font-medium">
            Qué mandar desde ManyChat
          </summary>
          <p className="mt-2 text-[12px] text-[var(--text-secondary)]">
            En ManyChat: acción «External Request», método POST, la URL de arriba, y en el body este
            JSON. Lo importante es que vaya <strong>algo que identifique al lead</strong> (user_id,
            ig_username o email) y <strong>algo que identifique el contenido</strong> (ig_media_id,
            o la palabra clave).
          </p>
          <pre
            className="mt-2 overflow-x-auto rounded p-3 text-[11px]"
            style={{ background: 'var(--page-plane)' }}
          >
            {JSON.stringify(EJEMPLO_MANYCHAT, null, 2)}
          </pre>
          <p className="mt-2 text-[11px] text-[var(--text-muted)]">
            El CRM también entiende payloads de Calendly, Stripe, Hotmart, Make y Zapier sin
            configurar nada: busca los campos en todos los sitios habituales.
          </p>
        </details>
      </section>

      {/* Instagram */}
      <section className="mt-6">
        <h2 className="mb-2 text-[14px] font-semibold">Instagram</h2>
        <div className="tarjeta p-3.5">
          <div className="flex items-center gap-2 text-[13px]">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{
                background:
                  igEstado?.conectado ? 'var(--status-good)'
                  : ig?.estado === 'error' ? 'var(--status-critical)'
                  : 'var(--baseline)',
              }}
              aria-hidden
            />
            {igEstado?.conectado
              ? `Conectado como @${igEstado.username ?? '—'}${ig?.ultimo_sync_en ? ` · última sincronización ${hace(ig.ultimo_sync_en)}` : ''}`
              : igEstado?.ultimo_error
                ? `Error: ${igEstado.ultimo_error}`
                : 'Sin conectar'}
          </div>

          <p className="mt-2 text-[12px] text-[var(--text-secondary)]">
            Conecta tu cuenta de Instagram Business para traer tus reels con portada y métricas, y
            para que el CRM pueda mandar DMs con sus propios flujos. Se hace en dos pasos, una sola
            vez.
          </p>

          {/* Paso 1: App de Meta */}
          <div className="mt-3 rounded-md border border-[var(--border-hairline)] p-3">
            <div className="text-[12px] font-medium">
              1. Tu App de Meta
              {igEstado?.tiene_app && <span className="ml-2 text-[11px]" style={{ color: 'var(--status-good)' }}>✓ guardada</span>}
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              En <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" className="underline">developers.facebook.com</a>{' '}
              → tu app → <strong>Configuración → Básica</strong>: copia el <strong>Identificador
              de la app</strong> (App ID) y la <strong>Clave secreta</strong>. Si tu app usa el
              <strong> login unificado</strong> (lo verás en «Casos de uso → Administrar mensajes…
              → API de Instagram»), copia también el <strong>Identificador de configuración</strong>.
              Registra esta <strong>redirect URI</strong> en «URL de redireccionamiento»:
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-[11px]" style={{ background: 'var(--page-plane)' }}>
                {igEstado?.redirect_uri ?? `${window.location.origin}/instagram/callback`}
              </code>
              <Copiable texto={igEstado?.redirect_uri ?? `${window.location.origin}/instagram/callback`} />
            </div>
            <form onSubmit={guardarApp} className="mt-2 flex flex-wrap gap-2">
              <input
                value={appForm.app_id}
                onChange={(e) => setAppForm((f) => ({ ...f, app_id: e.target.value.trim() }))}
                placeholder="Instagram app ID (solo números)"
                inputMode="numeric"
                className="w-[260px] rounded-md border bg-transparent px-2.5 py-1.5 text-[12px] outline-none"
                style={{ borderColor: appIdInvalido ? 'var(--status-critical)' : 'var(--border-hairline)' }}
              />
              <input
                value={appForm.app_secret}
                onChange={(e) => setAppForm((f) => ({ ...f, app_secret: e.target.value.trim() }))}
                type="password"
                placeholder="App Secret (texto largo de letras y números)"
                className="min-w-[200px] flex-1 rounded-md border border-[var(--border-hairline)] bg-transparent px-2.5 py-1.5 text-[12px] outline-none"
              />
              <input
                value={appForm.config_id}
                onChange={(e) => setAppForm((f) => ({ ...f, config_id: e.target.value.trim() }))}
                inputMode="numeric"
                placeholder="Identificador de configuración (si usas login unificado)"
                className="w-full rounded-md border border-[var(--border-hairline)] bg-transparent px-2.5 py-1.5 text-[12px] outline-none"
              />
              <input
                value={appForm.ig_user_id}
                onChange={(e) => setAppForm((f) => ({ ...f, ig_user_id: e.target.value.trim() }))}
                inputMode="numeric"
                placeholder="ID de Instagram (en Business settings → Cuentas de Instagram → Identificador)"
                className="w-full rounded-md border border-[var(--border-hairline)] bg-transparent px-2.5 py-1.5 text-[12px] outline-none"
              />
              <button type="submit" disabled={!appForm.app_id || !appForm.app_secret || appIdInvalido}
                className="rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] font-medium disabled:opacity-50 hover:bg-[var(--page-plane)]">
                Guardar App
              </button>
            </form>
            {appIdInvalido && (
              <p className="mt-1.5 text-[11px]" style={{ color: 'var(--status-critical)' }}>
                ⚠ El Instagram app ID es un <strong>número</strong> que te da Meta (no tu email ni tu
                usuario). Lo ves en developers.facebook.com → tu app → Instagram → «API setup with
                Instagram login» → «Instagram app ID».
              </p>
            )}
          </div>

          {/* Paso 2: Conectar */}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              onClick={conectarInstagram}
              disabled={!igEstado?.tiene_app || conectando}
              className="rounded-md px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(90deg,#833ab4,#fd1d1d,#fcb045)' }}
            >
              {conectando ? 'Abriendo Instagram…' : igEstado?.conectado ? '↻ Reconectar Instagram' : '2. Conectar Instagram'}
            </button>
            {!igEstado?.tiene_app && (
              <span className="text-[11px] text-[var(--text-muted)]">Guarda primero tu App de Meta.</span>
            )}
          </div>

          {/* Fallback manual (avanzado) */}
          <details className="mt-3">
            <summary className="cursor-pointer text-[11px] text-[var(--text-muted)]">
              Pegar un access_token manualmente (avanzado)
            </summary>
            <form onSubmit={guardarInstagram} className="mt-2 flex flex-wrap gap-2">
              <input
                value={igUserId}
                onChange={(e) => setIgUserId(e.target.value)}
                placeholder="ig_user_id"
                className="w-[200px] rounded-md border border-[var(--border-hairline)] bg-transparent px-2.5 py-1.5 text-[12px] outline-none"
              />
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                type="password"
                placeholder="access_token"
                className="min-w-[200px] flex-1 rounded-md border border-[var(--border-hairline)] bg-transparent px-2.5 py-1.5 text-[12px] outline-none"
              />
              <button type="submit" disabled={!token || !igUserId}
                className="rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] disabled:opacity-50 hover:bg-[var(--page-plane)]">
                Guardar y probar
              </button>
            </form>
          </details>
        </div>
      </section>

      {/* Webhooks de salida */}
      <section className="mt-6">
        <h2 className="mb-2 text-[14px] font-semibold">Webhooks de salida</h2>
        <p className="mb-3 text-[12px] text-[var(--text-muted)]">
          Que el CRM avise a otras apps (Zapier, Make, n8n, Slack, tu backend) cuando pasa algo. Cada
          envío va firmado con HMAC en la cabecera <code className="rounded px-1" style={{ background: 'var(--gridline)' }}>x-infocrm-firma</code>.
        </p>

        <form onSubmit={crearSalida} className="tarjeta mb-3 p-3.5">
          <div className="flex flex-wrap gap-2">
            <input
              value={nuevoSal.nombre}
              onChange={(e) => setNuevoSal((s) => ({ ...s, nombre: e.target.value }))}
              placeholder="Nombre (p. ej. Zapier ventas)"
              className="w-[200px] rounded-md border border-[var(--border-hairline)] bg-transparent px-2.5 py-1.5 text-[12px] outline-none"
            />
            <input
              value={nuevoSal.url}
              onChange={(e) => setNuevoSal((s) => ({ ...s, url: e.target.value }))}
              placeholder="https://hooks.zapier.com/..."
              className="min-w-[220px] flex-1 rounded-md border border-[var(--border-hairline)] bg-transparent px-2.5 py-1.5 text-[12px] outline-none"
            />
            <button type="submit"
              className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white"
              style={{ background: 'var(--series-1)' }}>
              Crear
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-secondary)]">
            <span className="text-[var(--text-muted)]">Eventos:</span>
            {['*', 'lead_creado', 'reunion_agendada', 'reunion_no_asistio', 'venta', 'reembolso'].map((ev) => {
              const checked = nuevoSal.eventos.includes(ev);
              return (
                <label key={ev} className="flex cursor-pointer items-center gap-1">
                  <input type="checkbox" checked={checked}
                    onChange={() => setNuevoSal((s) => {
                      if (ev === '*') return { ...s, eventos: ['*'] };
                      const sin = s.eventos.filter((x) => x !== '*');
                      return { ...s, eventos: checked ? sin.filter((x) => x !== ev) : [...sin, ev] };
                    })} />
                  {ev === '*' ? 'todos' : ev}
                </label>
              );
            })}
          </div>
        </form>

        {salientes.length > 0 && (
          <div className="tarjeta mb-3 divide-y divide-[var(--border-hairline)]">
            {salientes.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[13px] font-medium">
                    <span className="inline-block h-2 w-2 rounded-full"
                      style={{ background: s.activo ? 'var(--status-good)' : 'var(--baseline)' }} aria-hidden />
                    {s.nombre}
                  </div>
                  <div className="truncate text-[11px] text-[var(--text-muted)]">{s.url}</div>
                  <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                    {(s.eventos ?? []).join(', ')} · {s.total_enviados} enviados
                    {Number(s.total_fallos) > 0 && <span style={{ color: 'var(--status-critical)' }}> · {s.total_fallos} fallos</span>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button onClick={() => probarSalida(s.id)}
                    className="rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]">Probar</button>
                  <button onClick={() => toggleSalida(s)}
                    className="rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]">
                    {s.activo ? 'Pausar' : 'Activar'}</button>
                  <button onClick={() => borrarSalida(s.id)}
                    className="rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]"
                    style={{ color: 'var(--status-critical)' }}>Borrar</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {entregas.length > 0 && (
          <div className="tarjeta overflow-x-auto">
            <table className="w-full min-w-[560px] text-[12px]">
              <thead>
                <tr className="border-b border-[var(--border-hairline)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="px-4 py-2 font-medium">Estado</th>
                  <th className="px-3 py-2 font-medium">Evento</th>
                  <th className="px-3 py-2 font-medium">Suscripción</th>
                  <th className="px-3 py-2 font-medium">HTTP</th>
                  <th className="px-3 py-2 text-right font-medium">Cuándo</th>
                </tr>
              </thead>
              <tbody>
                {entregas.map((e) => (
                  <tr key={e.id} className="border-b border-[var(--border-hairline)] last:border-0">
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block h-2 w-2 rounded-full"
                          style={{ background: e.estado === 'entregado' ? 'var(--status-good)' : 'var(--status-critical)' }} aria-hidden />
                        {e.estado}
                      </span>
                    </td>
                    <td className="px-3 py-2">{e.tipo_evento}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">{e.suscripcion}</td>
                    <td className="px-3 py-2 cifras">{e.http_status ?? (e.error ? '—' : '')}</td>
                    <td className="px-3 py-2 text-right text-[var(--text-muted)]">{fmtFecha(e.creado_en, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Bandeja cruda */}
      <section className="mt-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[14px] font-semibold">Todo lo que ha llegado</h2>
          <div className="flex items-center gap-2">
            <select
              value={filtroEstado}
              onChange={(e) => setFiltroEstado(e.target.value)}
              className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1 text-[12px] outline-none"
            >
              <option value="">Todos</option>
              <option value="procesado">Procesados</option>
              <option value="error">Con error</option>
              <option value="duplicado">Duplicados</option>
            </select>
            {conErrores > 0 && (
              <button
                onClick={reprocesarTodos}
                className="rounded-md border border-[var(--border-hairline)] px-3 py-1 text-[12px] hover:bg-[var(--surface-1)]"
              >
                Reintentar {conErrores} con error
              </button>
            )}
          </div>
        </div>

        <p className="mb-2 text-[12px] text-[var(--text-muted)]">
          El payload crudo se guarda antes de procesarlo. Si algo falla, el lead no se pierde: se
          puede arreglar la configuración y reprocesar.
        </p>

        <div className="tarjeta overflow-x-auto">
          <table className="w-full min-w-[720px] text-[12px]">
            <thead>
              <tr className="border-b border-[var(--border-hairline)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-3 py-2 font-medium">Origen</th>
                <th className="px-3 py-2 font-medium">Lead</th>
                <th className="px-3 py-2 font-medium">Detalle</th>
                <th className="px-3 py-2 text-right font-medium">Recibido</th>
              </tr>
            </thead>
            <tbody>
              {eventos.map((ev) => (
                <tr key={ev.id} className="border-b border-[var(--border-hairline)] last:border-0">
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{
                          background:
                            ev.estado === 'procesado' ? 'var(--status-good)'
                            : ev.estado === 'error' ? 'var(--status-critical)'
                            : 'var(--baseline)',
                        }}
                        aria-hidden
                      />
                      {ev.estado}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[var(--text-secondary)]">{ev.endpoint_nombre ?? ev.fuente}</td>
                  <td className="px-3 py-2">
                    {ev.ig_username ? `@${ev.ig_username}` : ev.lead_nombre ?? '—'}
                  </td>
                  <td className="max-w-[320px] px-3 py-2">
                    {ev.error ? (
                      <span style={{ color: 'var(--status-critical)' }}>{ev.error}</span>
                    ) : (
                      <code className="block truncate text-[11px] text-[var(--text-muted)]">
                        {JSON.stringify(ev.payload)}
                      </code>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--text-muted)]">
                    {fmtFecha(ev.recibido_en, true)}
                  </td>
                </tr>
              ))}
              {eventos.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[var(--text-muted)]">
                    Todavía no ha llegado ningún webhook.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
