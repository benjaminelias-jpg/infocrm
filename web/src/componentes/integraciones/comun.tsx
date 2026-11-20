import { isValidElement, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, hace } from '../../api';
import { textoDe, tonoDe } from '../../textos';
import { IdentidadLead, Insignia, ItemMenu, useEsMovil } from '../../ui';

// Piezas compartidas por las guías de integraciones.

/** Botón Copiar con fondo sólido (nunca deja ver el texto por debajo) y aviso al copiar. */
export function BotonCopiar({ texto, etiqueta = 'Copiar', onCopiado, ancho, className = '' }: {
  texto: string; etiqueta?: string; onCopiado?: () => void; ancho?: boolean; className?: string;
}) {
  const [copiado, setCopiado] = useState(false);
  const t = useRef<number | null>(null);
  useEffect(() => () => { if (t.current) window.clearTimeout(t.current); }, []);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      // Respaldo para navegadores sin permiso de portapapeles.
      const area = document.createElement('textarea');
      area.value = texto; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.appendChild(area); area.select();
      try { document.execCommand('copy'); } catch { /* nada más que hacer */ }
      area.remove();
    }
    setCopiado(true);
    onCopiado?.();
    if (t.current) window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setCopiado(false), 1600);
  }
  return (
    <button type="button" onClick={copiar} aria-live="polite"
      className={`ui-foco inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-[10px] px-3 text-[12px] font-semibold md:h-8 ${ancho ? 'w-full' : ''} ${className}`}
      style={copiado
        ? { background: 'color-mix(in srgb, var(--status-good) 16%, var(--surface-1))', color: 'var(--status-good)' }
        : { background: 'var(--surface-2, var(--gridline))', color: 'var(--text-primary)' }}>
      {copiado ? '✓ Copiado' : etiqueta}
    </button>
  );
}

/** "https://x/webhooks/whk_9ffe1234…357f" → "…/webhooks/whk_9ffe••••357f" (para compartir pantalla tranquilo). */
export function enmascararUrl(url: string) {
  const m = url.match(/^(.*\/)([^/]+)$/);
  if (!m) return url;
  const [, base, tok] = m;
  const corto = base.replace(/^https?:\/\/[^/]+/, '…');
  if (tok.length <= 10) return `${corto}${tok}`;
  return `${corto}${tok.slice(0, 8)}••••${tok.slice(-4)}`;
}

/** Una dirección (URL) para copiar, con aviso de que es secreta si hace falta. */
export function Direccion({ url, secreta, etiqueta, onCopiado, enmascarar }: {
  url: string; secreta?: boolean; etiqueta?: string;
  /** Se llama al copiar (p. ej. para marcar el paso como hecho). */
  onCopiado?: () => void;
  /** Mostrarla enmascarada con un botón "Mostrar". */
  enmascarar?: boolean;
}) {
  const [ver, setVer] = useState(!enmascarar);
  return (
    <div className="space-y-1">
      {etiqueta && <div className="text-[11px] font-medium text-[var(--text-muted)]">{etiqueta}</div>}
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-[10px] px-2.5 py-2 text-[12px]"
          style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>
          {ver ? url : enmascararUrl(url)}
        </code>
        {enmascarar && (
          <button type="button" onClick={() => setVer((v) => !v)} aria-pressed={ver}
            className="ui-foco h-9 shrink-0 rounded-[10px] px-2 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-2,var(--page-plane))] md:h-8">
            {ver ? 'Ocultar' : 'Mostrar'}
          </button>
        )}
        <BotonCopiar texto={url} onCopiado={onCopiado} />
      </div>
      {secreta && <p className="text-[11px] text-[var(--text-muted)]">Es como una contraseña: pegala solo en esa app.</p>}
    </div>
  );
}

/**
 * Bloque de código/JSON para copiar: barra arriba con el título y Copiar
 * (nunca encima del texto) y, en el celular, líneas que se ajustan solas.
 */
