import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne, pool, transaction } from '../db/pool.js';
import { AppError, conflicto, peticionInvalida, prohibido } from '../lib/errores.js';
import { borrarDemo, cargarDemo, hayDemo } from '../modules/demo.js';
import { registrarEvento } from '../modules/eventos.js';
import {
  comisionDe, comisionPctDe, fechaISO, hoyEn, planDeCuotas, recalcularEstadoVenta, repartir, sumarDias,
  type Consultable,
} from '../modules/ventas_sync.js';
import type { FastifyRequest } from 'fastify';

/** Deja solo las claves permitidas y definidas (whitelist → SQL seguro). */
function pick(body: any, cols: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const c of cols) if (body && body[c] !== undefined) out[c] = body[c] === '' ? null : body[c];
  return out;
}

/** Solo el dueño o un administrador pueden cambiar el equipo (y quién cobra qué comisión). */
export const esAdmin = (req: FastifyRequest) => ['owner', 'admin'].includes(req.sesion?.rol);
export function exigirAdmin(req: FastifyRequest, mensaje = 'Solo el dueño o un administrador pueden cambiar el equipo.') {
  if (!esAdmin(req)) throw prohibido(mensaje);
}

/** "No encontramos esa venta…" (con el género bien y sin nombres de tablas). */
export const noEsta = (que: string) => new AppError(404, 'no_encontrado', `No encontramos ${que}. Puede que ya se haya borrado.`);
const NOMBRE_TABLA: Record<string, string> = {
  ventas: 'esa venta', pagos: 'esa cuota', gastos: 'ese gasto', productos: 'ese curso', metodos_pago: 'ese método de cobro',
  personas_equipo: 'esa persona del equipo', llamadas: 'esa llamada', seguimientos: 'ese seguimiento',
};

/** Lo que se elige (lead, curso, persona, venta…) tiene que ser de ESTA cuenta: nada de ids de otra. */
const DE_LA_CUENTA: Record<string, { tabla: string; que: string }> = {
  lead_id: { tabla: 'leads', que: 'ese lead' },
  producto_id: { tabla: 'productos', que: 'ese curso' },
  closer_id: { tabla: 'personas_equipo', que: 'esa persona del equipo' },
  setter_id: { tabla: 'personas_equipo', que: 'esa persona del equipo' },
  llamada_id: { tabla: 'llamadas', que: 'esa llamada' },
  venta_id: { tabla: 'ventas', que: 'esa venta' },
  pago_id: { tabla: 'pagos', que: 'esa cuota' },
  contenido_id: { tabla: 'contenidos', que: 'ese contenido' },
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function idsDeLaCuenta(cuentaId: string, d: Record<string, any>) {
  for (const [col, { tabla, que }] of Object.entries(DE_LA_CUENTA)) {
    const v = d[col];
    if (v === undefined || v === null) continue;
    const ok = typeof v === 'string' && UUID.test(v)
      && await queryOne(`SELECT 1 FROM ${tabla} WHERE cuenta_id = $1 AND id = $2`, [cuentaId, v]);
    if (!ok) throw noEsta(`${que} en tu cuenta`);
  }
}

/** "YYYY-MM-DD" de un date de Postgres (llega como Date a medianoche local) o de un texto. */
export function diaDe(v: any): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  return m ? m[1] : null;
}

interface Ganchos {
  /** Solo dueño o administrador pueden crear, editar o borrar. */
  soloAdmin?: boolean;
  /** Qué se le dice a quien no puede (por defecto, lo del equipo). */
  mensajeAdmin?: string;
  /** Ajusta los datos antes de guardar (antes = fila actual al editar; null al crear). */
  antesDeGuardar?: (req: FastifyRequest, datos: Record<string, any>, antes: any | null) => Promise<Record<string, any>> | Record<string, any>;
  despuesDeCrear?: (req: FastifyRequest, fila: any) => Promise<void>;
  despuesDeEditar?: (req: FastifyRequest, antes: any, fila: any) => Promise<void>;
  antesDeBorrar?: (req: FastifyRequest, fila: any) => Promise<void>;
}

