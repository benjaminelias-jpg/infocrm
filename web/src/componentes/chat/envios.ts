import { useMemo, useSyncExternalStore } from 'react';
import { api } from '../../api';
import { invalidarHilo } from './useHilo';
import type { MensajeLocal } from './tipos';

// Lo que el setter manda, antes de que el servidor lo confirme:
//  - texto escrito: sale enseguida y la burbuja aparece al instante ("Enviando…");
//  - audio, enlace o link de pago (salen con un toque): esperan unos segundos
//    con "Deshacer" (en Instagram no se pueden borrar).
// El destinatario queda fijo en el momento del toque, aunque se cambie de chat.
// Vive fuera de React: si el setter se va de la pantalla, lo pendiente sale igual.

export const ESPERA_ATAJO_MS = 4000;

export interface ResultadoEnvio {
  local: MensajeLocal;
  /** Lo que devolvió el servidor (incluye `aviso` si no salió a Instagram). */
  respuesta?: { id: string; estado: string; aviso: string | null };
  error?: Error;
}

let lista: MensajeLocal[] = [];
let n = 0;
const oyentes = new Set<() => void>();
const alTerminar = new Set<(r: ResultadoEnvio) => void>();
const relojes = new Map<string, number>();

function emitir() { oyentes.forEach((f) => f()); }
function cambiar(idLocal: string, cambio: Partial<MensajeLocal>) {
  lista = lista.map((m) => (m.idLocal === idLocal ? { ...m, ...cambio } : m));
  emitir();
}
function quitar(idLocal: string) {
  lista = lista.filter((m) => m.idLocal !== idLocal);
  emitir();
}

async function despachar(idLocal: string) {
  relojes.delete(idLocal);
  const m = lista.find((x) => x.idLocal === idLocal);
  if (!m) return;
  cambiar(idLocal, { estado: 'enviando', venceEn: undefined, error: undefined });
  try {
    const r = await api<{ id: string; estado: string; aviso: string | null }>(`/chat/${m.leadId}/enviar`, { method: 'POST', json: m.payload });
    cambiar(idLocal, { estado: 'enviado', idServidor: r?.id });
    invalidarHilo(m.leadId);
    const local = lista.find((x) => x.idLocal === idLocal) ?? m;
    alTerminar.forEach((f) => f({ local, respuesta: r }));
    // Si nadie lo limpia (el chat no está abierto), se va solo.
    window.setTimeout(() => quitar(idLocal), 30_000);
  } catch (e: any) {
    const error = e instanceof Error ? e : new Error(String(e));
    cambiar(idLocal, { estado: 'fallo', error: error.message });
    const local = lista.find((x) => x.idLocal === idLocal) ?? m;
    alTerminar.forEach((f) => f({ local, error }));
  }
}

/** Manda (o programa) un mensaje. Devuelve su id local. */
export function encolar(d: { leadId: string; payload: MensajeLocal['payload']; vista: MensajeLocal['vista']; demoraMs?: number }) {
  const idLocal = `local-${Date.now()}-${++n}`;
  const demora = d.demoraMs ?? 0;
  lista = [...lista, {
    idLocal, leadId: d.leadId, payload: d.payload, vista: d.vista, creado: Date.now(),
    estado: demora ? 'esperando' : 'enviando',
    venceEn: demora ? Date.now() + demora : undefined, plazoMs: demora || undefined,
  }];
  emitir();
  if (demora) relojes.set(idLocal, window.setTimeout(() => despachar(idLocal), demora));
  else despachar(idLocal);
  return idLocal;
}

/** Frena un envío que todavía espera. true si llegó a tiempo. */
export function deshacer(idLocal: string) {
  const t = relojes.get(idLocal);
  const m = lista.find((x) => x.idLocal === idLocal);
  if (!m || m.estado !== 'esperando') return false;
  if (t) window.clearTimeout(t);
  relojes.delete(idLocal);
  quitar(idLocal);
  return true;
}

export function reintentar(idLocal: string) {
  const m = lista.find((x) => x.idLocal === idLocal);
  if (m && m.estado === 'fallo') despachar(idLocal);
}

export function descartar(idLocal: string) {
  const t = relojes.get(idLocal);
  if (t) window.clearTimeout(t);
  relojes.delete(idLocal);
  quitar(idLocal);
}

/** Saca los que el hilo ya trae del servidor (para no dibujarlos dos veces). */
export function limpiarConfirmados(leadId: string, idsServidor: Set<string>) {
  const antes = lista.length;
  lista = lista.filter((m) => !(m.leadId === leadId && m.idServidor && idsServidor.has(m.idServidor)));
  if (lista.length !== antes) emitir();
}

export function alTerminarEnvio(f: (r: ResultadoEnvio) => void) {
  alTerminar.add(f);
  return () => { alTerminar.delete(f); };
}

function suscribir(f: () => void) { oyentes.add(f); return () => { oyentes.delete(f); }; }
const leer = () => lista;

/** Mensajes locales (de un lead, o todos). */
export function useLocales(leadId?: string | null) {
  const todos = useSyncExternalStore(suscribir, leer);
  return useMemo(() => (leadId === undefined ? todos : todos.filter((m) => m.leadId === leadId)), [todos, leadId]);
}
