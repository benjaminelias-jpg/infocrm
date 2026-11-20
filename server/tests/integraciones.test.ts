import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closePool, queryOne } from '../src/db/pool.js';
import { construirApp, urlParaLog } from '../src/app.js';
import { normalizarPayload } from '../src/modules/ingesta.js';
import { cuentaDePrueba } from './ayuda.js';

let app: FastifyInstance;
let token: string;
let cuentaId: string;
const auth = () => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  app = await construirApp();
  await app.ready();
  const { usuario, cuenta } = await cuentaDePrueba('Integraciones');
  cuentaId = cuenta.id;
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: usuario.email, password: 'contrasena-larga-123' } });
  token = login.json().token;
});

afterAll(async () => {
  await app.close();
  await closePool();
});

describe('integraciones simples', () => {
  it('pedir la fuente de un tipo la crea una sola vez y devuelve su URL', async () => {
    const a = await app.inject({ method: 'POST', url: '/api/ux/integraciones/fuente', headers: auth(), payload: { tipo: 'stripe' } });
    expect(a.statusCode).toBe(200);
    const e = a.json();
    expect(e.fuente).toBe('stripe');
    expect(e.url).toMatch(/\/webhooks\/[A-Za-z0-9_-]+$/);
    expect(e.token).toBeUndefined();
    const fila = await queryOne(`SELECT mapeo FROM webhook_endpoints WHERE id = $1`, [e.id]);
    expect(fila.mapeo.opciones.valor_divisor).toBe(100);

    const b = await app.inject({ method: 'POST', url: '/api/ux/integraciones/fuente', headers: auth(), payload: { tipo: 'stripe' } });
    expect(b.json().id).toBe(e.id);

    // ManyChat ya viene creado con la cuenta: lo reutiliza.
    const mc = await app.inject({ method: 'POST', url: '/api/ux/integraciones/fuente', headers: auth(), payload: { tipo: 'manychat' } });
    expect(mc.json().fuente).toBe('manychat');
    const n = await queryOne(`SELECT COUNT(*)::int AS n FROM webhook_endpoints WHERE cuenta_id = $1 AND fuente = 'manychat'`, [cuentaId]);
    expect(n.n).toBe(1);

    const malo = await app.inject({ method: 'POST', url: '/api/ux/integraciones/fuente', headers: auth(), payload: { tipo: 'nada' } });
    expect(malo.statusCode).toBe(400);
  });

  it('la prueba en vivo ve el webhook que llega después de tocar "Probar"', async () => {
    const mc = (await app.inject({ method: 'POST', url: '/api/ux/integraciones/fuente', headers: auth(), payload: { tipo: 'manychat' } })).json();
    const desde = new Date(Date.now() - 1000).toISOString();
    const antes = await app.inject({ method: 'GET', url: `/api/ux/integraciones/actividad?desde=${encodeURIComponent(desde)}&endpoint_id=${mc.id}`, headers: auth() });
    expect(antes.json().webhook).toBeNull();

    const ruta = new URL(mc.url).pathname;
    const w = await app.inject({ method: 'POST', url: ruta, payload: { id: 'sub_123', ig_username: 'prueba.envivo', first_name: 'Prueba' } });
    expect(w.statusCode).toBeLessThan(300);

    const despues = await app.inject({ method: 'GET', url: `/api/ux/integraciones/actividad?desde=${encodeURIComponent(desde)}&endpoint_id=${mc.id}`, headers: auth() });
    const llego = despues.json().webhook;
    expect(llego).toBeTruthy();
    expect(llego.de).toBe('prueba.envivo');
    expect(llego.estado).toBe('procesado');

    const resumen = (await app.inject({ method: 'GET', url: '/api/ux/integraciones/resumen', headers: auth() })).json();
    const ep = resumen.endpoints.find((x: any) => x.id === mc.id);
    expect(Number(ep.total_recibidos)).toBeGreaterThanOrEqual(1);
    expect(ep.url).toBe(mc.url);
  });
});

