import { useCallback, useEffect, useRef, useState } from 'react';
import { Boton } from './Boton';

// Carga de datos con sus tres estados (cargando / error / datos) y la pieza
// que se muestra cuando algo falla. Ninguna pantalla debería quedar en
// blanco ni en "Cargando…" para siempre.

export function useCarga<T>(fn: () => Promise<T>, deps: React.DependencyList = []) {
  const [datos, setDatos] = useState<T | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const turno = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const recargar = useCallback(async (silencioso = false) => {
    const yo = ++turno.current;
    if (!silencioso) setCargando(true);
    setError(null);
    try {
      const d = await fnRef.current();
      if (yo === turno.current) setDatos(d);
    } catch (e: any) {
      if (yo === turno.current) setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (yo === turno.current) setCargando(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { recargar(); }, deps);

  return { datos, setDatos, cargando, error, recargar };
}

/** Bloque de error con reintento. `compacto` para dentro de tarjetas. */
export function ErrorCarga({ error, onReintentar, titulo = 'No pudimos cargar esto', compacto }: {
  error?: Error | { message?: string } | null; onReintentar?: () => void; titulo?: string; compacto?: boolean;
}) {
  return (
    <div role="alert" className={`flex flex-col items-center text-center ${compacto ? 'gap-1.5 px-4 py-6' : 'gap-2 px-6 py-12'}`}>
      <span className="flex h-10 w-10 items-center justify-center rounded-full text-[18px]"
        style={{ background: 'color-mix(in srgb, var(--status-critical) 12%, transparent)', color: 'var(--status-critical)' }} aria-hidden>!</span>
      <div className="text-[14px] font-semibold">{titulo}</div>
      {error?.message && <p className="max-w-sm text-[12px] text-[var(--text-muted)]">{error.message}</p>}
      {onReintentar && <Boton tamano="sm" onClick={onReintentar} className="mt-1">Reintentar</Boton>}
    </div>
  );
}
