import { fmtDinero } from '../../api';
import { Menu, ItemMenu, SeparadorMenu } from '../../ui';
import Icono from '../Iconos';
import { resumirAcciones } from './acciones';

// Tarjeta estilo Kommo: compacta, tres renglones como mucho.
//   [quién lo atiende]                       [Hoy 11:16] [⋯]
//   @usuario (azul)                    [💬 2]      497 €
//   ▶ reel de origen · etiquetas
// Sin responsable no se repite "Sin asignar": queda solo la fecha.

/** "Hoy 11:16", "Ayer 14:32" o "04/11" (con año si no es este). */
export function fechaCorta(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const hoy = new Date();
  const ayer = new Date(Date.now() - 86_400_000);
  const mismoDia = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (mismoDia(d, hoy)) return `Hoy ${hora}`;
  if (mismoDia(d, ayer)) return `Ayer ${hora}`;
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', ...(d.getFullYear() !== hoy.getFullYear() ? { year: 'numeric' } : {}) });
}

function EtiquetaChica({ children, ancho = 'max-w-[45%]' }: { children: React.ReactNode; ancho?: string }) {
  return (
    <span className={`${ancho} shrink-0 truncate rounded-[6px] px-1.5 py-px text-[11px] font-medium leading-[16px] text-[var(--text-secondary)]`} style={{ background: 'var(--surface-2)' }}>
      {children}
    </span>
  );
}

export interface PropsTarjeta {
  t: any;
  etapas: any[];
  usuarios: Array<{ id: string; nombre: string }>;
  onAbrir: () => void;
  onChat: () => void;
  onMover: (etapaId: string) => void;
  onAsignar: (usuarioId: string | null) => void;
  onArrastrar: (v: boolean) => void;
}

export default function Tarjeta({ t, etapas, usuarios, onAbrir, onChat, onMover, onAsignar, onArrastrar }: PropsTarjeta) {
  const etiquetas: string[] = t.etiquetas ?? [];
  const max = t.contenido_titulo ? 1 : 2;
  const resto = etiquetas.length - max;
  const quien = t.ig_username ? `@${t.ig_username}` : (t.nombre || 'Lead sin nombre');
  const sinLeer = Number(t.mensajes_sin_leer) || 0;
  const conDueno = Boolean(t.propietario_nombre);
  // Sin responsable el @usuario sube al primer renglón (nada de "Sin asignar" ocupando lugar).
  const extras = (sinLeer > 0 || Number(t.valor) > 0) ? (
    <span className="flex shrink-0 items-center gap-1.5">
      {sinLeer > 0 && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onChat(); }} aria-label={`${sinLeer} sin leer: abrir chat`}
          className="ui-foco inline-flex h-6 items-center gap-1 rounded-[7px] px-2 text-[11px] font-semibold text-white"
          style={{ background: 'var(--accion)' }}>
          <Icono nombre="bandeja" tam={12} />{sinLeer > 99 ? '99+' : sinLeer}
        </button>
      )}
      {Number(t.valor) > 0 && <span className="cifras text-[12px] font-semibold">{fmtDinero(t.valor)}</span>}
    </span>
  ) : null;
  const nombreAzul = <span className="min-w-0 truncate text-[14px] font-medium" style={{ color: 'var(--series-1)' }}>{quien}</span>;
  const tercera = Boolean(t.contenido_titulo || etiquetas.length || (!conDueno && extras));

  return (
    <article draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onArrastrar(true); }} onDragEnd={() => onArrastrar(false)}
      onClick={onAbrir} role="button" tabIndex={0} aria-label={`${quien}${t.propietario_nombre ? `, lo atiende ${t.propietario_nombre}` : ''}`}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAbrir(); } }}
      className="group ui-foco cursor-pointer rounded-lg border border-[var(--border-hairline)] px-3 py-2 transition-shadow hover:shadow-md"
      style={{ background: 'var(--surface-1)' }}>
      <div className="flex items-center justify-between gap-2 text-[12px]">
        {conDueno ? <span className="min-w-0 truncate text-[var(--text-primary)]">{t.propietario_nombre}</span> : nombreAzul}
        <span className="flex shrink-0 items-center gap-1">
          <span className="text-[11px] text-[var(--text-muted)]">{fechaCorta(t.ultima_actividad ?? t.abierta_en)}</span>
          <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <Menu alinear="derecha" ancho={280} titulo="Mover a"
              disparador={({ alternar, ref, abierto }) => (
                <button ref={ref} type="button" onClick={alternar} aria-label="Más acciones" aria-expanded={abierto}
                  className={`ui-foco -my-1 -mr-1.5 flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--page-plane)] ${abierto ? '' : 'md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100'}`}>
                  <Icono nombre="puntos" tam={16} />
                </button>
              )}>
              {etapas.map((e) => (
                <ItemMenu key={e.id} activo={e.id === t.etapa_id} onClick={() => onMover(e.id)}
                  descripcion={resumirAcciones(e) ? `⚡ ${resumirAcciones(e)}` : undefined}
                  icono={<span className="h-2 w-2 rounded-full" style={{ background: e.color }} />}>{e.nombre}</ItemMenu>
              ))}
              <SeparadorMenu />
              <ItemMenu icono={<Icono nombre="bandeja" tam={15} />} onClick={onChat}>Abrir chat</ItemMenu>
              <ItemMenu icono={<Icono nombre="leads" tam={15} />} onClick={onAbrir}>Ver ficha</ItemMenu>
              {usuarios.length > 0 && <SeparadorMenu />}
              {usuarios.length > 0 && <div className="px-2.5 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Lo atiende</div>}
              {usuarios.map((u) => (
                <ItemMenu key={u.id} activo={u.id === t.propietario_id} onClick={() => onAsignar(u.id)}>{u.nombre}</ItemMenu>
              ))}
              {usuarios.length > 0 && t.propietario_id && <ItemMenu onClick={() => onAsignar(null)}>Sin asignar</ItemMenu>}
            </Menu>
          </span>
        </span>
      </div>
      {conDueno && (
        <div className="mt-0.5 flex items-center justify-between gap-2">
          {nombreAzul}
          {extras}
        </div>
      )}
      {tercera && (
        <div className="mt-1 flex items-center gap-1 overflow-hidden">
          {t.contenido_titulo && <EtiquetaChica ancho="max-w-[60%]">▶ {t.contenido_titulo}</EtiquetaChica>}
          {etiquetas.slice(0, max).map((e) => <EtiquetaChica key={e}>{e}</EtiquetaChica>)}
          {resto > 0 && <EtiquetaChica>+{resto}</EtiquetaChica>}
          {!conDueno && extras && <span className="ml-auto">{extras}</span>}
        </div>
      )}
    </article>
  );
}
