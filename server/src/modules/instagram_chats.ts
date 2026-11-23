import { pool, queryOne } from '../db/pool.js';
import { credsUsables, integracionInstagram } from './instagram.js';
import { registrarEvento } from './eventos.js';

// Trae el historial de DMs de Instagram al Chat del CRM: cada conversación
// pasa a ser un lead (si no existía) con sus mensajes. Es idempotente: los
// mensajes llevan el id de Meta, así que importar dos veces no duplica nada.
// Meta solo lo devuelve si en la app de Instagram está activado
// «Permitir acceso a los mensajes» (Configuración → Privacidad → Mensajes).

export interface ResultadoChats { ok: boolean; conversaciones: number; mensajes: number; leadsNuevos: number; mensaje: string }

export async function importarConversaciones(cuentaId: string, opts: { limite?: number } = {}): Promise<ResultadoChats> {
  const integ = await integracionInstagram(cuentaId);
  const { base, token, igId } = credsUsables(integ?.credenciales ?? {});
  if (!integ || !token || !igId) return { ok: false, conversaciones: 0, mensajes: 0, leadsNuevos: 0, mensaje: 'Instagram no está conectado.' };

  // Meta corta con "reduce the amount of data" si pedimos mucho: páginas chicas y, si igual se queja, más chicas.
  let porPagina = 10, porConv = 20;
  const armar = () => `${base}/${igId}/conversations?platform=instagram&fields=${encodeURIComponent(`participants,updated_time,messages.limit(${porConv}){id,message,from,created_time}`)}&limit=${porPagina}&access_token=${encodeURIComponent(token)}`;
  let url: string | null = armar();
  let conversaciones = 0, mensajes = 0, leadsNuevos = 0, paginas = 0;
  while (url && paginas < Math.ceil((opts.limite ?? 100) / 10) + 3) {
    paginas++;
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const d: any = await r.json().catch(() => ({}));
    if ((!r.ok || d.error) && /reduce the amount of data/i.test(d?.error?.message ?? '') && porPagina > 2) {
      porPagina = Math.max(2, Math.floor(porPagina / 2)); porConv = Math.max(5, Math.floor(porConv / 2));
      url = armar();
      continue;
    }
    if (!r.ok || d.error) {
      return { ok: false, conversaciones, mensajes, leadsNuevos, mensaje: `Instagram no devolvió tus chats: ${d?.error?.message ?? `HTTP ${r.status}`}` };
    }
    for (const c of d.data ?? []) {
      const otro = (c.participants?.data ?? []).find((p: any) => String(p.id) !== String(igId));
      if (!otro?.id) continue;
      conversaciones++;
      let lead: any = await queryOne(`SELECT id FROM leads WHERE cuenta_id = $1 AND ig_user_id = $2`, [cuentaId, String(otro.id)]);
      const existia = Boolean(lead);
      if (!lead) {
        const msgs = c.messages?.data ?? [];
        const primero = msgs.length ? new Date(msgs[msgs.length - 1].created_time) : new Date(c.updated_time ?? Date.now());
        const res = await registrarEvento({
          cuentaId, tipo: 'lead_creado', fuente: 'instagram', origenToque: 'dm', sinReglas: true,
          identidad: { igUserId: String(otro.id), igUsername: otro.username ?? undefined },
          ocurridoEn: primero, idempotencyKey: `ig:conv:${c.id}`,
        });
        lead = { id: res.leadId };
        if (!res.duplicado) leadsNuevos++;
      }
      let ultimo: Date | null = null; let entrantes = 0;
      for (const m of c.messages?.data ?? []) {
        const entrante = String(m.from?.id) !== String(igId);
        const cuando = new Date(m.created_time);
        const ins = await queryOne(
          `INSERT INTO mensajes (cuenta_id, lead_id, direccion, canal, cuerpo, estado, externo_id, ocurrido_en)
           VALUES ($1,$2,$3,'instagram_dm',$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,
          [cuentaId, lead.id, entrante ? 'entrante' : 'saliente', m.message ?? '', entrante ? 'recibido' : 'enviado', m.id, cuando]);
        if (ins) { mensajes++; if (entrante) entrantes++; }
        if (!ultimo || cuando > ultimo) ultimo = cuando;
      }
      if (ultimo) {
        await pool.query(
          `UPDATE leads SET ultimo_mensaje_en = GREATEST(COALESCE(ultimo_mensaje_en, $2), $2),
                  ultimo_contacto_en = GREATEST(COALESCE(ultimo_contacto_en, $2), $2) WHERE id = $1`, [lead.id, ultimo]);
      }
      // Mensajes nuevos de alguien que ya estaba: cuentan como sin leer.
      if (existia && entrantes > 0) {
        await pool.query(`UPDATE leads SET mensajes_sin_leer = mensajes_sin_leer + $2 WHERE id = $1`, [lead.id, entrantes]);
      }
      if (entrantes > 0) {
        await registrarEvento({ cuentaId, tipo: 'respondio_dm', leadId: lead.id, fuente: 'instagram', sinReglas: true, idempotencyKey: `ig:conv:r:${c.id}` }).catch(() => {});
      }
    }
    url = d.paging?.next ?? null;
  }
  return {
    ok: true, conversaciones, mensajes, leadsNuevos,
    mensaje: conversaciones
      ? `Trajimos ${conversaciones} conversaciones de Instagram (${mensajes} mensajes nuevos).`
      : 'Instagram no devolvió conversaciones. Revisá que en la app de Instagram esté activado «Permitir acceso a los mensajes».',
  };
}

// El Chat abierto pide novedades seguido; a Meta se le consulta como mucho
// cada 40 s por cuenta (los avisos al instante necesitan pages_messaging).
const ultimaVez = new Map<string, number>();
export async function importarSiToca(cuentaId: string): Promise<ResultadoChats | { ok: true; omitido: true }> {
  const ahora = Date.now();
  if (ahora - (ultimaVez.get(cuentaId) ?? 0) < 40_000) return { ok: true, omitido: true };
  ultimaVez.set(cuentaId, ahora);
  return importarConversaciones(cuentaId, { limite: 50 });
}
