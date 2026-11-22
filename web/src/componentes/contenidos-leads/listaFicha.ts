// "Pasar de un lead al siguiente" sin cerrar la ficha: la pantalla que
// muestra una lista (Leads, la ficha de un contenido…) guarda acá los ids en
// el orden en que se ven, y la ficha (que la dibuja el marco de la app con
// ?ficha=<id>) los lee para ofrecer ‹ 3 de 50 › y deslizar.
// Vive en sessionStorage: es de esta pestaña y se pisa con la última lista.

const CLAVE = 'infocrm_ficha_lista';

export interface ListaFicha { ruta: string; ids: string[]; nombre?: string }

export function guardarListaFicha(ids: string[], nombre?: string) {
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify({ ruta: window.location.pathname, ids: ids.slice(0, 500), nombre }));
  } catch { /* sin almacenamiento: la ficha se ve igual, sin anterior/siguiente */ }
}

export function leerListaFicha(): ListaFicha | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(CLAVE) ?? 'null');
    return v && Array.isArray(v.ids) && typeof v.ruta === 'string' ? v : null;
  } catch { return null; }
}

/** Evento que avisa "este lead cambió" (etapa, responsable, etiquetas…) para refrescar listas. */
export const EVENTO_LEAD_CAMBIADO = 'infocrm:lead-cambiado';

export function avisarLeadCambiado(id: string) {
  window.dispatchEvent(new CustomEvent(EVENTO_LEAD_CAMBIADO, { detail: { id } }));
}
