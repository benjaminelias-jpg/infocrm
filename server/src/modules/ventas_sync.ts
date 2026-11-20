import type { PoolClient } from 'pg';

/**
 * Ventas unificadas: cada evento "venta" tiene su fila en Finanzas (ventas +
 * su cobro) y cada venta cargada en Finanzas tiene su evento, unidos por
 * ventas.evento_id. Así el Panel y Finanzas cuentan exactamente lo mismo.
 *
 * Claves de idempotencia reservadas (las genera Finanzas):
 *   venta_<uuid de ventas>            → el evento solo se VINCULA a esa venta
 *   reembolso_venta_<uuid de ventas>  → la venta ya está marcada como devuelta
 */

const NOMBRE_FUENTE: Record<string, string> = {
  stripe: 'Stripe', hotmart: 'Hotmart', manychat: 'ManyChat', calendly: 'la agenda',
  instagram: 'Instagram', api: 'la API (o Claude)', regla: 'una regla', manual: 'el panel',
  generico: 'un webhook', seed: 'los datos de ejemplo',
};
const PASARELA: Record<string, string> = { stripe: 'Stripe', hotmart: 'Hotmart' };

const RE_VENTA = /^venta_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export async function sincronizarVentaDeEvento(c: PoolClient, d: {
  cuentaId: string; leadId: string; eventoId: number; valor?: number; moneda?: string;
  tipoPago?: 'completo' | 'cuotas'; pagoCompletado?: boolean; fuente?: string;
  idempotencyKey?: string; ocurridoEn: Date;
}) {
  // Viene de Finanzas: la venta ya existe, solo la unimos a su evento.
  const m = RE_VENTA.exec(d.idempotencyKey ?? '');
  if (m) {
    await c.query(
      `UPDATE ventas SET evento_id = $3 WHERE cuenta_id = $1 AND id = $2 AND evento_id IS NULL`,
      [d.cuentaId, m[1], d.eventoId]);
    return;
  }
  const { rows: cu } = await c.query(`SELECT moneda FROM cuentas WHERE id = $1`, [d.cuentaId]);
  const moneda = (d.moneda || cu[0]?.moneda || 'EUR').toUpperCase();
  const fuente = d.fuente ?? 'api';
  const pasarela = PASARELA[fuente] ?? null;
  const pagado = d.pagoCompletado !== false;
  const tipoCobro = d.tipoPago === 'cuotas' ? 'cuotas' : 'unico';
  const estado = !pagado ? 'activa' : tipoCobro === 'cuotas' ? 'en_cuotas' : 'completada';
  const valor = Number(d.valor ?? 0);
  const { rows } = await c.query(
    `INSERT INTO ventas (cuenta_id, lead_id, fecha, tipo_cobro, precio_acordado, moneda, num_cuotas,
                         pasarela, estado, notas, evento_id)
     VALUES ($1, $2, $3::timestamptz::date, $4, $5, $6, 1, $7, $8, $9, $10)
     ON CONFLICT (evento_id) WHERE evento_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [d.cuentaId, d.leadId, d.ocurridoEn, tipoCobro, valor, moneda, pasarela, estado,
     `Registrada sola: llegó por ${NOMBRE_FUENTE[fuente] ?? fuente}.`, d.eventoId]);
  if (!rows[0]) return;
  await c.query(
    `INSERT INTO pagos (cuenta_id, venta_id, num_cuota, monto, vence_en, cobrado_en, estado, pasarela)
     VALUES ($1, $2, 1, $3, $4::timestamptz::date, $5::timestamptz::date, $6, $7)`,
    [d.cuentaId, rows[0].id, valor, d.ocurridoEn, pagado ? d.ocurridoEn : null, pagado ? 'pagado' : 'pendiente', pasarela]);
}

/** Una devolución (evento "reembolso") marca la última venta del lead como devuelta. */
export async function sincronizarReembolsoDeEvento(c: PoolClient, d: {
  cuentaId: string; leadId: string; valor?: number; moneda?: string; idempotencyKey?: string; ocurridoEn: Date;
}) {
  if (/^reembolso_venta_/i.test(d.idempotencyKey ?? '')) return; // la marcó Finanzas
  const { rows } = await c.query(
    `SELECT id, precio_acordado FROM ventas
      WHERE cuenta_id = $1 AND lead_id = $2 AND estado NOT IN ('reembolsada', 'cancelada')
        AND fecha <= $3::timestamptz::date
      ORDER BY fecha DESC, creado_en DESC LIMIT 1`,
    [d.cuentaId, d.leadId, d.ocurridoEn]);
  const v = rows[0];
  if (!v) return;
  const total = d.valor === undefined || d.valor === null || Number(d.valor) >= Number(v.precio_acordado) * 0.99;
  if (total) {
    await c.query(`UPDATE ventas SET estado = 'reembolsada', actualizado_en = now() WHERE id = $1`, [v.id]);
    await c.query(`UPDATE pagos SET estado = 'reembolsado' WHERE venta_id = $1 AND estado = 'pagado'`, [v.id]);
  } else {
    await c.query(
      `UPDATE ventas SET notas = concat_ws(' · ', NULLIF(notas, ''), $2::text), actualizado_en = now() WHERE id = $1`,
      [v.id, `Devolución parcial de ${Number(d.valor).toFixed(2)} ${(d.moneda ?? '').toUpperCase()}`.trim()]);
  }
}
