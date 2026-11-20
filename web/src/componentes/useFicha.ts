import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * La ficha del lead se abre desde cualquier pantalla con ?ficha=<id>. La
 * dibuja el marco de la app (App.tsx), así que:
 *  - el botón/gesto Atrás del celular la cierra (no te saca de la pantalla),
 *  - se puede recargar o compartir el link con la ficha abierta.
 * Uso: const ficha = useFicha(); ficha.abrir(lead.id);
 * Para refrescar datos al cerrarla: useEffect(() => { if (!ficha.abierta) recargar(); }, [ficha.abierta]).
 */
export function useFicha() {
  const [params, setParams] = useSearchParams();
  const abierta = params.get('ficha');

  const abrir = useCallback((id: string) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set('ficha', id);
      return p;
    }, { replace: Boolean(new URLSearchParams(window.location.search).get('ficha')), state: { fichaApilada: true } });
  }, [setParams]);

  const cerrar = useCallback(() => {
    // Si la abrimos nosotros (sumó una entrada al historial), cerrar = Atrás.
    if ((window.history.state as any)?.usr?.fichaApilada) { window.history.back(); return; }
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.delete('ficha');
      return p;
    }, { replace: true });
  }, [setParams]);

  return { abierta, abrir, cerrar };
}
