import { fmtDinero } from '../../api';
import { estiloEtiqueta } from '../../etiquetas';
import Icono from '../Iconos';
import { Temperatura } from './temperatura';

// Tarjeta de lead estilo Kommo (la misma idea que la del Pipeline): tres
// renglones como mucho.
//   [quién lo atiende o "Sin asignar"]             [hace 5 h]
//   @usuario (azul) · Nombre              [💬 2] [Caliente · 52]
//   ● Etapa · ▶ reel de origen · etiqueta · +N

/** "Hoy 11:16", "Ayer 14:32" o "04/11" (con año si no es este). */
export function fechaCorta(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const hoy = new Date();
  const ayer = new Date(Date.now() - 86_400_000);
  const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (d.toDateString() === hoy.toDateString()) return `Hoy ${hora}`;
  if (d.toDateString() === ayer.toDateString()) return `Ayer ${hora}`;
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', ...(d.getFullYear() !== hoy.getFullYear() ? { year: 'numeric' } : {}) });
}

function EtiquetaChica({ children, ancho = 'max-w-[40%]' }: { children: React.ReactNode; ancho?: string }) {
  return (
    <span className={`${ancho} shrink-0 truncate rounded border border-[var(--border-hairline)] px-1.5 py-px text-[11px] leading-[16px] text-[var(--text-secondary)]`}
      style={typeof children === 'string' ? estiloEtiqueta(children) : undefined}>
      {children}
    </span>
  );
}

export default function TarjetaLead({ l, onAbrir, onChat }: { l: any; onAbrir: () => void; onChat: () => void }) {
  const etiquetas: string[] = l.etiquetas ?? [];
  const max = l.contenido_titulo ? 1 : 2;
  const resto = etiquetas.length - max;
  const usuario = l.ig_username ? `@${l.ig_username}` : null;
  const nombre = [l.nombre, l.apellido].filter(Boolean).join(' ').trim();
  const principal = usuario ?? (nombre || 'Lead sin nombre');
  const sinLeer = Number(l.mensajes_sin_leer) || 0;

  return (
    <article onClick={onAbrir} role="button" tabIndex={0}
      aria-label={`${principal}${l.propietario_nombre ? `, lo atiende ${l.propietario_nombre}` : ''}`}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAbrir(); } }}
      className="ui-foco cursor-pointer rounded-lg border border-[var(--border-hairline)] px-3 py-2 active:bg-[var(--page-plane)]"
      style={{ background: 'var(--surface-1)' }}>
      <div className="flex items-center justify-between gap-2 text-[12px]">
        {l.propietario_nombre
          ? <span className="min-w-0 truncate text-[var(--text-primary)]">{l.propietario_nombre}</span>
          : <span className="min-w-0 truncate italic text-[var(--text-muted)]">Sin asignar</span>}
        <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{fechaCorta(l.ultima_actividad)}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[14px] font-medium">
          <span style={{ color: usuario ? 'var(--series-1)' : undefined }}>{principal}</span>
          {usuario && nombre && <span className="font-normal text-[var(--text-muted)]"> · {nombre}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {sinLeer > 0 && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onChat(); }} aria-label={`${sinLeer} sin leer: abrir el chat`}
              className="ui-foco inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold text-white"
              style={{ background: 'var(--series-1)' }}>
              <Icono nombre="bandeja" tam={12} />{sinLeer > 99 ? '99+' : sinLeer}
            </button>
          )}
          <Temperatura score={l.score} corta numero={false} />
        </span>
      </div>
      <div className="mt-1 flex items-center gap-1 overflow-hidden text-[11px]">
        {l.etapa_nombre && (
          <span className="flex min-w-0 max-w-[45%] shrink-0 items-center gap-1 text-[var(--text-secondary)]">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: l.etapa_color ?? 'var(--baseline)' }} aria-hidden />
            <span className="truncate">{l.etapa_nombre}</span>
          </span>
        )}
        {l.contenido_titulo && <EtiquetaChica ancho="max-w-[38%]">▶ {l.contenido_titulo}</EtiquetaChica>}
        {etiquetas.slice(0, max).map((e) => <EtiquetaChica key={e}>{e}</EtiquetaChica>)}
        {resto > 0 && <EtiquetaChica>+{resto}</EtiquetaChica>}
        {Number(l.valor_total) > 0 && (
          <span className="cifras ml-auto shrink-0 pl-1 text-[12px] font-semibold" style={{ color: 'var(--status-good)' }}>{fmtDinero(l.valor_total)}</span>
        )}
      </div>
    </article>
  );
}
