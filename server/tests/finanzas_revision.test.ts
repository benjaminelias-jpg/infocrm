import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closePool, pool, query, queryOne } from '../src/db/pool.js';
import { construirApp } from '../src/app.js';
import { registrarEvento } from '../src/modules/eventos.js';
import { cuentaDePrueba } from './ayuda.js';

// Revisión adversarial de Finanzas: lo que se podía romper (o mentía) y quedó
// corregido. Cada caso es un bug encontrado probando la pantalla.

let app: FastifyInstance;
let token: string;
let cuentaId: string;
let sufijo: string;
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function pedir(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: any, t = token) {
  const r = await app.inject({ method, url, headers: auth(t), payload });
  return { codigo: r.statusCode, datos: r.body ? r.json() : null };
}
async function nuevoLead(usuario: string, nombre?: string, apellido?: string) {
  const r = await registrarEvento({ cuentaId, tipo: 'lead_creado', identidad: { igUsername: usuario, nombre, apellido }, fuente: 'manual', sinReglas: true });
  return r.leadId as string;
}
async function login(email: string, password: string) {
  return app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
}
const hoyMas = (dias: number) => new Date(Date.now() + dias * 864e5).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });

beforeAll(async () => {
  app = await construirApp();
  await app.ready();
  const r = await cuentaDePrueba('FinanzasRevision');
  cuentaId = r.cuenta.id;
  sufijo = r.sufijo;
  token = (await login(r.usuario.email, 'contrasena-larga-123')).json().token;
});

afterAll(async () => {
  await app.close();
  await closePool();
});

describe('lo que la pantalla decía y no era cierto', () => {
  it('una cuenta nueva NO tiene "la pasarela conectada" (la dirección de pagos sin usar no cuenta)', async () => {
    const r = (await pedir('GET', '/api/ux/finanzas/ventas?periodo=todo')).datos;
    expect(r.cobros_solos.conectado).toBe(false);
    // Cuando la dirección de pagos ya recibió algo, sí.
    await pool.query(`UPDATE webhook_endpoints SET total_recibidos = 1 WHERE cuenta_id = $1 AND slug = 'venta'`, [cuentaId]);
    expect((await pedir('GET', '/api/ux/finanzas/ventas?periodo=todo')).datos.cobros_solos.conectado).toBe(true);
    await pool.query(`UPDATE webhook_endpoints SET total_recibidos = 0 WHERE cuenta_id = $1 AND slug = 'venta'`, [cuentaId]);
  });

  it('cancelar una venta ya cobrada en parte: los dos "te queda" siguen diciendo lo mismo', async () => {
    const lead = await nuevoLead('cancelada.cobrada');
    const v = (await pedir('POST', '/api/ventas/registrar', {
      lead_id: lead, precio_acordado: 900, tipo_cobro: 'cuotas', num_cuotas: 3, cobrado: 'parte', cuotas_cobradas: 1,
    })).datos;
    expect((await pedir('PATCH', `/api/ventas/${v.id}`, { estado: 'cancelada' })).codigo).toBe(200);
    const ux = (await pedir('GET', '/api/ux/finanzas/resumen?periodo=todo')).datos.actual;
    const viejo = (await pedir('GET', '/api/finanzas/resumen')).datos;
    expect(viejo.ingresos_cobrados).toBeCloseTo(ux.cobrado, 2);
    expect(viejo.neto_cobrado).toBeCloseTo(ux.te_queda, 2);
    await pedir('DELETE', `/api/ventas/${v.id}`);
  });

  it('"esta semana" del Resumen es la misma que la de Cobros (hoy y los 7 días que siguen)', async () => {
    const lead = await nuevoLead('vence.en.siete');
    const v = (await pedir('POST', '/api/ventas/registrar', { lead_id: lead, precio_acordado: 70, cobrado: 'nada', vence_proxima: hoyMas(7) })).datos;
    const r = (await pedir('GET', '/api/ux/finanzas/resumen')).datos.por_cobrar;
    expect(r.semana).toBeGreaterThanOrEqual(70);
    await pedir('DELETE', `/api/ventas/${v.id}`);
  });

  it('si en el último gasto se apagó "todos los meses", deja de proponerse', async () => {
    const mesPasado = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 10).toLocaleDateString('sv-SE');
    const dosMeses = new Date(new Date().getFullYear(), new Date().getMonth() - 2, 10).toLocaleDateString('sv-SE');
    await pedir('POST', '/api/gastos', { descripcion: 'Canva', importe: 12, categoria: 'herramientas', tipo: 'fijo', periodicidad: 'mensual', fecha: dosMeses });
    const ultimo = (await pedir('POST', '/api/gastos', { descripcion: 'Canva', importe: 12, categoria: 'herramientas', tipo: 'fijo', periodicidad: 'mensual', fecha: mesPasado })).datos;
    expect((await pedir('GET', '/api/ux/finanzas/gastos')).datos.fijos.por_cargar.map((g: any) => g.descripcion)).toContain('Canva');
    await pedir('PATCH', `/api/gastos/${ultimo.id}`, { tipo: null, periodicidad: null });
    expect((await pedir('GET', '/api/ux/finanzas/gastos')).datos.fijos.por_cargar.map((g: any) => g.descripcion)).not.toContain('Canva');
  });

  it('subir el precio de una venta vieja ya cobrada: lo que falta no nace atrasado', async () => {
    const lead = await nuevoLead('vieja.mas.cara');
    const v = (await pedir('POST', '/api/ventas/registrar', { lead_id: lead, precio_acordado: 100, cobrado: 'todo', fecha: '2026-01-10' })).datos;
    const r = await pedir('PATCH', `/api/ux/finanzas/ventas/${v.id}`, { precio_acordado: 150 });
    expect(r.codigo).toBe(200);
    const nueva = r.datos.pagos.find((p: any) => p.estado === 'pendiente');
    expect(Number(nueva.monto)).toBe(50);
    expect(nueva.vence_en >= hoyMas(0)).toBe(true);
    expect(r.datos.atrasadas).toBe(0);
  });

  it('el total de comisiones de Equipo incluye a quien ya está de baja (es lo que se le debe)', async () => {
    const p = (await pedir('POST', '/api/ux/finanzas/equipo', { nombre: 'Ex', rol: 'closer', comision_venta_pct: 10 })).datos.persona;
    const lead = await nuevoLead('venta.de.ex');
    await pedir('POST', '/api/ventas/registrar', { lead_id: lead, precio_acordado: 1000, closer_id: p.id, cobrado: 'todo' });
    await pedir('POST', `/api/ux/finanzas/equipo/${p.id}/baja`);
    const eq = (await pedir('GET', '/api/ux/finanzas/equipo?periodo=todo')).datos;
    const resumen = (await pedir('GET', '/api/ux/finanzas/resumen?periodo=todo')).datos.actual;
    expect(eq.total_comisiones).toBeCloseTo(resumen.comision_equipo, 2);
  });
});

