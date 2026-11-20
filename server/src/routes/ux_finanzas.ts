import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool, query, queryOne, transaction } from '../db/pool.js';
import { conflicto, noEncontrado, peticionInvalida, prohibido } from '../lib/errores.js';
import { hashPassword } from '../lib/auth.js';
import { fechaISO, hoyEn, recalcularEstadoVenta, sumarDias, sumarMeses } from '../modules/ventas_sync.js';
import {
  diaDe, esAdmin, eventoDeVenta, exigirAdmin, quitarEventoDeVenta, sincronizarEdicionVenta,
} from './finanzas.js';

// Rutas propias de la zona "finanzas" (mejoras de UX). Montadas en /api/ux/finanzas.
// Requieren sesión (cuelgan de /api). Usar req.sesion.cuentaId en TODAS las
// consultas: nada de datos de otra cuenta.

// ---------------------------------------------------------------------
// Período: este mes · mes pasado · 3 meses · este año · todo
// ---------------------------------------------------------------------

const PERIODOS = ['mes', 'mes_pasado', '3m', 'anio', 'todo'] as const;
type Periodo = typeof PERIODOS[number];

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (iso: string) => MESES[Number(iso.slice(5, 7)) - 1];
const menor = (a: string, b: string) => (a < b ? a : b);

interface Rango {
  periodo: Periodo; hoy: string; desde: string | null; hasta: string | null;
  anterior: { desde: string; hasta: string } | null;
  /** "este mes", "en octubre", "en los últimos 3 meses"… */
  texto: string;
  /** Con qué se compara: "el mismo tramo de octubre". */
  comparacion: string | null;
}

export function rangoDe(periodo: Periodo, hoy: string): Rango {
  const primeroMes = `${hoy.slice(0, 7)}-01`;
  const manana = sumarDias(hoy, 1);
  const anio = Number(hoy.slice(0, 4));
  switch (periodo) {
    case 'mes_pasado': {
      const desde = sumarMeses(primeroMes, -1);
      const antDesde = sumarMeses(primeroMes, -2);
      return { periodo, hoy, desde, hasta: primeroMes, anterior: { desde: antDesde, hasta: desde },
        texto: `en ${nombreMes(desde)}`, comparacion: nombreMes(antDesde) };
    }
    case '3m': {
      const desde = sumarMeses(primeroMes, -2);
      return { periodo, hoy, desde, hasta: sumarMeses(primeroMes, 1),
        anterior: { desde: sumarMeses(desde, -3), hasta: menor(sumarMeses(manana, -3), desde) },
        texto: 'en los últimos 3 meses', comparacion: 'los 3 meses anteriores' };
    }
    case 'anio': {
      const desde = `${anio}-01-01`;
      return { periodo, hoy, desde, hasta: `${anio + 1}-01-01`,
        anterior: { desde: `${anio - 1}-01-01`, hasta: menor(sumarMeses(manana, -12), desde) },
        texto: 'este año', comparacion: `el mismo tramo de ${anio - 1}` };
    }
    case 'todo':
      return { periodo, hoy, desde: null, hasta: null, anterior: null, texto: 'desde el principio', comparacion: null };
    case 'mes':
    default: {
      const antDesde = sumarMeses(primeroMes, -1);
      return { periodo: 'mes', hoy, desde: primeroMes, hasta: sumarMeses(primeroMes, 1),
        anterior: { desde: antDesde, hasta: menor(sumarMeses(manana, -1), primeroMes) },
        texto: 'este mes', comparacion: `el mismo tramo de ${nombreMes(antDesde)}` };
    }
  }
}

async function contextoCuenta(cuentaId: string) {
  const cuenta = await queryOne(`SELECT moneda, zona_horaria FROM cuentas WHERE id = $1`, [cuentaId]);
  return { moneda: (cuenta?.moneda || 'EUR').toUpperCase(), hoy: hoyEn(cuenta?.zona_horaria) };
}

async function rangoDePeticion(req: FastifyRequest) {
  const p = (req.query as any)?.periodo;
  const periodo: Periodo = PERIODOS.includes(p) ? p : 'mes';
  const ctx = await contextoCuenta(req.sesion.cuentaId);
  return { ...ctx, rango: rangoDe(periodo, ctx.hoy) };
}

/** Columna dentro del período [$2, $3) (null = sin límite). */
const EN = (col: string, a = 2, b = 3) => `($${a}::date IS NULL OR ${col} >= $${a}::date) AND ($${b}::date IS NULL OR ${col} < $${b}::date)`;
const VIVA = `v.estado NOT IN ('cancelada','reembolsada')`;
const DEBE = `p.estado IN ('pendiente','reagendado','fallido')`;
/** Los gastos marcados como comisión ya se restan como comisiones: no se cuentan dos veces. */
const GASTO_REAL = `NOT es_comision_ventas AND NOT es_comision_pasarela AND categoria NOT IN ('comisiones_ventas','comisiones_pasarela')`;
const r2 = (n: any) => Math.round(Number(n ?? 0) * 100) / 100;

/** Los números de un período: vendido, cobrado, comisiones, gastos y lo que te queda. */
async function numerosDe(c: string, desde: string | null, hasta: string | null) {
  const [v, cob, g, coh] = await Promise.all([
    queryOne(
      `SELECT COUNT(*)::int n, COALESCE(SUM(precio_acordado),0) vendido,
              COALESCE(SUM(precio_acordado*(comision_setter_pct+comision_closer_pct)/100),0) com_equipo
         FROM ventas v WHERE v.cuenta_id = $1 AND ${VIVA} AND ${EN('v.fecha')}`, [c, desde, hasta]),
    queryOne(
      `SELECT COALESCE(SUM(p.monto),0) cobrado, COALESCE(SUM(p.comision_pasarela),0) com_cobro
         FROM pagos p JOIN ventas v ON v.id = p.venta_id
        WHERE p.cuenta_id = $1 AND p.estado = 'pagado' AND ${VIVA}
          AND ${EN('COALESCE(p.cobrado_en, p.vence_en, v.fecha)')}`, [c, desde, hasta]),
    queryOne(`SELECT COALESCE(SUM(importe),0) total FROM gastos WHERE cuenta_id = $1 AND ${GASTO_REAL} AND ${EN('fecha')}`, [c, desde, hasta]),
    // De lo que vendiste en el período, cuánto ya entró (sin importar cuándo).
    queryOne(
      `SELECT COALESCE(SUM(p.monto),0) cobrado FROM pagos p JOIN ventas v ON v.id = p.venta_id
        WHERE p.cuenta_id = $1 AND p.estado = 'pagado' AND ${VIVA} AND ${EN('v.fecha')}`, [c, desde, hasta]),
  ]);
  const vendido = r2(v?.vendido); const ventas = Number(v?.n ?? 0);
  const cobrado = r2(cob?.cobrado); const comCobro = r2(cob?.com_cobro);
  const comEquipo = r2(v?.com_equipo); const gastos = r2(g?.total);
  return {
    ventas, vendido, ticket: ventas ? r2(vendido / ventas) : 0,
    cobrado, comision_cobro: comCobro, comision_equipo: comEquipo, gastos,
    te_queda: r2(cobrado - comCobro - comEquipo - gastos),
    cobrado_de_lo_vendido: r2(coh?.cobrado),
  };
}

