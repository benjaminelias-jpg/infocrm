import { pool, query, queryOne } from '../db/pool.js';
import { integracionInstagram } from './instagram.js';
import { moverEtapa, oportunidadAbierta } from './pipeline.js';
import { registrarEvento } from './eventos.js';

const GRAPH = 'https://graph.instagram.com';

/**
 * Envía un DM por la Instagram Graph API. Requiere el token conectado y, en
 * producción, que Meta haya aprobado instagram_business_manage_messages.
 * Devuelve ok:false con motivo si no se puede (no tumba el flujo).
 */
export async function enviarDM(
  cuentaId: string, destinatarioIgId: string, texto: string,
): Promise<{ ok: boolean; error?: string }> {
  const integ = await integracionInstagram(cuentaId);
  const cred = integ?.credenciales ?? {};
  if (!cred.access_token || !cred.ig_user_id) {
    return { ok: false, error: 'Instagram no está conectado' };
  }
  try {
    const res = await fetch(`${GRAPH}/${cred.ig_user_id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: destinatarioIgId },
        message: { text: texto },
        access_token: cred.access_token,
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

  await pool.query(
    `UPDATE flujos SET total_disparos = total_disparos + 1, ultimo_disparo_en = now() WHERE id=$1`,
    [flujoId]);
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
