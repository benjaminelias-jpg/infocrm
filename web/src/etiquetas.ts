// Etiquetas con significado propio. «Calendario enviado» va en rojo: se le
// mandó el link de agenda y todavía no agendó (se saca sola cuando agenda).
export const ETIQUETA_AGENDA = 'Calendario enviado';

/** Verde: agendó la reunión (llega por el webhook de la agenda). */
export const ETIQUETA_REUNION = 'Reunión agendada';
const VERDE = '#16a34a';

export function estiloEtiqueta(e: string): React.CSSProperties | undefined {
  const c = e === ETIQUETA_AGENDA ? 'var(--status-critical)' : e === ETIQUETA_REUNION ? VERDE : null;
  if (!c) return undefined;
  return {
    background: `color-mix(in srgb, ${c} 12%, transparent)`,
    borderColor: `color-mix(in srgb, ${c} 45%, transparent)`,
    color: c,
    fontWeight: 600,
  };
}
