import { pool, query, queryOne } from '../db/pool.js';
import { registrarEvento } from './eventos.js';
import { integracionInstagram, credsUsables } from './instagram.js';
import { ejecutarFlujo, reanudarPorMensaje, coincidePalabra } from './instagram_dm.js';

// =====================================================================
// Disparadores de Instagram: traduce el webhook de Meta a eventos simples
// y decide qué hacer con cada uno:
//   1. guarda el mensaje en el Chat del setter (bandeja real),
//   2. si el lead tenía un flujo esperando su respuesta, lo reanuda,
//   3. si no, busca el flujo que corresponde a ese disparador y lo arranca.
// =====================================================================

export type TipoEventoIG =
  | 'comentario' | 'dm' | 'historia' | 'mencion' | 'reaccion' | 'boton' | 'anuncio' | 'eco';

export interface EventoIG {
  tipo: TipoEventoIG;
  /** IGSID del lead. En 'eco' es a quién le escribió la cuenta. */
  igUserId?: string;
  username?: string;
  texto?: string;
  payload?: string;
  mediaId?: string;
  commentId?: string;
  /** id del mensaje en Meta: evita duplicados si Meta reintenta. */
  mid?: string;
  ref?: string;
  adId?: string;
  emoji?: string;
  ocurridoEn?: Date;
  /** Prueba en vivo desde el CRM: lead concreto y sin llamar a Instagram. */
  leadId?: string;
  sinInstagram?: boolean;
}

function descAdjuntos(adj: any[] | undefined): string {
  const t = (adj ?? [])[0]?.type;
  if (!t) return '';
  return ({ audio: '🎙️ Audio', image: '🖼️ Imagen', video: '🎬 Video', file: '📄 Archivo',
    share: '🔗 Compartió una publicación', story_mention: '@ Te mencionó en su historia',
    ig_reel: '🎬 Compartió un reel', reel: '🎬 Compartió un reel' } as Record<string, string>)[t] ?? '📎 Adjunto';
}

/** Convierte el cuerpo del webhook de Meta en una lista de eventos. */
export function parsearWebhookInstagram(body: any): EventoIG[] {
  const out: EventoIG[] = [];
  for (const entry of body?.entry ?? []) {
    const cuentaIgId = entry?.id ? String(entry.id) : '';

    for (const ch of entry.changes ?? []) {
      const v = ch?.value ?? {};
      if (ch.field === 'comments' || ch.field === 'live_comments') {
        // Los comentarios de la propia cuenta (el founder respondiendo) no disparan nada.
        if (v.from?.id && String(v.from.id) === cuentaIgId) continue;
        out.push({
          tipo: 'comentario', igUserId: v.from?.id ? String(v.from.id) : undefined,
          username: v.from?.username, texto: v.text, mediaId: v.media?.id ? String(v.media.id) : undefined,
          commentId: v.id ? String(v.id) : undefined,
        });
      }
    }

    for (const m of [...(entry.messaging ?? []), ...(entry.standby ?? [])]) {
      const ocurridoEn = m?.timestamp ? new Date(Number(m.timestamp)) : undefined;
      const sender = m?.sender?.id ? String(m.sender.id) : undefined;
      const recipient = m?.recipient?.id ? String(m.recipient.id) : undefined;
      const msg = m?.message;

      if (msg?.is_echo) {
        if (msg.is_deleted) continue;
        out.push({ tipo: 'eco', igUserId: recipient, texto: msg.text ?? descAdjuntos(msg.attachments), mid: msg.mid, ocurridoEn });
        continue;
      }
      if (m?.reaction) {
        if (m.reaction.action === 'unreact') continue;
        out.push({
          tipo: 'reaccion', igUserId: sender, emoji: m.reaction.emoji ?? m.reaction.reaction,
          mid: m.reaction.mid ? `reac:${m.reaction.mid}:${sender}` : undefined, ocurridoEn,
        });
        continue;
      }
      if (m?.postback) {
        out.push({
          tipo: 'boton', igUserId: sender, texto: m.postback.title, payload: m.postback.payload,
          mid: m.postback.mid, ocurridoEn,
        });
        continue;
      }
      if (m?.referral && !msg) {
        out.push({ tipo: 'anuncio', igUserId: sender, ref: m.referral.ref, adId: m.referral.ad_id, ocurridoEn });
        continue;
      }
      if (msg) {
        if (msg.is_deleted || msg.is_unsupported) continue;
        const base = { igUserId: sender, texto: msg.text as string | undefined, mid: msg.mid as string | undefined, ocurridoEn };
        if (msg.quick_reply?.payload) {
          out.push({ ...base, tipo: 'boton', payload: msg.quick_reply.payload });
          continue;
        }
        if ((msg.attachments ?? []).some((a: any) => a?.type === 'story_mention')) {
          out.push({ ...base, tipo: 'mencion' });
          continue;
        }
        if (msg.reply_to?.story) {
          out.push({ ...base, tipo: 'historia', mediaId: msg.reply_to.story.id ? String(msg.reply_to.story.id) : undefined });
          continue;
        }
        if (msg.referral) {
          out.push({ ...base, tipo: 'anuncio', ref: msg.referral.ref, adId: msg.referral.ad_id });
          continue;
        }
        out.push({ ...base, tipo: 'dm', texto: msg.text ?? descAdjuntos(msg.attachments) });
      }
    }
  }
  return out;
}