/** CRUD genérico multi-tenant para una tabla con lista de columnas editables. */
function crud(app: FastifyInstance, ruta: string, tabla: string, cols: string[], orden = 'creado_en DESC', ganchos: Ganchos = {}) {
  app.get(ruta, async (req) =>
    query(`SELECT * FROM ${tabla} WHERE cuenta_id = $1 ORDER BY ${orden}`, [req.sesion.cuentaId]));

  app.post(ruta, async (req, reply) => {
    if (ganchos.soloAdmin) exigirAdmin(req, ganchos.mensajeAdmin);
    let d = pick(req.body, cols);
    if (ganchos.antesDeGuardar) d = await ganchos.antesDeGuardar(req, d, null);
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
    if (ganchos.soloAdmin) exigirAdmin(req, ganchos.mensajeAdmin);
    const { id } = req.params as { id: string };
    const antes = ganchos.despuesDeEditar || ganchos.antesDeGuardar
      ? await queryOne(`SELECT * FROM ${tabla} WHERE cuenta_id = $1 AND id = $2`, [req.sesion.cuentaId, id])
      : null;
    if ((ganchos.despuesDeEditar || ganchos.antesDeGuardar) && !antes) throw noEsta(NOMBRE_TABLA[tabla] ?? 'eso');
    let d = pick(req.body, cols);
    if (ganchos.antesDeGuardar) d = await ganchos.antesDeGuardar(req, d, antes);
    const keys = Object.keys(d);
    if (keys.length === 0) throw peticionInvalida('Nada que actualizar');
    const sets = keys.map((k, i) => `${k} = $${i + 3}`);
    const fila = await queryOne(
      `UPDATE ${tabla} SET ${sets.join(', ')} WHERE cuenta_id = $1 AND id = $2 RETURNING *`,
      [req.sesion.cuentaId, id, ...keys.map((k) => d[k])]);
    if (!fila) throw noEsta(NOMBRE_TABLA[tabla] ?? 'eso');
    if (ganchos.despuesDeEditar) await ganchos.despuesDeEditar(req, antes, fila);
    return fila;
  });

  app.delete(`${ruta}/:id`, async (req, reply) => {
    if (ganchos.soloAdmin) exigirAdmin(req, ganchos.mensajeAdmin);
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

/** La moneda de la cuenta (para lo que se carga sin moneda: nada de EUR fijo). */
export async function monedaDeCuenta(cuentaId: string): Promise<string> {
  const c = await queryOne(`SELECT moneda FROM cuentas WHERE id = $1`, [cuentaId]);
  return (c?.moneda || 'EUR').toUpperCase();
}

type AntesDeGuardar = NonNullable<Ganchos['antesDeGuardar']>;

/** Lo más grande que entra en la base (numeric(12,2)): más que eso es un error de tipeo. */
export const MONTO_MAX = 9_999_999_999;

const conMonedaDeCuenta: AntesDeGuardar = async (req, d, antes) => {
  if (!antes && !d.moneda) d.moneda = await monedaDeCuenta(req.sesion.cuentaId);
  return d;
};

// --- Ventas unificadas con el Panel (ver modules/ventas_sync.ts) ---------

/** Una venta cargada en Finanzas genera su evento "venta" (lo que cuenta el Panel). */
export async function eventoDeVenta(cuentaId: string, v: any) {
  if (!v?.lead_id || v.evento_id) return;
  const prod = v.producto_id
    ? await queryOne(`SELECT nombre FROM productos WHERE cuenta_id = $1 AND id = $2`, [cuentaId, v.producto_id])
    : null;
  const dia = diaDe(v.fecha);
  await registrarEvento({
    cuentaId, tipo: 'venta', leadId: v.lead_id, valor: Number(v.precio_acordado ?? 0), moneda: v.moneda ?? undefined,
    titulo: prod?.nombre ?? undefined, tipoPago: v.tipo_cobro === 'cuotas' ? 'cuotas' : 'completo',
    fuente: 'manual',
    ocurridoEn: dia ? new Date(`${dia}T12:00:00Z`) : new Date(),
    idempotencyKey: `venta_${v.id}`, payload: { venta_id: v.id, origen: 'finanzas' },
  });
}

/** Saca del Panel el evento "venta" de una venta de Finanzas (y descuenta el valor del lead). */
export async function quitarEventoDeVenta(cuentaId: string, fila: any) {
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

/**
 * Corrige las cuotas que faltan cobrar cuando cambia el precio: lo que ya
 * entró no se toca y el resto se reparte en las cuotas pendientes (o en una
 * nueva, si no quedaba ninguna). Cada cuota lleva la comisión de su pasarela.
 */
const mayor = (a: string, b: string) => (a > b ? a : b);

export async function reajustarCuotas(db: Consultable, cuentaId: string, venta: any) {
  const { rows: pagos } = await db.query(
    `SELECT id, num_cuota, monto, estado, pasarela FROM pagos WHERE cuenta_id = $1 AND venta_id = $2 ORDER BY num_cuota, creado_en`,
    [cuentaId, venta.id]);
  const cobrado = pagos.filter((p: any) => p.estado === 'pagado').reduce((s: number, p: any) => s + Number(p.monto), 0);
  const pendientes = pagos.filter((p: any) => ['pendiente', 'reagendado', 'fallido'].includes(p.estado));
  const resto = Math.round((Number(venta.precio_acordado) - cobrado) * 100) / 100;
  const pct = await comisionPctDe(db, cuentaId, venta.pasarela);
  if (resto <= 0) {
    if (pendientes.length) await db.query(`DELETE FROM pagos WHERE id = ANY($1::uuid[])`, [pendientes.map((p: any) => p.id)]);
  } else if (!pendientes.length) {
    const num = pagos.reduce((m: number, p: any) => Math.max(m, Number(p.num_cuota)), 0) + 1;
    await db.query(
      `INSERT INTO pagos (cuenta_id, venta_id, num_cuota, monto, vence_en, estado, pasarela, comision_pasarela)
       VALUES ($1, $2, $3, $4, $5, 'pendiente', $6, $7)`,
      // A la semana de la venta, pero nunca antes de hoy (no nace ya atrasada).
      [cuentaId, venta.id, num, resto, mayor(sumarDias(diaDe(venta.fecha) ?? hoyEn(), 7), hoyEn()), venta.pasarela ?? null, comisionDe(resto, pct)]);
  } else {
    const montos = repartir(resto, pendientes.length);
    for (let i = 0; i < pendientes.length; i++) {
      await db.query(`UPDATE pagos SET monto = $2, comision_pasarela = $3 WHERE id = $1`,
        [pendientes[i].id, montos[i], comisionDe(montos[i], pct)]);
    }
  }
  await recalcularEstadoVenta(db, cuentaId, venta.id);
}

/**
 * Una venta corregida en Finanzas se corrige también en el Panel: el valor
 * del evento (y del lead), la fecha y, si cambió el precio, las cuotas que
 * faltan cobrar.
 */
export async function sincronizarEdicionVenta(cuentaId: string, antes: any, fila: any) {
  if (!antes) return;
  const precioAntes = Number(antes.precio_acordado ?? 0);
  const precio = Number(fila.precio_acordado ?? 0);
  const cambioPrecio = Math.abs(precio - precioAntes) > 0.004;
  const diaAntes = diaDe(antes.fecha);
  const dia = diaDe(fila.fecha);
  if (fila.evento_id && cambioPrecio) {
    const ev = await queryOne(
      `UPDATE eventos SET valor = $3 WHERE cuenta_id = $1 AND id = $2 RETURNING lead_id, oportunidad_id`,
      [cuentaId, fila.evento_id, precio]);
    if (ev?.lead_id) {
      await pool.query(`UPDATE leads SET valor_total = GREATEST(valor_total + $3, 0) WHERE cuenta_id = $1 AND id = $2`,
        [cuentaId, ev.lead_id, precio - precioAntes]);
    }
    if (ev?.oportunidad_id) {
      await pool.query(`UPDATE oportunidades SET valor = $3 WHERE cuenta_id = $1 AND id = $2 AND estado = 'ganada'`,
        [cuentaId, ev.oportunidad_id, precio]);
    }
    // Si ya estaba devuelta, la devolución acompaña al nuevo importe (el Panel sigue en cero).
    await pool.query(`UPDATE eventos SET valor = $3 WHERE cuenta_id = $1 AND idempotency_key = $2 AND tipo = 'reembolso'`,
      [cuentaId, `reembolso_venta_${fila.id}`, precio]);
  }
  if (fila.evento_id && dia && dia !== diaAntes) {
    await pool.query(`UPDATE eventos SET ocurrido_en = $3::timestamptz WHERE cuenta_id = $1 AND id = $2`,
      [cuentaId, fila.evento_id, `${dia}T12:00:00Z`]);
  }
  if (cambioPrecio && !['cancelada', 'reembolsada'].includes(fila.estado)) {
    await reajustarCuotas(pool, cuentaId, fila);
  }
}

/** Sin setter (o sin closer) no hay a quién pagarle: esa comisión es 0. */
function sinComisionFantasma(d: Record<string, any>, antes: any | null) {
  const setter = 'setter_id' in d ? d.setter_id : antes?.setter_id;
  const closer = 'closer_id' in d ? d.closer_id : antes?.closer_id;
  if (!setter && (d.comision_setter_pct !== undefined || ('setter_id' in d))) d.comision_setter_pct = 0;
  if (!closer && (d.comision_closer_pct !== undefined || ('closer_id' in d))) d.comision_closer_pct = 0;
  return d;
};

/** Quien cierra (o consigue) sin % mandado: el de su ficha de Equipo, igual que al registrar. */
async function pctDeFicha(cuentaId: string, d: Record<string, any>, antes: any | null) {
  for (const rol of ['closer', 'setter'] as const) {
    const id = d[`${rol}_id`];
    if (!id || d[`comision_${rol}_pct`] !== undefined || (antes && antes[`${rol}_id`] === id)) continue;
    const p = await queryOne(`SELECT comision_venta_pct FROM personas_equipo WHERE cuenta_id = $1 AND id = $2`, [cuentaId, id]);
    d[`comision_${rol}_pct`] = Number(p?.comision_venta_pct ?? 0);
  }
}

const GANCHOS_VENTA: Ganchos = {
  // Registrar se puede desde el Pipeline y el Chat (POST /ventas/registrar); corregir,
  // cancelar, devolver o borrar una venta (y tocar comisiones) es del dueño o un admin.
  soloAdmin: true,
  mensajeAdmin: 'Solo el dueño o un administrador pueden corregir, cancelar o borrar ventas.',
  antesDeGuardar: async (req, d, antes) => {
    await idsDeLaCuenta(req.sesion.cuentaId, d);
    if (d.precio_acordado !== undefined && !(Number(d.precio_acordado) > 0 && Number(d.precio_acordado) <= MONTO_MAX)) {
      throw peticionInvalida('Poné un monto mayor a 0.');
    }
    const closerFinal = 'closer_id' in d ? d.closer_id : antes?.closer_id;
    const setterFinal = 'setter_id' in d ? d.setter_id : antes?.setter_id;
    if (closerFinal && setterFinal && closerFinal === setterFinal) {
      throw peticionInvalida('La misma persona no puede ser closer y setter de la misma venta.');
    }
    await pctDeFicha(req.sesion.cuentaId, d, antes);
    sinComisionFantasma(d, antes);
    return conMonedaDeCuenta(req, d, antes);
  },
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
    // Reactivada: el estado vuelve a salir de sus cobros.
    if (antes?.estado === 'cancelada' && fila.estado !== 'cancelada' && fila.estado !== 'reembolsada') {
      await recalcularEstadoVenta(pool, req.sesion.cuentaId, fila.id);
    }
    // Precio o fecha corregidos: el Panel y las cuotas pendientes acompañan.
    await sincronizarEdicionVenta(req.sesion.cuentaId, antes, fila);
  },
  // Borrar una venta (p. ej. cargada por error) la saca también del Panel.
  antesDeBorrar: async (req, fila) => { await quitarEventoDeVenta(req.sesion.cuentaId, fila); },
};

export default async function rutasFinanzas(app: FastifyInstance) {
  // Cargar datos de demostración en la cuenta actual (para ver el CRM "con vida").
  app.post('/demo/cargar', async (req) => {
    exigirAdmin(req, 'Solo el dueño puede cargar datos de prueba.');
    const n = Number((req.query as any)?.leads ?? 14);
    return cargarDemo(req.sesion.cuentaId, Math.min(Math.max(n, 1), 40));
  });
  app.get('/demo', async (req) => ({ leads: await hayDemo(req.sesion.cuentaId) }));
  app.post('/demo/borrar', async (req) => {
    exigirAdmin(req, 'Solo el dueño puede borrar los datos de prueba.');
    return borrarDemo(req.sesion.cuentaId);
  });

  crud(app, '/productos', 'productos',
    ['nombre', 'descripcion', 'precio_lista', 'moneda', 'duracion', 'activo', 'link_pago'], 'nombre', {
      antesDeGuardar: conMonedaDeCuenta,
      // Un curso con ventas no se borra (sus ventas perderían de qué eran): se archiva.
      antesDeBorrar: async (req, fila) => {
        const n = await queryOne(`SELECT COUNT(*)::int AS n FROM ventas WHERE cuenta_id = $1 AND producto_id = $2`,
          [req.sesion.cuentaId, fila.id]);
        if (n?.n) throw conflicto('Este curso tiene ventas: archivalo y deja de aparecer al vender, sin perder el historial.');
      },
    });
  crud(app, '/equipo', 'personas_equipo',
    ['nombre', 'email', 'telefono', 'rol', 'comision_venta_pct', 'comision_cobro_pct',
     'comision_cita_pct', 'contrato_url', 'activo', 'notas'], 'nombre', { soloAdmin: true });
  crud(app, '/metodos-pago', 'metodos_pago',
    ['nombre', 'tipo', 'descripcion', 'region', 'comision_pct', 'activo'], 'nombre');
  crud(app, '/gastos', 'gastos',
    ['fecha', 'descripcion', 'categoria', 'subcategoria', 'centro_coste', 'tipo', 'periodicidad',
     'importe', 'moneda', 'metodo', 'venta_id', 'pago_id', 'contenido_id',
     'es_comision_ventas', 'es_comision_pasarela', 'notas'], 'fecha DESC', {
      antesDeGuardar: async (req, d, antes) => {
        await idsDeLaCuenta(req.sesion.cuentaId, d);
        if (d.importe !== undefined && !(Number(d.importe) >= 0 && Number(d.importe) <= MONTO_MAX)) throw peticionInvalida('Poné cuánto salió (un número).');
        return conMonedaDeCuenta(req, d, antes);
      },
    });
  crud(app, '/pagos', 'pagos',
    ['venta_id', 'num_cuota', 'monto', 'vence_en', 'cobrado_en', 'estado', 'pasarela',
     'comision_pasarela', 'notas'], 'vence_en NULLS LAST', {
      // Una cuota solo puede ser de una venta de esta cuenta.
      antesDeGuardar: async (req, d) => { await idsDeLaCuenta(req.sesion.cuentaId, d); return d; },
      // Cobrar (o deshacer) una cuota cambia el estado de su venta.
      despuesDeEditar: async (req, _antes, fila) => { await recalcularEstadoVenta(pool, req.sesion.cuentaId, fila.venta_id); },
    });

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

  // --- Ventas (con comisiones y lo que te queda calculados) ---
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
              (SELECT COALESCE(SUM(pg.comision_pasarela),0) FROM pagos pg WHERE pg.venta_id = v.id AND pg.estado <> 'reembolsado') AS comision_cobro,
              -- "Te queda": la MISMA cuenta que el Resumen (precio − equipo − comisión de cobro).
              round(v.precio_acordado
                    - v.precio_acordado * v.comision_setter_pct / 100
                    - v.precio_acordado * v.comision_closer_pct / 100
                    - (SELECT COALESCE(SUM(pg.comision_pasarela),0) FROM pagos pg WHERE pg.venta_id = v.id AND pg.estado <> 'reembolsado'), 2) AS neto,
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

  /**
   * Registrar una venta con sus cuotas. "¿Ya te pagó?" (cobrado):
   *  - todo: la venta queda cobrada (pago único) o todas sus cuotas cobradas.
   *  - parte: pago único con seña (cobrado_monto) o en cuotas con las primeras
   *    `cuotas_cobradas` ya pagadas (1 por defecto).
   *  - nada (por defecto): todo queda por cobrar; la primera cuota vence en
   *    `vence_proxima` (o el día de la venta).
   * La comisión del closer/setter sale de su ficha si no se manda, y sin
   * closer/setter es 0 (nada de comisiones "fantasma").
   */
  app.post('/ventas/registrar', async (req, reply) => {
    const uuid = z.string().uuid();
    const d = z.object({
      lead_id: uuid.nullish(),
      producto_id: uuid.nullish(),
      closer_id: uuid.nullish(),
      setter_id: uuid.nullish(),
      metodo_pago_id: uuid.nullish(),
      fecha: z.string().max(40).nullish(),
      tipo_cobro: z.enum(['unico', 'cuotas']).default('unico'),
      precio_lista: z.number().min(0).max(MONTO_MAX).nullish(),
      precio_acordado: z.number().max(MONTO_MAX, 'Ese monto es demasiado grande.'),
      moneda: z.string().min(3).max(3).nullish(),
      num_cuotas: z.number().int().min(1).max(60).default(1),
      comision_setter_pct: z.number().min(0).max(100).nullish(),
      comision_closer_pct: z.number().min(0).max(100).nullish(),
      notas: z.string().max(2000).nullish(),
      cobrado: z.enum(['todo', 'parte', 'nada']).optional(),
      cobrado_monto: z.number().min(0).max(MONTO_MAX).nullish(),
      cuotas_cobradas: z.number().int().min(0).max(60).nullish(),
      vence_proxima: z.string().max(40).nullish(),
    }).parse(req.body);
    const c = req.sesion.cuentaId;
    if (!(d.precio_acordado > 0)) throw peticionInvalida('Poné el monto de la venta (mayor a 0).');
    if (d.tipo_cobro === 'cuotas' && d.num_cuotas < 2) throw peticionInvalida('Una venta en cuotas tiene al menos 2 cuotas.');

    // Todo lo que se elige tiene que ser de esta cuenta.
    const cuenta = await queryOne(`SELECT moneda, zona_horaria FROM cuentas WHERE id = $1`, [c]);
    const [lead, producto, closer, setterBruto, metodo] = await Promise.all([
      d.lead_id ? queryOne(`SELECT id FROM leads WHERE cuenta_id = $1 AND id = $2`, [c, d.lead_id]) : null,
      d.producto_id ? queryOne(`SELECT id, precio_lista FROM productos WHERE cuenta_id = $1 AND id = $2`, [c, d.producto_id]) : null,
      d.closer_id ? queryOne(`SELECT id, comision_venta_pct FROM personas_equipo WHERE cuenta_id = $1 AND id = $2`, [c, d.closer_id]) : null,
      d.setter_id ? queryOne(`SELECT id, comision_venta_pct FROM personas_equipo WHERE cuenta_id = $1 AND id = $2`, [c, d.setter_id]) : null,
      d.metodo_pago_id ? queryOne(`SELECT nombre, comision_pct FROM metodos_pago WHERE cuenta_id = $1 AND id = $2`, [c, d.metodo_pago_id]) : null,
    ]);
    if (d.lead_id && !lead) throw noEsta('ese lead en tu cuenta');
    if (d.producto_id && !producto) throw noEsta('ese curso en tu cuenta');
    if (d.closer_id && !closer) throw noEsta('esa persona del equipo');
    if (d.setter_id && !setterBruto) throw noEsta('esa persona del equipo');
    if (d.metodo_pago_id && !metodo) throw noEsta('ese método de cobro');
    // La misma persona no cobra dos veces la misma venta.
    const setter = setterBruto && setterBruto.id !== closer?.id ? setterBruto : null;
    // El % lo decide el dueño (o un admin): un closer que registra desde el
    // Pipeline o el Chat no se puede subir la comisión; sale de su ficha.
    const admin = esAdmin(req);
    const pctCloser = closer ? Number((admin ? d.comision_closer_pct : null) ?? closer.comision_venta_pct ?? 0) : 0;
    const pctSetter = setter ? Number((admin ? d.comision_setter_pct : null) ?? setter.comision_venta_pct ?? 0) : 0;

    const pasarela: string | null = metodo?.nombre ?? null;
    const comPct = Number(metodo?.comision_pct ?? 0) || 0;
    const hoy = hoyEn(cuenta?.zona_horaria);
    const fecha = fechaISO(d.fecha, hoy);
    const moneda = (d.moneda || cuenta?.moneda || 'EUR').toUpperCase();
    const plan = planDeCuotas({
      precio: d.precio_acordado, tipoCobro: d.tipo_cobro, numCuotas: d.num_cuotas, fecha,
      cobrado: d.cobrado ?? 'nada', cobradoMonto: d.cobrado_monto ?? undefined,
      cuotasCobradas: d.cuotas_cobradas ?? undefined,
      venceProxima: d.vence_proxima ? fechaISO(d.vence_proxima, fecha) : null,
    });
    const pagadas = plan.filter((p) => p.estado === 'pagado').length;
    const estado = pagadas === plan.length ? 'completada'
      : d.tipo_cobro === 'cuotas' ? 'en_cuotas' : pagadas > 0 ? 'senado' : 'activa';

    const { venta, pagos } = await transaction(async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO ventas (cuenta_id, lead_id, producto_id, closer_id, setter_id, fecha, tipo_cobro,
           precio_lista, precio_acordado, moneda, num_cuotas, pasarela, estado,
           comision_setter_pct, comision_closer_pct, notas)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [c, lead?.id ?? null, producto?.id ?? null, closer?.id ?? null, setter?.id ?? null,
         fecha, d.tipo_cobro, d.precio_lista ?? producto?.precio_lista ?? null,
         d.precio_acordado, moneda, plan.length, pasarela, estado,
         pctSetter, pctCloser, d.notas?.trim() || null]);
      const v = rows[0];
      const creados: any[] = [];
      for (const p of plan) {
        const r = await tx.query(
          `INSERT INTO pagos (cuenta_id, venta_id, num_cuota, monto, vence_en, cobrado_en, estado, pasarela, comision_pasarela)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [c, v.id, p.num, p.monto, p.vence, p.cobrado_en, p.estado, pasarela, comisionDe(p.monto, comPct)]);
        creados.push(r.rows[0]);
      }
      return { venta: v, pagos: creados };
    });
    // La venta cuenta en el Panel (evento "venta", que también mueve la oportunidad a ganada).
    await eventoDeVenta(c, venta);
    const porCobrar = plan.filter((p) => p.estado === 'pendiente').reduce((s, p) => s + p.monto, 0);
    const proxima = plan.find((p) => p.estado === 'pendiente')?.vence ?? null;
    return reply.code(201).send({
      ...venta, fecha, cuotas: plan.length, comision_pasarela_pct: comPct, pagos,
      cobrado: Math.round((d.precio_acordado - porCobrar) * 100) / 100,
      por_cobrar: Math.round(porCobrar * 100) / 100, proxima_vence: proxima,
    });
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

  // --- Resumen financiero (desde siempre; el de la pantalla, con período, está en /api/ux/finanzas/resumen) ---
  app.get('/finanzas/resumen', async (req) => {
    const c = req.sesion.cuentaId;
    // Lo que se debe es de ventas vivas: las canceladas o devueltas ya no se cobran.
    const VIVA = `EXISTS (SELECT 1 FROM ventas v WHERE v.id = pagos.venta_id AND v.estado NOT IN ('cancelada','reembolsada'))`;
    const [ventas, cobros, gastos, mora, pendiente] = await Promise.all([
      queryOne(`SELECT COUNT(*)::int n, COALESCE(SUM(precio_acordado),0) total,
                       COALESCE(SUM(precio_acordado*comision_setter_pct/100 + precio_acordado*comision_closer_pct/100),0) comisiones
                  FROM ventas WHERE cuenta_id=$1 AND estado NOT IN ('cancelada','reembolsada')`, [c]),
      // Lo cobrado de ventas vivas: la MISMA cuenta que /api/ux/finanzas/resumen (una venta cancelada no suma).
      queryOne(`SELECT COALESCE(SUM(monto),0) cobrado, COALESCE(SUM(comision_pasarela),0) com_pasarela
                  FROM pagos WHERE cuenta_id=$1 AND estado='pagado' AND ${VIVA}`, [c]),
      queryOne(`SELECT COALESCE(SUM(importe),0) total FROM gastos WHERE cuenta_id=$1
                   AND NOT es_comision_ventas AND NOT es_comision_pasarela
                   AND categoria NOT IN ('comisiones_ventas','comisiones_pasarela')`, [c]),
      queryOne(`SELECT COALESCE(SUM(monto),0) total FROM pagos WHERE cuenta_id=$1
                   AND estado IN ('pendiente','reagendado','fallido') AND vence_en < CURRENT_DATE AND ${VIVA}`, [c]),
      queryOne(`SELECT COALESCE(SUM(monto),0) total FROM pagos WHERE cuenta_id=$1
                   AND estado IN ('pendiente','reagendado','fallido') AND ${VIVA}`, [c]),
    ]);
    const porMes = await query(
      `SELECT to_char(fecha,'YYYY-MM') mes, COALESCE(SUM(precio_acordado),0) ventas
         FROM ventas WHERE cuenta_id=$1 AND estado NOT IN ('cancelada','reembolsada')
        GROUP BY 1 ORDER BY 1 DESC LIMIT 12`, [c]);
    const comprometido = Number(ventas?.total ?? 0);
    const cobrado = Number(cobros?.cobrado ?? 0);
    const gastoTotal = Number(gastos?.total ?? 0);
    const comisiones = Number(ventas?.comisiones ?? 0);
    const comPasarela = Number(cobros?.com_pasarela ?? 0);
    return {
      ventas: ventas?.n ?? 0,
      ingresos_comprometidos: comprometido,
      ingresos_cobrados: cobrado,
      por_cobrar: Number(pendiente?.total ?? 0),
      en_mora: Number(mora?.total ?? 0),
      comisiones,
      comision_pasarela: comPasarela,
      gastos: gastoTotal,
      // Lo que te queda: cobrado − comisiones de cobro − comisiones del equipo − gastos.
      neto_cobrado: Math.round((cobrado - comPasarela - comisiones - gastoTotal) * 100) / 100,
      ticket_medio: ventas?.n ? comprometido / ventas.n : 0,
      por_mes: porMes,
    };
  });
}
