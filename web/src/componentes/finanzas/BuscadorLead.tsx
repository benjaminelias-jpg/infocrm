import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../../api';
import { BotonIcono, Buscador, Girando, IdentidadLead } from '../../ui';
import Icono from '../Iconos';

// Elegir a quién le vendiste buscando por nombre o @usuario. Busca en el
// servidor (nada de bajar cientos de leads) y sin texto muestra los leads
// con los que hablaste último. Se maneja con ↑ ↓ y Enter.

export interface LeadElegido { id: string; nombre?: string | null; ig_username?: string | null; avatar_url?: string | null }

export function BuscadorLead({ valor, onElegir, autoFocus, bloqueado }: {
  valor: LeadElegido | null; onElegir: (l: LeadElegido | null) => void; autoFocus?: boolean;
  /** El lead viene dado (desde el Pipeline o el Chat): se muestra y no se cambia. */
  bloqueado?: boolean;
}) {
  const [texto, setTexto] = useState('');
  const [res, setRes] = useState<LeadElegido[] | null>(null);
  /** Para qué texto son los resultados: si escribiste algo nuevo, los viejos no se muestran ni se eligen. */
  const [resPara, setResPara] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activo, setActivo] = useState(0);
  const [abierto, setAbierto] = useState(Boolean(autoFocus));
  const turno = useRef(0);
  const idLista = useId();

  useEffect(() => {
    if (valor || !abierto) return;
    const yo = ++turno.current;
    const t = window.setTimeout(async () => {
      setCargando(true);
      try {
        const r = await api<LeadElegido[]>(`/ux/finanzas/leads?limite=8${texto.trim() ? `&q=${encodeURIComponent(texto.trim())}` : ''}`);
        if (yo === turno.current) { setRes(r); setResPara(texto.trim()); setActivo(0); setError(null); }
      } catch (e: any) {
        if (yo === turno.current) setError(e.message);
      } finally {
        if (yo === turno.current) setCargando(false);
      }
    }, texto.trim() ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [texto, valor, abierto]);

  if (valor) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[var(--border-hairline)] py-1.5 pl-2.5 pr-1.5" style={{ background: 'var(--page-plane)' }}>
        <IdentidadLead id={valor.id} nombre={valor.nombre} usuario={valor.ig_username} foto={valor.avatar_url} className="flex-1" />
        {!bloqueado && (
          <BotonIcono etiqueta="Elegir otro lead" onClick={() => { onElegir(null); setTexto(''); setAbierto(true); }}>
            <Icono nombre="cerrar" tam={16} />
          </BotonIcono>
        )}
      </div>
    );
  }

  const vigentes = resPara === texto.trim() ? res : null;

  function tecla(e: React.KeyboardEvent) {
    if (e.key === 'Enter') e.preventDefault();
    const res = vigentes;
    if (!res?.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActivo((a) => Math.min(a + 1, res.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((a) => Math.max(a - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); onElegir(res[activo]); }
  }

  return (
    <div onKeyDown={tecla} onFocus={() => setAbierto(true)}>
      <Buscador valor={texto} onCambiar={setTexto} placeholder="Buscá por nombre o @usuario" autoFocus={autoFocus} />
      {abierto && (
        <div id={idLista} role="listbox" aria-label="Leads"
          className="mt-1.5 max-h-[232px] overflow-y-auto overscroll-contain rounded-lg border border-[var(--border-hairline)]"
          style={{ background: 'var(--surface-1)' }}>
          <div className="flex items-center justify-between px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            <span>{texto.trim() ? 'Resultados' : 'Hablaste hace poco'}</span>
            {(cargando || !vigentes) && !error && <Girando tam={12} />}
          </div>
          {error && <p className="px-3 pb-2.5 text-[12px]" style={{ color: 'var(--status-critical)' }}>{error}</p>}
          {vigentes?.map((l, i) => (
            <button key={l.id} type="button" role="option" aria-selected={i === activo}
              onMouseEnter={() => setActivo(i)} onClick={() => onElegir(l)}
              className={`ui-foco flex w-full items-center px-2.5 py-1.5 text-left ${i === activo ? 'bg-[var(--page-plane)]' : ''}`}>
              <IdentidadLead id={l.id} nombre={l.nombre} usuario={l.ig_username} foto={l.avatar_url} className="flex-1" />
            </button>
          ))}
          {vigentes && !vigentes.length && !cargando && !error && (
            <p className="px-3 pb-3 pt-1 text-[12px] text-[var(--text-muted)]">
              {texto.trim() ? <>Nadie con «{texto.trim()}». Probá con el @usuario de Instagram.</> : 'Todavía no tenés leads.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