// ---------------------------------------------------------------------
// Filas de ventas y cobros (con el lead y el curso)
// ---------------------------------------------------------------------

const SELECT_VENTA = `
  SELECT v.id, to_char(v.fecha,'YYYY-MM-DD') AS fecha, v.lead_id, l.nombre AS lead_nombre, l.ig_username, l.avatar_url,
         v.producto_id, pr.nombre AS producto, v.closer_id, c.nombre AS closer_nombre, v.setter_id, s.nombre AS setter_nombre,
         v.pasarela, v.precio_acordado, v.moneda, v.tipo_cobro, v.estado, v.notas, v.evento_id, v.creado_en,
         v.comision_closer_pct, v.comision_setter_pct,
         round(v.precio_acordado * v.comision_closer_pct / 100, 2) AS comision_closer,
         round(v.precio_acordado * v.comision_setter_pct / 100, 2) AS comision_setter,
         COALESCE(pg.cobrado, 0) AS cobrado, COALESCE(pg.com_cobro, 0) AS comision_cobro,
         COALESCE(pg.total, 0)::int AS cuotas_total, COALESCE(pg.pagadas, 0)::int AS cuotas_pagadas,
         COALESCE(pg.por_cobrar, 0) AS por_cobrar, COALESCE(pg.atrasadas, 0)::int AS atrasadas, pg.proxima_vence,
         CASE WHEN e.id IS NULL THEN (CASE WHEN v.notas LIKE 'Registrada sola%' THEN 'auto' ELSE 'manual' END)
              WHEN e.fuente = 'manual' THEN 'manual' ELSE e.fuente END AS origen
    FROM ventas v
    LEFT JOIN leads l ON l.id = v.lead_id
    LEFT JOIN productos pr ON pr.id = v.producto_id
    LEFT JOIN personas_equipo c ON c.id = v.closer_id
    LEFT JOIN personas_equipo s ON s.id = v.setter_id
    LEFT JOIN eventos e ON e.id = v.evento_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE p.estado = 'pagado') AS pagadas,
             SUM(p.monto) FILTER (WHERE p.estado = 'pagado') AS cobrado,
             SUM(p.comision_pasarela) FILTER (WHERE p.estado <> 'reembolsado') AS com_cobro,
             SUM(p.monto) FILTER (WHERE ${DEBE}) AS por_cobrar,
             COUNT(*) FILTER (WHERE ${DEBE} AND p.vence_en < $HOY::date) AS atrasadas,
             to_char(MIN(p.vence_en) FILTER (WHERE ${DEBE}), 'YYYY-MM-DD') AS proxima_vence
        FROM pagos p WHERE p.venta_id = v.id
    ) pg ON true`;

/** Lo que se muestra de una venta: lo que te queda (la MISMA cuenta que el Resumen) y si está atrasada. */
function armarVenta(v: any) {
  const muerta = ['cancelada', 'reembolsada'].includes(v.estado);
  const comEquipo = r2(Number(v.comision_closer) + Number(v.comision_setter));
  return {
    ...v,
    comision_equipo: comEquipo,
    te_queda: muerta ? 0 : r2(Number(v.precio_acordado) - comEquipo - Number(v.comision_cobro)),
    por_cobrar: muerta ? 0 : r2(v.por_cobrar),
    atrasadas: muerta ? 0 : v.atrasadas,
    estado_visible: !muerta && v.atrasadas > 0 ? 'en_mora' : v.estado,
  };
}

const SELECT_COBRO = `
  SELECT p.id, p.venta_id, p.num_cuota, p.monto, to_char(p.vence_en,'YYYY-MM-DD') AS vence_en,
         to_char(p.cobrado_en,'YYYY-MM-DD') AS cobrado_en, p.estado, p.pasarela, p.comision_pasarela,
         (SELECT COUNT(*) FROM pagos x WHERE x.venta_id = p.venta_id)::int AS cuotas_total,
         v.moneda, v.estado AS venta_estado, v.tipo_cobro, v.precio_acordado, v.lead_id,
         l.nombre AS lead_nombre, l.ig_username, l.avatar_url, pr.nombre AS producto
    FROM pagos p JOIN ventas v ON v.id = p.venta_id
    LEFT JOIN leads l ON l.id = v.lead_id
    LEFT JOIN productos pr ON pr.id = v.producto_id`;

// ---------------------------------------------------------------------
// Equipo: personas (comisiones) + usuarios del CRM, en una sola lista
// ---------------------------------------------------------------------

const ROL_UI = z.enum(['setter', 'closer', 'closer_setter', 'admin', 'team_lead', 'otro']);
/** Rol de comisiones (ficha) según lo que se elige en pantalla. */
const rolPersona = (r: z.infer<typeof ROL_UI>) => (r === 'admin' ? 'team_lead' : r);
/** Rol de acceso al CRM según lo que se elige en pantalla. */
const rolUsuario = (r: string) => (r === 'admin' || r === 'team_lead' ? 'admin' : r === 'setter' ? 'setter' : 'closer');
/** Rol de comisiones de un usuario que todavía no tiene ficha. */
const rolDeUsuario = (r: string) => (r === 'setter' ? 'setter' : r === 'closer' ? 'closer' : r === 'solo_lectura' ? 'otro' : 'team_lead');

const ACCESO = z.object({
  email: z.string().trim().toLowerCase().email('Revisá el email'),
  password: z.string().min(8, 'La contraseña tiene que tener al menos 8 caracteres').max(200),
});

async function emailLibre(email: string, excepto?: string | null) {
  const u = await queryOne(`SELECT id FROM usuarios WHERE lower(email) = lower($1) AND ($2::uuid IS NULL OR id <> $2::uuid)`, [email, excepto ?? null]);
  if (u) throw conflicto('Ya hay alguien con ese email en el CRM. Usá otro.');
}

async function personaDe(c: string, id: string) {
  const p = await queryOne(
    `SELECT pe.*, u.email AS usuario_email, u.rol AS usuario_rol, u.activo AS usuario_activo
       FROM personas_equipo pe LEFT JOIN usuarios u ON u.id = pe.usuario_id
      WHERE pe.cuenta_id = $1 AND pe.id = $2`, [c, id]);
  if (!p) throw noEncontrado('Persona del equipo');
  return p;
}

