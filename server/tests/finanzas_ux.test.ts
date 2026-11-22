import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closePool, query, queryOne } from '../src/db/pool.js';
import { construirApp } from '../src/app.js';
import { registrarEvento } from '../src/modules/eventos.js';
import { planDeCuotas, repartir, sumarMeses } from '../src/modules/ventas_sync.js';
import { rangoDe } from '../src/routes/ux_finanzas.js';
import { cuentaDePrueba } from './ayuda.js';

// Finanzas: los bugs que tocan la plata (venta sin lead, setter fantasma,
// "por cobrar" aunque ya se cobró, Stripe sin comisión, dos "Neto") y el
// equipo unificado con los usuarios del CRM.

let app: FastifyInstance;
let token: string;
let cuentaId: string;
let sufijo: string;
const auth = (t = token) => ({ authorization: `Bearer ${t}` });

async function pedir(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: any, t = token) {
  const r = await app.inject({ method, url, headers: auth(t), payload });
  return { codigo: r.statusCode, datos: r.body ? r.json() : null };
}

async function nuevoLead(usuario: string, nombre?: string) {
  const r = await registrarEvento({ cuentaId, tipo: 'lead_creado', identidad: { igUsername: usuario, nombre }, fuente: 'manual', sinReglas: true });
  return r.leadId;
}

async function contar() {
  const panel = (await pedir('GET', '/api/analitica/resumen')).datos;
  const fin = (await pedir('GET', '/api/finanzas/resumen')).datos;
  return { panelVentas: Number(panel.ventas), panelIngresos: Number(panel.ingresos), finVentas: Number(fin.ventas), finTotal: Number(fin.ingresos_comprometidos) };
}

async function login(email: string, password: string) {
  return app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
}

beforeAll(async () => {
  app = await construirApp();
  await app.ready();
  const r = await cuentaDePrueba('FinanzasUX');
  cuentaId = r.cuenta.id;
  sufijo = r.sufijo;
  token = (await login(r.usuario.email, 'contrasena-larga-123')).json().token;
});

afterAll(async () => {
  await app.close();
  await closePool();
});

