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

/** Algo con .query (un cliente de una transacción o el pool). */
export type Consultable = { query: (texto: string, params?: any[]) => Promise<{ rows: any[] }> };

/** % de comisión del método de cobro que se llama como la pasarela (Stripe, Hotmart…). 0 si no hay. */
export async function comisionPctDe(db: Consultable, cuentaId: string, pasarela: string | null | undefined): Promise<number> {
  if (!pasarela) return 0;
  const { rows } = await db.query(
    `SELECT comision_pct FROM metodos_pago
      WHERE cuenta_id = $1 AND lower(nombre) = lower($2)
      ORDER BY activo DESC, creado_en ASC LIMIT 1`,
    [cuentaId, pasarela]);
  return Number(rows[0]?.comision_pct ?? 0) || 0;
}

/** Comisión de un cobro, redondeada a centavos. */
export const comisionDe = (monto: number, pct: number) => Math.round(Number(monto) * Number(pct)) / 100;

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
  // La pasarela también se lleva su parte: el % del método de cobro con su nombre.
  const pct = await comisionPctDe(c, d.cuentaId, pasarela);
  await c.query(
    `INSERT INTO pagos (cuenta_id, venta_id, num_cuota, monto, vence_en, cobrado_en, estado, pasarela, comision_pasarela)
     VALUES ($1, $2, 1, $3, $4::timestamptz::date, $5::timestamptz::date, $6, $7, $8)`,
    [d.cuentaId, rows[0].id, valor, d.ocurridoEn, pagado ? d.ocurridoEn : null, pagado ? 'pagado' : 'pendiente', pasarela,
     comisionDe(valor, pct)]);
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

// ---------------------------------------------------------------------
// Cuotas: cómo se reparte una venta y qué parte ya entró
// ---------------------------------------------------------------------

/** "YYYY-MM-DD" de hoy en una zona horaria (la de la cuenta). */
export function hoyEn(zona?: string | null): string {
  try {
    return new Date().toLocaleDateString('sv-SE', { timeZone: zona || 'Europe/Madrid' });
  } catch {
    return new Date().toLocaleDateString('sv-SE');
  }
}

/** Normaliza una fecha a "YYYY-MM-DD" (acepta también un ISO con hora). */
export function fechaISO(valor: string | null | undefined, porDefecto: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor ?? ''));
  if (!m) return porDefecto;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? porDefecto : d.toISOString().slice(0, 10);
}

export function sumarDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Suma meses sin saltar de mes (31 ene + 1 mes = 28/29 feb, no 3 mar). */
export function sumarMeses(iso: string, meses: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const ultimo = new Date(Date.UTC(y, m - 1 + meses + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + meses, Math.min(d, ultimo))).toISOString().slice(0, 10);
}

/** Reparte un total en n cuotas exactas: 497 en 3 → 165,67 + 165,67 + 165,66. */
export function repartir(total: number, n: number): number[] {
  const cuotas = Math.max(1, Math.floor(n));
  const centavos = Math.round(Number(total) * 100);
  const base = Math.floor(centavos / cuotas);
  const resto = centavos - base * cuotas;
  return Array.from({ length: cuotas }, (_, i) => (base + (i < resto ? 1 : 0)) / 100);
}

export type Cobrado = 'todo' | 'parte' | 'nada';
export interface CuotaPlan { num: number; monto: number; vence: string; estado: 'pagado' | 'pendiente'; cobrado_en: string | null }

/**
 * Las cuotas de una venta nueva y cuáles ya entraron.
 *  - Pago único: "todo" (cobrada), "nada" (queda por cobrar) o "parte"
 *    (seña: lo que pagó entra hoy y el resto queda por cobrar).
 *  - En cuotas: "parte" = ya pagó las primeras `cuotasCobradas` (1 por defecto).
 * La primera cuota pendiente vence en `venceProxima` (o en la fecha que le
 * toca) y las siguientes, un mes después de la anterior.
 */
export function planDeCuotas(o: {
  precio: number; tipoCobro: 'unico' | 'cuotas'; numCuotas?: number; fecha: string;
  cobrado?: Cobrado; cobradoMonto?: number; cuotasCobradas?: number; venceProxima?: string | null;
}): CuotaPlan[] {
  const precio = Math.round(Number(o.precio) * 100) / 100;
  const cobrado: Cobrado = o.cobrado ?? 'nada';
  if (o.tipoCobro !== 'cuotas') {
    const parte = Math.round(Math.min(Math.max(Number(o.cobradoMonto ?? 0), 0), precio) * 100) / 100;
    const modo: Cobrado = cobrado === 'parte' ? (parte <= 0 ? 'nada' : parte >= precio ? 'todo' : 'parte') : cobrado;
    if (modo === 'todo') return [{ num: 1, monto: precio, vence: o.fecha, estado: 'pagado', cobrado_en: o.fecha }];
    if (modo === 'nada') return [{ num: 1, monto: precio, vence: o.venceProxima || o.fecha, estado: 'pendiente', cobrado_en: null }];
    return [
      { num: 1, monto: parte, vence: o.fecha, estado: 'pagado', cobrado_en: o.fecha },
      { num: 2, monto: Math.round((precio - parte) * 100) / 100, vence: o.venceProxima || sumarMeses(o.fecha, 1), estado: 'pendiente', cobrado_en: null },
    ];
  }
  const n = Math.max(1, Math.floor(o.numCuotas ?? 1));
  const montos = repartir(precio, n);
  const k = cobrado === 'todo' ? n : cobrado === 'nada' ? 0 : Math.min(Math.max(Math.floor(o.cuotasCobradas ?? 1), 0), n);
  // Cada cuota se cuenta desde su ancla (no desde la anterior): 31 ene → 28 feb → 31 mar.
  return montos.map((monto, i) => (i < k
    ? { num: i + 1, monto, vence: sumarMeses(o.fecha, i), estado: 'pagado' as const, cobrado_en: o.fecha }
    : {
      num: i + 1, monto, estado: 'pendiente' as const, cobrado_en: null,
      vence: o.venceProxima ? sumarMeses(o.venceProxima, i - k) : sumarMeses(o.fecha, i),
    }));
}

/** Estado de la venta según sus cobros (las canceladas y devueltas no se tocan). */
export function estadoSegunCobros(tipoCobro: string, pagos: Array<{ estado: string }>): string {
  const vivos = pagos.filter((p) => p.estado !== 'reembolsado');
  const pagadas = vivos.filter((p) => p.estado === 'pagado').length;
  if (vivos.length > 0 && pagadas === vivos.length) return 'completada';
  if (tipoCobro === 'cuotas') return 'en_cuotas';
  return pagadas > 0 ? 'senado' : 'activa';
}

/** Recalcula el estado de una venta después de cobrar (o deshacer) una cuota. */
export async function recalcularEstadoVenta(db: Consultable, cuentaId: string, ventaId: string) {
  const { rows: vs } = await db.query(`SELECT estado, tipo_cobro FROM ventas WHERE cuenta_id = $1 AND id = $2`, [cuentaId, ventaId]);
  const v = vs[0];
  if (!v || ['cancelada', 'reembolsada'].includes(v.estado)) return;
  const { rows: pagos } = await db.query(`SELECT estado FROM pagos WHERE venta_id = $1`, [ventaId]);
  const nuevo = estadoSegunCobros(v.tipo_cobro, pagos);
  if (nuevo !== v.estado) await db.query(`UPDATE ventas SET estado = $3 WHERE cuenta_id = $1 AND id = $2`, [cuentaId, ventaId, nuevo]);
}