const DESCRIPCION: Record<string, string> = {
  historia: '⭕ Respondió tu historia',
  mencion: '@ Te mencionó en su historia',
  reaccion: 'Reaccionó a un mensaje',
  boton: '👉 Tocó',
  anuncio: '📣 Escribió desde un anuncio',
};

const ORIGEN_TOQUE: Record<string, string> = {
  comentario: 'comentario', historia: 'historia', mencion: 'historia', anuncio: 'anuncio',
  dm: 'dm', boton: 'dm', reaccion: 'dm',
};

/** Pide a Meta el @usuario de un IGSID (best-effort, no frena nada). */
async function usernameDe(cuentaId: string, igsid: string): Promise<string | undefined> {
  try {
    const integ = await integracionInstagram(cuentaId);
    const { base, token } = credsUsables(integ?.credenciales ?? {});
    if (!token) return undefined;
    const r = await fetch(`${base}/${encodeURIComponent(igsid)}?fields=username,name&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(5000) });
    const d: any = await r.json().catch(() => ({}));
    return d?.username ?? undefined;
  } catch { return undefined; }
}

function textoDisparo(ev: EventoIG, tipoFlujo: string): string {
  if (tipoFlujo === ev.tipo) {
    if (ev.tipo === 'boton') return ev.payload ?? ev.texto ?? '';
    if (ev.tipo === 'anuncio') return [ev.ref, ev.texto].filter(Boolean).join(' ');
    if (ev.tipo === 'reaccion') return ev.emoji ?? '';
  }
  return ev.texto ?? '';
}

/**
 * Elige el flujo para un evento. Más específico gana: con contenido
 * concreto > con palabra clave > comodín. Una respuesta a historia, un
 * botón o un anuncio sin flujo propio caen a los flujos de DM.
 */
export async function elegirFlujo(cuentaId: string, ev: EventoIG) {
  const tipos: string[] = [ev.tipo];
  if (['historia', 'anuncio', 'boton', 'mencion'].includes(ev.tipo) && ev.texto) tipos.push('dm');
  for (const tipo of tipos) {
    const candidatos = await query(
      `SELECT f.*, c.ig_media_id FROM flujos f LEFT JOIN contenidos c ON c.id = f.contenido_id
        WHERE f.cuenta_id = $1 AND f.activo AND f.disparo = $2 ORDER BY f.creado_en ASC`,
      [cuentaId, tipo]);
    const texto = textoDisparo(ev, tipo);
    const validos = candidatos.filter((f: any) => {
      if (f.contenido_id && f.ig_media_id) {
        if (!ev.mediaId || String(f.ig_media_id) !== ev.mediaId) return false;
      }
      return coincidePalabra(texto, f.palabra_clave);
    });
    const puntaje = (f: any) => (f.contenido_id ? 2 : 0) + (String(f.palabra_clave ?? '').trim() ? 1 : 0);
    validos.sort((a: any, b: any) => puntaje(b) - puntaje(a));
    if (validos[0]) return validos[0];
  }
  // Nada coincidió con lo que escribió: la «respuesta por defecto» (máx. 1 vez cada 24 h por lead).
  if (['dm', 'historia', 'boton', 'anuncio', 'reaccion', 'mencion'].includes(ev.tipo)) {
    const def = await queryOne(
      `SELECT * FROM flujos WHERE cuenta_id = $1 AND activo AND disparo = 'por_defecto' ORDER BY creado_en ASC LIMIT 1`, [cuentaId]);
    if (def) return def;
  }
  return null;
}

/**
 * Procesa un evento de Instagram de punta a punta. Nunca lanza por un
 * flujo mal armado: lo peor que pasa es que no se dispare nada.
 */
export async function procesarEventoInstagram(cuentaId: string, ev: EventoIG): Promise<Record<string, unknown> | null> {
  // Mensaje que mandó la propia cuenta (desde el celular o por la API): al Chat.
  if (ev.tipo === 'eco') {
    if (!ev.igUserId) return null;
    const lead = await queryOne(`SELECT id FROM leads WHERE cuenta_id = $1 AND ig_user_id = $2`, [cuentaId, ev.igUserId]);
    if (!lead) return null;
    await pool.query(
      `INSERT INTO mensajes (cuenta_id, lead_id, direccion, canal, cuerpo, estado, externo_id, ocurrido_en)
       VALUES ($1,$2,'saliente','instagram_dm',$3,'enviado',$4,COALESCE($5, now()))
       ON CONFLICT DO NOTHING`,
      [cuentaId, lead.id, ev.texto ?? '', ev.mid ?? null, ev.ocurridoEn ?? null]);
    await pool.query(`UPDATE leads SET ultimo_mensaje_en = now() WHERE id = $1`, [lead.id]);
    return { eco: true, leadId: lead.id };
  }
  if (!ev.igUserId && !ev.leadId) return null;

  const palabra = ev.tipo === 'comentario' || ev.tipo === 'dm' ? ev.texto : ev.ref;

  // 1. Lead: lo crea si es nuevo (con atribución al contenido que lo trajo).
  let lead: any = ev.leadId
    ? await queryOne(`SELECT id, ig_user_id FROM leads WHERE cuenta_id = $1 AND id = $2`, [cuentaId, ev.leadId])
    : await queryOne(`SELECT id, ig_user_id FROM leads WHERE cuenta_id = $1 AND ig_user_id = $2`, [cuentaId, ev.igUserId]);
  if (ev.leadId && !lead) return null;
  if (!ev.leadId && (!lead || ev.tipo === 'comentario')) {
    const username = ev.username ?? (lead || !ev.igUserId ? undefined : await usernameDe(cuentaId, ev.igUserId));
    const clave = ev.commentId ? `ig:c:${ev.commentId}` : ev.mid ? `ig:m:${ev.mid}` : undefined;
    const res = await registrarEvento({
      cuentaId,
      tipo: lead ? 'comentario' : 'lead_creado',
      identidad: { igUserId: ev.igUserId, igUsername: username },
      senales: { igMediaId: ev.mediaId, palabraClave: palabra ?? undefined },
      fuente: 'instagram',
      origenToque: ORIGEN_TOQUE[ev.tipo] ?? 'otro',
      idempotencyKey: clave,
      payload: { disparo: ev.tipo, texto: ev.texto ?? null, ref: ev.ref ?? null, ad_id: ev.adId ?? null },
    });
    // Meta reintentó el mismo comentario: ya lo procesamos.
    if (res.duplicado && ev.tipo === 'comentario') return { duplicado: true, leadId: res.leadId };
    lead = { id: res.leadId, ig_user_id: ev.igUserId };
  }
  const igDestino = ev.igUserId ?? lead.ig_user_id ?? undefined;

  // 2. Al Chat del setter (todo menos comentarios, que viven en el reel).
  if (ev.tipo !== 'comentario') {
    const cuerpo = ev.tipo === 'dm'
      ? (ev.texto ?? '')
      : `${DESCRIPCION[ev.tipo] ?? ''}${ev.tipo === 'reaccion' && ev.emoji ? ` ${ev.emoji}` : ''}${ev.texto ? `: ${ev.texto}` : ''}`;
    const previo = await queryOne(
      `SELECT COUNT(*)::int AS n FROM mensajes WHERE lead_id = $1 AND direccion = 'entrante'`, [lead.id]);
    const ins = await queryOne(
      `INSERT INTO mensajes (cuenta_id, lead_id, direccion, canal, cuerpo, estado, externo_id, ocurrido_en)
       VALUES ($1,$2,'entrante','instagram_dm',$3,'recibido',$4,COALESCE($5, now()))
       ON CONFLICT DO NOTHING RETURNING id`,
      [cuentaId, lead.id, cuerpo, ev.mid ?? null, ev.ocurridoEn ?? null]);
    if (!ins && ev.mid) return { duplicado: true, leadId: lead.id };
    await pool.query(
      `UPDATE leads SET mensajes_sin_leer = mensajes_sin_leer + 1, ultimo_mensaje_en = now(),
              ultimo_contacto_en = now() WHERE id = $1`, [lead.id]);
    // Su primera respuesta por DM es un hito del embudo (puede moverlo a "En conversación").
    if (previo?.n === 0 && ['dm', 'boton', 'historia'].includes(ev.tipo)) {
      await registrarEvento({
        cuentaId, tipo: 'respondio_dm', leadId: lead.id, fuente: 'instagram',
        idempotencyKey: ev.mid ? `ig:r:${ev.mid}` : undefined,
      }).catch(() => {});
    }
  }

  // 2b. Alguien del equipo le está respondiendo a mano: los automensajes no se meten.
  const pausa = await queryOne(`SELECT automensajes_pausados_hasta > now() AS pausado FROM leads WHERE id = $1`, [lead.id]);
  if (pausa?.pausado && !ev.sinInstagram) return { leadId: lead.id, pausado: 'le está respondiendo una persona del equipo' };

  // 3. ¿Un flujo de este lead estaba esperando su respuesta? Se reanuda ahí.
  if (['dm', 'boton', 'historia', 'anuncio'].includes(ev.tipo)) {
    const consumido = await reanudarPorMensaje(cuentaId, lead.id, { texto: ev.texto, payload: ev.payload });
    if (consumido) return { leadId: lead.id, reanudado: true };
  }

  // 4. Si no, el flujo que corresponda a este disparador.
  const flujo = await elegirFlujo(cuentaId, ev);
  if (!flujo) return { leadId: lead.id, flujo: null };

  // Anti-spam: el mismo flujo no se repite con el mismo lead en 24 h
  // (en las pruebas en vivo no, para poder probar varias veces).
  if (!ev.sinInstagram) {
    const reciente = await queryOne(
      `SELECT 1 FROM flujo_ejecuciones
        WHERE flujo_id = $1 AND lead_id = $2 AND estado <> 'simulado'
          AND ejecutado_en > now() - interval '24 hours' LIMIT 1`, [flujo.id, lead.id]);
    if (reciente) return { leadId: lead.id, flujo: flujo.nombre, omitido: 'ya corrió con este lead en las últimas 24 h' };
  }

  const r = await ejecutarFlujo(cuentaId, flujo.id, {
    leadId: lead.id,
    destinatarioIgId: igDestino,
    commentId: ev.tipo === 'comentario' ? ev.commentId : undefined,
    texto: textoDisparo(ev, flujo.disparo),
    sinInstagram: ev.sinInstagram,
  });
  return { leadId: lead.id, flujo: flujo.nombre, estado: r?.estado ?? null };
}
