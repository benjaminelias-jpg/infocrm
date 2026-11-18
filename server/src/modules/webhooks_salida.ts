import { createHmac } from 'node:crypto';
import { pool, query, queryOne } from '../db/pool.js';

// =====================================================================
// Webhooks de salida: el CRM avisa a otras apps cuando pasa algo.
// =====================================================================

export interface PayloadSalida {
  evento: string;
  ocurrido_en: string;
  cuenta_id: string;
  lead?: Record<string, unknown> | null;
  contenido?: Record<string, unknown> | null;
  oportunidad?: Record<string, unknown> | null;
  valor?: number | null;
  moneda?: string | null;
}

function firma(secreto: string, cuerpo: string): string {
  return createHmac('sha256', secreto).update(cuerpo).digest('hex');
}

/** Suscripciones activas de la cuenta que escuchan este tipo de evento. */
async function suscripcionesPara(cuentaId: string, tipoEvento: string) {
  return query(
    `SELECT * FROM suscripciones_webhook
      WHERE cuenta_id = $1 AND activo
        AND ($2 = ANY(eventos) OR '*' = ANY(eventos))`,
    [cuentaId, tipoEvento],
  );
}

/** Construye el payload completo del evento para enviarlo fuera. */
async function construirPayload(cuentaId: string, evento: any): Promise<PayloadSalida> {
  const [lead] = evento.lead_id
    ? await query(
        `SELECT id, nombre, apellido, ig_username, email, telefono, pais, etiquetas,
                estado, score, calificacion, grado, valor_total
           FROM leads WHERE id = $1`, [evento.lead_id])
    : [null];
  const [contenido] = evento.contenido_id
    ? await query(
        `SELECT id, titulo, tipo, permalink, angulo, etapa_embudo FROM contenidos WHERE id = $1`,
        [evento.contenido_id])
    : [null];
  const [oportunidad] = evento.oportunidad_id
    ? await query(
        `SELECT o.id, o.estado, o.valor, e.nombre AS etapa, e.slug AS etapa_slug
           FROM oportunidades o JOIN etapas e ON e.id = o.etapa_id WHERE o.id = $1`,
        [evento.oportunidad_id])
    : [null];

  return {
    evento: evento.tipo,
    ocurrido_en: (evento.ocurrido_en instanceof Date
      ? evento.ocurrido_en.toISOString()
      : new Date(evento.ocurrido_en).toISOString()),
    cuenta_id: cuentaId,
    lead: lead ?? null,
    contenido: contenido ?? null,
    oportunidad: oportunidad ?? null,
    valor: evento.valor ?? null,
    moneda: evento.moneda ?? null,
  };
}

async function entregar(
  suscripcion: any,
  payload: PayloadSalida,
  eventoId: number | null,
): Promise<void> {
  const cuerpo = JSON.stringify(payload);
  const cabeceras: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'InfoCRM-Webhooks/1.0',
    'x-infocrm-evento': payload.evento,
    'x-infocrm-firma': `sha256=${firma(suscripcion.secreto, cuerpo)}`,
    ...(suscripcion.cabeceras ?? {}),
  };

  const entrega = await queryOne(
    `INSERT INTO entregas_webhook (cuenta_id, suscripcion_id, evento_id, tipo_evento, url, payload)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING id`,
    [suscripcion.cuenta_id, suscripcion.id, eventoId, payload.evento, suscripcion.url, cuerpo],
  );

  // Hasta 3 intentos con backoff. Nada bloquea el evento original.
  let ultimoError: string | null = null;
  let status: number | null = null;
  let respuesta: string | null = null;

  for (let intento = 1; intento <= 3; intento++) {
    try {
      const res = await fetch(suscripcion.url, {
        method: 'POST',
        headers: cabeceras,
        body: cuerpo,
        signal: AbortSignal.timeout(8000),
      });
      status = res.status;
      respuesta = (await res.text().catch(() => '')).slice(0, 500);
      if (res.ok) {
        await pool.query(
          `UPDATE entregas_webhook SET estado='entregado', intentos=$2, http_status=$3,
                  respuesta=$4, entregado_en=now(), error=NULL WHERE id=$1`,
          [entrega!.id, intento, status, respuesta]);
        await pool.query(
          `UPDATE suscripciones_webhook SET total_enviados=total_enviados+1,
                  ultimo_envio_en=now(), ultimo_error=NULL WHERE id=$1`,
          [suscripcion.id]);
        return;
      }
      ultimoError = `HTTP ${status}: ${respuesta}`;
    } catch (err: any) {
      ultimoError = String(err?.message ?? err).slice(0, 300);
    }
    if (intento < 3) await new Promise((r) => setTimeout(r, intento * 500));
  }

  await pool.query(
    `UPDATE entregas_webhook SET estado='error', intentos=3, http_status=$2, error=$3 WHERE id=$1`,
    [entrega!.id, status, ultimoError]);
  await pool.query(
    `UPDATE suscripciones_webhook SET total_fallos=total_fallos+1, ultimo_error=$2 WHERE id=$1`,
    [suscripcion.id, ultimoError]);
}

/**
 * Despacha un evento a todas las suscripciones que lo escuchan. Se llama
 * tras registrar el evento; corre en segundo plano y nunca lanza hacia el
 * flujo principal (un receptor caído no debe tumbar el registro del evento).
 */
export async function despacharEvento(cuentaId: string, evento: any): Promise<void> {
  const subs = await suscripcionesPara(cuentaId, evento.tipo);
  if (subs.length === 0) return;
  const payload = await construirPayload(cuentaId, evento);
  await Promise.allSettled(subs.map((s) => entregar(s, payload, evento.id ?? null)));
}

/** Reintenta una entrega concreta que falló. */
export async function reintentarEntrega(cuentaId: string, entregaId: number) {
  const entrega = await queryOne(
    `SELECT * FROM entregas_webhook WHERE cuenta_id = $1 AND id = $2`, [cuentaId, entregaId]);
  if (!entrega) return null;
  const sub = await queryOne(
    `SELECT * FROM suscripciones_webhook WHERE id = $1`, [entrega.suscripcion_id]);
  if (!sub) return null;
  await entregar(sub, entrega.payload, entrega.evento_id);
  return queryOne(`SELECT * FROM entregas_webhook WHERE id = $1`, [entregaId]);
}

/** Envío de prueba con un payload de ejemplo (para validar la conexión). */
export async function probarSuscripcion(cuentaId: string, suscripcionId: string) {
  const sub = await queryOne(
    `SELECT * FROM suscripciones_webhook WHERE cuenta_id = $1 AND id = $2`,
    [cuentaId, suscripcionId]);
  if (!sub) return null;
  const payload: PayloadSalida = {
    evento: 'prueba',
    ocurrido_en: new Date().toISOString(),
    cuenta_id: cuentaId,
    lead: { nombre: 'Lead de prueba', ig_username: 'prueba', score: 72, calificacion: 'calificado' },
    contenido: { titulo: 'Reel de prueba', angulo: 'producto', etapa_embudo: 'BOFU' },
    valor: 1497, moneda: 'EUR',
  };
  await entregar(sub, payload, null);
  return queryOne(
    `SELECT * FROM entregas_webhook WHERE suscripcion_id = $1 ORDER BY creado_en DESC LIMIT 1`,
    [suscripcionId]);
}
