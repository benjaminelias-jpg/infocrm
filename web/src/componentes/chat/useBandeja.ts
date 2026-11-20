import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import type { Conteos, Conversacion, FiltroChat } from './tipos';

// La bandeja del setter: pide al servidor de a 40 conversaciones (con el
// filtro y la búsqueda), suma más al llegar al final y se refresca sola sin
// perder lo que ya se cargó. Lo último visto queda en memoria para que volver
// a la lista (o al Chat) sea instantáneo.

interface Pagina { items: Conversacion[]; siguiente: string | null; conteos?: Conteos }
interface Estado { items: Conversacion[]; siguiente: string | null }

const cache = new Map<string, Estado>();
let ultimosConteos: Conteos | null = null;
const POR_PAGINA = 40;

const claveDe = (filtro: FiltroChat, q: string) => `${filtro}|${q}`;
function partes(k: string): [FiltroChat, string] {
  const i = k.indexOf('|');
  return [k.slice(0, i) as FiltroChat, k.slice(i + 1)];
}
function url(filtro: FiltroChat, q: string, cursor?: string | null) {
  const p = new URLSearchParams({ filtro, limite: String(POR_PAGINA) });
  if (q) p.set('q', q);
  if (cursor) p.set('cursor', cursor);
  return `/ux/chat/conversaciones?${p}`;
}

/** Una conversación que ya está en alguna lista en memoria (para pintar la cabecera al instante). */
export function conversacionEnMemoria(id: string): Conversacion | null {
  for (const e of cache.values()) {
    const c = e.items.find((i) => i.id === id);
    if (c) return c;
  }
  return null;
}

export function useBandeja(filtro: FiltroChat, q: string) {
  const clave = claveDe(filtro, q);
  const [estado, setEstado] = useState<Estado>(() => cache.get(clave) ?? { items: [], siguiente: null });
  const [conteos, setConteos] = useState<Conteos | null>(ultimosConteos);
  const [cargando, setCargando] = useState(!cache.has(clave));
  const [cargandoMas, setCargandoMas] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const turno = useRef(0);
  const claveRef = useRef(clave);
  claveRef.current = clave;
  const pidiendoMas = useRef(false);

  const fijar = useCallback((k: string, e: Estado) => {
    cache.set(k, e);
    if (k === claveRef.current) setEstado(e);
  }, []);

  /** Primera página. Silencioso = refresco de fondo: conserva lo que ya se había cargado más abajo. */
  const cargar = useCallback(async (silencioso: boolean) => {
    const k = claveRef.current;
    const [f, texto] = partes(k);
    const yo = ++turno.current;
    if (!silencioso) { setError(null); if (!cache.has(k)) setCargando(true); }
    try {
      const p = await api<Pagina>(url(f, texto));
      if (yo !== turno.current) return;
      if (p.conteos) { ultimosConteos = p.conteos; setConteos(p.conteos); }
      const previo = cache.get(k);
      let nuevo: Estado = { items: p.items, siguiente: p.siguiente };
      if (previo && p.siguiente && previo.items.length > p.items.length) {
        // Lo que ya estaba cargado más abajo se mantiene (sin repetir).
        const ids = new Set(p.items.map((i) => i.id));
        const ultimo = p.items[p.items.length - 1];
        const corte = ultimo ? new Date(ultimo.actividad).getTime() : Infinity;
        const resto = previo.items.filter((i) => !ids.has(i.id) && new Date(i.actividad).getTime() <= corte);
        nuevo = { items: [...p.items, ...resto], siguiente: previo.siguiente };
      }
      fijar(k, nuevo);
      setError(null);
    } catch (e: any) {
      if (yo !== turno.current) return;
      if (!silencioso || !cache.has(k)) setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (yo === turno.current) setCargando(false);
    }
  }, [fijar]);

  useEffect(() => {
    const previo = cache.get(clave);
    setEstado(previo ?? { items: [], siguiente: null });
    setCargando(!previo);
    setError(null);
    cargar(!!previo);
  }, [clave, cargar]);

  const cargarMas = useCallback(async () => {
    const k = claveRef.current;
    const actual = cache.get(k);
    if (!actual?.siguiente || pidiendoMas.current) return;
    pidiendoMas.current = true;
    setCargandoMas(true);
    try {
      const [f, texto] = partes(k);
      const p = await api<Pagina>(url(f, texto, actual.siguiente));
      const ahora = cache.get(k) ?? actual;
      const ids = new Set(ahora.items.map((i) => i.id));
      fijar(k, { items: [...ahora.items, ...p.items.filter((i) => !ids.has(i.id))], siguiente: p.siguiente });
    } catch (e: any) {
      if (k === claveRef.current) setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      pidiendoMas.current = false;
      setCargandoMas(false);
    }
  }, [fijar]);

  /** Cambio local inmediato (leído, etapa, responsable…) en todas las listas en memoria. */
  const parchear = useCallback((id: string, cambio: Partial<Conversacion>) => {
    for (const [k, e] of cache) {
      if (e.items.some((i) => i.id === id)) fijar(k, { ...e, items: e.items.map((i) => (i.id === id ? { ...i, ...cambio } : i)) });
    }
  }, [fijar]);

  /** Sacar una fila de la lista que se está viendo (archivar, por ejemplo). */
  const quitar = useCallback((id: string) => {
    const k = claveRef.current;
    const e = cache.get(k);
    if (e) fijar(k, { ...e, items: e.items.filter((i) => i.id !== id) });
  }, [fijar]);

  const ajustarConteos = useCallback((cambio: Partial<Record<keyof Conteos, number>>) => {
    setConteos((c) => {
      if (!c) return c;
      const n = { ...c };
      for (const [k, v] of Object.entries(cambio)) n[k as keyof Conteos] = Math.max(0, (n[k as keyof Conteos] ?? 0) + (v ?? 0));
      ultimosConteos = n;
      return n;
    });
  }, []);

  const refrescar = useCallback(() => cargar(true), [cargar]);
  const recargar = useCallback(() => cargar(false), [cargar]);

  return useMemo(() => ({
    items: estado.items, hayMas: !!estado.siguiente, conteos, cargando, cargandoMas, error,
    refrescar, recargar, cargarMas, parchear, quitar, ajustarConteos,
  }), [estado, conteos, cargando, cargandoMas, error, refrescar, recargar, cargarMas, parchear, quitar, ajustarConteos]);
}

export type Bandeja = ReturnType<typeof useBandeja>;
