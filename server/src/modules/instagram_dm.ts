import { pool, query, queryOne } from '../db/pool.js';
import { integracionInstagram } from './instagram.js';
import { moverEtapa, oportunidadAbierta } from './pipeline.js';
import { registrarEvento } from './eventos.js';

const IG_GRAPH = 'https://graph.instagram.com';
const FB_GRAPH = 'https://graph.facebook.com/v21.0';

/**
 * Envía un DM. Según cómo se conectó la cuenta:
 *  - flujo Instagram Login: POST graph.instagram.com/{ig_user_id}/messages con el token de Instagram.
 *  - flujo Facebook (login unificado): POST graph.facebook.com/{page_id}/messages con el token de Página.
 * En producción Meta exige que la app esté aprobada para mensajería.
 * Devuelve ok:false con motivo si no se puede (no tumba el flujo).
 */
export async function enviarDM(
  cuentaId: string, destinatarioIgId: string, texto: string,
): Promise<{ ok: boolean; error?: string }> {
  const integ = await integracionInstagram(cuentaId);
  const cred = integ?.credenciales ?? {};

  // Conexión solo-lectura (sin token utilizable para mensajes).
  if (cred.tipo_login === 'facebook_lectura') {
    return { ok: false, error: 'Conexión solo-lectura: los DMs necesitan una página de Facebook vinculada a tu Instagram y la revisión de Meta.' };
  }

  // Endpoint y token según el flujo
  let url: string;
  let token: string;
  if (cred.tipo_login === 'facebook' || cred.page_token) {
    // Instagram API con Facebook login vía Página: mensaje por la Página.
    if (!cred.page_token || !cred.page_id) return { ok: false, error: 'Instagram no está conectado' };
    url = `${FB_GRAPH}/${cred.page_id}/messages`;
    token = cred.page_token;
  } else if (cred.tipo_login === 'facebook_directo') {
    // Instagram API con Facebook login sin Página: mensaje directo a la cuenta IG
    // con el token de usuario (lleva instagram_manage_messages).
    if (!cred.user_token || !cred.ig_user_id) return { ok: false, error: 'Instagram no está conectado' };
    url = `${FB_GRAPH}/${cred.ig_user_id}/messages`;
    token = cred.user_token;
  } else {
    // Instagram API con Instagram login: graph.instagram.com.
    if (!cred.access_token || !cred.ig_user_id) return { ok: false, error: 'Instagram no está conectado' };
    url = `${IG_GRAPH}/${cred.ig_user_id}/messages`;
    token = cred.access_token;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: destinatarioIgId },
        message: { text: texto },
        access_token: token,
      }),
      signal: AbortSignal.timeout(12000),
    });
    const d: any = await res.json().catch(() => ({}));
    if (!res.ok || d.error) {
      return { ok: false, error: d?.error?.message ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

export interface ContextoFlujo {
  leadId?: string;
  destinatarioIgId?: string;
  simular?: boolean;
}

/**
 * Ejecuta los pasos de un flujo sobre un lead. En modo simular no envía nada
 * real: registra qué haría, para poder ver el flujo funcionando sin esperar a
 * la aprobación de Meta.
 */
export async function ejecutarFlujo(cuentaId: string, flujoId: string, ctx: ContextoFlujo) {
  const flujo = await queryOne(`SELECT * FROM flujos WHERE cuenta_id=$1 AND id=$2`, [cuentaId, flujoId]);
  if (!flujo) return null;

  const pasos: any[] = flujo.pasos ?? [];
  const resultados: any[] = [];
  let huboEnvioPendiente = false;

  for (const paso of pasos) {
    try {
      switch (paso.tipo) {
        case 'enviar_dm':
        case 'entregar_recurso': {
          const texto = paso.texto ?? paso.recurso ?? '';
          if (ctx.simular || !ctx.destinatarioIgId) {
            resultados.push({ paso: paso.tipo, simulado: true, texto: String(texto).slice(0, 80) });
          } else {
            const r = await enviarDM(cuentaId, ctx.destinatarioIgId, texto);
            if (!r.ok) huboEnvioPendiente = true;
            resultados.push({ paso: paso.tipo, enviado: r.ok, error: r.error });
          }
          break;
        }
        case 'etiquetar': {
          if (ctx.leadId && paso.etiqueta) {
            await pool.query(
              `UPDATE leads SET etiquetas = (SELECT array_agg(DISTINCT x) FROM unnest(etiquetas || ARRAY[$2]) x)
               WHERE id=$1`, [ctx.leadId, paso.etiqueta]);
          }
          resultados.push({ paso: 'etiquetar', etiqueta: paso.etiqueta });
          break;
        }
        case 'mover_etapa': {
          if (ctx.leadId) {
            const opp = await oportunidadAbierta(cuentaId, ctx.leadId, pool);
            const [etapa] = await query(
              `SELECT id FROM etapas WHERE pipeline_id=$1 AND slug=$2 LIMIT 1`,
              [opp.pipeline_id, paso.etapa_slug]);
            if (etapa) await moverEtapa(cuentaId, opp.id, etapa.id, pool, { origen: 'regla' });
          }
          resultados.push({ paso: 'mover_etapa', etapa: paso.etapa_slug });
          break;
        }
        case 'esperar':
          // En serverless no se puede dormir; se registra como hito del flujo.
          resultados.push({ paso: 'esperar', minutos: paso.minutos ?? 0, nota: 'registrado' });
          break;
        default:
          resultados.push({ paso: paso.tipo, omitido: true });
      }
    } catch (err: any) {
      resultados.push({ paso: paso.tipo, error: String(err?.message ?? err) });
    }
  }

  // Una simulación no cuenta como disparo real (no infla las estadísticas).
  if (!ctx.simular) {
    await pool.query(
      `UPDATE flujos SET total_disparos = total_disparos + 1, ultimo_disparo_en = now() WHERE id=$1`,
      [flujoId]);
  }
  await pool.query(
    `INSERT INTO flujo_ejecuciones (cuenta_id, flujo_id, lead_id, estado, resultado)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [cuentaId, flujoId, ctx.leadId ?? null,
     ctx.simular ? 'simulado' : huboEnvioPendiente ? 'pendiente_envio' : 'ok',
     JSON.stringify(resultados)]);

  return { resultados, estado: ctx.simular ? 'simulado' : huboEnvioPendiente ? 'pendiente_envio' : 'ok' };
}

/**
 * Procesa un comentario entrante de Instagram: busca el flujo por palabra
 * clave, crea/resuelve el lead (con atribución) y ejecuta el flujo.
 */
export async function procesarComentarioInstagram(
  cuentaId: string,
  datos: { palabra?: string; igUserId?: string; username?: string; mediaId?: string },
) {
  const palabra = (datos.palabra ?? '').trim().toLowerCase();
  if (!palabra) return null;

  const flujo = await queryOne(
    `SELECT * FROM flujos WHERE cuenta_id=$1 AND activo AND lower(palabra_clave)=$2 ORDER BY creado_en ASC LIMIT 1`,
    [cuentaId, palabra]);
  if (!flujo) return null;

  // Crea el lead con atribución (reusa el motor de eventos)
  const res = await registrarEvento({
    cuentaId, tipo: 'lead_creado',
    identidad: { igUserId: datos.igUserId, igUsername: datos.username },
    senales: { igMediaId: datos.mediaId, palabraClave: datos.palabra },
    fuente: 'instagram', origenToque: 'comentario',
  });

  await ejecutarFlujo(cuentaId, flujo.id, {
    leadId: res.leadId,
    destinatarioIgId: datos.igUserId,
  });
  return { leadId: res.leadId, flujo: flujo.nombre };
}
