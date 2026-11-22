import type { Tono } from '../../ui';

// Textos de Contenidos, Leads y la ficha: en voseo y sin jerga. Los valores
// de la base ("ig_media_id", "manychat", "lastre") nunca se muestran tal cual.
// Los roles y las partes del embudo usan las MISMAS palabras que el Panel.

/** Qué trabajo hace cada contenido (rol), juzgado con los últimos 90 días. */
export const ROL_CONTENIDO: Record<string, { etiqueta: string; tono: Tono; ayuda: string }> = {
  caballo: { etiqueta: 'Caballo de batalla', tono: 'verde', ayuda: 'Sostiene la cuenta: trae leads y ventas. Protegelo e iterá la forma de contarlo, no el ángulo.' },
  closer: { etiqueta: 'Cierra ventas', tono: 'violeta', ayuda: 'Convierte muy bien con pocos leads. Dale más alcance: reciclalo o fijalo en tu perfil.' },
  prospector: { etiqueta: 'Trae volumen', tono: 'azul', ayuda: 'Trae muchos leads. Juzgalo por alcance y leads, no por ventas.' },
  calificador: { etiqueta: 'Filtra', tono: 'amarillo', ayuda: 'Filtra antes de que te escriban. No lo descartes por lo que te cuesta cada lead.' },
  abridor: { etiqueta: 'Frena el scroll', tono: 'azul', ayuda: 'Llama la atención pero no convierte. Revisá que el mensaje coincida con lo que ofrecés después.' },
  lastre: { etiqueta: 'No rinde', tono: 'rojo', ayuda: 'Ni volumen ni ventas en los últimos 90 días. Candidato a dejar de priorizar.' },
  explorador: { etiqueta: 'Probando', tono: 'neutro', ayuda: 'Todavía no tiene datos suficientes. Dejalo correr.' },
};

/** Con menos leads que esto (en 90 días) no se opina del rol. */
export const MIN_LEADS_ROL = 10;

/** Parte del embudo de contenido (la sigla queda solo dentro de la ayuda). */
export const PARTE_EMBUDO: Record<string, { etiqueta: string; tono: Tono; color: string; sigla: string }> = {
  TOFU: { etiqueta: 'Atrae', tono: 'azul', color: 'var(--series-1)', sigla: 'TOFU' },
  MOFU: { etiqueta: 'Educa', tono: 'violeta', color: 'var(--series-2)', sigla: 'MOFU' },
  BOFU: { etiqueta: 'Vende', tono: 'verde', color: 'var(--series-3)', sigla: 'BOFU' },
  transversal: { etiqueta: 'Siempre suma', tono: 'neutro', color: 'var(--text-muted)', sigla: '' },
};

export interface Angulo { valor: string; etiqueta: string; embudo: string; descripcion: string }

/** Ángulos agrupados por la parte del embudo en la que trabajan. */
export const ANGULOS: Angulo[] = [
  { valor: 'video_abierto', etiqueta: 'Video abierto', embudo: 'TOFU', descripcion: 'Llega a gente nueva que todavía no te conoce.' },
  { valor: 'problema', etiqueta: 'Problema', embudo: 'MOFU', descripcion: 'Mostrás el problema y por qué le duele.' },
  { valor: 'solucion', etiqueta: 'Solución', embudo: 'MOFU', descripcion: 'Enseñás cómo se resuelve.' },
  { valor: 'producto', etiqueta: 'Producto o caso', embudo: 'BOFU', descripcion: 'Mostrás un caso real o tu producto.' },
  { valor: 'mentalidad', etiqueta: 'Mentalidad', embudo: 'transversal', descripcion: 'Creencias y forma de pensar.' },
  { valor: 'narrativa', etiqueta: 'Narrativa', embudo: 'transversal', descripcion: 'Tu historia y por qué saber de esto.' },
  { valor: 'otro', etiqueta: 'Otro', embudo: 'transversal', descripcion: 'No encaja en los anteriores.' },
];
export const ANGULO: Record<string, Angulo> = Object.fromEntries(ANGULOS.map((a) => [a.valor, a]));

export const TIPO_CONTENIDO: Record<string, string> = {
  reel: 'Reel', post: 'Post', carrusel: 'Carrusel', historia: 'Historia', live: 'Directo', anuncio: 'Anuncio', otro: 'Otro',
};

/** De dónde llegó cada cosa que pasó, en palabras. */
export const FUENTE: Record<string, string> = {
  manychat: 'por ManyChat', instagram: 'por Instagram', calendly: 'por Calendly', stripe: 'por Stripe',
  hotmart: 'por Hotmart', manual: 'cargado a mano', api: 'por otra app', generico: 'por otra app', regla: 'automático', seed: '',
};

/** Lo que pasó en la vida del lead, contado como historia. */
export const EVENTO: Record<string, string> = {
  lead_creado: 'Entró como lead',
  recurso_entregado: 'Recibió el recurso',
  respondio_dm: 'Respondió por mensaje',
  comentario: 'Comentó',
  reunion_agendada: 'Agendó una reunión',
  reunion_realizada: 'Vino a la reunión',
  reunion_no_asistio: 'No vino a la reunión',
  reunion_cancelada: 'Canceló la reunión',
  venta: 'Compró',
  reembolso: 'Pidió la devolución',
  etapa_cambiada: 'Cambió de etapa',
  mensaje_enviado: 'Le escribiste',
  mensaje_recibido: 'Te escribió',
  nota: 'Nota',
  etiqueta: 'Etiqueta',
  otro: 'Otro',
};

export const COLOR_EVENTO: Record<string, string> = {
  venta: 'var(--status-good)',
  reunion_agendada: 'var(--series-2)',
  reunion_realizada: 'var(--series-3)',
  reunion_no_asistio: 'var(--status-critical)',
  reembolso: 'var(--status-critical)',
  lead_creado: 'var(--series-1)',
};

/** Cómo supimos de qué reel vino. */
export function metodoAtribucion(metodo?: string | null, palabra?: string | null): string {
  switch (metodo) {
    case 'ig_media_id': return 'comentó en ese reel';
    case 'palabra_clave': return palabra ? `comentó la palabra «${palabra}»` : 'comentó una palabra clave';
    case 'automatizacion': return 'llegó por el automensaje';
    case 'campania': return 'llegó por un anuncio';
    case 'manual': return 'lo asignaste a mano';
    default: return '';
  }
}

export const CONFIANZA: Record<string, { texto: string; tono: Tono }> = {
  alta: { texto: 'Seguro', tono: 'verde' },
  media: { texto: 'Bastante seguro', tono: 'azul' },
  baja: { texto: 'Dudoso', tono: 'amarillo' },
};

/** Motivos rápidos para descartar un lead. */
export const MOTIVOS_DESCARTE = ['No califica', 'No le interesa', 'Solo quería el recurso', 'No responde', 'Es spam'];

/** Resultado del checklist para la llamada (3 preguntas). 0 = sin evaluar (nunca "malísimo"). */
export const RESULTADO_CHECKLIST: Record<number, { texto: string; tono: Tono }> = {
  0: { texto: 'Sin evaluar', tono: 'neutro' },
  1: { texto: 'Todavía no califica', tono: 'amarillo' },
  2: { texto: 'Apto para vender', tono: 'azul' },
  3: { texto: 'Perfecto para vender', tono: 'verde' },
};

export const PREGUNTAS_CHECKLIST = ['Tiene presupuesto', 'Decide la compra', 'Tiene el problema que resolvés'];
