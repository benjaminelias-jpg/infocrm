import { useState } from 'react';
import { API_BASE, api, token } from '../../api';
import { useAviso } from '../../ui';
import { DialogoPerdido, DialogoVenta } from '../pipeline/Dialogos';
import { resumirAcciones, tieneExternas } from '../pipeline/acciones';
import { avisarLeadCambiado } from './listaFicha';
import type { Etapa } from './contexto';

// Mover de etapa y asignar, igual desde la ficha que desde la lista (y con
// las mismas reglas que el tablero):
//  - si la etapa le manda algo al lead (DM, audio, email…), espera 5 s con
//    "Deshacer" antes de mandarlo;
//  - si es de venta, abre el formulario de venta; si es de perdido, pregunta por qué;
//  - todo lo demás se hace ya, con "Deshacer" (vuelve sin repetir automatizaciones).

export interface LeadAccion {
  lead_id: string; oportunidad_id: string | null; etapa_id: string | null;
  nombre?: string | null; ig_username?: string | null; avatar_url?: string | null; valor?: number | null;
}

const ESPERA_MS = 5000;
const pendientes = new Map<string, { timer: number; leadId: string; etapaId: string }>();

async function enviar(oppId: string, etapaId: string, leadId: string, sinAcciones = false) {
  pendientes.delete(oppId);
  await api(`/oportunidades/${oppId}/etapa`, { method: 'POST', json: { etapa_id: etapaId, ...(sinAcciones ? { sin_acciones: true } : {}) } });
  avisarLeadCambiado(leadId);
}

if (typeof window !== 'undefined') {
  // Si se cierra la pestaña con un movimiento esperando, se manda igual.
  window.addEventListener('pagehide', () => {
    for (const [opp, p] of pendientes) {
      window.clearTimeout(p.timer);
      fetch(`${API_BASE}/api/oportunidades/${opp}/etapa`, {
        method: 'POST', keepalive: true,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token() ?? ''}` },
        body: JSON.stringify({ etapa_id: p.etapaId }),
      }).catch(() => {});
    }
    pendientes.clear();
  });
}

export const quienEs = (l: { ig_username?: string | null; nombre?: string | null } | null | undefined) =>
  (l?.ig_username ? `@${l.ig_username}` : (l?.nombre || 'El lead'));

export function useAccionesLead() {
  const aviso = useAviso();
  const [dialogo, setDialogo] = useState<null | { tipo: 'venta' | 'perdido'; lead: LeadAccion; etapa: Etapa }>(null);

  /** `alMover` actualiza la pantalla al instante (antes de que responda el servidor). */
  function mover(l: LeadAccion, destino: Etapa, alMover?: (e: Etapa) => void) {
    const oppId = l.oportunidad_id;
    if (!oppId || destino.id === l.etapa_id) return;
    if (destino.tipo === 'ganada') { setDialogo({ tipo: 'venta', lead: l, etapa: destino }); return; }
    if (destino.tipo === 'perdida') { setDialogo({ tipo: 'perdido', lead: l, etapa: destino }); return; }
    const quien = quienEs(l);
    const desde = l.etapa_id;
    const resumen = resumirAcciones(destino);
    alMover?.(destino);

    if (tieneExternas(destino)) {
      const previo = pendientes.get(oppId);
      if (previo) window.clearTimeout(previo.timer);
      const timer = window.setTimeout(() => {
        enviar(oppId, destino.id, l.lead_id).catch((e) => { aviso.error(e.message); avisarLeadCambiado(l.lead_id); });
      }, ESPERA_MS);
      pendientes.set(oppId, { timer, leadId: l.lead_id, etapaId: destino.id });
      aviso.info(<>{quien} → «{destino.nombre}». En 5 s {resumen}.</>, {
        texto: 'Deshacer',
        onClick: () => {
          const p = pendientes.get(oppId);
          if (p) { window.clearTimeout(p.timer); pendientes.delete(oppId); }
          avisarLeadCambiado(l.lead_id);
        },
      });
      return;
    }
    enviar(oppId, destino.id, l.lead_id)
      .then(() => {
        aviso.exito(<>{quien} → «{destino.nombre}»{resumen ? <> · {resumen}</> : null}</>, desde ? {
          texto: 'Deshacer',
          onClick: () => { enviar(oppId, desde, l.lead_id, true).catch((e) => aviso.error(e.message)); },
        } : undefined);
      })
      .catch((e) => { aviso.error(e.message ?? 'No se pudo mover'); avisarLeadCambiado(l.lead_id); });
  }

  /** Quién lo atiende (null = sin asignar). Con "Deshacer". */
  async function asignar(l: LeadAccion, usuario: { id: string; nombre: string } | null, previo: string | null, deshaciendo = false) {
    const quien = quienEs(l);
    try {
      if (l.oportunidad_id) await api('/ux/pipeline/asignar', { method: 'POST', json: { oportunidad_id: l.oportunidad_id, usuario_id: usuario?.id ?? null } });
      else await api(`/leads/${l.lead_id}`, { method: 'PATCH', json: { propietario_id: usuario?.id ?? null } });
      avisarLeadCambiado(l.lead_id);
      if (!deshaciendo) {
        aviso.exito(usuario ? `${quien}: ahora lo atiende ${usuario.nombre}.` : `${quien} quedó sin asignar.`, {
          texto: 'Deshacer', onClick: () => { asignar(l, previo ? { id: previo, nombre: '' } : null, null, true); },
        });
      }
    } catch (e: any) {
      aviso.error(e.message);
      avisarLeadCambiado(l.lead_id);
    }
  }

  const dialogos = (
    <>
      {dialogo?.tipo === 'venta' && (
        <DialogoVenta etapa={dialogo.etapa} onCerrar={() => setDialogo(null)}
          tarjeta={{ ...dialogo.lead, valor: dialogo.lead.valor ?? 0 }}
          onListo={async (_r, texto) => { setDialogo(null); aviso.exito(texto); avisarLeadCambiado(dialogo.lead.lead_id); }} />
      )}
      {dialogo?.tipo === 'perdido' && (
        <DialogoPerdido etapa={dialogo.etapa} onCerrar={() => setDialogo(null)} tarjeta={dialogo.lead}
          onListo={async (texto) => { setDialogo(null); aviso.exito(texto); avisarLeadCambiado(dialogo.lead.lead_id); }} />
      )}
    </>
  );

  return { mover, asignar, dialogos };
}
