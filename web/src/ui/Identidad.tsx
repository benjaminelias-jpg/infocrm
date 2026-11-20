// Cómo se ve un lead en TODA la app: avatar (foto de Instagram o iniciales
// con un color fijo por persona), nombre y @usuario. Regla de respaldo:
// nombre → @usuario → "Lead sin nombre".

const COLORES = ['#2f6fdf', '#7a5af8', '#d6457a', '#e07b1f', '#1f9d6a', '#0f8fb3', '#b5468f', '#6a7a1f'];

function colorDe(clave: string) {
  let h = 0;
  for (let i = 0; i < clave.length; i++) h = (h * 31 + clave.charCodeAt(i)) >>> 0;
  return COLORES[h % COLORES.length];
}

export function inicialesDe(nombre?: string | null, usuario?: string | null) {
  const base = (nombre ?? '').trim() || (usuario ?? '').replace(/^@/, '').trim();
  if (!base) return '·';
  const p = base.split(/[\s._-]+/).filter(Boolean);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[1][0] : '')).toUpperCase();
}

export function Avatar({ id, nombre, usuario, foto, tam = 32, punto }: {
  id?: string | null; nombre?: string | null; usuario?: string | null; foto?: string | null;
  tam?: number; /** Puntito (ej. no leídos) en la esquina. */ punto?: string;
}) {
  const clave = id || usuario || nombre || '?';
  return (
    <span className="relative inline-flex shrink-0" style={{ width: tam, height: tam }} aria-hidden>
      {foto
        ? <img src={foto} alt="" className="h-full w-full rounded-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
        : (
          <span className="flex h-full w-full items-center justify-center rounded-full font-semibold text-white"
            style={{ background: colorDe(clave), fontSize: Math.max(10, Math.round(tam * 0.38)) }}>
            {inicialesDe(nombre, usuario)}
          </span>
        )}
      {punto && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--surface-1)]" style={{ background: punto }} />}
    </span>
  );
}

export function nombreVisible(nombre?: string | null, usuario?: string | null) {
  return (nombre ?? '').trim() || (usuario ? `@${usuario.replace(/^@/, '')}` : 'Lead sin nombre');
}

/**
 * Avatar + nombre + @usuario (y país opcional). `tam` sm para listas, md para
 * cabeceras. Si recibe onClick se vuelve botón (p. ej. abrir la ficha).
 */
export function IdentidadLead({ id, nombre, usuario, foto, pais, tam = 'sm', onClick, derecha, className = '' }: {
  id?: string | null; nombre?: string | null; usuario?: string | null; foto?: string | null; pais?: string | null;
  tam?: 'sm' | 'md'; onClick?: () => void; derecha?: React.ReactNode; className?: string;
}) {
  const u = usuario ? usuario.replace(/^@/, '') : null;
  const titulo = nombreVisible(nombre, u);
  const sub = (nombre ?? '').trim() && u ? `@${u}` : null;
  const cuerpo = (
    <>
      <Avatar id={id} nombre={nombre} usuario={u} foto={foto} tam={tam === 'md' ? 40 : 30} />
      <span className="min-w-0 flex-1 text-left">
        <span className={`block truncate font-medium ${tam === 'md' ? 'text-[15px]' : 'text-[13px]'}`}>{titulo}</span>
        {(sub || pais) && (
          <span className="block truncate text-[12px] text-[var(--text-muted)]">
            {sub}{sub && pais ? ' · ' : ''}{pais}
          </span>
        )}
      </span>
      {derecha}
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} className={`ui-foco flex min-w-0 items-center gap-2.5 rounded-lg text-left ${className}`}>{cuerpo}</button>
    : <span className={`flex min-w-0 items-center gap-2.5 ${className}`}>{cuerpo}</span>;
}
