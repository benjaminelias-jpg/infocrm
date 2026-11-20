import { useState } from 'react';
import { api } from '../../../api';
import { Boton, Campo, Desplegable, Dialogo, Entrada, Seleccion, Verificacion } from '../../../ui';
import { B, Instrucciones } from '../../integraciones/comun';
import { estadoConexion, nombrePorUrl, urlValida, type Conexion } from './datos';

// "¿A qué app avisamos?": se elige una conexión ya hecha (Zapier, Make…) en
// vez de pegar URLs. Si no hay, se conecta una ahí mismo, paso a paso, y se
// prueba con un lead de ejemplo.

const NUEVA = '__nueva';

type Prueba = { estado: 'esperando' | 'ok' | 'error'; texto?: string } | null;

export function SelectorConexion({ valor, url, conexiones, onElegir, onUrl, onConexionCreada, tipo = 'webhook', invalido }: {
  valor?: string | null; url?: string; conexiones: Conexion[];
  onElegir: (id: string | null) => void; onUrl: (url: string) => void;
  onConexionCreada: (c: Conexion) => void; tipo?: 'webhook' | 'email'; invalido?: boolean;
}) {
  const [nueva, setNueva] = useState(false);
  const [prueba, setPrueba] = useState<Prueba>(null);
  const elegida = conexiones.find((c) => c.id === valor) ?? null;
  const est = elegida ? estadoConexion(elegida) : null;
  const avanzado = !valor && !!url;

  async function probar() {
    setPrueba({ estado: 'esperando' });
    try {
      if (elegida) {
        const r = await api<any>(`/webhooks/salida/${elegida.id}/probar`, { method: 'POST' });
        setPrueba(r.estado === 'entregado'
          ? { estado: 'ok', texto: `${elegida.nombre} recibió el lead de ejemplo.` }
          : { estado: 'error', texto: `No lo recibió: ${r.error ?? (r.http_status ? `respondió ${r.http_status}` : 'no respondió')}` });
      } else {
        const r = await api<any>('/ux/pipeline/probar-aviso', { method: 'POST', json: { url, tipo } });
        setPrueba(r.ok ? { estado: 'ok', texto: 'La otra app recibió el lead de ejemplo.' } : { estado: 'error', texto: `No lo recibió: ${r.error}` });
      }
    } catch (e: any) { setPrueba({ estado: 'error', texto: e.message }); }
  }

  return (
    <div className="space-y-2">
      <Campo etiqueta="¿A qué app avisamos?" error={invalido ? 'Elegí a qué app avisamos' : undefined}>
        <Seleccion value={valor ?? ''} aria-invalid={invalido || undefined}
          onChange={(e) => {
            setPrueba(null);
            if (e.target.value === NUEVA) { setNueva(true); return; }
            onElegir(e.target.value || null);
          }}>
          <option value="">{avanzado ? 'Dirección pegada a mano (abajo)' : 'Elegí una app conectada…'}</option>
          {conexiones.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.activo ? '' : ' (en pausa)'}</option>)}
          <option value={NUEVA}>+ Conectar una app nueva…</option>
        </Seleccion>
      </Campo>
      {est && (
        <div className="flex items-center gap-1.5 text-[12px]" style={{ color: est.tono === 'mal' ? 'var(--status-critical)' : 'var(--text-muted)' }}>
          <span className="h-2 w-2 rounded-full" aria-hidden
            style={{ background: est.tono === 'bien' ? 'var(--status-good)' : est.tono === 'mal' ? 'var(--status-critical)' : 'var(--baseline)' }} />
          {est.texto}{est.tono === 'mal' && elegida?.ultimo_error ? `: ${elegida.ultimo_error.slice(0, 80)}` : ''}
        </div>
      )}
      {(elegida || urlValida(url)) && (
        <div className="space-y-1.5">
          <Boton tamano="sm" onClick={probar} cargando={prueba?.estado === 'esperando'}>Probar con un lead de ejemplo</Boton>
          {prueba && <Verificacion estado={prueba.estado} esperando="Mandando un lead de ejemplo…" ok={prueba.texto} error={prueba.texto} />}
        </div>
      )}
      {!elegida && (
        <Desplegable tarjeta={false} abiertoInicial={avanzado} titulo={<span className="text-[12px] font-medium">Avanzado: pegar una dirección</span>}>
          <Campo etiqueta="Dirección (webhook)" error={url && !urlValida(url) ? 'Pegá la dirección completa (empieza con https://)' : undefined}>
            <Entrada value={url ?? ''} onChange={(e) => { setPrueba(null); onUrl(e.target.value); }} placeholder="https://hooks.zapier.com/hooks/catch/…" inputMode="url" />
          </Campo>
        </Desplegable>
      )}
      <DialogoNuevaConexion abierto={nueva} tipo={tipo} onCerrar={() => setNueva(false)}
        onCreada={(c) => { setNueva(false); onConexionCreada(c); onElegir(c.id); }} />
    </div>
  );
}

