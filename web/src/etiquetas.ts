// Etiquetas: cada una con su color (siempre el mismo para el mismo nombre),
// y dos con significado propio: «Calendario enviado» (rojo: se le mandó el
// link de agenda y todavía no agendó) y «Reunión agendada» (verde).
export const ETIQUETA_AGENDA = 'Calendario enviado';
export const ETIQUETA_REUNION = 'Reunión agendada';

// Paleta sobria (sin violetas), legible en claro y oscuro.
const PALETA = ['#2563eb', '#0d9488', '#d97706', '#e11d48', '#0284c7', '#059669', '#ea580c', '#0891b2', '#65a30d', '#475569', '#db2777', '#ca8a04'];

export function colorEtiqueta(e: string): string {
  const n = e.trim().toLowerCase();
  if (n === ETIQUETA_AGENDA.toLowerCase()) return '#dc2626';
  if (n === ETIQUETA_REUNION.toLowerCase()) return '#16a34a';
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return PALETA[h % PALETA.length];
}

export function iconoEtiqueta(e: string): string {
  const n = e.trim().toLowerCase();
  if (n === ETIQUETA_AGENDA.toLowerCase()) return '📅';
  if (n === ETIQUETA_REUNION.toLowerCase()) return '✅';
  return '';
}

export function estiloEtiqueta(e: string): React.CSSProperties {
  const c = colorEtiqueta(e);
  return {
    background: `color-mix(in srgb, ${c} 14%, transparent)`,
    borderColor: `color-mix(in srgb, ${c} 40%, transparent)`,
    color: `color-mix(in srgb, ${c} 82%, var(--text-primary))`,
    fontWeight: 600,
  };
}
