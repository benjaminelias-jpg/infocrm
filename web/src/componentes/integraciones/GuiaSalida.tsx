import { useEffect, useState } from 'react';
import { api, fmtNum, hace } from '../../api';
import {
  Boton, BotonConfirmar, Campo, Chip, Entrada, FilaChips, Interruptor, Pestanas, Verificacion, useAviso, Desplegable, Copiar,
} from '../../ui';
import GuiaEntrada from './GuiaEntrada';
import { B, Instrucciones } from './comun';

// Zapier / Make / n8n en las dos direcciones:
//  · "Avisar a otra app": el CRM manda un aviso cuando pasa algo.
//  · "Recibir datos": otra app manda leads al CRM (usa GuiaEntrada).

const EVENTOS: Array<{ id: string; nombre: string }> = [
  { id: '*', nombre: 'Todo' },
  { id: 'lead_creado', nombre: 'Lead nuevo' },
  { id: 'reunion_agendada', nombre: 'Reunión agendada' },
  { id: 'reunion_no_asistio', nombre: 'No asistió' },
  { id: 'venta', nombre: 'Venta' },
  { id: 'reembolso', nombre: 'Devolución' },
];
const nombreEvento = (id: string) => EVENTOS.find((e) => e.id === id)?.nombre ?? id;

function nombrePorUrl(url: string) {
  if (/zapier\.com/i.test(url)) return 'Zapier';
  if (/make\.com|integromat/i.test(url)) return 'Make';
  if (/n8n/i.test(url)) return 'n8n';
  if (/slack\.com/i.test(url)) return 'Slack';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Mi app'; }
}

type Prueba = { estado: 'esperando' | 'ok' | 'error'; texto?: string };

export default function GuiaSalida({ onCambio }: { onCambio?: () => void }) {
  const [pestana, setPestana] = useState<'avisar' | 'recibir'>('avisar');
  return (
    <div className="space-y-4">
      <Pestanas pestanas={[{ id: 'avisar', etiqueta: 'Avisar a otra app' }, { id: 'recibir', etiqueta: 'Recibir datos' }]}
        actual={pestana} onCambiar={setPestana} />
      {pestana === 'avisar' ? <Avisar onCambio={onCambio} /> : <GuiaEntrada clase="zapier" onCambio={onCambio} />}
    </div>
  );
}