export function Bloque({ texto, titulo = 'Para copiar', onCopiado }: { texto: string; titulo?: React.ReactNode; onCopiado?: () => void }) {
  const movil = useEsMovil();
  return (
    <div className="overflow-hidden rounded-[12px]" style={{ border: '1px solid var(--border-hairline)' }}>
      <div className="flex items-center justify-between gap-2 px-3 py-1.5" style={{ background: 'var(--surface-2, var(--gridline))' }}>
        <span className="min-w-0 truncate text-[11px] font-semibold text-[var(--text-secondary)]">{titulo}</span>
        {!movil && <BotonCopiar texto={texto} onCopiado={onCopiado} className="!h-7" />}
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all p-3 text-[11.5px] leading-relaxed" style={{ background: 'var(--page-plane)' }}>{texto}</pre>
      {movil && <div className="p-2" style={{ background: 'var(--page-plane)' }}><BotonCopiar texto={texto} onCopiado={onCopiado} ancho /></div>}
    </div>
  );
}

export type Subpaso = React.ReactNode | { texto: React.ReactNode; extra?: React.ReactNode };
const esSubpasoConExtra = (p: Subpaso): p is { texto: React.ReactNode; extra?: React.ReactNode } =>
  !!p && typeof p === 'object' && !isValidElement(p) && 'texto' in (p as object);

/**
 * Lista de pasos dentro de otra app ("En ManyChat: …"). Cada paso puede
 * llevar su contenido debajo ({ texto, extra }): el JSON va justo debajo
 * del paso que dice "pegá esto", no al final.
 */
