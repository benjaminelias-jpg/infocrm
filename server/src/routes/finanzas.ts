import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne, pool } from '../db/pool.js';
import { noEncontrado, peticionInvalida } from '../lib/errores.js';
import { cargarDemo } from '../modules/demo.js';
import { registrarEvento } from '../modules/eventos.js';
import type { FastifyRequest } from 'fastify';

/** Deja solo las claves permitidas y definidas (whitelist → SQL seguro). */
function pick(body: any, cols: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const c of cols) if (body && body[c] !== undefined) out[c] = body[c] === '' ? null : body[c];
  return out;
}

interface Ganchos {
  despuesDeCrear?: (req: FastifyRequest, fila: any) => Promise<void>;
  despuesDeEditar?: (req: FastifyRequest, antes: any, fila: any) => Promise<void>;
  antesDeBorrar?: (req: FastifyRequest, fila: any) => Promise<void>;
}

/** CRUD genérico multi-tenant para una tabla con lista de columnas editables. */
function crud(app: FastifyInstance, ruta: string, tabla: string, cols: string[], orden = 'creado_en DESC', ganchos: Ganchos = {}) {
  app.get(ruta, async (req) =>
    query(`SELECT * FROM ${tabla} WHERE cuenta_id = $1 ORDER BY ${orden}`, [req.sesion.cuentaId]));

  app.post(ruta, async (req, reply) => {
    const d = pick(req.body, cols);
    const keys = Object.keys(d);
    if (keys.length === 0) throw peticionInvalida('Faltan datos');
    const ph = keys.map((_, i) => `$${i + 2}`);
    const fila = await queryOne(
      `INSERT INTO ${tabla} (cuenta_id, ${keys.join(', ')}) VALUES ($1, ${ph.join(', ')}) RETURNING *`,
      [req.sesion.cuentaId, ...keys.map((k) => d[k])]);
    if (ganchos.despuesDeCrear) await ganchos.despuesDeCrear(req, fila);
    return reply.code(201).send(fila);
  });

  app.patch(`${ruta}/:id`, async (req) => {
    const { id } = req.params as { id: string };
    const d = pick(req.body, cols);
    const keys = Object.keys(d);
    if (keys.length === 0) throw peticionInvalida('Nada que actualizar');
    const sets = keys.map((k, i) => `${k} = $${i + 3}`);
    const antes = ganchos.despuesDeEditar
      ? await queryOne(`SELECT * FROM ${tabla} WHERE cuenta_id = $1 AND id = $2`, [req.sesion.cuentaId, id])
      : null;
    const fila = await queryOne(
      `UPDATE ${tabla} SET ${sets.join(', ')} WHERE cuenta_id = $1 AND id = $2 RETURNING *`,
      [req.sesion.cuentaId, id, ...keys.map((k) => d[k])]);
    if (!fila) throw noEncontrado(tabla);
    if (ganchos.despuesDeEditar) await ganchos.despuesDeEditar(req, antes, fila);
    return fila;
  });

  app.delete(`${ruta}/:id`, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (ganchos.antesDeBorrar) {
      const fila = await queryOne(`SELECT * FROM ${tabla} WHERE cuenta_id = $1 AND id = $2`, [req.sesion.cuentaId, id]);
      if (fila) await ganchos.antesDeBorrar(req, fila);
    }
    await queryOne(`DELETE FROM ${tabla} WHERE cuenta_id = $1 AND id = $2 RETURNING id`,
      [req.sesion.cuentaId, id]);
    return reply.code(204).send();
  });
}

// --- Ventas unificadas con el Panel (ver modules/ventas_sync.ts) ---------

/** Una venta cargada en Finanzas genera su evento "venta" (lo que cuenta el Panel). */
async function eventoDeVenta(cuentaId: string, v: any) {
  if (!v?.lead_id || v.evento_id) return;
  const prod = v.producto_id
    ? await queryOne(`SELECT nombre FROM productos WHERE cuenta_id = $1 AND id = $2`, [cuentaId, v.producto_id])
    : null;
  await registrarEvento({
    cuentaId, tipo: 'venta', leadId: v.lead_id, valor: Number(v.precio_acordado ?? 0), moneda: v.moneda ?? undefined,
    titulo: prod?.nombre ?? undefined, tipoPago: v.tipo_cobro === 'cuotas' ? 'cuotas' : 'completo',
    fuente: 'manual',
    ocurridoEn: v.fecha ? new Date(`${new Date(v.fecha).toISOString().slice(0, 10)}T12:00:00Z`) : new Date(),
    idempotencyKey: `venta_${v.id}`, payload: { venta_id: v.id, origen: 'finanzas' },
  });
}

