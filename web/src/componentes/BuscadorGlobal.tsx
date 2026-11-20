import { useEffect, useRef, useState } from 'react';
import { api, hace } from '../api';
import { Buscador, Dialogo, Girando, IdentidadLead, Vacio } from '../ui';
import { useFicha } from './useFicha';

// "Buscar un lead" desde cualquier pantalla (⌘K / Ctrl+K): escribís el
// @usuario, el nombre o el email y se abre su ficha.

export function useAtajoBuscar(abrir: () => void) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); abrir(); }
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [abrir]);
}

export default function BuscadorGlobal({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const ficha = useFicha();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<any[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [marcado, setMarcado] = useState(0);
  const turno = useRef(0);

  useEffect(() => { if (!abierto) { setQ(''); setRes(null); setMarcado(0); } }, [abierto]);
  useEffect(() => {
    const texto = q.trim().replace(/^@/, '');
    if (!texto) { setRes(null); return; }
    const yo = ++turno.current;
    setCargando(true);
    const t = window.setTimeout(() => {
      api<{ leads: any[] }>(`/leads?q=${encodeURIComponent(texto)}&limite=8`)
        .then((r) => { if (yo === turno.current) { setRes(r.leads ?? []); setMarcado(0); } })
        .catch(() => { if (yo === turno.current) setRes([]); })
        .finally(() => { if (yo === turno.current) setCargando(false); });
    }, 200);
    return () => window.clearTimeout(t);
  }, [q]);

  function abrir(l: any) {
    onCerrar();
    // Después de cerrar el diálogo, para que la ficha quede arriba en el historial.
    window.setTimeout(() => ficha.abrir(l.id), 0);
  }

  return (
    <Dialogo abierto={abierto} onCerrar={onCerrar} titulo="Buscar un lead" ancho={520}>
      <div onKeyDown={(e) => {
        if (!res?.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); setMarcado((m) => Math.min(m + 1, res.length - 1)); }
        if (e.key === 'ArrowUp') { e.preventDefault(); setMarcado((m) => Math.max(m - 1, 0)); }
        if (e.key === 'Enter') { e.preventDefault(); abrir(res[marcado]); }
      }}>
        <Buscador valor={q} onCambiar={setQ} placeholder="@usuario, nombre o email" autoFocus />
        <div className="mt-2 min-h-[120px]" role="listbox" aria-label="Resultados">
          {!q.trim() ? (
            <p className="px-1 py-3 text-[12px] text-[var(--text-muted)]">Escribí al menos una letra. Atajo: ⌘K (o Ctrl+K) desde cualquier pantalla.</p>
          ) : cargando && !res ? (
            <div className="flex items-center gap-2 px-1 py-3 text-[12px] text-[var(--text-muted)]"><Girando /> Buscando…</div>
          ) : res && res.length === 0 ? (
            <Vacio compacto icono="🔎" titulo="No encontramos a nadie" texto="Probá con otra parte del @usuario o del nombre." />
          ) : (
            <ul className="space-y-0.5">
              {(res ?? []).map((l, i) => (
                <li key={l.id} role="option" aria-selected={i === marcado}>
                  <IdentidadLead id={l.id} nombre={l.nombre} usuario={l.ig_username} foto={l.avatar_url}
                    onClick={() => abrir(l)} className={`w-full px-2 py-2 ${i === marcado ? 'bg-[var(--page-plane)]' : 'hover:bg-[var(--page-plane)]'}`}
                    derecha={<span className="shrink-0 text-right text-[11px] text-[var(--text-muted)]">
                      {l.etapa_nombre ?? ''}{l.ultimo_contacto_en ? <span className="block">{hace(l.ultimo_contacto_en)}</span> : null}
                    </span>} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Dialogo>
  );
}