export default async function rutasUx_finanzas(app: FastifyInstance) {
  // -------------------------------------------------------------------
  // Resumen con período y la cascada "lo que te queda"
  // -------------------------------------------------------------------
  app.get('/resumen', async (req) => {
    const c = req.sesion.cuentaId;
    const { rango, moneda, hoy } = await rangoDePeticion(req);
    const desde12 = sumarMeses(`${hoy.slice(0, 7)}-01`, -11);
    const [actual, anterior, debe, porMes, pasos] = await Promise.all([
      numerosDe(c, rango.desde, rango.hasta),
      rango.anterior ? numerosDe(c, rango.anterior.desde, rango.anterior.hasta) : Promise.resolve(null),
      queryOne(
        `SELECT COALESCE(SUM(p.monto),0) total, COUNT(*)::int n,
                COALESCE(SUM(p.monto) FILTER (WHERE p.vence_en < $2::date),0) atrasado,
                COUNT(*) FILTER (WHERE p.vence_en < $2::date)::int atrasadas,
                COALESCE(SUM(p.monto) FILTER (WHERE p.vence_en >= $2::date AND p.vence_en < $2::date + 7),0) semana,
                COUNT(*) FILTER (WHERE p.vence_en >= $2::date AND p.vence_en < $2::date + 7)::int semana_n
           FROM pagos p JOIN ventas v ON v.id = p.venta_id
          WHERE p.cuenta_id = $1 AND ${DEBE} AND ${VIVA}`, [c, hoy]),
      query(
        `SELECT to_char(fecha,'YYYY-MM') mes, COUNT(*)::int ventas, COALESCE(SUM(precio_acordado),0) vendido
           FROM ventas v WHERE v.cuenta_id = $1 AND ${VIVA} AND v.fecha >= $2::date
          GROUP BY 1 ORDER BY 1`, [c, desde12]),
      queryOne(
        `SELECT (SELECT COUNT(*) FROM productos WHERE cuenta_id = $1 AND activo)::int cursos,
                (SELECT COUNT(*) FROM metodos_pago WHERE cuenta_id = $1 AND activo)::int metodos,
                (SELECT COUNT(*) FROM personas_equipo WHERE cuenta_id = $1 AND activo)::int equipo,
                (SELECT COUNT(*) FROM ventas WHERE cuenta_id = $1)::int ventas,
                (SELECT COUNT(*) FROM gastos WHERE cuenta_id = $1)::int gastos`, [c]),
    ]);
    // Los últimos 12 meses, también los que no tuvieron ventas.
    const meses = Array.from({ length: 12 }, (_, i) => sumarMeses(desde12, i).slice(0, 7));
    const porClave = new Map(porMes.map((m: any) => [m.mes, m]));
    return {
      periodo: rango, moneda,
      actual, anterior,
      por_cobrar: {
        total: r2(debe?.total), cuotas: debe?.n ?? 0, atrasado: r2(debe?.atrasado), atrasadas: debe?.atrasadas ?? 0,
        semana: r2(debe?.semana), semana_n: debe?.semana_n ?? 0,
      },
      por_mes: meses.map((mes) => ({ mes, ventas: Number(porClave.get(mes)?.ventas ?? 0), vendido: r2(porClave.get(mes)?.vendido) })),
      primeros_pasos: pasos,
    };
  });

  /** Contadores chicos para las pestañas (cuotas atrasadas). */
  app.get('/contadores', async (req) => {
    const { hoy } = await contextoCuenta(req.sesion.cuentaId);
    const r = await queryOne(
      `SELECT COUNT(*) FILTER (WHERE p.vence_en < $2::date)::int atrasadas, COUNT(*)::int por_cobrar
         FROM pagos p JOIN ventas v ON v.id = p.venta_id
        WHERE p.cuenta_id = $1 AND ${DEBE} AND ${VIVA}`, [req.sesion.cuentaId, hoy]);
    return { atrasadas: r?.atrasadas ?? 0, por_cobrar: r?.por_cobrar ?? 0 };
  });

  // -------------------------------------------------------------------
  // Ventas
  // -------------------------------------------------------------------
  app.get('/ventas', async (req) => {
    const c = req.sesion.cuentaId;
    const { rango, moneda, hoy } = await rangoDePeticion(req);
    const [filas, auto, endpoints] = await Promise.all([
      query(`${SELECT_VENTA.replaceAll('$HOY', '$4')} WHERE v.cuenta_id = $1 AND ${EN('v.fecha')}
              ORDER BY v.fecha DESC, v.creado_en DESC LIMIT 500`, [c, rango.desde, rango.hasta, hoy]),
      query(
        `SELECT e.fuente, COUNT(*)::int n, to_char(max(v.fecha),'YYYY-MM-DD') ultima
           FROM ventas v JOIN eventos e ON e.id = v.evento_id
          WHERE v.cuenta_id = $1 AND e.fuente IN ('stripe','hotmart','generico')
          GROUP BY e.fuente ORDER BY 2 DESC`, [c]),
      queryOne(
        `SELECT COUNT(*)::int n, COALESCE(SUM(total_recibidos),0)::int recibidos
           FROM webhook_endpoints WHERE cuenta_id = $1 AND activo AND (fuente IN ('stripe','hotmart') OR slug = 'venta')`, [c]),
    ]);
    return {
      periodo: rango, moneda, ventas: filas.map(armarVenta),
      cobros_solos: {
        conectado: (endpoints?.n ?? 0) > 0 || auto.length > 0,
        fuentes: auto.map((a: any) => a.fuente),
        ventas: auto.reduce((s: number, a: any) => s + a.n, 0),
        ultima: auto.map((a: any) => a.ultima).sort().pop() ?? null,
      },
    };
  });

  async function ventaCompleta(c: string, id: string) {
    const { hoy } = await contextoCuenta(c);
    const v = await queryOne(`${SELECT_VENTA.replaceAll('$HOY', '$3')} WHERE v.cuenta_id = $1 AND v.id = $2`, [c, id, hoy]);
    if (!v) throw noEncontrado('Venta');
    const [pagos, metodo] = await Promise.all([
      query(`${SELECT_COBRO} WHERE p.cuenta_id = $1 AND p.venta_id = $2 ORDER BY p.num_cuota, p.creado_en`, [c, id]),
      v.pasarela ? queryOne(`SELECT id, nombre, comision_pct FROM metodos_pago WHERE cuenta_id = $1 AND lower(nombre) = lower($2) ORDER BY activo DESC LIMIT 1`, [c, v.pasarela]) : null,
    ]);
    return { ...armarVenta(v), pagos, metodo_pago_id: metodo?.id ?? null, metodo_pct: Number(metodo?.comision_pct ?? 0), hoy };
  }

  app.get('/ventas/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return ventaCompleta(req.sesion.cuentaId, id);
  });

  /**
   * Corregir una venta: lead, curso, quién la cerró (y su %), cómo pagó,
   * fecha, precio y notas. Lo que cambia en Finanzas cambia en el Panel.
   */
  app.patch('/ventas/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const uuid = z.string().uuid();
    const d = z.object({
      lead_id: uuid.nullish(),
      producto_id: uuid.nullish(),
      closer_id: uuid.nullish(),
      setter_id: uuid.nullish(),
      comision_closer_pct: z.number().min(0).max(100).nullish(),
      comision_setter_pct: z.number().min(0).max(100).nullish(),
      metodo_pago_id: uuid.nullish(),
      precio_acordado: z.number().optional(),
      fecha: z.string().max(40).optional(),
      notas: z.string().max(2000).nullish(),
    }).parse(req.body);
    const c = req.sesion.cuentaId;
    const antes = await queryOne(`SELECT * FROM ventas WHERE cuenta_id = $1 AND id = $2`, [c, id]);
    if (!antes) throw noEncontrado('Venta');
    const muerta = ['cancelada', 'reembolsada'].includes(antes.estado);
    const sets: Record<string, any> = {};

    if (d.precio_acordado !== undefined && Math.abs(d.precio_acordado - Number(antes.precio_acordado)) > 0.004) {
      if (muerta) throw conflicto('Esta venta está cancelada o devuelta: su monto ya no se cambia.');
      if (!(d.precio_acordado > 0)) throw peticionInvalida('Poné un monto mayor a 0.');
      const pagado = await queryOne(`SELECT COALESCE(SUM(monto),0) t FROM pagos WHERE venta_id = $1 AND estado = 'pagado'`, [id]);
      if (d.precio_acordado + 0.004 < Number(pagado?.t ?? 0)) {
        throw peticionInvalida('Ya te pagó más que ese monto. Si le devolviste plata, marcá la venta como devuelta.');
      }
      sets.precio_acordado = d.precio_acordado;
    }
    if (d.fecha !== undefined) sets.fecha = fechaISO(d.fecha, diaDe(antes.fecha) ?? hoyEn());
    if (d.notas !== undefined) sets.notas = d.notas?.trim() || null;
    if (d.producto_id !== undefined) {
      if (d.producto_id && !(await queryOne(`SELECT 1 FROM productos WHERE cuenta_id = $1 AND id = $2`, [c, d.producto_id]))) throw noEncontrado('Curso');
      sets.producto_id = d.producto_id ?? null;
    }
    // Quién la cerró: su % sale de su ficha si no se manda; sin persona, 0.
    for (const rol of ['closer', 'setter'] as const) {
      const idPersona = d[`${rol}_id`];
      const pct = d[`comision_${rol}_pct`];
      if (idPersona !== undefined) {
        if (idPersona) {
          const p = await queryOne(`SELECT comision_venta_pct FROM personas_equipo WHERE cuenta_id = $1 AND id = $2`, [c, idPersona]);
          if (!p) throw noEncontrado('Persona del equipo');
          sets[`${rol}_id`] = idPersona;
          sets[`comision_${rol}_pct`] = pct ?? (idPersona === antes[`${rol}_id`] ? Number(antes[`comision_${rol}_pct`]) : Number(p.comision_venta_pct));
        } else {
          sets[`${rol}_id`] = null;
          sets[`comision_${rol}_pct`] = 0;
        }
      } else if (pct !== undefined && pct !== null) {
        sets[`comision_${rol}_pct`] = antes[`${rol}_id`] ? pct : 0;
      }
    }
    if (sets.setter_id && sets.setter_id === (sets.closer_id ?? antes.closer_id)) {
      throw peticionInvalida('La misma persona no puede ser closer y setter de la misma venta.');
    }
    let metodo: any = null;
    if (d.metodo_pago_id !== undefined) {
      if (d.metodo_pago_id) {
        metodo = await queryOne(`SELECT nombre, comision_pct FROM metodos_pago WHERE cuenta_id = $1 AND id = $2`, [c, d.metodo_pago_id]);
        if (!metodo) throw noEncontrado('Método de cobro');
      }
      sets.pasarela = metodo?.nombre ?? null;
    }
    let leadNuevo: string | null | undefined;
    if (d.lead_id !== undefined && (d.lead_id ?? null) !== (antes.lead_id ?? null)) {
      if (!d.lead_id) throw peticionInvalida('Elegí a quién le vendiste.');
      if (!(await queryOne(`SELECT 1 FROM leads WHERE cuenta_id = $1 AND id = $2`, [c, d.lead_id]))) throw noEncontrado('Lead');
      leadNuevo = d.lead_id;
    }

    if (Object.keys(sets).length) {
      const keys = Object.keys(sets);
      await pool.query(`UPDATE ventas SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE cuenta_id = $1 AND id = $2`,
        [c, id, ...keys.map((k) => sets[k])]);
    }
    // Otro método de cobro: cada cuota lleva la comisión del nuevo.
    if (d.metodo_pago_id !== undefined) {
      const pct = Number(metodo?.comision_pct ?? 0);
      await pool.query(
        `UPDATE pagos SET pasarela = $3, comision_pasarela = round(monto * $4 / 100, 2) WHERE cuenta_id = $1 AND venta_id = $2`,
        [c, id, metodo?.nombre ?? null, pct]);
    }
    let fila: any = await queryOne(`SELECT * FROM ventas WHERE cuenta_id = $1 AND id = $2`, [c, id]);
    await sincronizarEdicionVenta(c, antes, fila);

    // Otro lead: la venta pasa a contar para el lead correcto en el Panel.
    if (leadNuevo !== undefined) {
      const ev = fila.evento_id ? await queryOne(`SELECT id, idempotency_key, valor, lead_id FROM eventos WHERE id = $1`, [fila.evento_id]) : null;
      const deFinanzas = !ev || ev.idempotency_key === `venta_${id}`;
      if (deFinanzas) {
        // La cargó Finanzas: se vuelve a registrar para el lead correcto (mueve su oportunidad a ganada).
        if (ev) await quitarEventoDeVenta(c, fila);
        await pool.query(`UPDATE ventas SET lead_id = $3, evento_id = NULL WHERE cuenta_id = $1 AND id = $2`, [c, id, leadNuevo]);
        fila = await queryOne(`SELECT * FROM ventas WHERE cuenta_id = $1 AND id = $2`, [c, id]);
        if (!muerta) await eventoDeVenta(c, fila);
      } else {
        // Entró sola (Stripe…): el aviso original se conserva y pasa al lead correcto.
        await transaction(async (tx) => {
          await tx.query(`UPDATE ventas SET lead_id = $3 WHERE cuenta_id = $1 AND id = $2`, [c, id, leadNuevo]);
          await tx.query(`UPDATE eventos SET lead_id = $3 WHERE cuenta_id = $1 AND id = $2`, [c, ev.id, leadNuevo]);
          if (!muerta) {
            await tx.query(`UPDATE leads SET valor_total = GREATEST(valor_total - $3, 0) WHERE cuenta_id = $1 AND id = $2`, [c, ev.lead_id, Number(ev.valor ?? 0)]);
            await tx.query(`UPDATE leads SET valor_total = valor_total + $3, estado = 'ganado' WHERE cuenta_id = $1 AND id = $2`, [c, leadNuevo, Number(ev.valor ?? 0)]);
          }
        });
      }
    }
    return ventaCompleta(c, id);
  });

  // -------------------------------------------------------------------
  // Cobros (cuotas): quién te debe y cuándo
  // -------------------------------------------------------------------
  app.get('/cobros', async (req) => {
    const c = req.sesion.cuentaId;
    const { hoy, moneda } = await contextoCuenta(c);
    const [pendientes, cobradas] = await Promise.all([
      query(`${SELECT_COBRO} WHERE p.cuenta_id = $1 AND ${DEBE} AND ${VIVA}
              ORDER BY p.vence_en NULLS LAST, p.num_cuota`, [c]),
      query(`${SELECT_COBRO} WHERE p.cuenta_id = $1 AND p.estado IN ('pagado','reembolsado') AND v.estado <> 'cancelada'
              ORDER BY COALESCE(p.cobrado_en, p.vence_en) DESC NULLS LAST, p.creado_en DESC LIMIT 200`, [c]),
    ]);
    return { hoy, moneda, pendientes, cobradas };
  });

  app.post('/cobros/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const d = z.object({
      accion: z.enum(['cobrar', 'pendiente', 'reprogramar', 'fallido']),
      fecha: z.string().max(40).optional(),
    }).parse(req.body);
    const c = req.sesion.cuentaId;
    const { hoy } = await contextoCuenta(req.sesion.cuentaId);
    const p = await queryOne(`SELECT p.*, v.estado AS venta_estado FROM pagos p JOIN ventas v ON v.id = p.venta_id WHERE p.cuenta_id = $1 AND p.id = $2`, [c, id]);
    if (!p) throw noEncontrado('Cuota');
    if (['cancelada', 'reembolsada'].includes(p.venta_estado)) throw conflicto('Esa venta está cancelada o devuelta: sus cuotas ya no se cobran.');
    if (d.accion === 'cobrar') {
      await pool.query(`UPDATE pagos SET estado = 'pagado', cobrado_en = $2 WHERE id = $1`, [id, fechaISO(d.fecha, hoy)]);
    } else if (d.accion === 'pendiente') {
      await pool.query(`UPDATE pagos SET estado = 'pendiente', cobrado_en = NULL WHERE id = $1`, [id]);
    } else if (d.accion === 'reprogramar') {
      if (!d.fecha) throw peticionInvalida('Elegí la nueva fecha.');
      await pool.query(`UPDATE pagos SET estado = 'reagendado', cobrado_en = NULL, vence_en = $2 WHERE id = $1`, [id, fechaISO(d.fecha, hoy)]);
    } else {
      await pool.query(`UPDATE pagos SET estado = 'fallido', cobrado_en = NULL WHERE id = $1`, [id]);
    }
    await recalcularEstadoVenta(pool, c, p.venta_id);
    return queryOne(`${SELECT_COBRO} WHERE p.cuenta_id = $1 AND p.id = $2`, [c, id]);
  });

  // -------------------------------------------------------------------
  // Registrar una venta: buscar el lead (en el servidor) y lo que se elige
  // -------------------------------------------------------------------
  app.get('/leads', async (req) => {
    const q = z.object({
      q: z.string().max(100).optional(),
      limite: z.coerce.number().int().min(1).max(20).default(8),
    }).parse(req.query);
    const texto = (q.q ?? '').trim().replace(/^@/, '');
    const like = texto.replace(/[\\%_]/g, (m) => `\\${m}`);
    return query(
      `SELECT l.id, l.nombre, l.ig_username, l.avatar_url, l.pais
         FROM leads l
        WHERE l.cuenta_id = $1
          AND ($2 = '' OR l.ig_username ILIKE '%'||$3||'%' OR l.nombre ILIKE '%'||$3||'%' OR l.email ILIKE '%'||$3||'%'
               OR (COALESCE(l.nombre,'')||' '||COALESCE(l.apellido,'')) ILIKE '%'||$3||'%')
        ORDER BY CASE WHEN $2 = '' THEN 0
                      WHEN lower(l.ig_username) = lower($2) THEN 0
                      WHEN l.ig_username ILIKE $3||'%' OR l.nombre ILIKE $3||'%' THEN 1 ELSE 2 END,
                 l.ultimo_contacto_en DESC NULLS LAST
        LIMIT $4`, [req.sesion.cuentaId, texto, like, q.limite]);
  });

  /** Todo lo que necesita el diálogo de venta en una llamada (y quién la cerró, sugerido). */
  app.get('/contexto-venta', async (req) => {
    const { lead_id } = z.object({ lead_id: z.string().uuid().optional() }).parse(req.query);
    const c = req.sesion.cuentaId;
    const [productos, metodos, equipo, ctx, lead] = await Promise.all([
      query(`SELECT id, nombre, precio_lista, moneda FROM productos WHERE cuenta_id = $1 AND activo ORDER BY nombre`, [c]),
      query(`SELECT id, nombre, tipo, comision_pct FROM metodos_pago WHERE cuenta_id = $1 AND activo ORDER BY nombre`, [c]),
      query(`SELECT id, nombre, rol, comision_venta_pct, usuario_id FROM personas_equipo WHERE cuenta_id = $1 AND activo ORDER BY nombre`, [c]),
      contextoCuenta(c),
      lead_id ? queryOne(
        `SELECT l.id, l.nombre, l.ig_username, l.avatar_url, l.closer_id, l.propietario_id,
                (SELECT o.propietario_id FROM oportunidades o WHERE o.lead_id = l.id
                  ORDER BY (o.estado = 'abierta') DESC, o.abierta_en DESC LIMIT 1) AS opp_propietario
           FROM leads l WHERE l.cuenta_id = $1 AND l.id = $2`, [c, lead_id]) : Promise.resolve(null),
    ]);
    const porId = new Map(equipo.map((p: any) => [p.id, p]));
    const porUsuario = new Map(equipo.filter((p: any) => p.usuario_id).map((p: any) => [p.usuario_id, p]));
    const cierra = (p: any) => ['closer', 'closer_setter', 'team_lead'].includes(p.rol);
    // Quién atiende al lead (su closer, o quien lo tiene asignado en el Pipeline), y si no, vos.
    const candidatos = [
      lead?.closer_id ? porId.get(lead.closer_id) : null,
      lead?.opp_propietario ? porUsuario.get(lead.opp_propietario) : null,
      lead?.propietario_id ? porUsuario.get(lead.propietario_id) : null,
      porUsuario.get(req.sesion.usuarioId),
    ].filter(Boolean) as any[];
    const closer = candidatos.find(cierra) ?? null;
    const setter = candidatos.find((p) => p.rol === 'setter' && p !== closer) ?? null;
    return {
      moneda: ctx.moneda, hoy: ctx.hoy, productos, metodos, equipo,
      lead: lead ? { id: lead.id, nombre: lead.nombre, ig_username: lead.ig_username, avatar_url: lead.avatar_url } : null,
      sugerido: { closer_id: closer?.id ?? null, setter_id: setter?.id ?? null },
    };
  });

  // -------------------------------------------------------------------
  // Cursos, métodos de cobro y gastos (con sus números)
  // -------------------------------------------------------------------
  app.get('/cursos', async (req) => {
    const c = req.sesion.cuentaId;
    const { hoy } = await contextoCuenta(req.sesion.cuentaId);
    const r = rangoDe('mes', hoy);
    return query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM ventas v WHERE v.producto_id = p.id)::int AS ventas_todas,
              (SELECT COUNT(*) FROM ventas v WHERE v.producto_id = p.id AND ${VIVA})::int AS ventas_total,
              (SELECT COUNT(*) FROM ventas v WHERE v.producto_id = p.id AND ${VIVA} AND ${EN('v.fecha')})::int AS ventas_mes,
              (SELECT COALESCE(SUM(v.precio_acordado),0) FROM ventas v WHERE v.producto_id = p.id AND ${VIVA} AND ${EN('v.fecha')}) AS vendido_mes
         FROM productos p WHERE p.cuenta_id = $1 ORDER BY p.activo DESC, p.nombre`, [c, r.desde, r.hasta]);
  });

  app.get('/metodos', async (req) => {
    const c = req.sesion.cuentaId;
    const { rango } = await rangoDePeticion(req);
    const MISMO = `p.cuenta_id = m.cuenta_id AND lower(p.pasarela) = lower(m.nombre)`;
    const [metodos, sinMetodo] = await Promise.all([
      query(
        `SELECT m.*,
                (SELECT COUNT(*) FROM pagos p WHERE ${MISMO})::int AS usos,
                (SELECT COALESCE(SUM(p.monto),0) FROM pagos p WHERE ${MISMO} AND p.estado = 'pagado'
                    AND ${EN('COALESCE(p.cobrado_en, p.vence_en)')}) AS cobrado,
                (SELECT COALESCE(SUM(p.comision_pasarela),0) FROM pagos p WHERE ${MISMO} AND p.estado = 'pagado'
                    AND ${EN('COALESCE(p.cobrado_en, p.vence_en)')}) AS comision,
                (SELECT COUNT(*) FROM pagos p WHERE ${MISMO} AND p.comision_pasarela = 0 AND p.monto > 0)::int AS sin_comision
           FROM metodos_pago m WHERE m.cuenta_id = $1 ORDER BY m.activo DESC, m.nombre`, [c, rango.desde, rango.hasta]),
      // Cobros que dicen "Stripe" (entraron solos) pero no hay un método con ese nombre: no sabemos su comisión.
      query(
        `SELECT p.pasarela AS nombre, COUNT(*)::int AS cobros, COALESCE(SUM(p.monto),0) AS total
           FROM pagos p
          WHERE p.cuenta_id = $1 AND p.pasarela IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM metodos_pago m WHERE m.cuenta_id = p.cuenta_id AND lower(m.nombre) = lower(p.pasarela))
          GROUP BY p.pasarela ORDER BY 2 DESC`, [c]),
    ]);
    return { periodo: rango, metodos, sin_metodo: sinMetodo };
  });

  /** Pone la comisión de este método a los cobros que entraron sin ella (p. ej. las ventas de Stripe). */
  app.post('/metodos/:id/aplicar', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const c = req.sesion.cuentaId;
    const m = await queryOne(`SELECT nombre, comision_pct FROM metodos_pago WHERE cuenta_id = $1 AND id = $2`, [c, id]);
    if (!m) throw noEncontrado('Método de cobro');
    const r = await pool.query(
      `UPDATE pagos SET comision_pasarela = round(monto * $3 / 100, 2)
        WHERE cuenta_id = $1 AND lower(pasarela) = lower($2) AND comision_pasarela = 0 AND monto > 0`,
      [c, m.nombre, Number(m.comision_pct)]);
    return { actualizados: r.rowCount ?? 0 };
  });

  async function gastosFijos(c: string, hoy: string) {
    const ultimos = await query(
      `SELECT DISTINCT ON (lower(descripcion), categoria) id, descripcion, categoria, importe, moneda,
              to_char(fecha,'YYYY-MM-DD') AS fecha
         FROM gastos WHERE cuenta_id = $1 AND tipo = 'fijo' AND periodicidad = 'mensual'
        ORDER BY lower(descripcion), categoria, fecha DESC, creado_en DESC`, [c]);
    const primeroMes = `${hoy.slice(0, 7)}-01`;
    return {
      mensual: r2(ultimos.reduce((s: number, g: any) => s + Number(g.importe), 0)),
      cantidad: ultimos.length,
      por_cargar: ultimos.filter((g: any) => g.fecha < primeroMes),
    };
  }

  app.get('/gastos', async (req) => {
    const c = req.sesion.cuentaId;
    const { rango, hoy, moneda } = await rangoDePeticion(req);
    const [gastos, fijos] = await Promise.all([
      query(
        `SELECT id, to_char(fecha,'YYYY-MM-DD') AS fecha, descripcion, categoria, tipo, periodicidad, importe, moneda, notas,
                es_comision_ventas, es_comision_pasarela
           FROM gastos WHERE cuenta_id = $1 AND ${EN('fecha')}
          ORDER BY fecha DESC, creado_en DESC LIMIT 1000`, [c, rango.desde, rango.hasta]),
      gastosFijos(c, hoy),
    ]);
    return { periodo: rango, moneda, gastos, fijos };
  });

  /** Carga en este mes los gastos fijos mensuales que todavía no están (suscripciones, sueldos…). */
  app.post('/gastos/repetir-fijos', async (req) => {
    const c = req.sesion.cuentaId;
    const { hoy } = await contextoCuenta(req.sesion.cuentaId);
    const { por_cargar } = await gastosFijos(c, hoy);
    for (const g of por_cargar) {
      await pool.query(
        `INSERT INTO gastos (cuenta_id, fecha, descripcion, categoria, tipo, periodicidad, importe, moneda)
         VALUES ($1, $2, $3, $4, 'fijo', 'mensual', $5, $6)`,
        [c, hoy, g.descripcion, g.categoria, g.importe, g.moneda]);
    }
    return { creados: por_cargar.length, total: r2(por_cargar.reduce((s: number, g: any) => s + Number(g.importe), 0)) };
  });

  // -------------------------------------------------------------------
  // Equipo: UNA lista (personas con comisión + usuarios del CRM)
  // -------------------------------------------------------------------
  app.get('/equipo', async (req) => {
    const c = req.sesion.cuentaId;
    const { rango } = await rangoDePeticion(req);
    const [personas, usuarios, numeros] = await Promise.all([
      query(
        `SELECT pe.id, pe.nombre, pe.email, pe.rol, pe.comision_venta_pct, pe.activo, pe.usuario_id,
                u.email AS usuario_email, u.rol AS usuario_rol, u.activo AS usuario_activo, u.ultimo_acceso_en
           FROM personas_equipo pe LEFT JOIN usuarios u ON u.id = pe.usuario_id AND u.cuenta_id = pe.cuenta_id
          WHERE pe.cuenta_id = $1 ORDER BY pe.activo DESC, lower(pe.nombre)`, [c]),
      query(
        `SELECT u.id, u.nombre, u.email, u.rol, u.activo, u.ultimo_acceso_en FROM usuarios u
          WHERE u.cuenta_id = $1 AND NOT EXISTS (SELECT 1 FROM personas_equipo pe WHERE pe.usuario_id = u.id)
          ORDER BY u.activo DESC, (u.rol = 'owner') DESC, lower(u.nombre)`, [c]),
      // Comisiones del período: lo que le corresponde a cada uno por las ventas que cerró o consiguió.
      query(
        `SELECT x.persona_id, COUNT(DISTINCT x.venta_id)::int AS ventas, COALESCE(SUM(x.vendido),0) AS vendido,
                COALESCE(SUM(x.comision),0) AS comision
           FROM (
             SELECT v.closer_id AS persona_id, v.id AS venta_id, v.precio_acordado AS vendido,
                    v.precio_acordado * v.comision_closer_pct / 100 AS comision
               FROM ventas v WHERE v.cuenta_id = $1 AND v.closer_id IS NOT NULL AND ${VIVA} AND ${EN('v.fecha')}
             UNION ALL
             SELECT v.setter_id, v.id, v.precio_acordado, v.precio_acordado * v.comision_setter_pct / 100
               FROM ventas v WHERE v.cuenta_id = $1 AND v.setter_id IS NOT NULL AND ${VIVA} AND ${EN('v.fecha')}
           ) x GROUP BY x.persona_id`, [c, rango.desde, rango.hasta]),
    ]);
    const porPersona = new Map(numeros.map((n: any) => [n.persona_id, n]));
    const miembros = [
      ...personas.map((p: any) => {
        const n = porPersona.get(p.id);
        return {
          clave: `p:${p.id}`, persona_id: p.id, usuario_id: p.usuario_id, nombre: p.nombre,
          email: p.usuario_email ?? p.email, rol: p.rol, rol_usuario: p.usuario_rol ?? null,
          comision_venta_pct: Number(p.comision_venta_pct), activo: p.activo,
          acceso: Boolean(p.usuario_id && p.usuario_activo), ultimo_acceso_en: p.ultimo_acceso_en ?? null,
          ventas: n?.ventas ?? 0, vendido: r2(n?.vendido), comision: r2(n?.comision),
        };
      }),
      ...usuarios.map((u: any) => ({
        clave: `u:${u.id}`, persona_id: null, usuario_id: u.id, nombre: u.nombre, email: u.email,
        rol: null, rol_usuario: u.rol, comision_venta_pct: null, activo: u.activo,
        acceso: u.activo, ultimo_acceso_en: u.ultimo_acceso_en, ventas: 0, vendido: 0, comision: 0,
      })),
    ];
    return {
      periodo: rango, puede_gestionar: esAdmin(req), yo: req.sesion.usuarioId,
      total_comisiones: r2(miembros.filter((m) => m.activo).reduce((s, m) => s + m.comision, 0)),
      miembros,
    };
  });

  /** Las ventas del período de una persona, con su comisión (para pagarle sin calculadora). */
  app.get('/equipo/:id/ventas', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const c = req.sesion.cuentaId;
    const { rango } = await rangoDePeticion(req);
    return query(
      `SELECT v.id, to_char(v.fecha,'YYYY-MM-DD') AS fecha, v.precio_acordado, v.moneda, v.estado,
              l.nombre AS lead_nombre, l.ig_username, pr.nombre AS producto,
              CASE WHEN v.closer_id = $2 THEN 'closer' ELSE 'setter' END AS como,
              round(v.precio_acordado * (CASE WHEN v.closer_id = $2 THEN v.comision_closer_pct ELSE v.comision_setter_pct END) / 100, 2) AS comision
         FROM ventas v
         LEFT JOIN leads l ON l.id = v.lead_id
         LEFT JOIN productos pr ON pr.id = v.producto_id
        WHERE v.cuenta_id = $1 AND (v.closer_id = $2 OR v.setter_id = $2) AND ${VIVA} AND ${EN('v.fecha', 3, 4)}
        ORDER BY v.fecha DESC, v.creado_en DESC LIMIT 200`, [c, id, rango.desde, rango.hasta]);
  });

  /** Sumar a alguien al equipo (con su comisión) y, si querés, con acceso al CRM. */
  app.post('/equipo', async (req, reply) => {
    exigirAdmin(req);
    const d = z.object({
      nombre: z.string().trim().min(1, 'Poné el nombre').max(120),
      rol: ROL_UI.default('closer'),
      comision_venta_pct: z.number().min(0).max(100).default(0),
      acceso: ACCESO.nullish(),
    }).parse(req.body);
    const c = req.sesion.cuentaId;
    if (d.acceso) await emailLibre(d.acceso.email);
    const persona = await transaction(async (tx) => {
      let usuarioId: string | null = null;
      if (d.acceso) {
        const { rows } = await tx.query(
          `INSERT INTO usuarios (cuenta_id, email, nombre, password_hash, rol) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [c, d.acceso.email, d.nombre, await hashPassword(d.acceso.password), rolUsuario(d.rol)]);
        usuarioId = rows[0].id;
      }
      const { rows } = await tx.query(
        `INSERT INTO personas_equipo (cuenta_id, nombre, email, rol, comision_venta_pct, usuario_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [c, d.nombre, d.acceso?.email ?? null, rolPersona(d.rol), d.comision_venta_pct, usuarioId]);
      return rows[0];
    });
    // La contraseña se devuelve UNA sola vez (para pasársela a la persona).
    return reply.code(201).send({ persona, acceso: d.acceso ? { email: d.acceso.email, password: d.acceso.password } : null });
  });

  /** Editar nombre, rol o comisión (y el usuario del CRM enlazado acompaña). */
  app.patch('/equipo/:id', async (req) => {
    exigirAdmin(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const d = z.object({
      nombre: z.string().trim().min(1, 'Poné el nombre').max(120).optional(),
      rol: ROL_UI.optional(),
      comision_venta_pct: z.number().min(0).max(100).optional(),
    }).parse(req.body);
    const c = req.sesion.cuentaId;
    const p = await personaDe(c, id);
    const sets: Record<string, any> = {};
    if (d.nombre !== undefined) sets.nombre = d.nombre;
    if (d.rol !== undefined) sets.rol = rolPersona(d.rol);
    if (d.comision_venta_pct !== undefined) sets.comision_venta_pct = d.comision_venta_pct;
    if (!Object.keys(sets).length) throw peticionInvalida('Nada que cambiar');
    const keys = Object.keys(sets);
    await pool.query(`UPDATE personas_equipo SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE cuenta_id = $1 AND id = $2`,
      [c, id, ...keys.map((k) => sets[k])]);
    if (p.usuario_id && p.usuario_rol !== 'owner') {
      if (d.nombre !== undefined) await pool.query(`UPDATE usuarios SET nombre = $3 WHERE cuenta_id = $1 AND id = $2`, [c, p.usuario_id, d.nombre]);
      if (d.rol !== undefined && p.usuario_id !== req.sesion.usuarioId) {
        await pool.query(`UPDATE usuarios SET rol = $3 WHERE cuenta_id = $1 AND id = $2`, [c, p.usuario_id, rolUsuario(d.rol)]);
      }
    }
    return personaDe(c, id);
  });

  /** Dar de baja: deja de aparecer al vender y no entra más al CRM. Sus ventas y comisiones quedan. */
  app.post('/equipo/:id/baja', async (req) => {
    exigirAdmin(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const c = req.sesion.cuentaId;
    const p = await personaDe(c, id);
    await pool.query(`UPDATE personas_equipo SET activo = false WHERE cuenta_id = $1 AND id = $2`, [c, id]);
    let accesoCortado = false;
    if (p.usuario_id && p.usuario_rol !== 'owner' && p.usuario_id !== req.sesion.usuarioId && p.usuario_activo) {
      await pool.query(`UPDATE usuarios SET activo = false WHERE cuenta_id = $1 AND id = $2`, [c, p.usuario_id]);
      accesoCortado = true;
    }
    return { ...(await personaDe(c, id)), acceso_cortado: accesoCortado };
  });

  /** Volver a sumar a alguien que estaba de baja (y su acceso, si lo tenía). */
  app.post('/equipo/:id/alta', async (req) => {
    exigirAdmin(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const c = req.sesion.cuentaId;
    const p = await personaDe(c, id);
    await pool.query(`UPDATE personas_equipo SET activo = true WHERE cuenta_id = $1 AND id = $2`, [c, id]);
    if (p.usuario_id) await pool.query(`UPDATE usuarios SET activo = true WHERE cuenta_id = $1 AND id = $2`, [c, p.usuario_id]);
    return personaDe(c, id);
  });

  /** Darle acceso al CRM a alguien del equipo que todavía no entra. */
  app.post('/equipo/:id/acceso', async (req, reply) => {
    exigirAdmin(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const d = ACCESO.extend({ rol: ROL_UI.optional() }).parse(req.body);
    const c = req.sesion.cuentaId;
    const p = await personaDe(c, id);
    if (p.usuario_id) throw conflicto('Ya puede entrar al CRM. Si se olvidó la contraseña, poné una nueva.');
    await emailLibre(d.email);
    await transaction(async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO usuarios (cuenta_id, email, nombre, password_hash, rol, activo) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [c, d.email, p.nombre, await hashPassword(d.password), rolUsuario(d.rol ?? p.rol), p.activo]);
      await tx.query(`UPDATE personas_equipo SET usuario_id = $3, email = $4 WHERE cuenta_id = $1 AND id = $2`, [c, id, rows[0].id, d.email]);
    });
    return reply.code(201).send({ persona: await personaDe(c, id), acceso: { email: d.email, password: d.password } });
  });

  /** Nueva contraseña para alguien del equipo (se muestra una sola vez). */
  app.post('/equipo/:id/clave', async (req) => {
    exigirAdmin(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { password } = ACCESO.pick({ password: true }).parse(req.body);
    const c = req.sesion.cuentaId;
    const p = await personaDe(c, id);
    if (!p.usuario_id) throw peticionInvalida('Todavía no entra al CRM: dale acceso primero.');
    if (p.usuario_rol === 'owner' && p.usuario_id !== req.sesion.usuarioId) throw prohibido('La contraseña del dueño la cambia solo el dueño.');
    await pool.query(`UPDATE usuarios SET password_hash = $3 WHERE cuenta_id = $1 AND id = $2`, [c, p.usuario_id, await hashPassword(password)]);
    return { email: p.usuario_email, password };
  });

  /** Enlazar una persona del equipo con un usuario del CRM que no tiene ficha (es la misma persona). */
  app.post('/equipo/:id/vincular', async (req) => {
    exigirAdmin(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { usuario_id } = z.object({ usuario_id: z.string().uuid() }).parse(req.body);
    const c = req.sesion.cuentaId;
    const p = await personaDe(c, id);
    if (p.usuario_id) throw conflicto('Esta persona ya está enlazada con un usuario del CRM.');
    const u = await queryOne(`SELECT id, email FROM usuarios WHERE cuenta_id = $1 AND id = $2`, [c, usuario_id]);
    if (!u) throw noEncontrado('Usuario');
    if (await queryOne(`SELECT 1 FROM personas_equipo WHERE usuario_id = $1`, [usuario_id])) throw conflicto('Ese usuario ya tiene su ficha en el equipo.');
    await pool.query(`UPDATE personas_equipo SET usuario_id = $3, email = COALESCE(email, $4) WHERE cuenta_id = $1 AND id = $2`, [c, id, usuario_id, u.email]);
    return personaDe(c, id);
  });

  /** Un usuario del CRM sin ficha: se le configura la comisión con un toque. */
  app.post('/equipo/usuario/:usuarioId/ficha', async (req, reply) => {
    exigirAdmin(req);
    const { usuarioId } = z.object({ usuarioId: z.string().uuid() }).parse(req.params);
    const d = z.object({
      comision_venta_pct: z.number().min(0).max(100).default(0),
      rol: ROL_UI.optional(),
    }).parse(req.body ?? {});
    const c = req.sesion.cuentaId;
    const u = await queryOne(`SELECT id, nombre, email, rol, activo FROM usuarios WHERE cuenta_id = $1 AND id = $2`, [c, usuarioId]);
    if (!u) throw noEncontrado('Usuario');
    if (await queryOne(`SELECT 1 FROM personas_equipo WHERE usuario_id = $1`, [usuarioId])) throw conflicto('Ya tiene su ficha en el equipo.');
    const p = await queryOne(
      `INSERT INTO personas_equipo (cuenta_id, nombre, email, rol, comision_venta_pct, usuario_id, activo)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [c, u.nombre, u.email, d.rol ? rolPersona(d.rol) : rolDeUsuario(u.rol), d.comision_venta_pct, u.id, u.activo]);
    return reply.code(201).send(await personaDe(c, p!.id));
  });
}
