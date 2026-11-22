import { useState } from 'react';

// Portada 9:16 de un reel, carrusel o historia. El creador reconoce sus
// contenidos por la imagen, no por el título. Si no hay imagen (o falla),
// un reemplazo con el color de la parte del embudo y el ícono del tipo.

const COLOR_EMBUDO: Record<string, string> = {
  TOFU: 'var(--series-1)', MOFU: 'var(--series-2)', BOFU: 'var(--series-3)', transversal: 'var(--text-muted)',
};

const TAMANOS = {
  xs: { w: 24, h: 32, icono: 11 },
  sm: { w: 36, h: 52, icono: 14 },
  md: { w: 44, h: 72, icono: 16 },
  lg: { w: 88, h: 148, icono: 26 },
} as const;

function IconoTipo({ tipo, tam }: { tipo?: string | null; tam: number }) {
  const comun = { width: tam, height: tam, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (tipo === 'carrusel') return <svg {...comun}><rect x="7" y="4" width="13" height="16" rx="2" /><path d="M4 7v10" /></svg>;
  if (tipo === 'historia') return <svg {...comun}><circle cx="12" cy="12" r="8" strokeDasharray="3 2.4" /><circle cx="12" cy="12" r="3.5" /></svg>;
  if (tipo === 'post' || tipo === 'otro') return <svg {...comun}><rect x="4" y="4" width="16" height="16" rx="2" /><circle cx="9" cy="9" r="1.6" /><path d="m20 15-4.5-4.5L6 20" /></svg>;
  if (tipo === 'anuncio') return <svg {...comun}><path d="M4 10v4h3l6 4V6L7 10H4zM16.5 9.5a3.5 3.5 0 0 1 0 5" /></svg>;
  // reel, live y por defecto: "play"
  return <svg {...comun}><rect x="4" y="3" width="16" height="18" rx="3" /><path d="m10 9 5 3-5 3z" fill="currentColor" /></svg>;
}

export default function Portada({ url, tipo, embudo, tam = 'sm', className = '' }: {
  url?: string | null; tipo?: string | null; embudo?: string | null; tam?: keyof typeof TAMANOS; className?: string;
}) {
  const [falla, setFalla] = useState(false);
  const t = TAMANOS[tam];
  const color = COLOR_EMBUDO[embudo ?? ''] ?? 'var(--text-muted)';
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md ${className}`}
      style={{ width: t.w, height: t.h, background: `color-mix(in srgb, ${color} 14%, var(--surface-1))`, color, border: '1px solid var(--border-hairline)' }}
      aria-hidden>
      {url && !falla
        ? <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFalla(true)} className="h-full w-full object-cover" />
        : <IconoTipo tipo={tipo} tam={t.icono} />}
    </span>
  );
}
