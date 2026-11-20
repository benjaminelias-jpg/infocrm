import { useEffect, useState } from 'react';
import { api, fmtFecha, fmtNum, hace } from '../../api';
import { Boton, Chip, FilaChips, Insignia, TablaResponsiva, Vacio, useAviso, Esqueleto } from '../../ui';
import { Direccion } from './comun';

// Todo lo técnico, junto y fuera del camino: direcciones de entrada, el
// historial crudo de lo que llegó (con reintento) y los avisos enviados.

const ESTADOS = [
  { id: '', nombre: 'Todo' },
  { id: 'error', nombre: 'Con error' },
  { id: 'procesado', nombre: 'Procesados' },
  { id: 'duplicado', nombre: 'Repetidos' },
];

const tonoEstado = (e: string) => (e === 'procesado' || e === 'entregado' ? 'verde' : e === 'error' || e === 'fallido' ? 'rojo' : 'neutro') as any;

export default function ParaTecnicos({ endpoints, onCambio }: { endpoints: any[]; onCambio?: () => void }) {
  const aviso = useAviso();
  const [filtro, setFiltro] = useState('');
  const [eventos, setEventos] = useState<any[] | null>(null);
  const [entregas, setEntregas] = useState<any[] | null>(null);
  const [reintentando, setReintentando] = useState(false);

  async function cargar() {
    const p = new URLSearchParams({ limite: '60' });
    if (filtro) p.set('estado', filtro);
    const [ev, en] = await Promise.all([
      api<any[]>(`/webhooks/eventos?${p}`),
      api<any[]>('/webhooks/salida/entregas?limite=30'),
    ]);
    setEventos(ev); setEntregas(en);
  }
  useEffect(() => { cargar().catch((e) => aviso.error(e.message)); }, [filtro]); // eslint-disable-line react-hooks/exhaustive-deps

  async function reintentar() {
    setReintentando(true);
    try {
      const r = await api<any>('/webhooks/reprocesar-errores', { method: 'POST' });
      aviso.exito(`Reintentados ${r.intentados}: se recuperaron ${r.recuperados}.`);
      await cargar(); onCambio?.();
    } catch (e: any) { aviso.error(e.message); } finally { setReintentando(false); }
  }

  const conError = eventos?.filter((e) => e.estado === 'error').length ?? 0;

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-[13px] font-semibold">Direcciones de entrada</h3>
        <p className="text-[12px] text-[var(--text-muted)]">Cada una es secreta. El CRM entiende los datos de ManyChat, Calendly, Cal.com, Stripe, Hotmart, Zapier y Make sin configurar nada.</p>
        <div className="space-y-3">
          {endpoints.map((e) => (
            <div key={e.id} className="space-y-1.5 rounded-xl p-3" style={{ border: '1px solid var(--border-hairline)' }}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                <span className="font-medium">{e.nombre}</span>
                <span className="cifras text-[var(--text-muted)]">
                  {fmtNum(e.total_recibidos)} recibidos
                  {Number(e.total_errores) > 0 && <span style={{ color: 'var(--status-critical)' }}> · {fmtNum(e.total_errores)} con error</span>}
                  {e.ultimo_evento_en && <> · último {hace(e.ultimo_evento_en)}</>}
                </span>
              </div>
              <Direccion url={e.url} />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold">Historial de lo que llegó</h3>
          {conError > 0 && <Boton tamano="xs" onClick={reintentar} cargando={reintentando}>Reintentar {conError} con error</Boton>}
        </div>
        <p className="text-[12px] text-[var(--text-muted)]">Todo se guarda antes de procesarlo: si algo falla, el lead no se pierde y se puede reintentar.</p>
        <FilaChips>
          {ESTADOS.map((s) => <Chip key={s.id || 'todo'} activo={filtro === s.id} onClick={() => setFiltro(s.id)}>{s.nombre}</Chip>)}
        </FilaChips>
        {!eventos ? <Esqueleto alto={120} /> : (
          <TablaResponsiva
            filas={eventos}
            clave={(f) => String(f.id)}
            vacio={<Vacio compacto icono="📭" titulo="Todavía no llegó nada" texto="Cuando una app mande datos, vas a verlos acá." />}
            columnas={[
              { clave: 'lead', titulo: 'Lead', enMovil: 'titulo', render: (f) => (f.ig_username ? `@${f.ig_username}` : f.lead_nombre ?? '—') },
              { clave: 'estado', titulo: 'Estado', enMovil: 'esquina', render: (f) => <Insignia tono={tonoEstado(f.estado)}>{f.estado}</Insignia> },
              { clave: 'origen', titulo: 'Origen', enMovil: 'subtitulo', render: (f) => <span className="text-[var(--text-secondary)]">{f.endpoint_nombre ?? f.fuente}</span> },
              {
                clave: 'detalle', titulo: 'Detalle', enMovil: 'dato',
                render: (f) => f.error
                  ? <span style={{ color: 'var(--status-critical)' }}>{f.error}</span>
                  : <code className="block max-w-[320px] truncate text-[11px] text-[var(--text-muted)]">{JSON.stringify(f.payload)}</code>,
              },
              { clave: 'cuando', titulo: 'Recibido', alinear: 'der', enMovil: 'dato', render: (f) => <span className="text-[var(--text-muted)]">{fmtFecha(f.recibido_en, true)}</span> },
            ]}
          />
        )}
      </section>

      {entregas && entregas.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[13px] font-semibold">Avisos enviados a otras apps</h3>
          <TablaResponsiva
            filas={entregas}
            clave={(f) => String(f.id)}
            columnas={[
              { clave: 'evento', titulo: 'Evento', enMovil: 'titulo', render: (f) => f.tipo_evento },
              { clave: 'estado', titulo: 'Estado', enMovil: 'esquina', render: (f) => <Insignia tono={tonoEstado(f.estado)}>{f.estado}</Insignia> },
              { clave: 'app', titulo: 'App', enMovil: 'subtitulo', render: (f) => <span className="text-[var(--text-secondary)]">{f.suscripcion}</span> },
              { clave: 'http', titulo: 'Respuesta', enMovil: 'dato', render: (f) => <span className="cifras">{f.http_status ?? (f.error ? 'sin respuesta' : '—')}</span> },
              { clave: 'cuando', titulo: 'Cuándo', alinear: 'der', enMovil: 'dato', render: (f) => <span className="text-[var(--text-muted)]">{fmtFecha(f.creado_en, true)}</span> },
            ]}
          />
        </section>
      )}
    </div>
  );
}