function DialogoNuevaConexion({ abierto, tipo, onCerrar, onCreada }: {
  abierto: boolean; tipo: 'webhook' | 'email'; onCerrar: () => void; onCreada: (c: Conexion) => void;
}) {
  const [url, setUrl] = useState('');
  const [nombre, setNombre] = useState('');
  const [creando, setCreando] = useState(false);
  const [prueba, setPrueba] = useState<Prueba>(null);
  const [creada, setCreada] = useState<Conexion | null>(null);
  const valida = urlValida(url);
  const sugerido = valida ? `${nombrePorUrl(url.trim())}${tipo === 'email' ? ' · Email' : ''}` : '';

  function cerrar() { setUrl(''); setNombre(''); setPrueba(null); setCreada(null); onCerrar(); }

  async function conectar(e?: React.FormEvent) {
    e?.preventDefault();
    if (!valida) return;
    setCreando(true); setPrueba({ estado: 'esperando' });
    try {
      const c = creada ?? await api<Conexion>('/webhooks/salida', {
        method: 'POST', json: { nombre: nombre.trim() || sugerido, url: url.trim(), eventos: ['solo_etapas'] },
      });
      setCreada(c);
      const r = await api<any>(`/webhooks/salida/${c.id}/probar`, { method: 'POST' });
      if (r.estado === 'entregado') {
        setPrueba({ estado: 'ok', texto: 'Conectada: la otra app recibió un lead de ejemplo.' });
        window.setTimeout(() => { onCreada({ ...c, ultimo_envio_en: new Date().toISOString(), ultimo_error: null }); setUrl(''); setNombre(''); setPrueba(null); setCreada(null); }, 900);
      } else {
        setPrueba({ estado: 'error', texto: `Quedó guardada, pero no recibió el aviso de prueba: ${r.error ?? (r.http_status ? `respondió ${r.http_status}` : 'no respondió')}. Revisá la dirección o publicá el Zap y probá de nuevo.` });
      }
    } catch (err: any) { setPrueba({ estado: 'error', texto: err.message }); } finally { setCreando(false); }
  }

  return (
    <Dialogo abierto={abierto} onCerrar={cerrar} titulo={tipo === 'email' ? 'Conectar tu app de email' : 'Conectar otra app'} autoFoco={false}
      descripcion="Con Zapier o Make, sin programar."
      pie={<>
        {creada && prueba?.estado === 'error'
          ? <Boton variante="secundario" onClick={() => { onCreada(creada); cerrar(); }}>Usarla igual</Boton>
          : <Boton variante="fantasma" onClick={cerrar}>Cancelar</Boton>}
        <Boton variante="primario" onClick={() => conectar()} cargando={creando} disabled={!valida}>{creada ? 'Probar de nuevo' : 'Conectar y probar'}</Boton>
      </>}>
      <form onSubmit={conectar} className="space-y-3">
        <Instrucciones pasos={tipo === 'email' ? [
          <>En Zapier creá un Zap con <B>Webhooks by Zapier → Catch Hook</B> (en Make: <B>Webhooks → Custom webhook</B>).</>,
          <>Como segundo paso elegí tu app de email (ActiveCampaign, Mailchimp, Brevo…) → <B>agregar contacto a una lista o automatización</B>, usando el email que llega.</>,
          <>Copiá la dirección del primer paso y pegala acá.</>,
        ] : [
          <>En Zapier creá un Zap con <B>Webhooks by Zapier → Catch Hook</B> (en Make: <B>Webhooks → Custom webhook</B>).</>,
          <>Copiá la dirección que te da y pegala acá.</>,
          <>Tocá <B>Conectar y probar</B>: mandamos un lead de ejemplo para que Zapier/Make vea los datos.</>,
        ]} />
        <Campo etiqueta="Dirección que te dio Zapier o Make" error={url && !valida ? 'Pegá la dirección completa (empieza con https://)' : undefined}>
          <Entrada value={url} onChange={(e) => { setUrl(e.target.value); setCreada(null); setPrueba(null); }} placeholder="https://hooks.zapier.com/hooks/catch/…" inputMode="url" invalido={!!url && !valida} />
        </Campo>
        <Campo etiqueta="Nombre para reconocerla (opcional)">
          <Entrada value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={sugerido || 'Ej. Zapier · Secuencia de bienvenida'} maxLength={60} />
        </Campo>
        {prueba && <Verificacion estado={prueba.estado} esperando="Conectando y mandando un lead de ejemplo…" ok={prueba.texto} error={prueba.texto} />}
        <button type="submit" hidden aria-hidden />
      </form>
    </Dialogo>
  );
}
