import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

// Avisos flotantes ("toasts"): confirman lo que pasó sin ocupar lugar en la
// pantalla ni empujar el contenido. Se van solos. Abajo a la derecha en
// escritorio; abajo y a lo ancho en el celular.

type Tono = 'exito' | 'error' | 'info';
interface Aviso { id: number; tono: Tono; texto: React.ReactNode; accion?: { texto: string; onClick: () => void } }
interface Api {
  exito: (texto: React.ReactNode, accion?: Aviso['accion']) => void;
  error: (texto: React.ReactNode, accion?: Aviso['accion']) => void;
  info: (texto: React.ReactNode, accion?: Aviso['accion']) => void;
}

const Ctx = createContext<Api | null>(null);

const COLOR: Record<Tono, string> = { exito: 'var(--status-good)', error: 'var(--status-critical)', info: 'var(--series-1)' };
const ICONO: Record<Tono, string> = { exito: '✓', error: '!', info: 'i' };

export function ProveedorAvisos({ children }: { children: React.ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const sig = useRef(1);
  const quitar = useCallback((id: number) => setAvisos((a) => a.filter((x) => x.id !== id)), []);
  const poner = useCallback((tono: Tono, texto: React.ReactNode, accion?: Aviso['accion']) => {
    const id = sig.current++;
    setAvisos((a) => [...a.slice(-2), { id, tono, texto, accion }]);
    window.setTimeout(() => quitar(id), tono === 'error' ? 7000 : accion ? 6000 : 3500);
  }, [quitar]);
  const api = useMemo<Api>(() => ({
    exito: (t, a) => poner('exito', t, a),
    error: (t, a) => poner('error', t, a),
    info: (t, a) => poner('info', t, a),
  }), [poner]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-[70] flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-4 sm:w-[380px]"
        aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} role={a.tono === 'error' ? 'alert' : 'status'}
            className="ui-aparecer pointer-events-auto flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[13px] shadow-xl"
            style={{ background: 'var(--text-primary)', color: 'var(--page-plane)' }}>
            <span className="mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: COLOR[a.tono] }}>{ICONO[a.tono]}</span>
            <div className="min-w-0 flex-1 leading-snug">{a.texto}</div>
            {a.accion && (
              <button onClick={() => { a.accion!.onClick(); quitar(a.id); }} className="ui-foco shrink-0 rounded-md px-2 py-0.5 text-[12px] font-semibold underline">
                {a.accion.texto}
              </button>
            )}
            <button onClick={() => quitar(a.id)} aria-label="Cerrar aviso" className="ui-foco shrink-0 rounded px-1 text-[12px] opacity-60 hover:opacity-100">✕</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

/** Avisos flotantes. Fuera del proveedor no rompe: cae a la consola. */
export function useAviso(): Api {
  const ctx = useContext(Ctx);
  return ctx ?? { exito: console.info, error: console.error, info: console.info } as unknown as Api;
}
