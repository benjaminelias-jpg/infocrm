import { pool, query, queryOne } from '../db/pool.js';
import { enviarMensajeIG, mensajeDeRecurso, registrarSaliente } from './instagram_dm.js';
import { esLinkDeAgenda, marcarAgendaEnviada } from './agenda.js';
export { ETIQUETA_AGENDA } from './agenda.js';

// Atajos que se mandan desde el Chat: un recurso suelto o una SECUENCIA
// (varios recursos con esperas entre cada uno). El primero sale al toque y
// el resto queda en envios_programados; se despachan cuando vencen (al usar
// el Chat, en cada aviso de Instagram y en el proceso periódico).
// Si lo enviado es un link de agenda, el lead queda con la etiqueta
// «Calendario enviado» (roja) hasta que agenda.

const CAMPOS = `id, nombre, tipo, texto, url, token, es_agenda, pasos, (datos IS NOT NULL) AS tiene_archivo`;

/** Manda UN recurso (no secuencia) a un lead: Instagram + Chat + etiqueta de agenda. */
export async function enviarRecursoSuelto(cuentaId: string, leadId: string, rec: any, usuarioId: string | null) {
  const lead = await queryOne(`SELECT id, ig_user_id FROM leads WHERE cuenta_id = $1 AND id = $2`, [cuentaId, leadId]);
  if (!lead) return null;
  const { mensaje, cuerpo } = mensajeDeRecurso(rec);
  const r = lead.ig_user_id
    ? await enviarMensajeIG(cuentaId, { igId: lead.ig_user_id }, mensaje)
    : { ok: false, error: 'Este lead no tiene Instagram vinculado (entró por otra vía)' };
  const msg = await registrarSaliente(cuentaId, leadId, cuerpo, rec.id, r as any, usuarioId);
  if (esLinkDeAgenda(rec)) await marcarAgendaEnviada(cuentaId, leadId);
  await pool.query(`UPDATE recursos SET veces_usado = veces_usado + 1 WHERE id = $1`, [rec.id]).catch(() => {});
  return { msg, r };
}

/**
 * Manda un atajo: si es secuencia, el primer paso sale ya y los demás se
 * programan sumando las esperas. Devuelve el primer mensaje y cuántos quedaron.
 */
export async function enviarAtajo(cuentaId: string, leadId: string, recursoId: string, usuarioId: string | null) {
  const rec = await queryOne(`SELECT ${CAMPOS} FROM recursos WHERE cuenta_id = $1 AND id = $2`, [cuentaId, recursoId]);
  if (!rec) return null;
  if (rec.tipo !== 'secuencia') {
    const r = await enviarRecursoSuelto(cuentaId, leadId, rec, usuarioId);
    return r ? { ...r, programados: 0 } : null;
  }
  const pasos: Array<{ recurso_id: string; espera_seg?: number }> = Array.isArray(rec.pasos) ? rec.pasos : [];
  if (!pasos.length) return null;
  const primero = await queryOne(`SELECT ${CAMPOS} FROM recursos WHERE cuenta_id = $1 AND id = $2`, [cuentaId, pasos[0].recurso_id]);
  const r = primero ? await enviarRecursoSuelto(cuentaId, leadId, primero, usuarioId) : null;
  let t = Date.now();
  for (const p of pasos.slice(1)) {
    t += Math.max(0, Number(p.espera_seg ?? 0)) * 1000;
    await pool.query(
      `INSERT INTO envios_programados (cuenta_id, lead_id, recurso_id, secuencia_id, enviar_en, enviado_por)
       VALUES ($1,$2,$3,$4,$5,$6)`, [cuentaId, leadId, p.recurso_id, rec.id, new Date(t), usuarioId]);
  }
  await pool.query(`UPDATE recursos SET veces_usado = veces_usado + 1 WHERE id = $1`, [rec.id]).catch(() => {});
  return r ? { ...r, programados: pasos.length - 1 } : null;
}

/** Despacha los envíos programados que ya vencieron. */
export async function procesarEnviosProgramados(cuentaId?: string, max = 20): Promise<number> {
  const filas = await query(
    `UPDATE envios_programados SET estado = 'enviado'
      WHERE id IN (SELECT id FROM envios_programados
                    WHERE estado = 'pendiente' AND enviar_en <= now() ${cuentaId ? 'AND cuenta_id = $2' : ''}
                    ORDER BY enviar_en LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING *`, cuentaId ? [max, cuentaId] : [max]);
  let n = 0;
  for (const f of filas.sort((a: any, b: any) => +new Date(a.enviar_en) - +new Date(b.enviar_en))) {
    try {
      const rec = await queryOne(`SELECT ${CAMPOS} FROM recursos WHERE cuenta_id = $1 AND id = $2`, [f.cuenta_id, f.recurso_id]);
      if (!rec) continue;
      await enviarRecursoSuelto(f.cuenta_id, f.lead_id, rec, f.enviado_por);
      n++;
    } catch (e: any) {
      await pool.query(`UPDATE envios_programados SET estado = 'error', error = $2 WHERE id = $1`, [f.id, String(e?.message ?? e)]);
    }
  }
  return n;
}

/** Lo que falta mandar de secuencias a un lead (para mostrarlo y poder cancelarlo). */
export async function pendientesDeLead(cuentaId: string, leadId: string) {
  return query(
    `SELECT ep.id, ep.enviar_en, r.nombre, s.nombre AS secuencia
       FROM envios_programados ep JOIN recursos r ON r.id = ep.recurso_id
       LEFT JOIN recursos s ON s.id = ep.secuencia_id
      WHERE ep.cuenta_id = $1 AND ep.lead_id = $2 AND ep.estado = 'pendiente' ORDER BY ep.enviar_en`, [cuentaId, leadId]);
}

export async function cancelarPendientes(cuentaId: string, leadId: string) {
  const r = await pool.query(
    `UPDATE envios_programados SET estado = 'cancelado' WHERE cuenta_id = $1 AND lead_id = $2 AND estado = 'pendiente'`,
    [cuentaId, leadId]);
  return r.rowCount ?? 0;
}
