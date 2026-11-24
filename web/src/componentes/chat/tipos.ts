// Tipos del Chat del setter (lo que devuelven /api/ux/chat/* y /api/chat/*).

export type FiltroChat =
  | 'por_responder' | 'sin_leer' | 'mios' | 'se_cierra' | 'automensaje' | 'todos' | 'sin_conversacion' | 'archivados';

export type AutorTipo = 'lead' | 'yo' | 'equipo' | 'automatico';

export interface Conversacion {
  id: string;
  /** Se le mandó el link de agenda y todavía no agendó. */
  etiquetas?: string[];
  calendario_enviado?: boolean;
  reunion_agendada?: boolean;
  nombre: string | null;
  apellido: string | null;
  ig_username: string | null;
  avatar_url: string | null;
  pais: string | null;
  mensajes_sin_leer: number;
  propietario_id: string | null;
  responsable: string | null;
  contenido: string | null;
  oportunidad_id: string | null;
  etapa_id: string | null;
  etapa: string | null;
  etapa_color: string | null;
  pipeline_id: string | null;
  ultimo_texto: string | null;
  ultimo_dir: 'entrante' | 'saliente' | null;
  ultimo_estado: string | null;
  ultimo_autor: AutorTipo | null;
  ultimo_autor_nombre: string | null;
  ultimo_recurso_tipo: string | null;
  ultimo_en: string | null;
  actividad: string;
  ultimo_entrante: string | null;
  ventana_cierra_en: string | null;
  ventana_abierta: boolean;
  flujo_esperando: boolean;
  archivado: boolean;
  con_conversacion: boolean;
}

export type Conteos = Record<FiltroChat, number>;

export interface Mensaje {
  id: string;
  direccion: 'entrante' | 'saliente';
  texto: string | null;
  estado: string;
  error: string | null;
  creado_en: string;
  ocurrido_en: string;
  enviado_por: string | null;
  recurso_id: string | null;
  autor: string;
  autor_tipo: AutorTipo;
  flujo: string | null;
  recurso_nombre: string | null;
  recurso_tipo: string | null;
  recurso_url_publica: string | null;
  tipo: 'texto' | 'audio' | 'imagen' | 'recurso';
}

export interface Espera { id: number | string; esperando: 'respuesta' | 'tiempo' | null; reanudar_en: string | null; flujo: string }

export interface EventoLead { tipo: string; fuente: string | null; ocurrido_en: string; titulo: string | null; contenido: string | null }

/** El lead tal como lo trae /chat/:id (las columnas de leads + etapa y responsable). */
export interface LeadHilo {
  id: string;
  nombre: string | null;
  apellido?: string | null;
  ig_username: string | null;
  avatar_url?: string | null;
  pais?: string | null;
  email?: string | null;
  valor?: number | string | null;
  mensajes_sin_leer?: number;
  propietario_id: string | null;
  responsable: string | null;
  contenido: string | null;
  oportunidad_id: string | null;
  oportunidad_estado?: string | null;
  pipeline_id: string | null;
  etapa_id: string | null;
  etapa: string | null;
  etapa_color: string | null;
  archivado?: boolean;
  [k: string]: unknown;
}

export interface Hilo {
  lead: LeadHilo;
  ventana: { abierta: boolean; cierra_en: string | null; nunca_escribio: boolean; por_manychat?: boolean };
  esperas: Espera[];
  eventos: EventoLead[];
  mensajes: Mensaje[];
}

export interface Recurso {
  id: string;
  nombre: string;
  tipo: 'audio' | 'pdf' | 'imagen' | 'video' | 'texto' | 'link' | 'secuencia';
  texto: string | null;
  /** Secuencia: los atajos que manda, con la espera (en segundos) antes de cada uno. */
  pasos?: Array<{ recurso_id: string; espera_seg: number }> | null;
  /** Link de agenda: al mandarlo, el lead queda «Calendario enviado» hasta que agenda. */
  es_agenda?: boolean;
  url: string | null;
  url_publica: string | null;
  veces_usado: number;
  mime?: string | null;
}

export interface ProductoPago { id: string; nombre: string; precio_lista: number | string | null; moneda: string | null; link_pago: string | null }

/** Mensaje que todavía vive solo en el navegador (por salir, saliendo, o que falló). */
export interface MensajeLocal {
  idLocal: string;
  leadId: string;
  /** Qué se manda. */
  payload: { texto?: string; recurso_id?: string };
  /** Cómo se ve en la burbuja. */
  vista: { texto: string; tipo?: Recurso['tipo'] | 'pago'; nombre?: string; url?: string | null };
  estado: 'esperando' | 'enviando' | 'enviado' | 'fallo';
  /** Los que esperan unos segundos antes de salir (se pueden deshacer). */
  venceEn?: number;
  plazoMs?: number;
  error?: string;
  /** Id del mensaje ya guardado en el servidor (para no dibujarlo dos veces). */
  idServidor?: string;
  creado: number;
}

export interface Pipeline { id: string; nombre: string; es_predeterminado: boolean; etapas: Etapa[] }
export interface Etapa { id: string; nombre: string; color: string; tipo: 'abierta' | 'ganada' | 'perdida'; pipeline_id: string; orden?: number; acciones?: unknown }
export interface Usuario { id: string; nombre: string; rol: string; activo: boolean }