describe('pagos sin configurar nada', () => {
  it('Stripe: checkout.session.completed es venta en euros (no céntimos) con el email del comprador', () => {
    const n = normalizarPayload(
      { fuente: 'stripe', evento_defecto: 'venta', mapeo: { opciones: { valor_divisor: 100 } } },
      {
        id: 'evt_1', type: 'checkout.session.completed',
        data: { object: { amount_total: 49700, currency: 'eur', customer_email: null, customer_details: { email: 'Ana@Mail.com', name: 'Ana' } } },
      },
    );
    expect(n.tipo).toBe('venta');
    expect(n.valor).toBe(497);
    expect(n.moneda).toBe('EUR');
    expect(n.identidad.email).toBe('ana@mail.com');
    expect(n.idempotencyKey).toBe('evt_1');
  });

  it('Stripe: charge.refunded es devolución por lo devuelto y un evento desconocido no cuenta como venta', () => {
    const cfg = { fuente: 'stripe', evento_defecto: 'venta', mapeo: { opciones: { valor_divisor: 100 } } };
    const dev = normalizarPayload(cfg, { id: 'evt_2', type: 'charge.refunded', data: { object: { amount: 49700, amount_refunded: 20000, currency: 'eur', billing_details: { email: 'ana@mail.com' } } } });
    expect(dev.tipo).toBe('reembolso');
    expect(dev.valor).toBe(200);
    const raro = normalizarPayload(cfg, { id: 'evt_3', type: 'customer.created', data: { object: { email: 'x@y.com' } } });
    expect(raro.tipo).toBe('otro');
  });

  it('Hotmart: compra aprobada, devolución y boleto impreso', () => {
    const cfg = { fuente: 'hotmart', evento_defecto: 'venta' };
    const base = (event: string) => ({
      id: `hm_${event}`, event, version: '2.0.0',
      data: {
        product: { id: 1, name: 'Mentoría' },
        buyer: { email: 'Comprador@Mail.com', name: 'Juan' },
        purchase: { price: { value: 1500, currency_value: 'BRL' }, transaction: 'HP123' },
      },
    });
    const venta = normalizarPayload(cfg, base('PURCHASE_APPROVED'));
    expect(venta.tipo).toBe('venta');
    expect(venta.valor).toBe(1500);
    expect(venta.moneda).toBe('BRL');
    expect(venta.titulo).toBe('Mentoría');
    expect(venta.identidad.email).toBe('comprador@mail.com');
    expect(venta.idempotencyKey).toBe('hm_PURCHASE_APPROVED');
    expect(normalizarPayload(cfg, base('PURCHASE_REFUNDED')).tipo).toBe('reembolso');
    expect(normalizarPayload(cfg, base('PURCHASE_BILLET_PRINTED')).tipo).toBe('otro');
    expect(normalizarPayload(cfg, base('ALGO_NUEVO')).tipo).toBe('otro');
  });

  it('Agenda: Calendly v2 y Cal.com se entienden sin configurar campos', () => {
    const cfg = { fuente: 'calendly', evento_defecto: 'reunion_agendada' };
    const cal = normalizarPayload(cfg, {
      event: 'invitee.created',
      payload: { email: 'Lu@Mail.com', name: 'Lu', uri: 'https://api.calendly.com/x/1', scheduled_event: { start_time: '2026-12-01T10:00:00Z', name: 'Diagnóstico' } },
    });
    expect(cal.tipo).toBe('reunion_agendada');
    expect(cal.identidad.email).toBe('lu@mail.com');
    expect(cal.identidad.nombre).toBe('Lu');
    expect(cal.ocurridoEn?.toISOString()).toBe('2026-12-01T10:00:00.000Z');

    const calcom = normalizarPayload(cfg, {
      triggerEvent: 'BOOKING_CREATED', createdAt: '2026-11-20T10:00:00Z',
      payload: { uid: 'bk_1', title: 'Llamada', startTime: '2026-12-02T15:00:00Z', attendees: [{ email: 'pepa@mail.com', name: 'Pepa', timeZone: 'Europe/Madrid' }] },
    });
    expect(calcom.tipo).toBe('reunion_agendada');
    expect(calcom.identidad.email).toBe('pepa@mail.com');
    expect(calcom.identidad.zonaHoraria).toBe('Europe/Madrid');
    expect(calcom.idempotencyKey).toBe('bk_1');
    const cancel = normalizarPayload(cfg, { triggerEvent: 'BOOKING_CANCELLED', payload: { uid: 'bk_1', attendees: [{ email: 'pepa@mail.com' }] } });
    expect(cancel.tipo).toBe('reunion_cancelada');
  });

  it('una fuente genérica sigue usando su evento por defecto (no se rompe ManyChat/Zapier)', () => {
    const n = normalizarPayload({ fuente: 'generico', evento_defecto: 'venta' }, { event: 'cosa_rara', email: 'a@b.com', amount: 97 });
    expect(n.tipo).toBe('venta');
    expect(n.valor).toBe(97);
  });
});

