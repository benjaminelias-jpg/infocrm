// Íconos de línea propios del Chat (mismo estilo que componentes/Iconos.tsx:
// 24×24, trazo de 1,7 y currentColor). Los que faltan en el set común.

const P: Record<string, string> = {
  enviar: 'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z',
  archivar: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4',
  leido: 'M20 6 9 17l-5-5',
  noleido: 'M12 12m-4 0a4 4 0 1 0 8 0 4 4 0 1 0-8 0',
  usuario: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  reloj: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  abajo: 'M12 5v14M19 12l-7 7-7-7',
  arriba: 'M12 19V5M5 12l7-7 7 7',
  chevronAbajo: 'm6 9 6 6 6-6',
  chevronArriba: 'm18 15-6-6-6 6',
  chevronDerecha: 'm9 6 6 6-6 6',
  mas: 'M12 5v14M5 12h14',
  rayo: 'M13 2 3 14h9l-1 8 10-12h-9z',
  microfono: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
  copiar: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  instagram: 'M17 2H7a5 5 0 0 0-5 5v10a5 5 0 0 0 5 5h10a5 5 0 0 0 5-5V7a5 5 0 0 0-5-5zM16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37zM17.5 6.5h.01',
  ficha: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  probar: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3',
  pausa: 'M10 4H6v16h4zM18 4h-4v16h4z',
  arrastrar: 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01',
  editar: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  duplicar: 'M8 8h12v12H8zM16 8V4H4v12h4',
  borrar: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  subir: 'M12 19V5M5 12l7-7 7 7M5 3h14',
  bajar: 'M12 5v14M19 12l-7 7-7-7M5 21h14',
  subirArchivo: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  enlace: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  ajustes: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  pipeline: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v7h-4z',
};

export function IconoChat({ nombre, tam = 18, className = '' }: { nombre: keyof typeof P | string; tam?: number; className?: string }) {
  const d = P[nombre] ?? P.mas;
  const punto = nombre === 'noleido';
  return (
    <svg width={tam} height={tam} viewBox="0 0 24 24" fill={punto ? 'currentColor' : 'none'} stroke="currentColor"
      strokeWidth={nombre === 'arrastrar' ? 2.6 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d={d} />
    </svg>
  );
}
