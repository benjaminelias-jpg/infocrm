import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closePool, query, queryOne } from '../src/db/pool.js';
import { construirApp } from '../src/app.js';
import { registrarEvento } from '../src/modules/eventos.js';
import { cuentaDePrueba } from './ayuda.js';

// Panel (eventos "venta") y Finanzas (tabla ventas) tienen que contar lo mismo.

let app: FastifyInstance;
let token: string;
let cuentaId: string;
const auth = () => ({ authorization: `Bearer ${token}` });

async function contar() {
  const panel = (await app.inject({ method: 'GET', url: '/api/analitica/resumen', headers: auth() })).json();
  const fin = (await app.inject({ method: 'GET', url: '/api/finanzas/resumen', headers: auth() })).json();
  return { panelVentas: Number(panel.ventas), panelIngresos: Number(panel.ingresos), finVentas: Number(fin.ventas), finTotal: Number(fin.ingresos_comprometidos) };
}

async function nuevoLead(usuario: string) {
  const r = await registrarEvento({ cuentaId, tipo: 'lead_creado', identidad: { igUsername: usuario }, fuente: 'manual', sinReglas: true });
  return r.leadId;
}

beforeAll(async () => {
  app = await construirApp();
  await app.ready();
  const { usuario, cuenta } = await cuentaDePrueba('Ventas');
  cuentaId = cuenta.id;
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: usuario.email, password: 'contrasena-larga-123' } });
  token = login.json().token;
});

afterAll(async () => {
  await app.close();
  await closePool();
});