const GANCHOS_VENTA: Ganchos = {
  despuesDeCrear: async (req, fila) => { await eventoDeVenta(req.sesion.cuentaId, fila); },
  despuesDeEditar: async (req, antes, fila) => {
    // Marcada como devuelta en Finanzas → devolución en el Panel.
    if (fila.estado === 'reembolsada' && antes?.estado !== 'reembolsada') {
      await pool.query(`UPDATE pagos SET estado = 'reembolsado' WHERE cuenta_id = $1 AND venta_id = $2 AND estado = 'pagado'`,
        [req.sesion.cuentaId, fila.id]);
    }
    if (fila.estado === 'reembolsada' && antes?.estado !== 'reembolsada' && fila.lead_id) {
      await registrarEvento({
        cuentaId: req.sesion.cuentaId, tipo: 'reembolso', leadId: fila.lead_id,
        valor: Number(fila.precio_acordado ?? 0), moneda: fila.moneda ?? undefined, fuente: 'manual',
        idempotencyKey: `reembolso_venta_${fila.id}`, payload: { venta_id: fila.id, origen: 'finanzas' },
      });
    }
    // Cancelada (la venta se cayó): deja de contar en el Panel, igual que si se borrara.
    if (fila.estado === 'cancelada' && antes?.estado !== 'cancelada') {
      await quitarEventoDeVenta(req.sesion.cuentaId, fila);
      return;
    }
    // Se le asignó un lead después (o se reactivó): ahora sí cuenta en el Panel.
    if (fila.lead_id && !fila.evento_id && !['cancelada', 'reembolsada'].includes(fila.estado)) {
      await eventoDeVenta(req.sesion.cuentaId, fila);
    }
  },
  // Borrar una venta (p. ej. cargada por error) la saca también del Panel.
  antesDeBorrar: async (req, fila) => { await quitarEventoDeVenta(req.sesion.cuentaId, fila); },
};

/** Saca del Panel el evento "venta" de una venta de Finanzas (y descuenta el valor del lead). */
async function quitarEventoDeVenta(cuentaId: string, fila: any) {
  if (!fila?.evento_id) return;
  const ev = await queryOne(
    `DELETE FROM eventos WHERE cuenta_id = $1 AND id = $2 AND tipo = 'venta' RETURNING lead_id, valor`,
    [cuentaId, fila.evento_id]);
  if (ev?.lead_id) {
    await pool.query(
      `UPDATE leads SET valor_total = GREATEST(valor_total - $2, 0) WHERE cuenta_id = $1 AND id = $3`,
      [cuentaId, Number(ev.valor ?? 0), ev.lead_id]);
  }
}

