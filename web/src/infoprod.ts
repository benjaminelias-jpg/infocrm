// Etiquetas, colores e iconos de la capa de infoproducción (ángulos, roles,
// calificación). Centralizado para que el panel hable el mismo idioma que el
// método en todas las pantallas.

export const ANGULOS: Array<{ valor: string; etiqueta: string; embudo: string }> = [
  { valor: 'video_abierto', etiqueta: 'Vídeo abierto', embudo: 'TOFU' },
  { valor: 'problema', etiqueta: 'Problema', embudo: 'MOFU' },
  { valor: 'solucion', etiqueta: 'Solución', embudo: 'MOFU' },
  { valor: 'producto', etiqueta: 'Producto / caso', embudo: 'BOFU' },
  { valor: 'mentalidad', etiqueta: 'Mentalidad', embudo: 'transversal' },
  { valor: 'narrativa', etiqueta: 'Narrativa', embudo: 'transversal' },
  { valor: 'otro', etiqueta: 'Otro', embudo: 'transversal' },
];

export const ETIQUETA_ANGULO: Record<string, string> = Object.fromEntries(
  ANGULOS.map((a) => [a.valor, a.etiqueta]),
);

// Color por etapa de embudo (no por ángulo): la posición en el embudo es
// la información que importa de un vistazo.
export const COLOR_EMBUDO: Record<string, string> = {
  TOFU: 'var(--series-1)',
  MOFU: 'var(--series-2)',
  BOFU: 'var(--series-3)',
  transversal: 'var(--text-muted)',
};

export const EMBUDO_DE_ANGULO: Record<string, string> = Object.fromEntries(
  ANGULOS.map((a) => [a.valor, a.embudo]),
);

export const ROLES: Record<string, { etiqueta: string; color: string; ayuda: string }> = {
  caballo: { etiqueta: 'Caballo de batalla', color: 'var(--status-good)', ayuda: 'Sostiene la cuenta. Protégelo e itera la ejecución, no el ángulo.' },
  closer: { etiqueta: 'Closer', color: 'var(--series-3)', ayuda: 'Convierte muy bien con pocos leads. Dale más alcance.' },
  prospector: { etiqueta: 'Prospector', color: 'var(--series-1)', ayuda: 'Trae volumen barato. Júzgalo por alcance y leads, no por ventas.' },
  calificador: { etiqueta: 'Calificador', color: 'var(--series-2)', ayuda: 'Filtra antes del clic. No lo mates por coste por lead.' },
  abridor: { etiqueta: 'Abridor', color: 'var(--ramp-5)', ayuda: 'Detiene el scroll. Arregla la coherencia con el destino.' },
  lastre: { etiqueta: 'Lastre', color: 'var(--status-critical)', ayuda: 'Ni volumen ni conversión. Candidato a dejar de priorizar.' },
  explorador: { etiqueta: 'Explorador', color: 'var(--text-muted)', ayuda: 'Aún sin datos suficientes. Déjalo correr.' },
  estable: { etiqueta: 'Estable', color: 'var(--text-muted)', ayuda: 'Rinde en la media del resto.' },
  sin_atribuir: { etiqueta: 'Sin atribuir', color: 'var(--baseline)', ayuda: 'Leads sin contenido de origen.' },
};

export const CALIFICACION: Record<string, { etiqueta: string; color: string }> = {
  calificado: { etiqueta: 'Calificado', color: 'var(--status-good)' },
  no_calificado: { etiqueta: 'No calificado', color: 'var(--status-critical)' },
  sin_calificar: { etiqueta: 'Sin calificar', color: 'var(--text-muted)' },
};

export const DM_PASOS: Array<{ valor: string; etiqueta: string }> = [
  { valor: 'apertura', etiqueta: 'Apertura' },
  { valor: 'calificacion', etiqueta: 'Calificación' },
  { valor: 'dolor', etiqueta: 'Dolor' },
  { valor: 'solucion', etiqueta: 'Solución' },
  { valor: 'cierre', etiqueta: 'Cierre' },
  { valor: 'seguimiento', etiqueta: 'Seguimiento' },
];

export function colorScore(score: number): string {
  if (score >= 70) return 'var(--status-good)';
  if (score >= 45) return 'var(--series-3)';
  if (score >= 25) return 'var(--status-warning)';
  return 'var(--text-muted)';
}
