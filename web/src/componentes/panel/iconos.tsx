// Íconos de línea propios del Panel (24×24, heredan el color). Los de la
// app viven en componentes/Iconos.tsx; estos son los que el Panel necesita
// y allá no están (reloj, alerta, objetivo, enlace, lápiz…).

const P: Record<string, string> = {
  reloj: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  alerta: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  objetivo: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  enlace: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  instagram: 'M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zM16 11.4A4 4 0 1 1 12.6 8a4 4 0 0 1 3.4 3.4zM17.5 6.5h.01',
  mudo: 'M15 10l4.6-2.3A1 1 0 0 1 21 8.6v6.8a1 1 0 0 1-1.4.9L15 14M3 6h12v12H3zM2 2l20 20',
  lapiz: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  check: 'M20 6 9 17l-5-5',
  externo: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
  flecha: 'M5 12h14M13 6l6 6-6 6',
  perdido: 'M18 6 6 18M6 6l12 12',
};

export function IconoPanel({ nombre, tam = 16, grosor = 1.8 }: { nombre: keyof typeof P | string; tam?: number; grosor?: number }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={grosor}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      <path d={P[nombre] ?? P.alerta} />
    </svg>
  );
}
