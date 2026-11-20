import { api } from '../../api';

// Lo que la ficha y la lista necesitan para las acciones (etapas de cada
// pipeline, el equipo y las etiquetas que ya usás). Se guarda un minuto en
// memoria: pasar de un lead al siguiente no vuelve a pedirlo.

export interface Etapa { id: string; nombre: string; color: string; tipo: 'abierta' | 'ganada' | 'perdida'; orden: number; pipeline_id: string; acciones?: unknown }
export interface Pipeline { id: string; nombre: string; es_predeterminado: boolean; etapas: Etapa[] }
export interface Persona { id: string; nombre: string; rol?: string }
export interface Contexto { pipelines: Pipeline[]; usuarios: Persona[]; etiquetas: Array<{ etiqueta: string; n: number }> }

let cache: { t: number; p: Promise<Contexto> } | null = null;

export function cargarContexto(forzar = false): Promise<Contexto> {
  if (!forzar && cache && Date.now() - cache.t < 60_000) return cache.p;
  const p = Promise.all([
    api<Pipeline[]>('/pipelines'),
    api<any[]>('/usuarios').catch(() => []),
    api<Array<{ etiqueta: string; n: number }>>('/etiquetas').catch(() => []),
  ]).then(([pipelines, usuarios, etiquetas]) => ({
    pipelines: pipelines.map((x) => ({ ...x, etapas: [...(x.etapas ?? [])].sort((a, b) => a.orden - b.orden) })),
    usuarios: usuarios.filter((u) => u.activo !== false).map((u) => ({ id: u.id, nombre: u.nombre, rol: u.rol })),
    etiquetas,
  }));
  cache = { t: Date.now(), p };
  p.catch(() => { cache = null; });
  return p;
}

/** Después de crear etiquetas o etapas, para que la próxima lectura las traiga. */
export function olvidarContexto() { cache = null; }
