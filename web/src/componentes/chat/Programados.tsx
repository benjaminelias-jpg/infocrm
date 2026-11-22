import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Boton, useAviso } from '../../ui';
import { alTerminarEnvio } from './envios';

// Lo que falta salir de una secuencia para este lead (ej. «Audio 2 en 1 min»),
// con un botón para cancelarlo. Se actualiza al mandar y cada 20 s.

type Pend = { id: string; enviar_en: string; nombre: string; secuencia: string | null };

function cuando(iso: string) {
  const s = Math.round((+new Date(iso) - Date.now()) / 1000);
  if (s <= 15) return 'ya sale';
  if (s < 90) return `en ${s} s`;
  if (s < 5400) return `en ${Math.round(s / 60)} min`;
  return `en ${Math.round(s / 3600)} h`;
}

export function Programados({ leadId }: { leadId: string }) {
  const aviso = useAviso();
  const [lista, setLista] = useState<Pend[]>([]);
  useEffect(() => {
    let vivo = true;
    const cargar = () => api<Pend[]>(`/chat/${leadId}/programados`).then((r) => { if (vivo) setLista(r); }).catch(() => {});
    cargar();
    const t = window.setInterval(cargar, 20_000);
    const quitar = alTerminarEnvio(() => { window.setTimeout(cargar, 600); });
    return () => { vivo = false; window.clearInterval(t); quitar(); };
  }, [leadId]);
  if (!lista.length) return null;
  async function cancelar() {
    try {
      await api(`/chat/${leadId}/programados/cancelar`, { method: 'POST' });
      setLista([]);
      aviso.exito('Listo: lo que faltaba de la secuencia ya no sale.');
    } catch (e: any) { aviso.error(e.message); }
  }
  return (
    <div className="flex items-center gap-2 border-t border-[var(--border-hairline)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)]" role="status">
      <span aria-hidden>🔁</span>
      <span className="min-w-0 flex-1 truncate">
        {lista[0].secuencia ? `${lista[0].secuencia}: ` : ''}quedan {lista.length} por salir · {lista.map((p) => `${p.nombre} (${cuando(p.enviar_en)})`).join(', ')}
      </span>
      <Boton tamano="xs" variante="fantasma" onClick={cancelar}>Cancelar</Boton>
    </div>
  );
}
