// Forma de lo que devuelve GET /api/analitica/panel (y /api/ux/panel/*).

import type { Granularidad, PasoEmbudo } from '../Graficas';

export interface Kpis {
  leads: number;
  reuniones_agendadas: number;
  reuniones_realizadas: number;
  no_shows: number;
  reuniones_pendientes?: number;
  ventas: number;
  ingresos: number;
  reembolsos: number;
  reembolsado: number;
  leads_atribuidos: number;
  cobertura_atribucion: number;
  /** Leads que entraron en el período y ya agendaron (base de tasa_lead_reunion). */
  leads_con_reunion?: number;
  tasa_lead_reunion: number;
  tasa_asistencia: number;
  /** Reuniones hechas en el período que terminaron en venta (base de tasa_reunion_venta). */
  reuniones_con_venta?: number;
  tasa_reunion_venta: number;
  tasa_lead_venta: number;
  ticket_medio: number;
  ingresos_cohorte?: number;
  valor_por_lead: number;
  dias_medios_cierre: number;
}

export interface FilaContenido {
  id: string | null;
  titulo: string;
  tipo: string;
  permalink: string | null;
  thumbnail_url: string | null;
  publicado_en: string | null;
  ig_reproducciones?: number | null;
  ig_alcance?: number | null;
  leads: number;
  reuniones_agendadas: number;
  reuniones_realizadas: number;
  ventas: number;
  ingresos: number;
  tasa_lead_venta: number;
  tasa_lead_reunion: number;
  tasa_asistencia: number;
  valor_por_lead: number;
  rol?: string;
  rol_90d?: string;
  leads_90d?: number;
  angulo?: string | null;
  etapa_embudo?: string | null;
}

export interface PipelineResumen { id: string; nombre: string; es_predeterminado: boolean; abiertos: number }

export interface LeadQuieto {
  oportunidad_id: string;
  lead_id: string;
  nombre: string | null;
  ig_username: string | null;
  avatar_url: string | null;
  etapa_id: string;
  etapa: string;
  etapa_orden: number;
  pipeline_id: string;
  pipeline: string;
  responsable: string | null;
  responsable_id: string | null;
  ultimo_movimiento: string;
  dias_quieto: number;
}

export interface ConteoEtapa {
  etapa_id: string; etapa: string; orden: number; pipeline_id: string; pipeline: string;
  pipeline_predeterminado: boolean; n: number;
}

export interface Quietos {
  total: number;
  dias: number;
  leads: LeadQuieto[];
  por_etapa?: ConteoEtapa[];
  etapas_por_pipeline?: Record<string, Array<{ id: string; nombre: string; tipo: string; orden: number }>>;
}

export interface Calidad {
  total: number; alta: number; media: number; baja: number; ninguna: number; porcentaje_fiable: number;
  leads?: { total: number; seguros: number; dudosos: number; sin_origen: number; porcentaje_seguros: number };
  palabras_ambiguas: Array<{ palabra_clave: string; contenidos: number }>;
  automatizaciones_sin_contenido: Array<{ id: string; nombre: string; palabra_clave: string | null; toques: number }>;
}

export interface Angulo {
  angulo: string; etiqueta: string; etapa_embudo: string | null;
  leads: number; reuniones: number; ventas: number; ingresos: number; tasa_lead_venta: number; valor_por_lead: number;
}

export interface Persona {
  id: string; nombre: string; email: string; rol: string;
  oportunidades: number; reuniones_agendadas?: number; reuniones: number; ventas: number; ingresos: number;
  /** De sus reuniones hechas en el período, cuántas terminaron en venta (y el %: nunca más de 100). */
  reuniones_con_venta?: number; tasa_cierre?: number;
  /** De sus leads que entraron en el período, cuántos agendaron (y el %). */
  oportunidades_con_reunion?: number; tasa_agenda?: number;
}

export interface Metas {
  tiene_meta: boolean;
  objetivo: { leads: number; calificados: number; ventas: number; ingresos: number } | null;
  real: { leads: number; calificados: number; ventas: number; ingresos: number };
  progreso: Record<string, number> | null;
}

export interface Mudo {
  id: string; titulo: string; tipo: string; publicado_en: string; permalink: string | null;
  alcance: number | null; reproducciones: number | null;
}

export interface DatosPanel {
  kpis: Kpis;
  anterior: Kpis | null;
  anterior_rango?: { desde: string; hasta: string } | null;
  contenidos: FilaContenido[];
  embudo: PasoEmbudo[];
  embudo_pipeline_id?: string | null;
  pipelines?: PipelineResumen[];
  serie: Array<{ periodo: string; leads: number | string; reuniones: number | string; ventas: number | string; ingresos: number | string }>;
  serie_granularidad?: Granularidad;
  /** La misma serie del período con el que se compara (para la barra de fondo). */
  serie_anterior?: DatosPanel['serie'] | null;
  closers: Persona[];
  calidad: Calidad;
  angulos: Angulo[];
  mezcla?: { clasificados: number; total: number; dias_muestra: number; muestra_suficiente: boolean; aviso?: string | null };
  metas?: Metas;
  mudos?: Mudo[];
  publicados?: number;
  estancados?: Quietos;
}

/** GET /api/ux/panel/estado */
export interface EstadoCuenta {
  leads_total: number;
  instagram_conectado: boolean;
  automensajes: number;
  cursos: number;
  cursos_con_link: number;
  objetivo_mes: boolean;
  mes_pasado: { leads: number; calificados: number; ventas: number; ingresos: number };
  sugerido: { leads: number; calificados: number; ventas: number; ingresos: number };
}