describe('Claude por URL (conector MCP remoto)', () => {
  let clave: string;
  let claveId: string;
  const rpc = (cuerpo: unknown, url = `/mcp/${clave}`) =>
    app.inject({ method: 'POST', url, headers: { accept: 'application/json, text/event-stream' }, payload: cuerpo as any });

  beforeAll(async () => {
    const r = await app.inject({ method: 'POST', url: '/api/api-keys', headers: auth(), payload: { nombre: 'Claude' } });
    clave = r.json().clave;
    claveId = r.json().id;
  });

  it('se presenta, lista sus herramientas y responde ping', async () => {
    const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
    expect(init.statusCode).toBe(200);
    expect(init.json().result.protocolVersion).toBe('2025-06-18');
    expect(init.json().result.capabilities.tools).toBeTruthy();
    expect(init.json().result.serverInfo.name).toBe('infocrm');

    const raro = await rpc({ jsonrpc: '2.0', id: 9, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    expect(raro.json().result.protocolVersion).toBe('2025-11-25');

    const notif = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(notif.statusCode).toBe(202);
    expect(notif.body).toBe('');

    const lista = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const nombres = lista.json().result.tools.map((t: any) => t.name);
    expect(nombres).toEqual(expect.arrayContaining(['resumen', 'buscar_leads', 'lead_detalle', 'registrar_evento', 'mover_etapa', 'crear_nota']));
    for (const t of lista.json().result.tools) {
      expect(t.inputSchema.type).toBe('object');
      expect(t.peticion).toBeUndefined();
    }

    expect((await rpc({ jsonrpc: '2.0', id: 3, method: 'ping' })).json().result).toEqual({});
    expect((await rpc({ jsonrpc: '2.0', id: 4, method: 'no/existe' })).json().error.code).toBe(-32601);
  });

  it('ejecuta herramientas contra la cuenta de la clave y marca la clave como usada', async () => {
    const desde = new Date(Date.now() - 1000).toISOString();
    const r = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'resumen', arguments: {} } });
    expect(r.statusCode).toBe(200);
    const res = r.json().result;
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(res.content[0].text)).toBeTypeOf('object');

    // Escribir: registrar un lead nuevo por @usuario y encontrarlo después.
    const ev = await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'registrar_evento', arguments: { tipo: 'lead_creado', ig_username: 'desde.claude' } } });
    expect(ev.json().result.isError).toBeFalsy();
    const busca = await rpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'buscar_leads', arguments: { q: 'desde.claude' } } });
    expect(busca.json().result.content[0].text).toContain('desde.claude');

    // Faltan argumentos → error legible, no excepción.
    const falta = await rpc({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'lead_detalle', arguments: {} } });
    expect(falta.json().result.isError).toBe(true);
    expect(falta.json().result.content[0].text).toMatch(/lead_id/);

    // La pantalla de Integraciones ve que Claude usó la clave.
    const act = await app.inject({ method: 'GET', url: `/api/ux/integraciones/actividad?desde=${encodeURIComponent(desde)}&clave_id=${claveId}`, headers: auth() });
    expect(act.json().clave).toBeTruthy();
  });

  it('acepta la clave por cabecera y lotes de mensajes', async () => {
    const r = await app.inject({
      method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${clave}` },
      payload: [{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }] as any,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveLength(1);
    const h = await app.inject({ method: 'POST', url: '/mcp', headers: { 'x-api-key': clave }, payload: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    expect(h.json().result).toEqual({});
  });

  it('sin clave, con clave borrada o por GET no deja pasar', async () => {
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, '/mcp')).statusCode).toBe(401);
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, '/mcp/ic_inventada_123')).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/mcp/${clave}` })).statusCode).toBe(405);
    await app.inject({ method: 'DELETE', url: `/api/api-keys/${claveId}`, headers: auth() });
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' })).statusCode).toBe(401);
  });

  it('los secretos de las URLs no quedan en los logs', () => {
    expect(urlParaLog('/mcp/ic_abc_123')).toBe('/mcp/***');
    expect(urlParaLog('/webhooks/tok_secreto?x=1')).toBe('/webhooks/***?x=1');
    expect(urlParaLog('/webhooks/instagram')).toBe('/webhooks/instagram');
    expect(urlParaLog('/webhooks/instagram/tok')).toBe('/webhooks/instagram/***');
    expect(urlParaLog('/webhooks/cron/flujos')).toBe('/webhooks/cron/flujos');
    expect(urlParaLog('/api/leads')).toBe('/api/leads');
  });
});
