import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Un valor guardado en la URL (?tab=cobros): sobrevive a recargar, se puede
 * compartir y el botón Atrás del celular hace lo esperado.
 * Por defecto REEMPLAZA la entrada del historial (cambiar de pestaña no llena
 * el "Atrás"); con { apilar: true } suma una entrada (para subpantallas).
 */
export function useParamUrl<T extends string = string>(clave: string, porDefecto: T, opciones: { apilar?: boolean } = {}) {
  const [params, setParams] = useSearchParams();
  const valor = (params.get(clave) ?? porDefecto) as T;
  const fijar = useCallback((nuevo: T | null) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (nuevo === null || nuevo === porDefecto) p.delete(clave); else p.set(clave, nuevo);
      return p;
    }, { replace: !opciones.apilar });
  }, [clave, porDefecto, opciones.apilar, setParams]);
  return [valor, fijar] as const;
}