export default async function rutasFinanzas(app: FastifyInstance) {
  // Cargar datos de demostración en la cuenta actual (para ver el CRM "con vida").
  app.post('/demo/cargar', async (req) => {
    const n = Number((req.query as any)?.leads ?? 14);
    return cargarDemo(req.sesion.cuentaId, Math.min(Math.max(n, 1), 22));
  });

  crud(app, '/productos', 'productos',
    ['nombre', 'descripcion', 'precio_lista', 'moneda', 'duracion', 'activo', 'link_pago'], 'nombre');
  crud(app, '/equipo', 'personas_equipo',
    ['nombre', 'email', 'telefono', 'rol', 'comision_venta_pct', 'comision_cobro_pct',
     'comision_cita_pct', 'contrato_url', 'activo', 'notas'], 'nombre');
  crud(app, '/metodos-pago', 'metodos_pago',
    ['nombre', 'tipo', 'descripcion', 'region', 'comision_pct', 'activo'], 'nombre');
  crud(app, '/gastos', 'gastos',
    ['fecha', 'descripcion', 'categoria', 'subcategoria', 'centro_coste', 'tipo', 'periodicidad',
     'importe', 'moneda', 'metodo', 'venta_id', 'pago_id', 'contenido_id',
     'es_comision_ventas', 'es_comision_pasarela', 'notas'], 'fecha DESC');
  crud(app, '/pagos', 'pagos',
    ['venta_id', 'num_cuota', 'monto', 'vence_en', 'cobrado_en', 'estado', 'pasarela',
     'comision_pasarela', 'notas'], 'vence_en NULLS LAST');

  // --- Llamadas (con nombres de lead/closer/setter) ---
  const COLS_LLAMADA = ['lead_id', 'setter_id', 'closer_id', 'producto_id', 'programado_en', 'tipo',
    'estado', 'resultado', 'valor_propuesto', 'link_reunion', 'link_grabacion', 'feedback', 'notas'];
  crud(app, '/llamadas', 'llamadas', COLS_LLAMADA, 'programado_en DESC NULLS LAST');
  app.get('/llamadas/agenda', async (req) =>
    query(
      `SELECT ll.*, l.nombre AS lead_nombre, l.ig_username,
              s.nombre AS setter_nombre, c.nombre AS closer_nombre, p.nombre AS producto
         FROM llamadas ll
         LEFT JOIN leads l ON l.id = ll.lead_id
         LEFT JOIN personas_equipo s ON s.id = ll.setter_id
         LEFT JOIN personas_equipo c ON c.id = ll.closer_id
         LEFT JOIN productos p ON p.id = ll.producto_id
        WHERE ll.cuenta_id = $1 ORDER BY ll.programado_en DESC NULLS LAST LIMIT 200`,
      [req.sesion.cuentaId]));

  // --- Ventas (con comisiones y neto calculados) ---
  const COLS_VENTA = ['lead_id', 'llamada_id', 'producto_id', 'setter_id', 'closer_id', 'fecha',
    'tipo_cobro', 'precio_lista', 'precio_acordado', 'moneda', 'num_cuotas', 'duracion', 'pasarela',
    'estado', 'comision_setter_pct', 'comision_closer_pct', 'notas'];
  crud(app, '/ventas', 'ventas', COLS_VENTA, 'fecha DESC', GANCHOS_VENTA);
  app.get('/ventas/detalle', async (req) =>
    query(
      `SELECT v.*, l.nombre AS lead_nombre, l.ig_username, p.nombre AS producto,
              s.nombre AS setter_nombre, c.nombre AS closer_nombre,
              round(v.precio_acordado * v.comision_setter_pct / 100, 2) AS comision_setter,
              round(v.precio_acordado * v.comision_closer_pct / 100, 2) AS comision_closer,
              round(v.precio_acordado
                    - v.precio_acordado * v.comision_setter_pct / 100
                    - v.precio_acordado * v.comision_closer_pct / 100, 2) AS neto,
              (SELECT COALESCE(SUM(pg.monto),0) FROM pagos pg WHERE pg.venta_id = v.id AND pg.estado='pagado') AS cobrado,
              (SELECT COUNT(*) FROM pagos pg WHERE pg.venta_id = v.id) AS cuotas_total,
              (SELECT COUNT(*) FROM pagos pg WHERE pg.venta_id = v.id AND pg.estado='pagado') AS cuotas_pagadas
         FROM ventas v
         LEFT JOIN leads l ON l.id = v.lead_id
         LEFT JOIN productos p ON p.id = v.producto_id
         LEFT JOIN personas_equipo s ON s.id = v.setter_id
         LEFT JOIN personas_equipo c ON c.id = v.closer_id
        WHERE v.cuenta_id = $1 ORDER BY v.fecha DESC LIMIT 200`,
      [req.sesion.cuentaId]));

  // Registrar venta + generar sus cuotas con la comisión del método de pago.
  app.post('/ventas/registrar', async (req, reply) => {
    const d = z.object({
      lead_id: z.string().uuid().optional(),
      producto_id: z.string().uuid().optional(),
      closer_id: z.string().uuid().optional(),
      setter_id: z.string().uuid().optional(),
      metodo_pago_id: z.string().uuid().optional(),
      fecha: z.string().optional(),
      tipo_cobro: z.enum(['unico', 'cuotas']).default('unico'),
      precio_lista: z.number().optional(),
      precio_acordado: z.number(),
      moneda: z.string().default('EUR'),
      num_cuotas: z.number().int().min(1).default(1),
      comision_setter_pct: z.number().default(0),
      comision_closer_pct: z.number().default(0),
      notas: z.string().optional(),
    }).parse(req.body);
    const c = req.sesion.cuentaId;

    // Comisión y nombre del método de pago elegido.
    let pasarela: string | null = null;
    let comPct = 0;
    if (d.metodo_pago_id) {
      const m = await queryOne(`SELECT nombre, comision_pct FROM metodos_pago WHERE cuenta_id=$1 AND id=$2`,
        [c, d.metodo_pago_id]);
      if (m) { pasarela = m.nombre; comPct = Number(m.comision_pct) || 0; }
    }

    const venta = await queryOne(
      `INSERT INTO ventas (cuenta_id, lead_id, producto_id, closer_id, setter_id, fecha, tipo_cobro,
         precio_lista, precio_acordado, moneda, num_cuotas, pasarela, estado,
         comision_setter_pct, comision_closer_pct, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [c, d.lead_id ?? null, d.producto_id ?? null, d.closer_id ?? null, d.setter_id ?? null,
       d.fecha ? new Date(d.fecha) : new Date(), d.tipo_cobro, d.precio_lista ?? null,
       d.precio_acordado, d.moneda, d.num_cuotas, pasarela,
       d.tipo_cobro === 'cuotas' ? 'en_cuotas' : 'activa',
       d.comision_setter_pct, d.comision_closer_pct, d.notas ?? null]);

    // Genera las cuotas con la comisión de pasarela ya calculada.
    const nc = d.tipo_cobro === 'cuotas' ? d.num_cuotas : 1;
    const montoCuota = Math.round((d.precio_acordado / nc) * 100) / 100;
    for (let k = 1; k <= nc; k++) {
      const vence = new Date(); vence.setMonth(vence.getMonth() + (k - 1));
      await pool.query(
        `INSERT INTO pagos (cuenta_id, venta_id, num_cuota, monto, vence_en, estado, pasarela, comision_pasarela)
         VALUES ($1,$2,$3,$4,$5,'pendiente',$6,$7)`,
        [c, venta!.id, k, montoCuota, vence, pasarela, Math.round(montoCuota * comPct) / 100]);
    }
    // La venta cuenta en el Panel (evento "venta", que también mueve la oportunidad a ganada).
    await eventoDeVenta(c, venta);
    return reply.code(201).send({ ...venta, cuotas: nc, comision_pasarela_pct: comPct });
  });

  app.get('/ventas/:id/pagos', async (req) => {
    const { id } = req.params as { id: string };
    return query(`SELECT * FROM pagos WHERE cuenta_id=$1 AND venta_id=$2 ORDER BY num_cuota`,
      [req.sesion.cuentaId, id]);
  });

  // --- Seguimientos por lead ---
  crud(app, '/seguimientos', 'seguimientos',
    ['lead_id', 'numero', 'fecha', 'tipo_mensaje', 'estado', 'canal', 'observaciones'], 'fecha DESC');
  app.get('/leads/:id/seguimientos', async (req) => {
    const { id } = req.params as { id: string };
    return query(`SELECT * FROM seguimientos WHERE cuenta_id=$1 AND lead_id=$2 ORDER BY numero, fecha`,
      [req.sesion.cuentaId, id]);
  });

  // --- Resumen financiero (P&L) ---
  app.get('/finanzas/resumen', async (req) => {
    const c = req.sesion.cuentaId;
    const [ventas, cobros, gastos, mora, pendiente] = await Promise.all([
      queryOne(`SELECT COUNT(*)::int n, COALESCE(SUM(precio_acordado),0) total,
                       COALESCE(SUM(precio_acordado*comision_setter_pct/100 + precio_acordado*comision_closer_pct/100),0) comisiones
                  FROM ventas WHERE cuenta_id=$1 AND estado NOT IN ('cancelada','reembolsada')`, [c]),
      queryOne(`SELECT COALESCE(SUM(monto),0) cobrado, COALESCE(SUM(comision_pasarela),0) com_pasarela
                  FROM pagos WHERE cuenta_id=$1 AND estado='pagado'`, [c]),
      queryOne(`SELECT COALESCE(SUM(importe),0) total FROM gastos WHERE cuenta_id=$1`, [c]),
      queryOne(`SELECT COALESCE(SUM(monto),0) total FROM pagos WHERE cuenta_id=$1 AND estado='pendiente' AND vence_en < CURRENT_DATE`, [c]),
      queryOne(`SELECT COALESCE(SUM(monto),0) total FROM pagos WHERE cuenta_id=$1 AND estado='pendiente'`, [c]),
    ]);
    const porMes = await query(
      `SELECT to_char(fecha,'YYYY-MM') mes, COALESCE(SUM(precio_acordado),0) ventas
         FROM ventas WHERE cuenta_id=$1 AND estado NOT IN ('cancelada','reembolsada')
        GROUP BY 1 ORDER BY 1 DESC LIMIT 12`, [c]);
    const comprometido = Number(ventas?.total ?? 0);
    const cobrado = Number(cobros?.cobrado ?? 0);
    const gastoTotal = Number(gastos?.total ?? 0);
    return {
      ventas: ventas?.n ?? 0,
      ingresos_comprometidos: comprometido,
      ingresos_cobrados: cobrado,
      por_cobrar: Number(pendiente?.total ?? 0),
      en_mora: Number(mora?.total ?? 0),
      comisiones: Number(ventas?.comisiones ?? 0),
      comision_pasarela: Number(cobros?.com_pasarela ?? 0),
      gastos: gastoTotal,
      neto_cobrado: cobrado - gastoTotal,
      ticket_medio: ventas?.n ? comprometido / ventas.n : 0,
      por_mes: porMes,
    };
  });
}
