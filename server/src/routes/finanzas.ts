import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db/pool.js';
import { noEncontrado, peticionInvalida } from '../lib/errores.js';

/** Deja solo las claves permitidas y definidas (whitelist → SQL seguro). */
function pick(body: any, cols: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const c of cols) if (body && body[c] !== undefined) out[c] = body[c] === '' ? null : body[c];
  return out;
}

/** CRUD genérico multi-tenant para una tabla con lista de columnas editables. */
function crud(app: FastifyInstance, ruta: string, tabla: string, cols: string[], orden = 'creado_en DESC') {
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
    return reply.code(201).send(fila);
  });

  app.patch(`${ruta}/:id`, async (req) => {
    const { id } = req.params as { id: string };
    const d = pick(req.body, cols);
    const keys = Object.keys(d);
    if (keys.length === 0) throw peticionInvalida('Nada que actualizar');
    const sets = keys.map((k, i) => `${k} = $${i + 3}`);
    const fila = await queryOne(
      `UPDATE ${tabla} SET ${sets.join(', ')} WHERE cuenta_id = $1 AND id = $2 RETURNING *`,
      [req.sesion.cuentaId, id, ...keys.map((k) => d[k])]);
    if (!fila) throw noEncontrado(tabla);
    return fila;
  });

  app.delete(`${ruta}/:id`, async (req, reply) => {
    const { id } = req.params as { id: string };
    await queryOne(`DELETE FROM ${tabla} WHERE cuenta_id = $1 AND id = $2 RETURNING id`,
      [req.sesion.cuentaId, id]);
    return reply.code(204).send();
  });
}

export default async function rutasFinanzas(app: FastifyInstance) {
  crud(app, '/productos', 'productos',
    ['nombre', 'descripcion', 'precio_lista', 'moneda', 'duracion', 'activo'], 'nombre');
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
  crud(app, '/ventas', 'ventas', COLS_VENTA, 'fecha DESC');
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
