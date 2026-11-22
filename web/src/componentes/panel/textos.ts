// Textos del Panel en voseo y sin jerga. Los roles de cada contenido y las
// etapas del embudo de contenido (TOFU/MOFU/BOFU) se dicen en palabras; la
// sigla queda solo dentro de la ayuda (ⓘ).

import type { Tono } from '../../ui';

export const ROL_CONTENIDO: Record<string, { etiqueta: string; tono: Tono; ayuda: string }> = {
  caballo: { etiqueta: 'Caballo de batalla', tono: 'verde', ayuda: 'Sostiene la cuenta: trae leads y ventas. Protegelo e iterá la forma de contarlo, no el ángulo.' },
  closer: { etiqueta: 'Cierra ventas', tono: 'violeta', ayuda: 'Convierte muy bien con pocos leads. Dale más alcance.' },
  prospector: { etiqueta: 'Trae volumen', tono: 'azul', ayuda: 'Trae muchos leads baratos. Juzgalo por alcance y leads, no por ventas.' },
  calificador: { etiqueta: 'Filtra', tono: 'amarillo', ayuda: 'Filtra antes de que te escriban. No lo descartes por lo que te cuesta cada lead.' },
  abridor: { etiqueta: 'Frena el scroll', tono: 'azul', ayuda: 'Llama la atención pero no convierte. Revisá que el mensaje coincida con lo que ofrecés después.' },
  lastre: { etiqueta: 'No rinde', tono: 'rojo', ayuda: 'Ni volumen ni ventas. Candidato a dejar de priorizar.' },
  explorador: { etiqueta: 'Probando', tono: 'neutro', ayuda: 'Todavía no tiene datos suficientes. Dejalo correr.' },
};

/** Parte del embudo de contenido: qué trabajo hace ese tipo de contenido. */
export const PARTE_EMBUDO: Record<string, { etiqueta: string; sigla: string; color: string }> = {
  TOFU: { etiqueta: 'Atrae', sigla: 'TOFU', color: 'var(--series-1)' },
  MOFU: { etiqueta: 'Educa', sigla: 'MOFU', color: 'var(--series-2)' },
  BOFU: { etiqueta: 'Vende', sigla: 'BOFU', color: 'var(--series-3)' },
  transversal: { etiqueta: 'Transversal', sigla: 'transversal', color: 'var(--text-muted)' },
};

/** "Producto / caso (BOFU)" → "Producto / caso"; "Vídeo" → "Video". */
export function limpiarAngulo(etiqueta: string) {
  return String(etiqueta ?? '')
    .replace(/\s*\((TOFU|MOFU|BOFU|transversal)\)\s*$/i, '')
    .replace(/Vídeo/g, 'Video');
}

export const TIPO_CONTENIDO: Record<string, string> = {
  reel: 'Reel', post: 'Post', carrusel: 'Carrusel', historia: 'Historia', live: 'Directo', anuncio: 'Anuncio', otro: 'Otro',
};