function Avisar({ onCambio }: { onCambio?: () => void }) {
  const aviso = useAviso();
  const [lista, setLista] = useState<any[] | null>(null);
  const [url, setUrl] = useState('');
  const [eventos, setEventos] = useState<string[]>(['*']);
  const [creando, setCreando] = useState(false);
  const [pruebas, setPruebas] = useState<Record<string, Prueba>>({});
  const urlValida = (() => {
    try { const u = new URL(url.trim()); return (u.protocol === 'https:' || u.protocol === 'http:') && !!u.hostname; } catch { return false; }
  })();

  async function cargar() {
    setLista(await api<any[]>('/webhooks/salida'));
  }
  useEffect(() => { cargar().catch((e) => aviso.error(e.message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function alternar(id: string) {
    setEventos((ev) => {
      if (id === '*') return ['*'];
      const sin = ev.filter((x) => x !== '*' && x !== id);
      const nuevo = ev.includes(id) ? sin : [...sin, id];
      return nuevo.length ? nuevo : ['*'];
    });
  }

  async function probar(id: string) {
    setPruebas((p) => ({ ...p, [id]: { estado: 'esperando' } }));
    try {
      const r = await api<any>(`/webhooks/salida/${id}/probar`, { method: 'POST' });
      setPruebas((p) => ({
        ...p,
        [id]: r.estado === 'entregado'
          ? { estado: 'ok', texto: 'La otra app recibió el aviso de prueba.' }
          : { estado: 'error', texto: `No lo recibió: ${r.error ?? (r.http_status ? `respondió ${r.http_status}` : 'sin respuesta')}` },
      }));
      await cargar();
    } catch (e: any) {
      setPruebas((p) => ({ ...p, [id]: { estado: 'error', texto: e.message } }));
    }
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!urlValida) return;
    setCreando(true);
    try {
      const limpia = url.trim();
      const s = await api<any>('/webhooks/salida', { method: 'POST', json: { nombre: nombrePorUrl(limpia), url: limpia, eventos } });
      setUrl(''); setEventos(['*']);
      await cargar();
      onCambio?.();
      aviso.exito(`Listo: avisamos a ${s.nombre}. Probando la conexión…`);
      await probar(s.id);
    } catch (err: any) {
      aviso.error(err.message);
    } finally { setCreando(false); }
  }

  async function activar(s: any, activo: boolean) {
    setLista((l) => l?.map((x) => (x.id === s.id ? { ...x, activo } : x)) ?? l);
    try { await api(`/webhooks/salida/${s.id}`, { method: 'PATCH', json: { activo } }); onCambio?.(); }
    catch (e: any) { aviso.error(e.message); await cargar(); }
  }

  async function borrar(s: any) {
    try {
      await api(`/webhooks/salida/${s.id}`, { method: 'DELETE' });
      await cargar(); onCambio?.();
      aviso.exito(`Ya no avisamos a ${s.nombre}.`);
    } catch (e: any) { aviso.error(e.message); }
  }

  async function verSecreto(id: string) {
    const r = await api<{ secreto: string }>(`/webhooks/salida/${id}/secreto`);
    setPruebas((p) => ({ ...p, [`sec_${id}`]: { estado: 'ok', texto: r.secreto } }));
  }

  return (
    <div className="space-y-4">
      <Instrucciones pasos={[
        <>En Zapier creá un Zap con el disparador <B>Webhooks by Zapier → Catch Hook</B> (en Make: <B>Webhooks → Custom webhook</B>) y copiá la dirección que te da.</>,
        <>Pegala acá abajo y elegí <B>cuándo</B> querés que avisemos.</>,
        <>Tocá <B>Conectar</B>: mandamos un aviso de prueba para que Zapier/Make vea los datos.</>,
      ]} />

      <form onSubmit={crear} className="space-y-3 rounded-xl p-3" style={{ border: '1px solid var(--border-hairline)' }}>
        <Campo etiqueta="Dirección de la otra app" error={url && !urlValida ? 'Pegá la dirección completa (empieza con https://)' : undefined}>
          <Entrada value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.zapier.com/hooks/catch/…" inputMode="url" invalido={!!url && !urlValida} />
        </Campo>
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-[var(--text-secondary)]">¿Cuándo avisamos?</div>
          <FilaChips>
            {EVENTOS.map((ev) => <Chip key={ev.id} activo={eventos.includes(ev.id)} onClick={() => alternar(ev.id)}>{ev.nombre}</Chip>)}
          </FilaChips>
        </div>
        <Boton type="submit" variante="primario" cargando={creando} disabled={!urlValida}>Conectar</Boton>
      </form>

      {lista && lista.length > 0 && (
        <div className="space-y-2">
          <div className="text-[12px] font-medium text-[var(--text-secondary)]">Apps a las que avisamos</div>
          {lista.map((s) => {
            const pr = pruebas[s.id];
            const sec = pruebas[`sec_${s.id}`];
            return (
              <div key={s.id} className="space-y-2 rounded-xl p-3" style={{ border: '1px solid var(--border-hairline)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold">{s.nombre}</div>
                    <div className="truncate text-[11px] text-[var(--text-muted)]" title={s.url}>{s.url}</div>
                    <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                      {(s.eventos ?? []).map(nombreEvento).join(' · ')} · <span className="cifras">{fmtNum(s.total_enviados)}</span> enviados
                      {s.ultimo_envio_en ? <> · último {hace(s.ultimo_envio_en)}</> : null}
                      {Number(s.total_fallos) > 0 && <span style={{ color: 'var(--status-critical)' }}> · {fmtNum(s.total_fallos)} fallaron</span>}
                    </div>
                  </div>
                  <Interruptor activo={s.activo} onCambiar={(v) => activar(s, v)} etiqueta={s.activo ? 'Activo' : 'Pausado'} />
                </div>
                {pr && <Verificacion estado={pr.estado} esperando="Mandando un aviso de prueba…" ok={pr.texto} error={pr.texto} />}
                <div className="flex flex-wrap items-center gap-2">
                  <Boton tamano="xs" onClick={() => probar(s.id)} cargando={pr?.estado === 'esperando'}>Probar</Boton>
                  <BotonConfirmar tamano="xs" onConfirmar={() => borrar(s)} confirmar="¿Dejar de avisar? Tocá de nuevo">Quitar</BotonConfirmar>
                </div>
                <Desplegable titulo={<span className="text-[12px]">Para técnicos: firma de seguridad</span>} tarjeta={false}
                  onCambiar={(a) => { if (a && !sec) verSecreto(s.id).catch(() => {}); }}>
                  <div className="space-y-1.5 pt-1 text-[12px] text-[var(--text-secondary)]">
                    <p>Cada aviso va firmado (HMAC-SHA256) en la cabecera <code>x-infocrm-firma</code> con este secreto:</p>
                    {sec?.texto
                      ? <div className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-[11px]" style={{ background: 'var(--page-plane)' }}>{sec.texto}</code><Copiar texto={sec.texto} /></div>
                      : <p className="text-[var(--text-muted)]">Cargando…</p>}
                  </div>
                </Desplegable>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
