import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Boton, Entrada, Seleccion, useAviso } from '../../ui';

// Cuando llega un aviso de esta app (p. ej. Calendly: «agendó»), qué
// etiqueta se le pone al lead y cuál se le saca.

type Regla = { evento: string; poner?: string; quitar?: string };

const EVENTOS: Record<string, Array<{ v: string; t: string }>> = {
  agenda: [
    { v: 'reunion_agendada', t: 'Agenda una llamada' },
    { v: 'reunion_cancelada', t: 'Cancela la llamada' },
    { v: 'reunion_no_asistio', t: 'No se presenta' },
    { v: 'reunion_realizada', t: 'La llamada se hizo' },
  ],
  pagos: [{ v: 'venta', t: 'Compra' }, { v: 'reembolso', t: 'Pide reembolso' }],
  otros: [{ v: 'lead_creado', t: 'Llega un lead nuevo' }, { v: 'reunion_agendada', t: 'Agenda una llamada' }, { v: 'venta', t: 'Compra' }],
};

const POR_DEFECTO: Record<string, Regla[]> = {
  agenda: [{ evento: 'reunion_agendada', poner: 'Reunión agendada', quitar: 'Calendario enviado' }],
};

export default function EtiquetasPorAviso({ endpointId, tipo }: { endpointId: string; tipo: string }) {
  const aviso = useAviso();
  const eventos = EVENTOS[tipo] ?? EVENTOS.otros;
  const [reglas, setReglas] = useState<Regla[] | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [cambio, setCambio] = useState(false);

  useEffect(() => {
    api<{ reglas: Regla[] | null }>(`/ux/integraciones/fuente/${endpointId}/etiquetas`)
      .then((r) => setReglas(r.reglas ?? POR_DEFECTO[tipo] ?? []))
      .catch(() => setReglas(POR_DEFECTO[tipo] ?? []));
  }, [endpointId, tipo]);

  if (!reglas) return null;
  const set = (i: number, k: keyof Regla, v: string) => { setCambio(true); setReglas(reglas.map((r, j) => (j === i ? { ...r, [k]: v } : r))); };

  async function guardar() {
    setGuardando(true);
    try {
      const limpias = (reglas ?? []).filter((r) => r.evento && ((r.poner ?? '').trim() || (r.quitar ?? '').trim()));
      const r = await api<{ reglas: Regla[] }>(`/ux/integraciones/fuente/${endpointId}/etiquetas`, { method: 'PUT', json: { reglas: limpias } });
      setReglas(r.reglas); setCambio(false);
      aviso.exito('Listo: las etiquetas se ponen solas cuando llega el aviso.');
    } catch (e: any) {
      aviso.error(e?.message ?? 'No se pudo guardar.');
    } finally { setGuardando(false); }
  }

  return (
    <div className="space-y-2 rounded-[10px] border border-[var(--border)] p-3">
      <div>
        <div className="text-[13px] font-semibold">🏷️ Etiquetas automáticas</div>
        <p className="text-[12px] text-[var(--text-muted)]">Cuando llega el aviso, el lead cambia de etiqueta solo. Ej.: agenda → se saca «Calendario enviado» (rojo) y se pone «Reunión agendada» (verde).</p>
      </div>
      {reglas.map((r, i) => (
        <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1.2fr_1fr_1fr_auto] sm:items-center">
          <Seleccion value={r.evento} onChange={(e) => set(i, 'evento', e.target.value)} aria-label="Cuando">
            {eventos.map((e) => <option key={e.v} value={e.v}>Cuando: {e.t}</option>)}
          </Seleccion>
          <Entrada value={r.poner ?? ''} onChange={(e) => set(i, 'poner', e.target.value)} placeholder="Poner etiqueta" aria-label="Poner etiqueta" list="etiquetas-existentes" />
          <Entrada value={r.quitar ?? ''} onChange={(e) => set(i, 'quitar', e.target.value)} placeholder="Quitar etiqueta" aria-label="Quitar etiqueta" list="etiquetas-existentes" />
          <Boton tamano="sm" variante="fantasma" onClick={() => { setCambio(true); setReglas(reglas.filter((_, j) => j !== i)); }} aria-label="Borrar regla">✕</Boton>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Boton tamano="sm" variante="secundario" onClick={() => { setCambio(true); setReglas([...reglas, { evento: eventos[0].v, poner: '', quitar: '' }]); }}>+ Otra regla</Boton>
        <Boton tamano="sm" variante="primario" onClick={guardar} cargando={guardando} disabled={!cambio}>Guardar</Boton>
      </div>
    </div>
  );
}
