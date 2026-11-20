// Tabla que en escritorio es tabla y en el celular se vuelve una lista de
// tarjetas (nada de desplazarse de costado para leer una fila).

export interface Columna<T> {
  clave: string;
  titulo: React.ReactNode;
  render: (fila: T) => React.ReactNode;
  alinear?: 'izq' | 'der';
  /** En el celular: título de la tarjeta, subtítulo, dato (etiqueta: valor), esquina (arriba a la derecha) u ocultar. */
  enMovil?: 'titulo' | 'subtitulo' | 'dato' | 'esquina' | 'ocultar';
  ancho?: string;
}

export function TablaResponsiva<T>({
  columnas, filas, clave, onFila, vacio, filaActiva, ocultarCabecera,
}: {
  columnas: Array<Columna<T>>; filas: T[]; clave: (f: T) => string; onFila?: (f: T) => void;
  vacio?: React.ReactNode; filaActiva?: (f: T) => boolean; ocultarCabecera?: boolean;
}) {
  if (!filas.length) return <>{vacio ?? null}</>;
  const titulo = columnas.find((c) => c.enMovil === 'titulo') ?? columnas[0];
  const subtitulo = columnas.find((c) => c.enMovil === 'subtitulo');
  const esquina = columnas.find((c) => c.enMovil === 'esquina');
  const datos = columnas.filter((c) => (c.enMovil ?? 'dato') === 'dato' && c !== titulo);
  return (
    <>
      {/* Escritorio */}
      <div className="tarjeta hidden overflow-x-auto md:block">
        <table className="w-full text-[13px]">
          {!ocultarCabecera && (
            <thead>
              <tr className="border-b border-[var(--border-hairline)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                {columnas.map((c) => (
                  <th key={c.clave} className={`px-3 py-2.5 font-medium first:pl-4 last:pr-4 ${c.alinear === 'der' ? 'text-right' : ''}`} style={c.ancho ? { width: c.ancho } : undefined}>{c.titulo}</th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {filas.map((f) => (
              <tr key={clave(f)} onClick={onFila ? () => onFila(f) : undefined}
                className={`border-b border-[var(--border-hairline)] last:border-0 ${onFila ? 'cursor-pointer hover:bg-[var(--page-plane)]' : ''} ${filaActiva?.(f) ? 'bg-[var(--page-plane)]' : ''}`}>
                {columnas.map((c) => (
                  <td key={c.clave} className={`px-3 py-2.5 align-middle first:pl-4 last:pr-4 ${c.alinear === 'der' ? 'cifras text-right' : ''}`}>{c.render(f)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Celular */}
      <ul className="flex flex-col gap-2 md:hidden">
        {filas.map((f) => (
          <li key={clave(f)}>
            <div role={onFila ? 'button' : undefined} tabIndex={onFila ? 0 : undefined}
              onClick={onFila ? () => onFila(f) : undefined}
              onKeyDown={onFila ? (e) => { if (e.key === 'Enter') onFila(f); } : undefined}
              className={`tarjeta ui-foco block w-full px-3.5 py-3 text-left ${onFila ? 'active:bg-[var(--page-plane)]' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">{titulo.render(f)}</div>
                  {subtitulo && <div className="mt-0.5 truncate text-[12px] text-[var(--text-muted)]">{subtitulo.render(f)}</div>}
                </div>
                {esquina && <div className="shrink-0 text-right text-[13px] font-semibold">{esquina.render(f)}</div>}
              </div>
              {datos.length > 0 && (
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {datos.map((c) => (
                    <div key={c.clave} className="min-w-0">
                      <dt className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{c.titulo}</dt>
                      <dd className="truncate text-[12px]">{c.render(f)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