export function Instrucciones({ app, pasos }: { app?: string; pasos: Subpaso[] }) {
  return (
    <div className="space-y-1.5">
      {app && <div className="text-[12px] font-medium">En {app}:</div>}
      <ol className="space-y-2 text-[13px]">
        {pasos.map((p, i) => {
          const conExtra = esSubpasoConExtra(p);
          return (
            <li key={i} className="flex gap-2">
              <span className="mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                style={{ background: 'var(--surface-2, var(--gridline))', color: 'var(--text-secondary)' }}>{i + 1}</span>
              <div className="min-w-0 flex-1 space-y-2 leading-snug">
                <div>{conExtra ? p.texto : p}</div>
                {conExtra && p.extra}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Texto fuerte para nombres de botones/menús de otras apps. */
export const B = ({ children }: { children: React.ReactNode }) => <b className="font-semibold">{children}</b>;

export interface Fuente {
  id: string; nombre: string; fuente: string; url: string; slug?: string;
  total_recibidos: number | string; total_errores: number | string; ultimo_evento_en: string | null;
  configurado_en?: string | null; verificada?: boolean; activo?: boolean;
}

/**
 * La dirección de entrada de un tipo de integración.
 * Por defecto la pide y la crea si falta (como siempre). Con { crear: false }
 * solo la busca: mirar una guía no crea nada, y `crear()` la crea cuando el
 * usuario la pide ("Mostrar mi dirección").
 */
export function useFuente(tipo: string | null, opciones: { crear?: boolean } = {}) {
  const crearAlAbrir = opciones.crear !== false;
  const [fuente, setFuente] = useState<Fuente | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(Boolean(tipo));
  const [vuelta, setVuelta] = useState(0);
  useEffect(() => {
    if (!tipo) { setCargando(false); return; }
    let vivo = true;
    setFuente(null); setError(null); setCargando(true);
    const pedido = crearAlAbrir
      ? api<Fuente>('/ux/integraciones/fuente', { method: 'POST', json: { tipo } })
      : api<{ fuente: Fuente | null }>(`/ux/integraciones/fuente?tipo=${encodeURIComponent(tipo)}`).then((r) => r.fuente);
    pedido
      .then((f) => { if (vivo) setFuente(f); })
      .catch((e) => { if (vivo) setError(e.message); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [tipo, crearAlAbrir, vuelta]);
  const crear = useCallback(async () => {
    if (!tipo) return null;
    const f = await api<Fuente>('/ux/integraciones/fuente', { method: 'POST', json: { tipo } });
    setFuente(f); setError(null);
    return f;
  }, [tipo]);
  const recargar = useCallback(() => setVuelta((n) => n + 1), []);
  return { fuente, error, cargando, crear, recargar, setFuente };
}

/** "Ya llegaron N · el último hace X" + los últimos 3, en simple (y se pueden tocar). */
export function UltimosLlegados({ endpointId, refrescar, onVerLead, limite = 3 }: {
  endpointId: string; refrescar?: number; onVerLead?: (leadId: string) => void; limite?: number;
}) {
  const [filas, setFilas] = useState<any[] | null>(null);
  useEffect(() => {
    let vivo = true;
    api<any[]>(`/ux/integraciones/ultimos?endpoint_id=${endpointId}&limite=${limite}`).then((f) => { if (vivo) setFilas(f); }).catch(() => {});
    return () => { vivo = false; };
  }, [endpointId, refrescar, limite]);
  if (!filas?.length) return null;
  return (
    <div className="rounded-[12px] p-3" style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>
      <div className="mb-1.5 text-[12px] font-semibold">Lo último que llegó</div>
      <ul className="space-y-1">
        {filas.map((f) => {
          const estado = f.estado !== 'procesado'
            ? <Insignia tono={tonoDe('webhook', f.estado)}>{textoDe('webhook', f.estado)}</Insignia> : null;
          const derecha = (
            <span className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--text-muted)]">{estado}{hace(f.en)}</span>
          );
          return (
            <li key={f.id}>
              {f.lead_id
                ? <IdentidadLead id={f.lead_id} nombre={f.nombre} usuario={f.de} foto={f.avatar_url} derecha={derecha}
                    onClick={onVerLead ? () => onVerLead(f.lead_id) : undefined} className="w-full py-1 hover:bg-[var(--surface-2,transparent)]" />
                : (
                  <div className="flex items-center justify-between gap-2 py-1 text-[12px]">
                    <span className="min-w-0 truncate text-[var(--text-secondary)]">{f.codigo === 'firma_invalida' ? 'Aviso rechazado (firma)' : 'Sin identificar'}</span>
                    {derecha}
                  </div>
                )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Pasos con avance manual ("Listo, siguiente") para guías de copiar y pegar.
 * Con `claveUrl` el paso vive en la URL (?paso=2): recargar lo mantiene.
 */
export function usePaso(total: number, inicial = 0, claveUrl?: string) {
  const [propio, setPropio] = useState(inicial);
  const [params, setParams] = useSearchParams();
  const enUrl = claveUrl ? Number(params.get(claveUrl)) : NaN;
  const paso = claveUrl ? (Number.isFinite(enUrl) && enUrl >= 1 ? Math.min(total - 1, enUrl - 1) : inicial) : propio;
  const fijar = useCallback((n: number) => {
    const v = Math.max(0, Math.min(total - 1, n));
    if (!claveUrl) { setPropio(v); return; }
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set(claveUrl, String(v + 1));
      return p;
    }, { replace: true, state: (window.history.state as any)?.usr ?? undefined });
  }, [claveUrl, setParams, total]);
  const estado = (i: number) => (i < paso ? 'hecho' : i === paso ? 'actual' : 'pendiente') as 'hecho' | 'actual' | 'pendiente';
  return {
    paso, estado,
    siguiente: () => fijar(paso + 1),
    ir: (i: number) => fijar(i),
  };
}

/** Ítem de menú que pide confirmación con un segundo toque (sin ventanas del navegador). */
export function ItemConfirmar({ children, confirmar = '¿Seguro? Tocá de nuevo', onConfirmar, icono }: {
  children: React.ReactNode; confirmar?: string; onConfirmar: () => void; icono?: React.ReactNode;
}) {
  const [armado, setArmado] = useState(false);
  useEffect(() => {
    if (!armado) return;
    const t = window.setTimeout(() => setArmado(false), 4000);
    return () => window.clearTimeout(t);
  }, [armado]);
  return (
    <ItemMenu peligro icono={icono} cerrarAlTocar={armado}
      onClick={() => { if (armado) onConfirmar(); else setArmado(true); }}>
      {armado ? confirmar : children}
    </ItemMenu>
  );
}


/** "Detalle técnico" plegado (el texto crudo para quien ayuda con lo técnico), sin el triángulo del navegador. */
export function DetalleTecnico({ children, titulo = 'Detalle técnico' }: { children: React.ReactNode; titulo?: string }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="text-[11px] text-[var(--text-muted)]">
      <button type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}
        className="ui-foco inline-flex items-center gap-1 rounded-[6px] py-0.5 font-medium hover:text-[var(--text-secondary)]">
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden className="transition-transform" style={{ transform: abierto ? 'rotate(90deg)' : 'none' }}>
          <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {titulo}
      </button>
      {abierto && <p className="ui-fundido mt-1 break-words">{children}</p>}
    </div>
  );
}
