// Iconos de línea, 20x20, heredan el color (currentColor). Limpios y nítidos,
// en vez de glifos de texto que se ven chicos y disparejos.
const P: Record<string, string> = {
  panel: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  contenidos: 'M4 4h16v12H4zM2 20h20M10 8l5 2-5 2z',
  pipeline: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v7h-4z',
  leads: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  flujos: 'M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L3.2 7.7l5.4-.8z',
  finanzas: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  bandeja: 'M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.5 8.5 0 0 1 21 11.5z',
  recursos: 'M9 18V5l12-2v13M9 13l12-2M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  automatizaciones: 'M13 2L3 14h9l-1 8 10-12h-9z',
  reglas: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15H4.5a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 6 9.4a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 11 4.6V4.5a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 2.82 1.17l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 11v.09',
  conexiones: 'M10.6 13.4a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.1 1.1M13.4 10.6a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.1-1.1',
  claude: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8v4l3 2',
};

export default function Icono({ nombre, tam = 20 }: { nombre: string; tam?: number }) {
  const d = P[nombre] ?? P.panel;
  const relleno = nombre === 'flujos' || nombre === 'automatizaciones';
  return (
    <svg width={tam} height={tam} viewBox="0 0 24 24" fill={relleno ? 'currentColor' : 'none'}
      stroke="currentColor" strokeWidth={relleno ? 0 : 1.7} strokeLinecap="round"
      strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
