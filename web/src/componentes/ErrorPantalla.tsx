import { Component, type ReactNode } from 'react';

// Si una pantalla se rompe por un error inesperado, en vez de quedar en
// blanco se ve esto, con una salida. Cambiar de pantalla lo reinicia.

export default class ErrorPantalla extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error) {
    // Queda en la consola para quien lo esté revisando.
    console.warn('Pantalla con error:', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    // Una pantalla que no se pudo descargar casi siempre es falta de internet.
    const sinRed = (typeof navigator !== 'undefined' && navigator.onLine === false)
      || /dynamically imported module|Importing a module script failed|Loading chunk|Failed to fetch/i.test(String(this.state.error?.message ?? ''));
    if (sinRed) {
      return (
        <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
          <div className="tarjeta w-full max-w-md p-6 text-center">
            <div className="text-[28px]" aria-hidden>📶</div>
            <h1 className="mt-2 text-[16px] font-semibold">No hay conexión</h1>
            <p className="mt-1 text-[13px] text-[var(--text-secondary)]">No pudimos abrir esta pantalla. Revisá tu internet y probá de nuevo.</p>
            <button type="button" onClick={() => window.location.reload()}
              className="ui-foco mt-4 h-10 rounded-[12px] px-4 text-[13px] font-semibold text-white md:h-9" style={{ background: 'var(--accion)' }}>
              Reintentar
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
        <div className="tarjeta w-full max-w-md p-6 text-center">
          <div className="text-[28px]" aria-hidden>🧩</div>
          <h1 className="mt-2 text-[16px] font-semibold">Algo se rompió en esta pantalla</h1>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
            Tus datos están bien. Recargá la página; si vuelve a pasar, probá desde otra pantalla.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => window.location.reload()}
              className="ui-foco h-10 rounded-[12px] px-4 text-[13px] font-semibold text-white md:h-9" style={{ background: 'var(--accion)' }}>
              Recargar
            </button>
            <a href="/" className="ui-foco inline-flex h-10 items-center rounded-[12px] px-4 text-[13px] font-semibold md:h-9" style={{ background: 'var(--surface-2)' }}>Ir al Panel</a>
          </div>
        </div>
      </div>
    );
  }
}