describe('cuotas: cómo se reparte una venta', () => {
  it('reparte exacto, sin centavos perdidos (497 en 3 = 165,67 + 165,67 + 165,66)', () => {
    expect(repartir(497, 3)).toEqual([165.67, 165.67, 165.66]);
    expect(repartir(1000, 3).reduce((s, x) => s + x, 0)).toBeCloseTo(1000, 5);
  });

  it('pago único: todo / nada / una parte (seña)', () => {
    expect(planDeCuotas({ precio: 997, tipoCobro: 'unico', fecha: '2026-11-20', cobrado: 'todo' }))
      .toEqual([{ num: 1, monto: 997, vence: '2026-11-20', estado: 'pagado', cobrado_en: '2026-11-20' }]);
    expect(planDeCuotas({ precio: 997, tipoCobro: 'unico', fecha: '2026-11-20', cobrado: 'nada', venceProxima: '2026-11-27' })[0])
      .toMatchObject({ estado: 'pendiente', vence: '2026-11-27' });
    const sena = planDeCuotas({ precio: 1000, tipoCobro: 'unico', fecha: '2026-11-20', cobrado: 'parte', cobradoMonto: 200 });
    expect(sena.map((p) => [p.monto, p.estado])).toEqual([[200, 'pagado'], [800, 'pendiente']]);
  });

  it('en cuotas: las primeras ya pagadas y el resto mes a mes (sin saltar de mes)', () => {
    const plan = planDeCuotas({ precio: 1500, tipoCobro: 'cuotas', numCuotas: 3, fecha: '2026-01-31', cobrado: 'parte', cuotasCobradas: 1 });
    expect(plan.map((p) => p.estado)).toEqual(['pagado', 'pendiente', 'pendiente']);
    expect(plan.map((p) => p.vence)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(sumarMeses('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('período "este mes" se compara con el mismo tramo del mes anterior', () => {
    const r = rangoDe('mes', '2026-11-20');
    expect(r).toMatchObject({ desde: '2026-11-01', hasta: '2026-12-01', anterior: { desde: '2026-10-01', hasta: '2026-10-21' } });
    expect(rangoDe('mes', '2026-03-31').anterior).toEqual({ desde: '2026-02-01', hasta: '2026-03-01' });
    expect(rangoDe('todo', '2026-11-20')).toMatchObject({ desde: null, anterior: null });
  });
});

describe('registrar una venta', () => {
  let stripeId: string;
  let marcoId: string;

  beforeAll(async () => {
    stripeId = (await pedir('POST', '/api/metodos-pago', { nombre: 'Stripe', tipo: 'pasarela', comision_pct: 4.5 })).datos.id;
    marcoId = (await pedir('POST', '/api/ux/finanzas/equipo', { nombre: 'Marco', rol: 'closer', comision_venta_pct: 18 })).datos.persona.id;
  });

  it('"Sí, ya me pagó todo": queda cobrada (no "por cobrar") y no aparece como atrasada', async () => {
    const lead = await nuevoLead('pago.todo');
    const r = await pedir('POST', '/api/ventas/registrar', { lead_id: lead, precio_acordado: 1497, metodo_pago_id: stripeId, cobrado: 'todo', fecha: '2026-11-10' });
    expect(r.codigo).toBe(201);
    expect(r.datos.estado).toBe('completada');
    expect(r.datos.por_cobrar).toBe(0);
    const pagos = await query(`SELECT estado, to_char(cobrado_en,'YYYY-MM-DD') cobrado_en, comision_pasarela FROM pagos WHERE venta_id = $1`, [r.datos.id]);
    expect(pagos).toEqual([{ estado: 'pagado', cobrado_en: '2026-11-10', comision_pasarela: 67.37 }]);
    const cobros = (await pedir('GET', '/api/ux/finanzas/cobros')).datos;
    expect(cobros.pendientes.find((p: any) => p.venta_id === r.datos.id)).toBeUndefined();
  });

  it('"Nada todavía": queda por cobrar con su vencimiento', async () => {
    const lead = await nuevoLead('pago.nada');
    const r = await pedir('POST', '/api/ventas/registrar', { lead_id: lead, precio_acordado: 497, cobrado: 'nada', vence_proxima: '2030-01-15' });
    expect(r.datos.estado).toBe('activa');
    expect(r.datos.por_cobrar).toBe(497);
    expect(r.datos.proxima_vence).toBe('2030-01-15');
  });

  it('en cuotas con la primera ya pagada: el resto queda por cobrar y la suma es exacta', async () => {
    const lead = await nuevoLead('pago.cuotas');
    const r = await pedir('POST', '/api/ventas/registrar', {
      lead_id: lead, precio_acordado: 497, tipo_cobro: 'cuotas', num_cuotas: 3, cobrado: 'parte', cuotas_cobradas: 1,
    });
    expect(r.datos.estado).toBe('en_cuotas');
    const pagos = await query(`SELECT monto, estado FROM pagos WHERE venta_id = $1 ORDER BY num_cuota`, [r.datos.id]);
    expect(pagos.map((p: any) => p.estado)).toEqual(['pagado', 'pendiente', 'pendiente']);
    expect(pagos.reduce((s: number, p: any) => s + Number(p.monto), 0)).toBeCloseTo(497, 5);
    expect(r.datos.por_cobrar).toBeCloseTo(331.33, 2);
  });

  it('sin setter no hay comisión de setter (nada de 5 % fantasma) y el closer trae su % de Equipo', async () => {
    const lead = await nuevoLead('sin.setter');
    const r = await pedir('POST', '/api/ventas/registrar', { lead_id: lead, precio_acordado: 1000, closer_id: marcoId, comision_setter_pct: 5, cobrado: 'todo' });
    expect(Number(r.datos.comision_setter_pct)).toBe(0);
    expect(Number(r.datos.comision_closer_pct)).toBe(18);
    // Por la ruta genérica tampoco.
    const g = await pedir('POST', '/api/ventas', { precio_acordado: 300, comision_setter_pct: 5, comision_closer_pct: 20 });
    expect(Number(g.datos.comision_setter_pct)).toBe(0);
    expect(Number(g.datos.comision_closer_pct)).toBe(0);
    await pedir('DELETE', `/api/ventas/${g.datos.id}`);
  });

  it('no acepta un lead, curso o persona de otra cuenta', async () => {
    const otra = await cuentaDePrueba('Otra');
    const ajeno = (await registrarEvento({ cuentaId: otra.cuenta.id, tipo: 'lead_creado', identidad: { igUsername: 'ajeno' }, fuente: 'manual', sinReglas: true })).leadId;
    const r = await pedir('POST', '/api/ventas/registrar', { lead_id: ajeno, precio_acordado: 100 });
    expect(r.codigo).toBe(404);
  });

  it('una venta que entra sola por Stripe lleva la comisión del método "Stripe"', async () => {
    const lead = await nuevoLead('stripe.con.comision');
    const ev = await registrarEvento({ cuentaId, tipo: 'venta', leadId: lead, valor: 497, fuente: 'stripe', idempotencyKey: 'evt_fin_ux_1', sinReglas: true });
    const p = await queryOne(`SELECT p.comision_pasarela, p.pasarela FROM pagos p JOIN ventas v ON v.id = p.venta_id WHERE v.evento_id = $1`, [ev.eventoId]);
    expect(p.pasarela).toBe('Stripe');
    expect(Number(p.comision_pasarela)).toBe(22.37);
  });

  it('los cobros que entraron sin método (Hotmart) toman la comisión al cargarlo', async () => {
    const lead = await nuevoLead('hotmart.sin.metodo');
    await registrarEvento({ cuentaId, tipo: 'venta', leadId: lead, valor: 200, fuente: 'hotmart', idempotencyKey: 'evt_fin_ux_hot', sinReglas: true });
    const antes = (await pedir('GET', '/api/ux/finanzas/metodos')).datos;
    expect(antes.sin_metodo.map((s: any) => s.nombre)).toContain('Hotmart');
    const m = (await pedir('POST', '/api/metodos-pago', { nombre: 'Hotmart', tipo: 'pasarela', comision_pct: 10 })).datos;
    const r = await pedir('POST', `/api/ux/finanzas/metodos/${m.id}/aplicar`);
    expect(r.datos.actualizados).toBe(1);
    const p = await queryOne(`SELECT p.comision_pasarela FROM pagos p JOIN ventas v ON v.id = p.venta_id WHERE v.lead_id = $1`, [lead]);
    expect(Number(p.comision_pasarela)).toBe(20);
  });
});

describe('Resumen: un solo "te queda" y Panel = Finanzas', () => {
  it('te queda = cobrado − comisiones de cobro − comisiones del equipo − gastos', async () => {
    await pedir('POST', '/api/gastos', { descripcion: 'Anuncios', importe: 100, categoria: 'ads' });
    // Un gasto marcado como comisión no se resta dos veces.
    await pedir('POST', '/api/gastos', { descripcion: 'Comisión Marco', importe: 999, categoria: 'comisiones_ventas' });
    const r = (await pedir('GET', '/api/ux/finanzas/resumen?periodo=todo')).datos;
    const a = r.actual;
    expect(a.gastos).toBe(100);
    expect(a.te_queda).toBeCloseTo(a.cobrado - a.comision_cobro - a.comision_equipo - a.gastos, 2);
    expect(a.comision_cobro).toBeGreaterThan(0);
    expect(r.por_mes).toHaveLength(12);
    // El de siempre dice lo mismo.
    const viejo = (await pedir('GET', '/api/finanzas/resumen')).datos;
    expect(viejo.neto_cobrado).toBeCloseTo(a.te_queda, 2);
    const c = await contar();
    expect(c.panelVentas).toBe(c.finVentas);
    expect(c.panelIngresos).toBe(c.finTotal);
  });

  it('cancelar una venta saca sus cuotas de "por cobrar"', async () => {
    const lead = await nuevoLead('cancelada.debe');
    const v = (await pedir('POST', '/api/ventas/registrar', { lead_id: lead, precio_acordado: 777, cobrado: 'nada' })).datos;
    const antes = (await pedir('GET', '/api/ux/finanzas/resumen?periodo=todo')).datos.por_cobrar.total;
    await pedir('PATCH', `/api/ventas/${v.id}`, { estado: 'cancelada' });
    const despues = (await pedir('GET', '/api/ux/finanzas/resumen?periodo=todo')).datos.por_cobrar.total;
    expect(antes - despues).toBeCloseTo(777, 2);
    const viejo = (await pedir('GET', '/api/finanzas/resumen')).datos;
    expect(viejo.por_cobrar).toBeCloseTo(despues, 2);
  });
});

describe('Cobros', () => {
  it('lista con el lead y el curso; "Cobrada ✓" completa la venta y se puede deshacer', async () => {
    const lead = await nuevoLead('cobros.lead', 'Sofía Gómez');
    const curso = (await pedir('POST', '/api/productos', { nombre: 'Curso express', precio_lista: 497 })).datos;
    expect(curso.moneda).toBe('EUR');
    const v = (await pedir('POST', '/api/ventas/registrar', { lead_id: lead, producto_id: curso.id, precio_acordado: 497, cobrado: 'nada' })).datos;
    const lista = (await pedir('GET', '/api/ux/finanzas/cobros')).datos;
    const fila = lista.pendientes.find((p: any) => p.venta_id === v.id);
    expect(fila).toMatchObject({ lead_nombre: 'Sofía Gómez', ig_username: 'cobros.lead', producto: 'Curso express', cuotas_total: 1 });

    const cobrada = await pedir('POST', `/api/ux/finanzas/cobros/${fila.id}`, { accion: 'cobrar' });
    expect(cobrada.datos.estado).toBe('pagado');
    expect((await queryOne(`SELECT estado FROM ventas WHERE id = $1`, [v.id])).estado).toBe('completada');

    await pedir('POST', `/api/ux/finanzas/cobros/${fila.id}`, { accion: 'pendiente' });
    expect((await queryOne(`SELECT estado FROM ventas WHERE id = $1`, [v.id])).estado).toBe('activa');

    const re = await pedir('POST', `/api/ux/finanzas/cobros/${fila.id}`, { accion: 'reprogramar', fecha: '2031-02-03' });
    expect(re.datos).toMatchObject({ estado: 'reagendado', vence_en: '2031-02-03' });
  });

  it('el curso con ventas no se borra (se archiva)', async () => {
    const curso = (await pedir('POST', '/api/productos', { nombre: 'Mentoría', precio_lista: 3500 })).datos;
    const lead = await nuevoLead('mentoria.lead');
    await pedir('POST', '/api/ventas/registrar', { lead_id: lead, producto_id: curso.id, precio_acordado: 3500, cobrado: 'todo' });
    expect((await pedir('DELETE', `/api/productos/${curso.id}`)).codigo).toBe(409);
    expect((await pedir('PATCH', `/api/productos/${curso.id}`, { activo: false })).datos.activo).toBe(false);
    const ctx = (await pedir('GET', '/api/ux/finanzas/contexto-venta')).datos;
    expect(ctx.productos.find((p: any) => p.id === curso.id)).toBeUndefined();
  });
});

describe('buscar el lead en el servidor', () => {
  it('encuentra por @usuario o nombre y no muestra leads de otra cuenta', async () => {
    await nuevoLead('aguja.unica', 'Paula Pajar');
    const otra = await cuentaDePrueba('OtraBusqueda');
    await registrarEvento({ cuentaId: otra.cuenta.id, tipo: 'lead_creado', identidad: { igUsername: 'aguja.ajena' }, fuente: 'manual', sinReglas: true });
    const r = (await pedir('GET', '/api/ux/finanzas/leads?q=@aguja')).datos;
    expect(r.map((l: any) => l.ig_username)).toEqual(['aguja.unica']);
    expect((await pedir('GET', '/api/ux/finanzas/leads?q=pajar')).datos[0].nombre).toBe('Paula Pajar');
    expect((await pedir('GET', '/api/ux/finanzas/leads?q=100%25')).codigo).toBe(200);
  });
});

describe('corregir una venta', () => {
  it('cambiar el monto corrige el Panel y reparte lo que falta en las cuotas pendientes', async () => {
    const lead = await nuevoLead('corregir.monto');
    const v = (await pedir('POST', '/api/ventas/registrar', { lead_id: lead, precio_acordado: 900, tipo_cobro: 'cuotas', num_cuotas: 3, cobrado: 'parte', cuotas_cobradas: 1 })).datos;
    const r = await pedir('PATCH', `/api/ux/finanzas/ventas/${v.id}`, { precio_acordado: 1200 });
    expect(r.codigo).toBe(200);
    expect(r.datos.pagos.map((p: any) => Number(p.monto))).toEqual([300, 450, 450]);
    const ev = await queryOne(`SELECT valor FROM eventos WHERE idempotency_key = $1`, [`venta_${v.id}`]);
    expect(Number(ev.valor)).toBe(1200);
    const c = await contar();
    expect(c.panelIngresos).toBe(c.finTotal);
    // No puede quedar por debajo de lo que ya pagó.
    expect((await pedir('PATCH', `/api/ux/finanzas/ventas/${v.id}`, { precio_acordado: 100 })).codigo).toBe(400);
  });

  it('cambiar el lead mueve la venta al lead correcto (el Panel sigue contando una)', async () => {
    const a = await nuevoLead('lead.equivocado');
    const b = await nuevoLead('lead.correcto');
    const v = (await pedir('POST', '/api/ventas/registrar', { lead_id: a, precio_acordado: 400, cobrado: 'todo' })).datos;
    const antes = await contar();
    const r = await pedir('PATCH', `/api/ux/finanzas/ventas/${v.id}`, { lead_id: b });
    expect(r.datos.lead_id).toBe(b);
    const ev = await queryOne(`SELECT lead_id FROM eventos WHERE idempotency_key = $1`, [`venta_${v.id}`]);
    expect(ev.lead_id).toBe(b);
    expect(Number((await queryOne(`SELECT valor_total FROM leads WHERE id = $1`, [a])).valor_total)).toBe(0);
    const despues = await contar();
    expect(despues.panelVentas).toBe(antes.panelVentas);
    expect(despues.panelVentas).toBe(despues.finVentas);
  });

  it('cambiar quién la cerró trae su % y sacarlo deja la comisión en 0', async () => {
    const p = (await pedir('POST', '/api/ux/finanzas/equipo', { nombre: 'Celes', rol: 'closer_setter', comision_venta_pct: 15 })).datos.persona;
    const v = (await pedir('POST', '/api/ventas/registrar', { precio_acordado: 2000, cobrado: 'todo' })).datos;
    let r = await pedir('PATCH', `/api/ux/finanzas/ventas/${v.id}`, { closer_id: p.id });
    expect(r.datos.comision_closer).toBe(300);
    expect(r.datos.te_queda).toBe(1700);
    r = await pedir('PATCH', `/api/ux/finanzas/ventas/${v.id}`, { closer_id: null });
    expect(Number(r.datos.comision_closer_pct)).toBe(0);
  });
});

describe('gastos fijos', () => {
  it('ofrece cargar este mes los gastos fijos del mes pasado (una sola vez)', async () => {
    const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
    const mesPasado = sumarMeses(`${hoy.slice(0, 7)}-01`, -1);
    await pedir('POST', '/api/gastos', { descripcion: 'Zoom', importe: 15, categoria: 'herramientas', tipo: 'fijo', periodicidad: 'mensual', fecha: mesPasado });
    let g = (await pedir('GET', '/api/ux/finanzas/gastos')).datos;
    expect(g.fijos.por_cargar.map((x: any) => x.descripcion)).toEqual(['Zoom']);
    expect((await pedir('POST', '/api/ux/finanzas/gastos/repetir-fijos')).datos.creados).toBe(1);
    g = (await pedir('GET', '/api/ux/finanzas/gastos')).datos;
    expect(g.fijos.por_cargar).toEqual([]);
    expect(g.gastos.some((x: any) => x.descripcion === 'Zoom' && x.fecha === hoy)).toBe(true);
  });
});

describe('equipo unificado', () => {
  let tokenCloser: string;
  let personaId: string;
  const email = () => `nico-${sufijo}@test.local`;

  it('sumar a alguien con acceso: entra con la contraseña inicial y aparece en una sola lista', async () => {
    const r = await pedir('POST', '/api/ux/finanzas/equipo', {
      nombre: 'Nico', rol: 'closer', comision_venta_pct: 20, acceso: { email: email(), password: 'inicial-1234' },
    });
    expect(r.codigo).toBe(201);
    expect(r.datos.acceso).toEqual({ email: email(), password: 'inicial-1234' });
    personaId = r.datos.persona.id;
    const l = await login(email(), 'inicial-1234');
    expect(l.statusCode).toBe(200);
    expect(l.json().usuario.rol).toBe('closer');
    tokenCloser = l.json().token;

    const eq = (await pedir('GET', '/api/ux/finanzas/equipo')).datos;
    expect(eq.puede_gestionar).toBe(true);
    const nico = eq.miembros.find((m: any) => m.persona_id === personaId);
    expect(nico).toMatchObject({ acceso: true, rol: 'closer', comision_venta_pct: 20 });
    // El dueño es usuario del CRM sin ficha: aparece en la misma lista para ponerle comisión.
    expect(eq.miembros.some((m: any) => m.persona_id === null && m.rol_usuario === 'owner')).toBe(true);
    // El email no se repite.
    expect((await pedir('POST', '/api/ux/finanzas/equipo', { nombre: 'Otro', rol: 'setter', acceso: { email: email(), password: 'otra-12345' } })).codigo).toBe(409);
  });

  it('solo el dueño o un administrador gestionan el equipo', async () => {
    expect((await pedir('POST', '/api/ux/finanzas/equipo', { nombre: 'Intruso' }, tokenCloser)).codigo).toBe(403);
    expect((await pedir('POST', '/api/equipo', { nombre: 'Intruso' }, tokenCloser)).codigo).toBe(403);
    expect((await pedir('PATCH', `/api/ux/finanzas/equipo/${personaId}`, { comision_venta_pct: 90 }, tokenCloser)).codigo).toBe(403);
    expect((await pedir('GET', '/api/ux/finanzas/equipo', undefined, tokenCloser)).datos.puede_gestionar).toBe(false);
  });

  it('cuánto se le debe: comisiones del período por sus ventas', async () => {
    const lead = await nuevoLead('venta.de.nico');
    await pedir('POST', '/api/ventas/registrar', { lead_id: lead, precio_acordado: 1000, closer_id: personaId, cobrado: 'todo' });
    const eq = (await pedir('GET', '/api/ux/finanzas/equipo?periodo=todo')).datos;
    expect(eq.miembros.find((m: any) => m.persona_id === personaId)).toMatchObject({ ventas: 1, comision: 200 });
    const ventas = (await pedir('GET', `/api/ux/finanzas/equipo/${personaId}/ventas?periodo=todo`)).datos;
    expect(ventas).toHaveLength(1);
    expect(ventas[0]).toMatchObject({ como: 'closer', comision: 200 });
  });

  it('dar de baja corta el acceso sin perder el historial; volver a darlo de alta lo devuelve', async () => {
    const r = await pedir('POST', `/api/ux/finanzas/equipo/${personaId}/baja`);
    expect(r.datos).toMatchObject({ activo: false, acceso_cortado: true });
    expect((await login(email(), 'inicial-1234')).statusCode).toBe(401);
    const v = await queryOne(`SELECT COUNT(*)::int n FROM ventas WHERE closer_id = $1`, [personaId]);
    expect(v.n).toBe(1);
    const ctx = (await pedir('GET', '/api/ux/finanzas/contexto-venta')).datos;
    expect(ctx.equipo.find((p: any) => p.id === personaId)).toBeUndefined();

    await pedir('POST', `/api/ux/finanzas/equipo/${personaId}/alta`);
    expect((await login(email(), 'inicial-1234')).statusCode).toBe(200);
  });

  it('nueva contraseña y editar nombre/rol/comisión (el usuario del CRM acompaña)', async () => {
    expect((await pedir('POST', `/api/ux/finanzas/equipo/${personaId}/clave`, { password: 'nueva-clave-99' })).codigo).toBe(200);
    expect((await login(email(), 'nueva-clave-99')).statusCode).toBe(200);
    const r = await pedir('PATCH', `/api/ux/finanzas/equipo/${personaId}`, { nombre: 'Nicolás', rol: 'setter', comision_venta_pct: 7 });
    expect(r.datos).toMatchObject({ nombre: 'Nicolás', rol: 'setter', usuario_rol: 'setter' });
    expect(Number(r.datos.comision_venta_pct)).toBe(7);
  });

  it('a un usuario del CRM sin ficha se le pone comisión con un toque; una ficha se enlaza con su usuario', async () => {
    const eq = (await pedir('GET', '/api/ux/finanzas/equipo')).datos;
    const owner = eq.miembros.find((m: any) => m.persona_id === null && m.rol_usuario === 'owner');
    const r = await pedir('POST', `/api/ux/finanzas/equipo/usuario/${owner.usuario_id}/ficha`, { comision_venta_pct: 0 });
    expect(r.codigo).toBe(201);
    expect(r.datos).toMatchObject({ usuario_id: owner.usuario_id, rol: 'team_lead' });
    expect((await pedir('POST', `/api/ux/finanzas/equipo/usuario/${owner.usuario_id}/ficha`, {})).codigo).toBe(409);

    // Ficha sin usuario + darle acceso después.
    const sola = (await pedir('POST', '/api/ux/finanzas/equipo', { nombre: 'Betty', rol: 'closer', comision_venta_pct: 20 })).datos.persona;
    const acc = await pedir('POST', `/api/ux/finanzas/equipo/${sola.id}/acceso`, { email: `betty-${sufijo}@test.local`, password: 'betty-12345' });
    expect(acc.codigo).toBe(201);
    expect((await login(`betty-${sufijo}@test.local`, 'betty-12345')).statusCode).toBe(200);
  });
});
