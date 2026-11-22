// Piezas chicas que se repiten en toda la app: estados vacíos que dicen qué
// hacer, esqueletos de carga, insignias, chips de filtro y encabezados de
// sección con el "+" al lado de lo que se crea.

export function Vacio({ icono = '✨', titulo, texto, accion, compacto }: {
  icono?: React.ReactNode; titulo: React.ReactNode; texto?: React.ReactNode; accion?: React.ReactNode; compacto?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center text-center ${compacto ? 'gap-1.5 px-4 py-6' : 'gap-2 px-6 py-10'}`}>
      <div className={`flex items-center justify-center rounded-xl ${compacto ? 'h-10 w-10 text-[20px]' : 'h-14 w-14 text-[28px]'}`} style={{ background: 'var(--page-plane)' }} aria-hidden>{icono}</div>
      <div className={`font-semibold ${compacto ? 'text-[13px]' : 'text-[15px]'}`}>{titulo}</div>
      {texto && <p className="max-w-[420px] text-[12px] leading-relaxed text-[var(--text-muted)]">{texto}</p>}
      {accion && <div className="mt-1.5">{accion}</div>}
    </div>
  );
}

export function Esqueleto({ className = '', alto = 16, ancho = '100%' }: { className?: string; alto?: number | string; ancho?: number | string }) {
  return <div className={`ui-esqueleto ${className}`} style={{ height: alto, width: ancho }} aria-hidden />;
}

/** Pantalla cargando con la forma aproximada del contenido (no un spinner suelto). */
export function EsqueletoPantalla({ tarjetas = 4, filas = 6 }: { tarjetas?: number; filas?: number }) {
  return (
    <div className="px-4 py-5 lg:px-8" aria-busy="true" aria-label="Cargando">
      <Esqueleto alto={24} ancho={180} />
      <Esqueleto alto={14} ancho={320} className="mt-2" />
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: tarjetas }, (_, i) => <Esqueleto key={i} alto={84} className="rounded-xl" />)}
      </div>
      <div className="mt-5 space-y-2">
        {Array.from({ length: filas }, (_, i) => <Esqueleto key={i} alto={44} className="rounded-xl" />)}
      </div>
    </div>
  );
}

export type Tono = 'neutro' | 'azul' | 'verde' | 'amarillo' | 'rojo' | 'violeta';
const TONOS: Record<Tono, { fondo: string; texto: string }> = {
  neutro: { fondo: 'var(--gridline)', texto: 'var(--text-secondary)' },
  azul: { fondo: 'color-mix(in srgb, var(--series-1) 14%, transparent)', texto: 'var(--tint-texto)' },
  verde: { fondo: 'color-mix(in srgb, var(--status-good) 14%, transparent)', texto: 'var(--bien-texto)' },
  amarillo: { fondo: 'color-mix(in srgb, var(--status-warning) 22%, transparent)', texto: 'color-mix(in srgb, var(--status-warning) 60%, var(--text-primary))' },
  rojo: { fondo: 'color-mix(in srgb, var(--status-critical) 14%, transparent)', texto: 'var(--status-critical)' },
  // «violeta» quedó como nombre, pero es un gris pizarra: nada de morado.
  violeta: { fondo: 'color-mix(in srgb, #64748b 16%, transparent)', texto: 'color-mix(in srgb, #64748b 55%, var(--text-primary))' },
};

export function Insignia({ tono = 'neutro', children, punto, className = '' }: {
  tono?: Tono; children: React.ReactNode; punto?: boolean; className?: string;
}) {
  const t = TONOS[tono];
  return (
    <span className={`inline-flex h-fit items-center gap-1 self-center whitespace-nowrap rounded px-1.5 py-[2px] text-[11px] font-medium ${className}`}
      style={{ background: t.fondo, color: t.texto }}>
      {punto && <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.texto }} aria-hidden />}
      {children}
    </span>
  );
}

/** Chip de filtro: se toca para activar/desactivar. */
export function Chip({ activo, onClick, children, contador, icono }: {
  activo?: boolean; onClick?: () => void; children: React.ReactNode; contador?: number; icono?: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={activo}
      className={`ui-foco inline-flex h-10 shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-[12px] transition-colors md:h-8 ${activo ? 'border-[color-mix(in_srgb,var(--text-primary)_22%,transparent)] bg-[color-mix(in_srgb,var(--text-primary)_7%,var(--surface-1))] font-medium text-[var(--text-primary)]' : 'border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--surface-1)] hover:text-[var(--text-primary)]'}`}>
      {icono}
      {children}
      {contador !== undefined && (
        <span className="cifras rounded px-1 text-[10px]" style={{ background: 'var(--gridline)' }}>{contador}</span>
      )}
    </button>
  );
}

/** Fila de chips que se desliza con el dedo en el celular. */
export function FilaChips({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div data-no-deslizar className={`sin-barra -mx-4 flex snap-x gap-1.5 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0 ${className}`}>
      {children}
    </div>
  );
}

/**
 * Encabezado de sección con el "+" al lado de lo que se crea (el patrón
 * que pidió el dueño: crear justo donde está la lista).
 */
export function TituloSeccion({ titulo, subtitulo, onMas, textoMas = 'Agregar', derecha, className = '' }: {
  titulo: React.ReactNode; subtitulo?: React.ReactNode; onMas?: () => void; textoMas?: string;
  derecha?: React.ReactNode; className?: string;
}) {
  return (
    <div className={`mb-2.5 flex items-end justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold leading-tight">{titulo}</h2>
          {onMas && (
            <button type="button" onClick={onMas} aria-label={textoMas} title={textoMas}
              className="ui-foco flex h-7 w-7 items-center justify-center rounded-md text-[16px] font-medium text-white hover:brightness-110"
              style={{ background: 'var(--series-1)' }}>+</button>
          )}
        </div>
        {subtitulo && <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">{subtitulo}</p>}
      </div>
      {derecha && <div className="flex shrink-0 items-center gap-2">{derecha}</div>}
    </div>
  );
}

/** Botón flotante redondo (celular): la acción principal de la pantalla. */
export function BotonFlotante({ onClick, etiqueta, icono = '+' }: { onClick: () => void; etiqueta: string; icono?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={etiqueta}
      className="ui-foco ui-sobre-barra-fab fixed right-5 z-30 flex h-14 w-14 items-center justify-center rounded-md text-[26px] text-white shadow-lg md:hidden"
      style={{ background: 'var(--series-1)' }}>
      {icono}
    </button>
  );
}

/** Copiar al portapapeles con confirmación visual. */
export function Copiar({ texto, etiqueta = 'Copiar', className = '' }: { texto: string; etiqueta?: string; className?: string }) {
  return (
    <button type="button" className={`ui-foco inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-[var(--border-hairline)] px-2.5 text-[12px] font-medium hover:bg-[var(--page-plane)] ${className}`}
      onClick={(e) => {
        const b = e.currentTarget;
        navigator.clipboard?.writeText(texto).then(() => {
          const prev = b.textContent;
          b.textContent = '✓ Copiado';
          window.setTimeout(() => { b.textContent = prev; }, 1500);
        }).catch(() => {});
      }}>
      {etiqueta}
    </button>
  );
}
