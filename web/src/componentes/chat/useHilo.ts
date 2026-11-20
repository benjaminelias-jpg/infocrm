import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import type { Hilo } from './tipos';

// El hilo de una conversación. Lo ya abierto queda en memoria: volver a un
// chat lo muestra al instante y se actualiza por detrás. El siguiente de la
// lista se precarga sin darlo por leído (?sin_marcar=1).

const cache = new Map<string, { hilo: Hilo; en: number }>();
const precargando = new Set<string>();
const MAX_CACHE = 40;

function guardar(id: string, hilo: Hilo) {
  cache.delete(id);
  cache.set(id, { hilo, en: Date.now() });
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
}

export function hiloEnMemoria(id: string): Hilo | null {
  return cache.get(id)?.hilo ?? null;
}

/** La próxima vez que se abra, se pide de nuevo (pero se muestra lo que había mientras). */
export function invalidarHilo(id: string) {
  const c = cache.get(id);
  if (c) c.en = 0;
}

export function precargarHilo(id: string | null | undefined) {
  if (!id || cache.has(id) || precargando.has(id)) return;
  precargando.add(id);
  api<Hilo>(`/chat/${id}?sin_marcar=1`)
    .then((h) => { if (!cache.has(id)) guardar(id, h); })
    .catch(() => {})
    .finally(() => precargando.delete(id));
}

export function useHilo(leadId: string | null) {
  const [estado, setEstado] = useState<{ id: string | null; hilo: Hilo | null }>(
    () => ({ id: leadId, hilo: leadId ? hiloEnMemoria(leadId) : null }));
  const [error, setError] = useState<{ id: string; error: Error } | null>(null);
  const turno = useRef(0);
  const actual = useRef(leadId);
  actual.current = leadId;

  const cargar = useCallback(async (id: string, silencioso: boolean) => {
    const yo = ++turno.current;
    if (!silencioso) setError(null);
    try {
      const h = await api<Hilo>(`/chat/${id}`);
      guardar(id, h);
      if (yo !== turno.current || actual.current !== id) return;
      setEstado({ id, hilo: h });
      setError(null);
    } catch (e: any) {
      if (yo !== turno.current || actual.current !== id) return;
      // Si ya se veía algo, un refresco que falla no tapa la conversación.
      if (!silencioso || !cache.has(id)) setError({ id, error: e instanceof Error ? e : new Error(String(e)) });
    }
  }, []);

  useEffect(() => {
    if (!leadId) { setEstado({ id: null, hilo: null }); setError(null); return; }
    const c = cache.get(leadId);
    setEstado({ id: leadId, hilo: c?.hilo ?? null });
    setError(null);
    cargar(leadId, !!c);
  }, [leadId, cargar]);

  const recargar = useCallback((silencioso = true) => {
    if (actual.current) return cargar(actual.current, silencioso);
    return Promise.resolve();
  }, [cargar]);

  /** Cambio local inmediato (etapa, responsable…) mientras el servidor confirma. */
  const parchear = useCallback((f: (h: Hilo) => Hilo) => {
    setEstado((e) => {
      if (!e.hilo || !e.id) return e;
      const h = f(e.hilo);
      guardar(e.id, h);
      return { ...e, hilo: h };
    });
  }, []);

  const hilo = estado.id === leadId ? estado.hilo : null;
  const err = error && error.id === leadId ? error.error : null;
  return { hilo, error: err, cargando: !!leadId && !hilo && !err, recargar, parchear };
}
