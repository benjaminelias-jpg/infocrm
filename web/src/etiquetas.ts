// Etiquetas con significado propio. «Calendario enviado» va en rojo: se le
// mandó el link de agenda y todavía no agendó (se saca sola cuando agenda).
export const ETIQUETA_AGENDA = 'Calendario enviado';

export function estiloEtiqueta(e: string): React.CSSProperties | undefined {
  if (e !== ETIQUETA_AGENDA) return undefined;
  return {
    background: 'color-mix(in srgb, var(--status-critical) 12%, transparent)',
    borderColor: 'color-mix(in srgb, var(--status-critical) 45%, transparent)',
    color: 'var(--status-critical)',
    fontWeight: 600,
  };
}
