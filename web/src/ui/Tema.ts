import { useEffect, useState } from 'react';

// Tema con tres opciones: claro, oscuro o automático (sigue al teléfono o a la
// computadora). "Automático" = sin data-theme y sin preferencia guardada.

export type Tema = 'claro' | 'oscuro' | 'auto';
const CLAVE = 'infocrm_tema';
const COLOR = { claro: '#f3f3f6', oscuro: '#0f0f12' };

export function leerTema(): Tema {
  try {
    const g = localStorage.getItem(CLAVE);
    return g === 'dark' ? 'oscuro' : g === 'light' ? 'claro' : 'auto';
  } catch { return 'auto'; }
}

function oscuroEfectivo(t: Tema) {
  if (t === 'oscuro') return true;
  if (t === 'claro') return false;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

/** Color de la barra del navegador en el celular, igual al fondo de la app. */
function actualizarColorBarra(t: Tema) {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = oscuroEfectivo(t) ? COLOR.oscuro : COLOR.claro;
}

export function aplicarTema(t: Tema) {
  const raiz = document.documentElement;
  try {
    if (t === 'auto') { raiz.removeAttribute('data-theme'); localStorage.removeItem(CLAVE); }
    else { const v = t === 'oscuro' ? 'dark' : 'light'; raiz.setAttribute('data-theme', v); localStorage.setItem(CLAVE, v); }
  } catch { /* sin almacenamiento: igual se aplica en esta visita */ }
  actualizarColorBarra(t);
}

export function useTema() {
  const [tema, setTema] = useState<Tema>(leerTema);
  useEffect(() => {
    actualizarColorBarra(tema);
    if (tema !== 'auto') return;
    // En automático, si el sistema cambia de claro a oscuro, la barra acompaña.
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const f = () => actualizarColorBarra('auto');
    mq?.addEventListener?.('change', f);
    return () => mq?.removeEventListener?.('change', f);
  }, [tema]);
  return {
    tema,
    cambiar: (t: Tema) => { aplicarTema(t); setTema(t); },
  };
}