describe('buscar a quién le vendiste', () => {
  it('encuentra sin tildes ni mayúsculas, y por nombre y apellido', async () => {
    await nuevoLead('s.g.2026', 'Sofía', 'Gómez');
    const nombres = async (q: string) => (await pedir('GET', `/api/ux/finanzas/leads?q=${encodeURIComponent(q)}`)).datos.map((l: any) => l.ig_username);
    expect(await nombres('sofia gomez')).toContain('s.g.2026');
    expect(await nombres('GÓMEZ')).toContain('s.g.2026');
    expect(await nombres('Sofía')).toContain('s.g.2026');
    // Los comodines de SQL se buscan como texto.
    expect(await nombres('%')).not.toContain('s.g.2026');
  });
});

describe('nada de ids de otra cuenta ni montos imposibles', () => {
  it('la ruta genérica de ventas y de cuotas no acepta ids de otra cuenta', async () => {
    const otra = await cuentaDePrueba('OtraRevision');
    const ajeno = (await registrarEvento({ cuentaId: otra.cuenta.id, tipo: 'lead_creado', identidad: { igUsername: `ajeno.${sufijo}` }, fuente: 'manual', sinReglas: true })).leadId;
    const ventaAjena = await queryOne(
      `INSERT INTO ventas (cuenta_id, precio_acordado, moneda) VALUES ($1, 10, 'EUR') RETURNING id`, [otra.cuenta.id]);
    const mia = (await pedir('POST', '/api/ventas/registrar', { precio_acordado: 50, cobrado: 'todo' })).datos;

    const r1 = await pedir('PATCH', `/api/ventas/${mia.id}`, { lead_id: ajeno });
    expect(r1.codigo).toBe(404);
    expect(r1.datos.mensaje).toMatch(/No encontramos ese lead/);
    const r2 = await pedir('POST', '/api/pagos', { venta_id: ventaAjena.id, num_cuota: 9, monto: 1 });
    expect(r2.codigo).toBe(404);
    const r3 = await pedir('POST', '/api/gastos', { descripcion: 'x', importe: 1, categoria: 'otros', venta_id: ventaAjena.id });
    expect(r3.codigo).toBe(404);
    // Nada quedó colgado de la venta de la otra cuenta.
    const n = await queryOne(`SELECT COUNT(*)::int n FROM pagos WHERE venta_id = $1`, [ventaAjena.id]);
    expect(n.n).toBe(0);
  });

  it('un monto gigante es un error claro (no "numeric field overflow")', async () => {
    const r = await pedir('POST', '/api/ventas/registrar', { precio_acordado: 1e12 });
    expect(r.codigo).toBe(400);
    expect(r.datos.mensaje).not.toMatch(/overflow/i);
  });

  it('una venta que no existe se dice en español y con el género bien', async () => {
    const r = await pedir('GET', '/api/ux/finanzas/ventas/00000000-0000-4000-8000-000000000000');
    expect(r.codigo).toBe(404);
    expect(r.datos.mensaje).toBe('No encontramos esa venta. Puede que ya se haya borrado.');
    const g = await pedir('PATCH', '/api/gastos/00000000-0000-4000-8000-000000000000', { importe: 3 });
    expect(g.datos.mensaje).toMatch(/^No encontramos ese gasto/);
  });
});

