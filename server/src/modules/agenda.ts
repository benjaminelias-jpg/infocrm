import { pool } from '../db/pool.js';

// Link de agenda enviado → etiqueta roja «Calendario enviado» hasta que agenda.

export const ETIQUETA_AGENDA = 'Calendario enviado';
/** Verde: agendó (llega por el webhook de Calendly/Cal.com…). */
export const ETIQUETA_REUNION = 'Reunión agendada';
const URL_AGENDA = /calendly\.com|(^|\/\/|\.)cal\.com\/|tidycal\.com|zcal\.co|savvycal\.com|calendar\.app\.google|calendar\.google\.com\/calendar\/appointments|meetings\.hubspot\.com|koalendar\.com|youcanbook\.me|acuityscheduling\.com|setmore\.com/i;

export function esLinkDeAgenda(r: { es_agenda?: boolean; url?: string | null; texto?: string | null }) {
  return Boolean(r.es_agenda) || URL_AGENDA.test(`${r.url ?? ''} ${r.texto ?? ''}`);
}

export async function marcarAgendaEnviada(cuentaId: string, leadId: string) {
  await pool.query(
    `UPDATE leads SET etiquetas = array_append(etiquetas, $3)
      WHERE cuenta_id = $1 AND id = $2 AND NOT ($3 = ANY(etiquetas))`, [cuentaId, leadId, ETIQUETA_AGENDA]);
}


/** Agendó: sale la roja «Calendario enviado» y entra la verde «Reunión agendada». */
export async function quitarAgendaEnviada(db: { query: (q: string, v: any[]) => Promise<any> }, leadId: string) {
  await db.query(
    `UPDATE leads SET etiquetas = array_append(array_remove(array_remove(etiquetas, $2), $3), $3) WHERE id = $1`,
    [leadId, ETIQUETA_AGENDA, ETIQUETA_REUNION]);
}
