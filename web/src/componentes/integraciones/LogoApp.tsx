import { useId } from 'react';
import Icono from '../Iconos';

// Logos simples (SVG) de cada app que se puede conectar: un usuario no
// técnico reconoce más rápido el logo de ManyChat o de Stripe que un emoji
// genérico (y el 📅 del celular decía "July 17", en inglés). Son marcas
// simplificadas con el color de cada app, no los logos oficiales.

export type App =
  | 'instagram' | 'manychat' | 'calendly' | 'calcom' | 'stripe' | 'hotmart' | 'zapier' | 'make'
  | 'claude' | 'email' | 'agenda' | 'pagos' | 'tecnicos' | 'otra' | 'n8n';

export function LogoApp({ app, tam = 22, titulo }: { app: App; tam?: number; titulo?: string }) {
  const id = useId().replace(/:/g, '');
  const comun = { width: tam, height: tam, viewBox: '0 0 24 24', role: titulo ? 'img' : undefined, 'aria-label': titulo, 'aria-hidden': titulo ? undefined : true } as const;
  switch (app) {
    case 'instagram':
      return (
        <svg {...comun} fill="none">
          <defs>
            <linearGradient id={`ig-${id}`} x1="0" y1="24" x2="24" y2="0">
              <stop offset="0" stopColor="#fcb045" /><stop offset="0.5" stopColor="#fd1d1d" /><stop offset="1" stopColor="#833ab4" />
            </linearGradient>
          </defs>
          <rect x="3" y="3" width="18" height="18" rx="5" stroke={`url(#ig-${id})`} strokeWidth="2" />
          <circle cx="12" cy="12" r="4" stroke={`url(#ig-${id})`} strokeWidth="2" />
          <circle cx="17.3" cy="6.7" r="1.2" fill={`url(#ig-${id})`} />
        </svg>
      );
    case 'manychat':
      return (
        <svg {...comun}>
          <path d="M12 3c5 0 9 3.6 9 8.1 0 4.5-4 8.1-9 8.1-1 0-2-.1-2.9-.4L5 21l.9-3.6C4.1 16 3 13.7 3 11.1 3 6.6 7 3 12 3z" fill="#0084ff" />
          <path d="M8.2 11.6c1 1.6 2.3 2.4 3.8 2.4s2.8-.8 3.8-2.4" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'calendly':
      return (
        <svg {...comun} fill="none">
          <path d="M17.6 7.2A7.2 7.2 0 1 0 17.6 16.8" stroke="#006bff" strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="12" cy="12" r="2.6" fill="#006bff" />
        </svg>
      );
    case 'calcom':
      return (
        <svg {...comun}>
          <rect x="2" y="4" width="20" height="16" rx="4" fill="var(--ink, #111827)" />
          <text x="12" y="15.6" textAnchor="middle" fontSize="8.6" fontWeight="700" fill="var(--on-ink, #fff)" fontFamily="Arial, sans-serif">Cal</text>
        </svg>
      );
    case 'stripe':
      return (
        <svg {...comun}>
          <rect x="2" y="2" width="20" height="20" rx="5" fill="#635bff" />
          <path d="M14.9 9.3c-.6-.5-1.6-.9-2.6-.9-1.1 0-1.8.4-1.8 1.1 0 1.9 5 .9 5 4.3 0 1.6-1.4 2.7-3.4 2.7-1.4 0-2.7-.5-3.4-1.1" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
      );
    case 'hotmart':
      return (
        <svg {...comun}>
          <circle cx="12" cy="12" r="10" fill="#f04e23" />
          <path d="M12.6 5.8c.3 2.1 2.9 3.2 2.9 6.2a3.5 3.5 0 0 1-7 0c0-1.6.8-2.6 1.6-3.3.1 1 .6 1.7 1.3 1.9-.2-2 .2-3.6 1.2-4.8z" fill="#fff" />
        </svg>
      );
    case 'zapier':
      return (
        <svg {...comun} fill="none" stroke="#ff4f00" strokeWidth="2.6" strokeLinecap="round">
          <path d="M12 3.5v17M3.5 12h17M6 6l12 12M18 6 6 18" />
        </svg>
      );
    case 'make':
      return (
        <svg {...comun}>
          <defs>
            <linearGradient id={`mk-${id}`} x1="0" y1="0" x2="24" y2="24">
              <stop offset="0" stopColor="#b02de9" /><stop offset="1" stopColor="#6d00cc" />
            </linearGradient>
          </defs>
          <rect x="3" y="7" width="4" height="12" rx="2" fill={`url(#mk-${id})`} transform="rotate(-18 5 13)" />
          <rect x="10" y="5" width="4" height="14" rx="2" fill={`url(#mk-${id})`} transform="rotate(-18 12 12)" />
          <rect x="17" y="5" width="4" height="14" rx="2" fill={`url(#mk-${id})`} />
        </svg>
      );
    case 'n8n':
      return (
        <svg {...comun} fill="none" stroke="#ea4b71" strokeWidth="2">
          <circle cx="5" cy="12" r="2.4" /><circle cx="12" cy="7" r="2.4" /><circle cx="12" cy="17" r="2.4" /><circle cx="19.5" cy="12" r="2.4" />
          <path d="M7.4 12h2.2M14.4 7.6l3.2 2.8M14.4 16.4l3.2-2.8" />
        </svg>
      );
    case 'claude':
      return (
        <svg {...comun} fill="none" stroke="#d97757" strokeWidth="2.3" strokeLinecap="round">
          <path d="M12 3v5.2M12 15.8V21M3 12h5.2M15.8 12H21M5.6 5.6l3.7 3.7M14.7 14.7l3.7 3.7M18.4 5.6l-3.7 3.7M9.3 14.7l-3.7 3.7" />
        </svg>
      );
    case 'email':
      return (
        <svg {...comun} fill="none" stroke="var(--accion, var(--series-1))" strokeWidth="1.9" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" />
        </svg>
      );
    case 'agenda':
      return (
        <svg {...comun} fill="none" stroke="var(--accion, var(--series-1))" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" />
          <circle cx="8.5" cy="14.5" r="1" fill="var(--accion, var(--series-1))" stroke="none" />
          <circle cx="12" cy="14.5" r="1" fill="var(--accion, var(--series-1))" stroke="none" />
        </svg>
      );
    case 'pagos':
      return (
        <svg {...comun} fill="none" stroke="var(--status-good)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2.5" y="5" width="19" height="14" rx="3" /><path d="M2.5 10h19M6.5 15h4" />
        </svg>
      );
    case 'tecnicos':
      return <span style={{ color: 'var(--text-secondary)', display: 'inline-flex' }}><Icono nombre="reglas" tam={tam} /></span>;
    case 'otra':
    default:
      return <span style={{ color: 'var(--text-secondary)', display: 'inline-flex' }}><Icono nombre="conexiones" tam={tam} /></span>;
  }
}

/** 2-3 logos chicos superpuestos (cuando una categoría no tiene ninguna app conectada). */
export function LogosApilados({ apps, tam = 13 }: { apps: App[]; tam?: number }) {
  return (
    <span className="relative inline-flex items-center" aria-hidden>
      {apps.slice(0, 3).map((a, i) => (
        <span key={a} className="inline-flex items-center justify-center rounded-full"
          style={{
            width: tam + 6, height: tam + 6, marginLeft: i ? -3 : 0, zIndex: 3 - i,
            background: 'var(--surface-1)', boxShadow: '0 0 0 1.5px var(--surface-2, var(--page-plane))',
          }}>
          <LogoApp app={a} tam={tam} />
        </span>
      ))}
    </span>
  );
}