describe('ventas unificadas entre Panel y Finanzas', () => {
  it('una venta que llega por Stripe aparece en Finanzas, pagada y con su cobro', async () => {
    const leadId = await nuevoLead('compra.stripe');
    const r = await registrarEvento({ cuentaId, tipo: 'venta', leadId, valor: 497, moneda: 'eur', fuente: 'stripe', idempotencyKey: 'evt_stripe_1', sinReglas: true });
    const v = await queryOne(`SELECT * FROM ventas WHERE cuenta_id = $1 AND evento_id = $2`, [cuentaId, r.eventoId]);
    expect(v).toBeTruthy();
    expect(v.lead_id).toBe(leadId);
    expect(Number(v.precio_acordado)).toBe(497);
    expect(v.moneda).toBe('EUR');
    expect(v.estado).toBe('completada');
    expect(v.pasarela).toBe('Stripe');
    const pagos = await query(`SELECT * FROM pagos WHERE venta_id = $1`, [v.id]);
    expect(pagos).toHaveLength(1);
    expect(pagos[0].estado).toBe('pagado');

    // El mismo aviso repetido no duplica nada.
    await registrarEvento({ cuentaId, tipo: 'venta', leadId, valor: 497, moneda: 'eur', fuente: 'stripe', idempotencyKey: 'evt_stripe_1', sinReglas: true });
    const n = await queryOne(`SELECT COUNT(*)::int AS n FROM ventas WHERE cuenta_id = $1 AND lead_id = $2`, [cuentaId, leadId]);
    expect(n.n).toBe(1);

    const c = await contar();
    expect(c.panelVentas).toBe(c.finVentas);
    expect(c.panelIngresos).toBe(c.finTotal);
  });

  it('una venta cargada en Finanzas cuenta en el Panel (una sola vez) y mueve la oportunidad a ganada', async () => {
    const leadId = await nuevoLead('compra.manual');
    const antes = await contar();
    const r = await app.inject({
      method: 'POST', url: '/api/ventas/registrar', headers: auth(),
      payload: { lead_id: leadId, precio_acordado: 1200, tipo_cobro: 'cuotas', num_cuotas: 3 },
    });
    expect(r.statusCode).toBe(201);
    const venta = r.json();
    const v = await queryOne(`SELECT evento_id FROM ventas WHERE id = $1`, [venta.id]);
    expect(v.evento_id).toBeTruthy();
    const ev = await queryOne(`SELECT tipo, valor, fuente, idempotency_key FROM eventos WHERE id = $1`, [v.evento_id]);
    expect(ev.tipo).toBe('venta');
    expect(Number(ev.valor)).toBe(1200);
    expect(ev.idempotency_key).toBe(`venta_${venta.id}`);
    // No se creó una segunda fila en Finanzas por el evento.
    const n = await queryOne(`SELECT COUNT(*)::int AS n FROM ventas WHERE cuenta_id = $1 AND lead_id = $2`, [cuentaId, leadId]);
    expect(n.n).toBe(1);
    // Las 3 cuotas siguen pendientes (lo cargado a mano es un compromiso, no un cobro).
    const cuotas = await query(`SELECT estado FROM pagos WHERE venta_id = $1`, [venta.id]);
    expect(cuotas.map((x: any) => x.estado)).toEqual(['pendiente', 'pendiente', 'pendiente']);
    const opp = await queryOne(`SELECT estado FROM oportunidades WHERE lead_id = $1 ORDER BY abierta_en DESC LIMIT 1`, [leadId]);
    expect(['ganada', 'abierta']).toContain(opp.estado);

    const despues = await contar();
    expect(despues.panelVentas).toBe(antes.panelVentas + 1);
    expect(despues.finVentas).toBe(antes.finVentas + 1);
    expect(despues.panelVentas).toBe(despues.finVentas);
  });

  it('una devolución por Stripe deja la venta devuelta en Finanzas y el Panel la descuenta', async () => {
    const leadId = await nuevoLead('compra.devuelta');
    await registrarEvento({ cuentaId, tipo: 'venta', leadId, valor: 300, fuente: 'stripe', idempotencyKey: 'evt_dev_venta', sinReglas: true });
    const antes = await contar();
    await registrarEvento({ cuentaId, tipo: 'reembolso', leadId, valor: 300, fuente: 'stripe', idempotencyKey: 'evt_dev_reembolso', sinReglas: true });
    const v = await queryOne(`SELECT id, estado FROM ventas WHERE cuenta_id = $1 AND lead_id = $2`, [cuentaId, leadId]);
    expect(v.estado).toBe('reembolsada');
    const p = await queryOne(`SELECT estado FROM pagos WHERE venta_id = $1`, [v.id]);
    expect(p.estado).toBe('reembolsado');
    const despues = await contar();
    expect(despues.panelVentas).toBe(antes.panelVentas - 1);
    expect(despues.finVentas).toBe(antes.finVentas - 1);
    expect(despues.panelVentas).toBe(despues.finVentas);
  });

  it('marcarla como devuelta en Finanzas registra la devolución en el Panel', async () => {
    const leadId = await nuevoLead('devuelta.en.finanzas');
    const venta = (await app.inject({ method: 'POST', url: '/api/ventas/registrar', headers: auth(), payload: { lead_id: leadId, precio_acordado: 200 } })).json();
    await app.inject({ method: 'PATCH', url: `/api/pagos/${(await queryOne(`SELECT id FROM pagos WHERE venta_id = $1`, [venta.id])).id}`, headers: auth(), payload: { estado: 'pagado' } });
    const antes = await contar();
    const r = await app.inject({ method: 'PATCH', url: `/api/ventas/${venta.id}`, headers: auth(), payload: { estado: 'reembolsada' } });
    expect(r.statusCode).toBe(200);
    const ev = await queryOne(`SELECT tipo, valor FROM eventos WHERE cuenta_id = $1 AND idempotency_key = $2`, [cuentaId, `reembolso_venta_${venta.id}`]);
    expect(ev.tipo).toBe('reembolso');
    expect(Number(ev.valor)).toBe(200);
    const p = await queryOne(`SELECT estado FROM pagos WHERE venta_id = $1`, [venta.id]);
    expect(p.estado).toBe('reembolsado');
    const despues = await contar();
    expect(despues.panelVentas).toBe(antes.panelVentas - 1);
    expect(despues.finVentas).toBe(antes.finVentas - 1);
  });

  it('cancelar o borrar una venta en Finanzas la saca también del Panel', async () => {
    const a = await nuevoLead('cancelada.finanzas');
    const b = await nuevoLead('borrada.finanzas');
    const va = (await app.inject({ method: 'POST', url: '/api/ventas/registrar', headers: auth(), payload: { lead_id: a, precio_acordado: 150 } })).json();
    const vb = (await app.inject({ method: 'POST', url: '/api/ventas/registrar', headers: auth(), payload: { lead_id: b, precio_acordado: 250 } })).json();
    const antes = await contar();

    await app.inject({ method: 'PATCH', url: `/api/ventas/${va.id}`, headers: auth(), payload: { estado: 'cancelada' } });
    const tras = await contar();
    expect(tras.panelVentas).toBe(antes.panelVentas - 1);
    expect(tras.finVentas).toBe(antes.finVentas - 1);

    const borrar = await app.inject({ method: 'DELETE', url: `/api/ventas/${vb.id}`, headers: auth() });
    expect(borrar.statusCode).toBe(204);
    const fin = await contar();
    expect(fin.panelVentas).toBe(antes.panelVentas - 2);
    expect(fin.finVentas).toBe(antes.finVentas - 2);
    const lead = await queryOne(`SELECT valor_total FROM leads WHERE id = $1`, [b]);
    expect(Number(lead.valor_total)).toBe(0);
  });

  it('una venta por Claude/MCP (registrar_evento) también queda en Finanzas', async () => {
    const leadId = await nuevoLead('compra.claude');
    const r = await app.inject({ method: 'POST', url: '/api/eventos', headers: auth(), payload: { tipo: 'venta', lead_id: leadId, valor: 997, titulo: 'Mentoría' } });
    expect(r.statusCode).toBeLessThan(300);
    const v = await queryOne(`SELECT estado, notas FROM ventas WHERE cuenta_id = $1 AND lead_id = $2`, [cuentaId, leadId]);
    expect(v.estado).toBe('completada');
    expect(v.notas).toMatch(/Registrada sola/);
  });
});
