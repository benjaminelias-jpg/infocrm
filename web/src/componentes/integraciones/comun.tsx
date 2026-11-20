import { useEffect, useState } from 'react';
import { api, hace } from '../../api';
import { Copiar, Insignia } from '../../ui';

// Piezas compartidas por las guías de integraciones.

/** Una dirección (URL) para copiar, con aviso de que es secreta si hace falta. */
export function Direccion({ url, secreta, etiqueta }: { url: string; secreta?: boolean; etiqueta?: string }) {
  return (
    <div className="space-y-1">
      {etiqueta && <div className="text-[11px] font-medium text-[var(--text-muted)]">{etiqueta}</div>}
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg px-2.5 py-2 text-[12px]" style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }} title={url}>{url}</code>
        <Copiar texto={url} />
      </div>
      {secreta && <p className="text-[11px] text-[var(--text-muted)]">🔒 Es como una contraseña: pegala solo en esa app.</p>}
    </div>
  );
}

/** Bloque de código/JSON para copiar. */
export function Bloque({ texto }: { texto: string }) {
  return (
    <div className="relative">
      <pre className="max-h-56 overflow-auto rounded-lg p-3 pr-20 text-[11px] leading-relaxed" style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>{texto}</pre>
      <div className="absolute right-2 top-2"><Copiar texto={texto} /></div>
    </div>
  );
}

/** Lista de pasos dentro de otra app ("En ManyChat: …"). */
export function Instrucciones({ app, pasos }: { app?: string; pasos: React.ReactNode[] }) {
  return (
    <div className="space-y-1.5">
      {app && <div className="text-[12px] font-medium">En {app}:</div>}
      <ol className="space-y-1.5 text-[13px]">
        {pasos.map((p, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold" style={{ background: 'var(--gridline)', color: 'var(--text-secondary)' }}>{i + 1}</span>
            <span className="min-w-0 leading-snug">{p}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Texto fuerte para nombres de botones/menús de otras apps. */
export const B = ({ children }: { children: React.ReactNode }) => <b className="font-semibold">{children}</b>;

export interface Fuente {
  id: string; nombre: string; fuente: string; url: string;
  total_recibidos: number | string; total_errores: number | string; ultimo_evento_en: string | null;
}

/** Pide (y crea si falta) la dirección de entrada de un tipo de integración. */
export function useFuente(tipo: string | null) {
  const [fuente, setFuente] = useState<Fuente | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!tipo) return;
    let vivo = true;
    setFuente(null); setError(null);
    api<Fuente>('/ux/integraciones/fuente', { method: 'POST', json: { tipo } })
      .then((f) => { if (vivo) setFuente(f); })
      .catch((e) => { if (vivo) setError(e.message); });
    return () => { vivo = false; };
  }, [tipo]);
  return { fuente, error };
}

/** "Ya llegaron N · el último hace X" + los últimos 3, en simple. */
export function UltimosLlegados({ endpointId, refrescar }: { endpointId: string; refrescar?: number }) {
  const [filas, setFilas] = useState<any[] | null>(null);
  useEffect(() => {
    let vivo = true;
    api<any[]>(`/ux/integraciones/ultimos?endpoint_id=${endpointId}&limite=3`).then((f) => { if (vivo) setFilas(f); }).catch(() => {});
    return () => { vivo = false; };
  }, [endpointId, refrescar]);
  if (!filas?.length) return null;
  return (
    <div className="rounded-lg p-3" style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>
      <div className="mb-1.5 text-[12px] font-medium">Lo último que llegó</div>
      <ul className="space-y-1">
        {filas.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-2 text-[12px]">
            <span className="min-w-0 truncate">{f.de ? `@${f.de}` : f.nombre ?? 'Sin identificar'}</span>
            <span className="flex shrink-0 items-center gap-2 text-[var(--text-muted)]">
              {f.estado === 'error'
                ? <Insignia tono="rojo">con error</Insignia>
                : f.estado === 'duplicado' ? <Insignia>repetido</Insignia> : null}
              {hace(f.en)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Pasos con avance manual ("Listo, siguiente") para guías de copiar y pegar. */
export function usePaso(total: number, inicial = 0) {
  const [paso, setPaso] = useState(inicial);
  const estado = (i: number) => (i < paso ? 'hecho' : i === paso ? 'actual' : 'pendiente') as 'hecho' | 'actual' | 'pendiente';
  return {
    paso, estado,
    siguiente: () => setPaso((p) => Math.min(total - 1, p + 1)),
    ir: (i: number) => setPaso(Math.max(0, Math.min(total - 1, i))),
  };
}