describe('un closer registra ventas, pero la plata y las comisiones son del dueño', () => {
  let tokenCloser: string;
  let marco: any;
  let venta: any;

  beforeAll(async () => {
    const email = `marco-${sufijo}@test.local`;
    marco = (await pedir('POST', '/api/ux/finanzas/equipo', {
      nombre: 'Marco', rol: 'closer', comision_venta_pct: 18, acceso: { email, password: 'marco-12345' },
    })).datos.persona;
    tokenCloser = (await login(email, 'marco-12345')).json().token;
  });

  it('registra desde el Pipeline con SU % (no se lo puede subir)', async () => {
    const lead = await nuevoLead('venta.de.marco');
    const r = await pedir('POST', '/api/ventas/registrar', { lead_id: lead, precio_acordado: 1000, closer_id: marco.id, comision_closer_pct: 90, cobrado: 'todo' }, tokenCloser);
    expect(r.codigo).toBe(201);
    expect(Number(r.datos.comision_closer_pct)).toBe(18);
    venta = r.datos;
  });

  it('no puede corregir, cancelar ni borrar ventas (ni cambiarse la comisión)', async () => {
    expect((await pedir('PATCH', `/api/ux/finanzas/ventas/${venta.id}`, { comision_closer_pct: 90 }, tokenCloser)).codigo).toBe(403);
    expect((await pedir('PATCH', `/api/ventas/${venta.id}`, { comision_closer_pct: 90 }, tokenCloser)).codigo).toBe(403);
    expect((await pedir('PATCH', `/api/ventas/${venta.id}`, { estado: 'cancelada' }, tokenCloser)).codigo).toBe(403);
    expect((await pedir('DELETE', `/api/ventas/${venta.id}`, undefined, tokenCloser)).codigo).toBe(403);
    const v = await queryOne(`SELECT estado, comision_closer_pct FROM ventas WHERE id = $1`, [venta.id]);
    expect(v.estado).toBe('completada');
    expect(Number(v.comision_closer_pct)).toBe(18);
  });

  it('no ve los números de la plata, pero sí lo que necesita para registrar', async () => {
    for (const ruta of ['resumen', 'ventas', 'cobros', 'gastos', 'metodos', 'contadores', `ventas/${venta.id}`]) {
      expect((await pedir('GET', `/api/ux/finanzas/${ruta}`, undefined, tokenCloser)).codigo).toBe(403);
    }
    expect((await pedir('GET', '/api/ux/finanzas/leads?q=marco', undefined, tokenCloser)).codigo).toBe(200);
    const ctx = await pedir('GET', '/api/ux/finanzas/contexto-venta', undefined, tokenCloser);
    expect(ctx.codigo).toBe(200);
    expect(ctx.datos.puede_comisiones).toBe(false);
    expect(ctx.datos.equipo.every((p: any) => p.comision_venta_pct === null)).toBe(true);
    // El dueño sí.
    const ctxDueno = (await pedir('GET', '/api/ux/finanzas/contexto-venta')).datos;
    expect(ctxDueno.puede_comisiones).toBe(true);
    expect(Number(ctxDueno.equipo.find((p: any) => p.id === marco.id).comision_venta_pct)).toBe(18);
  });

  it('el dueño corrige por la ruta genérica y el % sale de la ficha si cambia quién cerró', async () => {
    const otro = (await pedir('POST', '/api/ux/finanzas/equipo', { nombre: 'Betty', rol: 'closer', comision_venta_pct: 20 })).datos.persona;
    const r = await pedir('PATCH', `/api/ventas/${venta.id}`, { closer_id: otro.id });
    expect(r.codigo).toBe(200);
    expect(Number(r.datos.comision_closer_pct)).toBe(20);
    // Closer y setter, la misma persona: no.
    expect((await pedir('PATCH', `/api/ventas/${venta.id}`, { closer_id: otro.id, setter_id: otro.id })).codigo).toBe(400);
  });
});
