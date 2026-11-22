import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { Boton, useAviso } from '../../ui';

// Caja de nota fija al pie de la ficha, como la de un chat. Lo que escribís
// queda como borrador (por lead) aunque cierres la ficha, recargues o pases
// a otro lead: al volver, está ahí. Guardar: botón o Ctrl/Cmd+Enter.

const clave = (leadId: string) => `infocrm_nota_${leadId}`;

function leerBorrador(leadId: string) {
  try { return localStorage.getItem(clave(leadId)) ?? ''; } catch { return ''; }
}
function guardarBorrador(leadId: string, texto: string) {
  try {
    if (texto.trim()) localStorage.setItem(clave(leadId), texto);
    else localStorage.removeItem(clave(leadId));
  } catch { /* sin almacenamiento */ }
}

export default function CajaNota({ leadId, onGuardada }: { leadId: string; onGuardada: (nota: any) => void }) {
  const aviso = useAviso();
  const [texto, setTexto] = useState(() => leerBorrador(leadId));
  const [recuperado] = useState(() => Boolean(leerBorrador(leadId).trim()));
  const [guardando, setGuardando] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  // El borrador se guarda mientras escribís (con una pausa chiquita).
  useEffect(() => {
    const t = window.setTimeout(() => guardarBorrador(leadId, texto), 250);
    return () => window.clearTimeout(t);
  }, [leadId, texto]);
  // …y también al cerrar de golpe.
  const ultimo = useRef(texto);
  ultimo.current = texto;
  useEffect(() => () => guardarBorrador(leadId, ultimo.current), [leadId]);

  // Crece de 1 a 5 líneas.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [texto]);

  async function guardar() {
    const cuerpo = texto.trim();
    if (!cuerpo || guardando) return;
    setGuardando(true);
    try {
      const nota = await api(`/leads/${leadId}/notas`, { method: 'POST', json: { cuerpo } });
      setTexto('');
      guardarBorrador(leadId, '');
      onGuardada(nota);
      aviso.exito('Nota guardada');
    } catch (e: any) {
      aviso.error(e.message ?? 'No se pudo guardar la nota. Tu texto sigue acá.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); guardar(); }} className="px-3 py-2.5 md:px-4">
      {recuperado && texto.trim() && (
        <p className="mb-1 text-[11px] text-[var(--text-muted)]">Tenés una nota sin guardar.</p>
      )}
      <div className="flex items-end gap-2">
        <textarea ref={area} value={texto} onChange={(e) => setTexto(e.target.value)} rows={1}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); guardar(); } }}
          placeholder="Nota: qué pasó y qué sigue…" aria-label="Nota sobre este lead"
          className="ui-control min-h-[40px] w-full resize-none rounded-lg px-3 py-2 text-[16px] leading-snug md:min-h-[36px] md:text-[13px]" />
        <Boton type="submit" variante="primario" cargando={guardando} disabled={!texto.trim()} className="shrink-0">
          Guardar
        </Boton>
      </div>
    </form>
  );
}
