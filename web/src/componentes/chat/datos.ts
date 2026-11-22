import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api, leerSesion } from '../../api';
import type { Pipeline, ProductoPago, Recurso, Usuario } from './tipos';

// Datos que el Chat usa en muchas partes y que cambian poco (atajos, cursos
// con link de pago, estado de Instagram, pipelines y equipo). Se piden UNA vez
// y quedan en memoria: volver al Chat o cambiar de conversación es instantáneo.

interface Almacen<T> {
  valor: T | null;
  error: Error | null;
  pidiendo: Promise<void> | null;
  pedidoEn: number;
  oyentes: Set<() => void>;
}

function crear<T>(cargar: () => Promise<T>, vigenciaMs = 5 * 60_000) {
  const a: Almacen<T> = { valor: null, error: null, pidiendo: null, pedidoEn: 0, oyentes: new Set() };
  const avisar = () => a.oyentes.forEach((f) => f());
  const pedir = (forzar = false) => {
    if (a.pidiendo) return a.pidiendo;
    if (!forzar && a.valor !== null && Date.now() - a.pedidoEn < vigenciaMs) return Promise.resolve();
    a.pidiendo = cargar()
      .then((v) => { a.valor = v; a.error = null; a.pedidoEn = Date.now(); })
      .catch((e) => { a.error = e instanceof Error ? e : new Error(String(e)); })
      .finally(() => { a.pidiendo = null; avisar(); });
    return a.pidiendo;
  };
  const fijar = (v: T) => { a.valor = v; a.pedidoEn = Date.now(); avisar(); };
  const suscribir = (f: () => void) => { a.oyentes.add(f); return () => { a.oyentes.delete(f); }; };
  function usar() {
    const valor = useSyncExternalStore(suscribir, () => a.valor);
    const error = useSyncExternalStore(suscribir, () => a.error);
    useEffect(() => { pedir(); }, []);
    const recargar = useCallback(() => pedir(true), []);
    return { valor, error, recargar };
  }
  return { usar, pedir, fijar, leer: () => a.valor };
}

// ---------------------------------------------------------------------

const recursos = crear<Recurso[]>(() => api<Recurso[]>('/recursos'));
const productos = crear<ProductoPago[]>(() => api<ProductoPago[]>('/productos').catch(() => []));

/** Atajos del founder (en su orden) y cursos con link de pago. */
export function useAtajosDatos() {
  const r = recursos.usar();
  const p = productos.usar();
  return {
    recursos: r.valor ?? [],
    cargados: r.valor !== null,
    error: r.error,
    productos: (p.valor ?? []).filter((x) => !!x.link_pago),
    recargar: r.recargar,
    fijarRecursos: recursos.fijar,
  };
}
export const leerRecursos = () => recursos.leer() ?? [];
export const fijarRecursos = recursos.fijar;
export const recargarRecursos = () => recursos.pedir(true);

// ---------------------------------------------------------------------

export type EstadoIG = 'conectado' | 'desconectado' | 'cortado';
const instagram = crear<EstadoIG>(async () => {
  const e = await api<any>('/instagram/estado');
  const vencido = e?.token_expira_en && new Date(e.token_expira_en).getTime() < Date.now();
  if (e?.conectado) return vencido ? 'cortado' : 'conectado';
  return e?.username || e?.ultimo_error ? 'cortado' : 'desconectado';
});

/** null mientras no se sabe (y si falla la consulta: no asustamos con un aviso falso). */
export function useEstadoInstagram(): EstadoIG | null {
  return instagram.usar().valor;
}

// ---------------------------------------------------------------------

const pipelines = crear<Pipeline[]>(() => api<Pipeline[]>('/pipelines'));
const usuarios = crear<Usuario[]>(() => api<Usuario[]>('/usuarios'));

export function usePipelines() { return pipelines.usar(); }
export function useUsuarios() { return usuarios.usar(); }

// ---------------------------------------------------------------------

/** Quién está usando el panel (id, nombre y rol). */
export function yo(): { id: string | null; nombre: string; rol: string } {
  const s = leerSesion();
  return { id: s?.usuario?.id ?? null, nombre: s?.usuario?.nombre ?? '', rol: s?.usuario?.rol ?? '' };
}

/** El dueño (o un administrador) puede probar automensajes y conectar Instagram. */
export const esDueno = () => ['owner', 'admin'].includes(yo().rol);
