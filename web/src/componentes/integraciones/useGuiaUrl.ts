import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useParamUrl } from '../../ui';

// La guía abierta vive en la URL: /conexiones?abrir=manychat&app=…&paso=2.
//  · Abrir una guía SUMA una entrada al historial → Atrás cierra la hoja
//    (no te saca de Configuración), como pasa con ?ficha=.
//  · Recargar (o que iOS recargue la pestaña al volver de Instagram) mantiene
//    la guía, la app elegida y el paso.
//  · Cualquier pantalla puede llevar a una guía con /conexiones?abrir=pagos.

const PROPIOS = ['abrir', 'app', 'paso'];
const apilada = () => Boolean((window.history.state as any)?.usr?.guiaApilada);
/**
 * Estado de la entrada actual del historial. Al REEMPLAZAR la URL dentro de
 * una guía (cambiar de paso o de app) hay que conservarlo: si no, se pierde
 * la marca "la abrimos nosotros" y Cerrar dejaría de ser como Atrás.
 */
export const estadoActual = () => (window.history.state as any)?.usr ?? undefined;

export function useGuiaUrl<T extends string>(claves: readonly T[]) {
  const [valor] = useParamUrl('abrir', '', { apilar: true });
  const [, setParams] = useSearchParams();
  const abierta = (claves as readonly string[]).includes(valor) ? (valor as T) : null;

  const abrir = useCallback((clave: T) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      PROPIOS.forEach((k) => p.delete(k));
      p.set('abrir', clave);
      return p;
    }, { state: { guiaApilada: true } });
  }, [setParams]);

  /** Cerrar: si la abrimos nosotros, es lo mismo que Atrás; si vino por enlace, se limpia la URL. */
  const cerrar = useCallback(() => {
    if (apilada()) { window.history.back(); return; }
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      PROPIOS.forEach((k) => p.delete(k));
      return p;
    }, { replace: true });
  }, [setParams]);

  /** Cerrar la guía y abrir la ficha del lead en el mismo lugar del historial (Atrás vuelve a Configuración). */
  const verLead = useCallback((leadId: string) => {
    const eraApilada = apilada();
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      PROPIOS.forEach((k) => p.delete(k));
      p.set('ficha', leadId);
      return p;
    }, { replace: true, state: eraApilada ? { fichaApilada: true } : undefined });
  }, [setParams]);

  return { abierta, abrir, cerrar, verLead };
}

/** Parámetro de la guía que se reemplaza (no llena el historial): la app elegida. */
export function useAppElegida<T extends string>(opciones: readonly T[], porDefecto: T) {
  const [params, setParams] = useSearchParams();
  const valor = params.get('app') ?? '';
  const elegida = (opciones as readonly string[]).includes(valor) ? (valor as T) : porDefecto;
  const elegir = useCallback((v: T) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set('app', v);
      p.delete('paso');
      return p;
    }, { replace: true, state: estadoActual() });
  }, [setParams]);
  return [elegida, elegir] as const;
}
