import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { closePool, query, queryOne } from '../src/db/pool.js';
import { construirApp } from '../src/app.js';
import { configurarApisExternas, restaurarApisExternas } from '../src/routes/ux_integraciones.js';
import {
  usarClienteHttpInstagram, renovarTokensPorVencer, tocaRenovar, manejarCallback,
} from '../src/modules/instagram_oauth.js';
import { verificarFirmaWebhook } from '../src/modules/ingesta.js';
import { cuentaDePrueba } from './ayuda.js';

let app: FastifyInstance;
let token: string;
let cuentaId: string;
const auth = () => ({ authorization: `Bearer ${token}` });
const get = (url: string) => app.inject({ method: 'GET', url, headers: auth() });
const send = (method: 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url, headers: auth(), payload: payload as any });

// ---------------------------------------------------------------------
// Servidor falso local (Stripe y Calendly): registra lo que le piden.
// ---------------------------------------------------------------------
type Pedido = { method: string; url: string; body: string; auth: string };
let falso: Server;
let base = '';
let pedidos: Pedido[] = [];
let manejar: (p: Pedido) => { status: number; json?: unknown } = () => ({ status: 404 });

function leer(req: IncomingMessage): Promise<string> {
  return new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => ok(b)); });
}

beforeAll(async () => {
  app = await construirApp();
  await app.ready();
  const { usuario, cuenta } = await cuentaDePrueba('Conexiones');
  cuentaId = cuenta.id;
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: usuario.email, password: 'contrasena-larga-123' } });
  token = login.json().token;

  falso = createServer(async (req, res) => {
    const p: Pedido = { method: req.method ?? 'GET', url: req.url ?? '/', body: await leer(req), auth: String(req.headers.authorization ?? '') };
    pedidos.push(p);
    const r = manejar(p);
    res.writeHead(r.status, { 'content-type': 'application/json' });
    res.end(r.json === undefined ? '' : JSON.stringify(r.json));
  });
  await new Promise<void>((ok) => falso.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(falso.address() as AddressInfo).port}`;
  configurarApisExternas({ stripe: base, calendly: base });
});

afterEach(() => { pedidos = []; manejar = () => ({ status: 404 }); });

afterAll(async () => {
  restaurarApisExternas();
  usarClienteHttpInstagram();
  delete process.env.META_APP_ID; delete process.env.META_APP_SECRET;
  await new Promise<void>((ok) => falso.close(() => ok()));
  await app.close();
  await closePool();
});

const firmar = (secreto: string, cuerpo: string, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex')}`;

describe('Instagram con la app de la plataforma', () => {
  it('sin app propia y sin app del CRM pide los datos de la app; con META_APP_ID usa la del CRM', async () => {
    delete process.env.META_APP_ID; delete process.env.META_APP_SECRET;
    const sin = (await get('/api/instagram/estado')).json();
    expect(sin.app_de_plataforma).toBe(false);
    expect(sin.puede_conectar).toBe(false);
    const malo = await get('/api/instagram/oauth/start');
    expect(malo.statusCode).toBe(400);
    expect(malo.json().mensaje).toMatch(/app de Meta/);

    process.env.META_APP_ID = '111222333444';
    process.env.META_APP_SECRET = 'secreto-de-la-plataforma';
    const con = (await get('/api/instagram/estado')).json();
    expect(con.app_de_plataforma).toBe(true);
    expect(con.puede_conectar).toBe(true);
    expect(con.tiene_app).toBe(false);
    const start = await get('/api/instagram/oauth/start');
    expect(start.statusCode).toBe(200);
    expect(start.json().url).toContain('client_id=111222333444');
    expect(start.json().url).toContain('instagram.com/oauth/authorize');
  });

  it('la app propia manda sobre la del CRM y se puede volver a la del CRM', async () => {
    process.env.META_APP_ID = '111222333444';
    process.env.META_APP_SECRET = 'secreto-de-la-plataforma';
    await send('PATCH', '/api/instagram/pasos', { profesional: true });
    expect((await app.inject({ method: 'PUT', url: '/api/instagram/app', headers: auth(), payload: { app_id: '999888777', app_secret: 'propio' } })).statusCode).toBe(200);
    const propia = (await get('/api/instagram/estado')).json();
    expect(propia.app_de_plataforma).toBe(false);
    expect(propia.tiene_app).toBe(true);
    expect((await get('/api/instagram/oauth/start')).json().url).toContain('client_id=999888777');
    // Volver a la app del CRM no borra las confirmaciones de la guía.
    expect((await send('DELETE', '/api/instagram/app')).statusCode).toBe(204);
    const vuelta = (await get('/api/instagram/estado')).json();
    expect(vuelta.app_de_plataforma).toBe(true);
    expect(vuelta.pasos.profesional).toBe(true);
  });

  it('"Ya es profesional" y "Ya activé el permiso" quedan guardados en la cuenta', async () => {
    const r = await send('PATCH', '/api/instagram/pasos', { permiso_mensajes: true });
    expect(r.json().pasos).toEqual({ profesional: true, permiso_mensajes: true });
    const e = (await get('/api/instagram/estado')).json();
    expect(e.pasos).toEqual({ profesional: true, permiso_mensajes: true });
    expect(typeof e.dms_7d).toBe('number');
  });

  it('el callback del login de Instagram guarda cuándo vence y suscribe la cuenta a los avisos', async () => {
    process.env.META_APP_ID = '111222333444';
    process.env.META_APP_SECRET = 'secreto-de-la-plataforma';
    const llamadas: string[] = [];
    usarClienteHttpInstagram(async (url) => {
      llamadas.push(url);
      const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.startsWith('https://api.instagram.com/oauth/access_token')) return json({ access_token: 'corto', user_id: 1 });
      if (url.includes('/access_token?grant_type=ig_exchange_token')) return json({ access_token: 'largo', expires_in: 5_184_000 });
      if (url.includes('/me?fields=user_id,username')) return json({ user_id: '17841400000000001', username: 'lu.coach' });
      if (url.includes('/subscribed_apps')) return json({ success: true });
      return json({});
    });
    const r = await manejarCallback(cuentaId, 'codigo-de-meta');
    expect(r.ok).toBe(true);
    expect(llamadas.some((u) => u.includes('client_secret=secreto-de-la-plataforma'))).toBe(true);
    expect(llamadas.some((u) => u.includes('/17841400000000001/subscribed_apps'))).toBe(true);
    const e = (await get('/api/instagram/estado')).json();
    expect(e.conectado).toBe(true);
    expect(e.username).toBe('lu.coach');
    expect(e.se_renueva_sola).toBe(true);
    expect(e.avisos_suscritos).toBe(true);
    const dias = (new Date(e.token_expira_en).getTime() - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(59);
  });

  it('renueva sola la conexión que vence en menos de 15 días; si falla lo deja anotado sin cortar', async () => {
    await query(
      `UPDATE integraciones SET credenciales = credenciales || jsonb_build_object('token_expira_en', (now() + interval '5 days')::text),
              config = config - 'renovacion'
        WHERE cuenta_id = $1 AND tipo = 'instagram'`, [cuentaId]);
    usarClienteHttpInstagram(async (url) => {
      if (url.includes('/refresh_access_token')) {
        return new Response(JSON.stringify({ access_token: 'renovado', expires_in: 5_184_000 }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });
    const r = await renovarTokensPorVencer();
    expect(r.renovadas).toBeGreaterThanOrEqual(1);
    const integ = await queryOne(`SELECT credenciales, config FROM integraciones WHERE cuenta_id = $1 AND tipo = 'instagram'`, [cuentaId]);
    expect(integ.credenciales.access_token).toBe('renovado');
    expect(integ.config.renovacion.ok).toBe(true);
    expect(new Date(integ.credenciales.token_expira_en).getTime() - Date.now()).toBeGreaterThan(50 * 86_400_000);

    // Falla: queda anotado, la conexión sigue (el token todavía sirve) y no reintenta enseguida.
    await query(
      `UPDATE integraciones SET credenciales = credenciales || jsonb_build_object('token_expira_en', (now() + interval '3 days')::text),
              config = config - 'renovacion'
        WHERE cuenta_id = $1 AND tipo = 'instagram'`, [cuentaId]);
    usarClienteHttpInstagram(async () => new Response(JSON.stringify({ error: { message: 'Session has expired' } }), { status: 400 }));
    const f = await renovarTokensPorVencer();
    expect(f.fallidas).toBeGreaterThanOrEqual(1);
    const e = (await get('/api/instagram/estado')).json();
    expect(e.conectado).toBe(true);
    expect(e.renovacion.ok).toBe(false);
    expect(e.renovacion.error).toMatch(/expired/);
    const integ2 = await queryOne(`SELECT * FROM integraciones WHERE cuenta_id = $1 AND tipo = 'instagram'`, [cuentaId]);
    expect(tocaRenovar(integ2)).toBe(false);
    // El cron del servidor también la intenta (y responde aunque falle).
    const cron = await app.inject({ method: 'GET', url: '/webhooks/cron/flujos' });
    expect(cron.statusCode).toBe(200);
    expect(cron.json().instagram).toBeTruthy();
  });
});

describe('direcciones que se crean recién cuando se piden', () => {
  it('mirar una guía no crea nada; pedir la dirección sí; "ya la pegué" la deja esperando el primer dato', async () => {
    const antes = (await get('/api/ux/integraciones/fuente?tipo=hotmart')).json();
    expect(antes.fuente).toBeNull();
    const n0 = await queryOne(`SELECT COUNT(*)::int AS n FROM webhook_endpoints WHERE cuenta_id = $1 AND slug = 'hotmart-ventas'`, [cuentaId]);
    expect(n0.n).toBe(0);
    const creada = (await send('POST', '/api/ux/integraciones/fuente', { tipo: 'hotmart' })).json();
    expect(creada.url).toMatch(/\/webhooks\/whk_/);
    expect(creada.configurado_en).toBeNull();
    const conf = (await send('POST', `/api/ux/integraciones/fuente/${creada.id}/configurado`)).json();
    expect(conf.configurado_en).toBeTruthy();
    const resumen = (await get('/api/ux/integraciones/resumen')).json();
    const ep = resumen.endpoints.find((e: any) => e.id === creada.id);
    expect(ep.configurado_en).toBeTruthy();
    expect(Number(ep.total_recibidos)).toBe(0);
    expect(ep.token).toBeUndefined();
    expect(ep.secreto_firma).toBeUndefined();
  });

  it('lo que llega sin identificar a la persona trae un código para explicarlo según la app', async () => {
    const mc = (await send('POST', '/api/ux/integraciones/fuente', { tipo: 'manychat' })).json();
    const desde = new Date(Date.now() - 1000).toISOString();
    await app.inject({ method: 'POST', url: new URL(mc.url).pathname, payload: { first_name: 'Sin datos' } });
    const act = (await get(`/api/ux/integraciones/actividad?desde=${encodeURIComponent(desde)}&endpoint_id=${mc.id}`)).json();
    expect(act.webhook.estado).toBe('error');
    expect(act.webhook.codigo).toBe('sin_identidad');
    expect(act.webhook.error).toMatch(/identificar/);
    await app.inject({ method: 'POST', url: new URL(mc.url).pathname, payload: { id: 'sub_9', ig_username: 'con.lead', first_name: 'Con' } });
    const ok = (await get(`/api/ux/integraciones/actividad?desde=${encodeURIComponent(desde)}&endpoint_id=${mc.id}`)).json();
    expect(ok.webhook.estado).toBe('procesado');
    expect(ok.webhook.lead_id).toBeTruthy();
  });

  it('Para técnicos: cambiar la dirección y filtrar el historial por dirección', async () => {
    const z = (await send('POST', '/api/ux/integraciones/fuente', { tipo: 'zapier' })).json();
    const vieja = new URL(z.url).pathname;
    expect((await app.inject({ method: 'POST', url: vieja, payload: { email: 'a@b.com' } })).statusCode).toBeLessThan(300);
    const rot = await send('POST', `/api/webhooks/endpoints/${z.id}/rotar`);
    expect(rot.statusCode).toBe(200);
    expect(rot.json().url).not.toBe(z.url);
    expect(rot.json().secreto_firma).toBeUndefined();
    expect((await app.inject({ method: 'POST', url: vieja, payload: { email: 'a@b.com' } })).statusCode).toBe(404);
    const hist = (await get(`/api/webhooks/eventos?endpoint_id=${z.id}`)).json();
    expect(hist.length).toBe(1);
    expect(hist.every((h: any) => h.endpoint_id === z.id)).toBe(true);
  });
});

describe('Calendly pegando un token', () => {
  const yo = { resource: { uri: `https://api.calendly.com/users/U1`, email: 'benja@mail.com', name: 'Benja', current_organization: 'https://api.calendly.com/organizations/O1' } };

  it('crea la suscripción (agendada y cancelada) con secreto de firma y la entrada verifica la firma', async () => {
    let creada: any = null;
    manejar = (p) => {
      if (p.url === '/users/me') return p.auth === 'Bearer tok-calendly-0123456789abcdef' ? { status: 200, json: yo } : { status: 401, json: {} };
      if (p.method === 'POST' && p.url === '/webhook_subscriptions') { creada = JSON.parse(p.body); return { status: 201, json: { resource: { uri: `${base}/webhook_subscriptions/W1` } } }; }
      if (p.url.startsWith('/event_types')) return { status: 200, json: { collection: [{}, {}] } };
      return { status: 404, json: {} };
    };
    const malo = await send('POST', '/api/ux/integraciones/calendly', { token: 'tok-equivocado-0123456789' });
    expect(malo.statusCode).toBe(400);
    expect(malo.json().mensaje).toMatch(/Calendly no aceptó/);

    const r = await send('POST', '/api/ux/integraciones/calendly', { token: 'tok-calendly-0123456789abcdef' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, email: 'benja@mail.com', tipos_evento: 2 });
    expect(creada.events).toEqual(['invitee.created', 'invitee.canceled']);
    expect(creada.scope).toBe('user');
    expect(creada.signing_key).toMatch(/^[0-9a-f]{48}$/);
    const ep = await queryOne(`SELECT * FROM webhook_endpoints WHERE id = $1`, [r.json().endpoint_id]);
    expect(ep.secreto_firma).toBe(creada.signing_key);
    expect(creada.url).toContain(`/webhooks/${ep.token}`);
    const resumen = (await get('/api/ux/integraciones/resumen')).json();
    expect(resumen.conexiones.calendly).toMatchObject({ conectado: true, email: 'benja@mail.com' });

    // Aviso firmado → entra; sin firma o con otra firma → se guarda como rechazado y no se procesa.
    const cuerpo = JSON.stringify({ event: 'invitee.created', payload: { email: 'cliente@mail.com', name: 'Cliente', uri: 'https://api.calendly.com/inv/1',
      questions_and_answers: [{ question: '¿Cuál es tu Instagram?', answer: '@cliente.ig' }] } });
    const ruta = `/webhooks/${ep.token}`;
    const bien = await app.inject({ method: 'POST', url: ruta, headers: { 'content-type': 'application/json', 'calendly-webhook-signature': firmar(ep.secreto_firma, cuerpo) }, payload: cuerpo });
    expect(bien.statusCode).toBe(200);
    expect(bien.json().tipo).toBe('reunion_agendada');
    const lead = await queryOne(`SELECT l.ig_username FROM webhook_eventos w JOIN leads l ON l.id = w.lead_id WHERE w.id = $1`, [bien.json().webhookEventoId]);
    expect(lead.ig_username).toBe('cliente.ig');
    const sin = await app.inject({ method: 'POST', url: ruta, headers: { 'content-type': 'application/json' }, payload: cuerpo });
    expect(sin.statusCode).toBe(400);
    expect(sin.json().codigo).toBe('firma_invalida');
    const otra = await app.inject({ method: 'POST', url: ruta, headers: { 'content-type': 'application/json', 'calendly-webhook-signature': firmar('otro-secreto', cuerpo) }, payload: cuerpo });
    expect(otra.statusCode).toBe(400);
    const rechazado = await queryOne(`SELECT estado, codigo_error, lead_id FROM webhook_eventos WHERE id = $1`, [otra.json().webhookEventoId]);
    expect(rechazado).toMatchObject({ estado: 'error', codigo_error: 'firma_invalida', lead_id: null });
  });

  it('si ya había una suscripción a esa dirección la reemplaza; si el plan no deja, lo dice claro', async () => {
    let altas = 0; const borradas: string[] = [];
    manejar = (p) => {
      if (p.url === '/users/me') return { status: 200, json: yo };
      if (p.method === 'POST' && p.url === '/webhook_subscriptions') {
        altas++;
        return altas === 1 ? { status: 409, json: { title: 'Already Exists' } } : { status: 201, json: { resource: { uri: `${base}/webhook_subscriptions/W2` } } };
      }
      if (p.method === 'GET' && p.url.startsWith('/webhook_subscriptions?')) {
        const ep = pedidos.find((x) => x.method === 'POST' && x.url === '/webhook_subscriptions');
        return { status: 200, json: { collection: [{ uri: `${base}/webhook_subscriptions/VIEJA`, callback_url: JSON.parse(ep!.body).url }] } };
      }
      if (p.method === 'DELETE') { borradas.push(p.url); return { status: 204 }; }
      if (p.url.startsWith('/event_types')) return { status: 200, json: { collection: [] } };
      return { status: 404 };
    };
    const r = await send('POST', '/api/ux/integraciones/calendly', { token: 'tok-calendly-0123456789abcdef' });
    expect(r.statusCode).toBe(200);
    expect(borradas).toContain('/webhook_subscriptions/VIEJA');

    manejar = (p) => (p.url === '/users/me' ? { status: 200, json: yo } : { status: 403, json: { title: 'Permission Denied', message: 'Please upgrade your Calendly account to Standard' } });
    const plan = await send('POST', '/api/ux/integraciones/calendly', { token: 'tok-calendly-0123456789abcdef' });
    expect(plan.statusCode).toBe(400);
    expect(plan.json().mensaje).toMatch(/plan de Calendly/);

    manejar = (p) => (p.method === 'DELETE' ? { status: 204 } : { status: 404 });
    expect((await send('DELETE', '/api/ux/integraciones/calendly')).statusCode).toBe(204);
    expect(pedidos.some((p) => p.method === 'DELETE' && p.url === '/webhook_subscriptions/W2')).toBe(true);
    const ep = await queryOne(`SELECT secreto_firma, configurado_en FROM webhook_endpoints WHERE cuenta_id = $1 AND slug = 'reunion-agendada'`, [cuentaId]);
    expect(ep).toMatchObject({ secreto_firma: null, configurado_en: null });
  });
});

describe('Stripe pegando una clave restringida', () => {
  it('valida el formato, crea el aviso con los eventos justos y guarda el secreto de firma', async () => {
    const formato = await send('POST', '/api/ux/integraciones/stripe', { clave: 'pk_live_1234567890' });
    expect(formato.statusCode).toBe(400);
    expect(formato.json().mensaje).toMatch(/rk_live_/);

    manejar = (p) => (p.url.startsWith('/v1/webhook_endpoints') ? { status: 403, json: { error: { message: 'does not have the required permissions' } } } : { status: 404 });
    const permiso = await send('POST', '/api/ux/integraciones/stripe', { clave: 'rk_test_abcdefghij123' });
    expect(permiso.statusCode).toBe(400);
    expect(permiso.json().mensaje).toMatch(/Webhook Endpoints/);

    // Ya había un aviso pegado a mano a la misma dirección: se reemplaza (si no, cada venta contaría doble).
    const previa = (await send('POST', '/api/ux/integraciones/fuente', { tipo: 'stripe' })).json();
    let alta: URLSearchParams | null = null;
    manejar = (p) => {
      if (p.method === 'GET' && p.url.startsWith('/v1/webhook_endpoints')) {
        return { status: 200, json: { data: [{ id: 'we_viejo', url: previa.url }, { id: 'we_otro', url: 'https://otra.app/hook' }] } };
      }
      if (p.method === 'POST' && p.url === '/v1/webhook_endpoints') {
        alta = new URLSearchParams(p.body);
        return { status: 200, json: { id: 'we_123', secret: 'whsec_prueba_123', livemode: false } };
      }
      if (p.method === 'DELETE') return { status: 200, json: { deleted: true } };
      return { status: 404 };
    };
    const r = await send('POST', '/api/ux/integraciones/stripe', { clave: 'rk_test_abcdefghij123' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, modo: 'prueba' });
    expect(pedidos.some((p) => p.method === 'DELETE' && p.url === '/v1/webhook_endpoints/we_viejo')).toBe(true);
    expect(pedidos.some((p) => p.method === 'DELETE' && p.url === '/v1/webhook_endpoints/we_otro')).toBe(false);
    expect(alta!.getAll('enabled_events[]')).toEqual(['checkout.session.completed', 'charge.refunded']);
    expect(pedidos.find((p) => p.method === 'POST')!.auth).toBe('Bearer rk_test_abcdefghij123');
    const ep = await queryOne(`SELECT * FROM webhook_endpoints WHERE id = $1`, [r.json().endpoint_id]);
    expect(ep.secreto_firma).toBe('whsec_prueba_123');
    expect(alta!.get('url')).toContain(`/webhooks/${ep.token}`);
    expect(ep.configurado_en).toBeTruthy();

    // Venta firmada → entra como venta en euros; sin firma, firma vieja u otra → no.
    const cuerpo = JSON.stringify({ id: 'evt_firmado', type: 'checkout.session.completed', data: { object: { amount_total: 49700, currency: 'eur', customer_details: { email: 'compra@mail.com' } } } });
    const ruta = `/webhooks/${ep.token}`;
    const ok = await app.inject({ method: 'POST', url: ruta, headers: { 'content-type': 'application/json', 'stripe-signature': firmar('whsec_prueba_123', cuerpo) }, payload: cuerpo });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().tipo).toBe('venta');
    const ev = await queryOne(`SELECT valor FROM eventos WHERE id = $1`, [ok.json().eventoId]);
    expect(Number(ev.valor)).toBe(497);
    // Stripe manda "application/json; charset=utf-8" y el cuerpo con su propio formato (con espacios):
    // la firma se calcula sobre el cuerpo CRUDO, tal cual llegó.
    const crudo = `{\n  "id": "evt_charset",\n  "type": "charge.refunded",\n  "data": { "object": { "amount_refunded": 10000, "currency": "eur", "billing_details": { "email": "compra@mail.com" } } }\n}`;
    const conCharset = await app.inject({ method: 'POST', url: ruta, headers: { 'content-type': 'application/json; charset=utf-8', 'stripe-signature': firmar('whsec_prueba_123', crudo) }, payload: crudo });
    expect(conCharset.statusCode).toBe(200);
    expect(conCharset.json().tipo).toBe('reembolso');
    const vieja = await app.inject({ method: 'POST', url: ruta, headers: { 'content-type': 'application/json', 'stripe-signature': firmar('whsec_prueba_123', cuerpo, Math.floor(Date.now() / 1000) - 3600) }, payload: cuerpo });
    expect(vieja.statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: ruta, headers: { 'content-type': 'application/json' }, payload: cuerpo })).statusCode).toBe(400);

    // Las direcciones sin secreto (ManyChat, Zapier…) siguen entrando sin firma.
    const mc = (await send('POST', '/api/ux/integraciones/fuente', { tipo: 'manychat' })).json();
    expect((await app.inject({ method: 'POST', url: new URL(mc.url).pathname, payload: { id: 'sub_x', ig_username: 'sin.firma' } })).statusCode).toBe(200);

    // Una dirección manejada por la conexión no se puede rotar a mano.
    expect((await send('POST', `/api/webhooks/endpoints/${ep.id}/rotar`)).statusCode).toBe(400);

    manejar = (p) => (p.method === 'DELETE' ? { status: 200, json: { deleted: true } } : { status: 404 });
    expect((await send('DELETE', '/api/ux/integraciones/stripe')).statusCode).toBe(204);
    expect(pedidos.some((p) => p.method === 'DELETE' && p.url === '/v1/webhook_endpoints/we_123')).toBe(true);
  });

  it('verificarFirmaWebhook: formato, tolerancia y firmas múltiples', () => {
    const cuerpo = '{"a":1}';
    const t = 1_700_000_000;
    const buena = firmar('s3cr3t', cuerpo, t);
    expect(verificarFirmaWebhook('stripe', 's3cr3t', cuerpo, { 'stripe-signature': buena }, t * 1000).ok).toBe(true);
    expect(verificarFirmaWebhook('stripe', 's3cr3t', cuerpo, { 'stripe-signature': `t=${t},v1=deadbeef,${buena.split(',')[1]}` }, t * 1000).ok).toBe(true);
    expect(verificarFirmaWebhook('stripe', 's3cr3t', '{"a":2}', { 'stripe-signature': buena }, t * 1000).ok).toBe(false);
    expect(verificarFirmaWebhook('stripe', 's3cr3t', cuerpo, { 'stripe-signature': buena }, (t + 301) * 1000).ok).toBe(false);
    expect(verificarFirmaWebhook('stripe', 's3cr3t', cuerpo, { 'stripe-signature': 'basura' }, t * 1000).ok).toBe(false);
    expect(verificarFirmaWebhook('manychat', 's3cr3t', cuerpo, {}, t * 1000).ok).toBe(true);
  });
});

describe('Tu Claude con permiso de solo lectura', () => {
  const rpc = (clave: string, cuerpo: unknown) =>
    app.inject({ method: 'POST', url: `/mcp/${clave}`, payload: cuerpo as any });

  it('por defecto mira pero no toca; con permiso puede hacer cambios', async () => {
    const r = await send('POST', '/api/ux/integraciones/claude', { nombre: 'Claude de Benja' });
    expect(r.statusCode).toBe(201);
    const c = r.json();
    expect(c.solo_lectura).toBe(true);
    expect(c.tipo).toBe('claude');
    const clave = c.url.split('/mcp/')[1];

    const lista = (await rpc(clave, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).json().result.tools.map((t: any) => t.name);
    expect(lista).toContain('resumen');
    expect(lista).not.toContain('registrar_evento');
    expect(lista).not.toContain('mover_etapa');
    const escribir = (await rpc(clave, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'crear_nota', arguments: { lead_id: '00000000-0000-0000-0000-000000000000', cuerpo: 'x' } } })).json();
    expect(escribir.result.isError).toBe(true);
    expect(escribir.result.content[0].text).toMatch(/solo lectura/);
    const leer = (await rpc(clave, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'resumen', arguments: {} } })).json();
    expect(leer.result.isError).toBeFalsy();

    const cambio = await send('PATCH', `/api/ux/integraciones/claude/${c.id}`, { puede_escribir: true, nombre: 'Claude (cambios)' });
    expect(cambio.json()).toMatchObject({ solo_lectura: false, nombre: 'Claude (cambios)' });
    const lista2 = (await rpc(clave, { jsonrpc: '2.0', id: 4, method: 'tools/list' })).json().result.tools.map((t: any) => t.name);
    expect(lista2).toContain('registrar_evento');

    // La tarjeta cuenta solo las conexiones de Claude, no cualquier clave técnica.
    await send('POST', '/api/api-keys', { nombre: 'Script propio' });
    const resumen = (await get('/api/ux/integraciones/resumen')).json();
    expect(resumen.claves.n).toBe(1);
    expect(resumen.otras_claves.n).toBeGreaterThanOrEqual(1);
    const otras = (await get('/api/ux/integraciones/claves')).json();
    expect(otras.some((k: any) => k.nombre === 'Script propio')).toBe(true);
    expect(otras.some((k: any) => k.tipo === 'claude')).toBe(false);
  });
});

describe('Tu negocio', () => {
  it('lee y cambia nombre, moneda, zona horaria, @, criterios y comisiones (validando)', async () => {
    const n = (await get('/api/ux/integraciones/negocio')).json();
    expect(n.cuenta.moneda).toBe('EUR');
    expect(n.cuenta.criterios_calif).toHaveLength(3);
    expect(n.comisiones).toEqual({ closer_pct: 20, setter_pct: 5 });
    expect(n.objetivo).toHaveProperty('tiene_meta');

    const r = await send('PATCH', '/api/ux/integraciones/negocio', {
      nombre: 'Academia Lu', moneda: 'usd', zona_horaria: 'America/Argentina/Buenos_Aires', ig_username: '@Lu.Coach',
      criterios_calif: ['Tiene plata', 'Decide', 'Le duele'], comision_closer_pct: 15, comision_setter_pct: 7.5,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().cuenta).toMatchObject({ nombre: 'Academia Lu', moneda: 'USD', zona_horaria: 'America/Argentina/Buenos_Aires', ig_username: 'lu.coach' });
    expect(r.json().cuenta.criterios_calif).toEqual(['Tiene plata', 'Decide', 'Le duele']);
    expect(r.json().comisiones).toEqual({ closer_pct: 15, setter_pct: 7.5 });

    expect((await send('PATCH', '/api/ux/integraciones/negocio', { moneda: 'XXQ' })).statusCode).toBe(400);
    expect((await send('PATCH', '/api/ux/integraciones/negocio', { zona_horaria: 'Marte/Olympus' })).statusCode).toBe(400);
    expect((await send('PATCH', '/api/ux/integraciones/negocio', { criterios_calif: ['uno', 'dos'] })).statusCode).toBe(400);
    expect((await send('PATCH', '/api/ux/integraciones/negocio', { ig_username: 'con espacio raro!' })).statusCode).toBe(400);
    expect((await send('PATCH', '/api/ux/integraciones/negocio', { comision_closer_pct: 120 })).statusCode).toBe(400);
  });
});

describe('Etiquetas automáticas por aviso (agenda)', () => {
  it('agenda en Calendly con su @ → sale el rojo y entra la etiqueta elegida', async () => {
    const ep = (await send('POST', '/api/ux/integraciones/fuente', { tipo: 'agenda' })).json();
    expect(ep.fuente).toBe('calendly');
    const lead = await queryOne<{ id: string }>(
      `INSERT INTO leads (cuenta_id, ig_username, etiquetas) VALUES ($1, 'agenda.tag', ARRAY['Calendario enviado']) RETURNING id`, [cuentaId]);
    const put = await app.inject({ method: 'PUT', url: `/api/ux/integraciones/fuente/${ep.id}/etiquetas`, headers: auth(),
      payload: { reglas: [{ evento: 'reunion_agendada', poner: 'Llamada lista', quitar: 'Calendario enviado' }] } });
    expect(put.statusCode).toBe(200);
    expect((await get(`/api/ux/integraciones/fuente/${ep.id}/etiquetas`)).json().reglas[0].poner).toBe('Llamada lista');
    const r = await app.inject({ method: 'POST', url: new URL(ep.url).pathname, payload: {
      event: 'invitee.created',
      payload: { email: 'agenda.tag@mail.com', name: 'Ag', uri: 'https://api.calendly.com/inv/tag1',
        scheduled_event: { start_time: '2026-12-01T10:00:00Z' },
        questions_and_answers: [{ question: '¿Cuál es tu Instagram?', answer: '@agenda.tag' }] },
    } });
    expect(r.statusCode).toBeLessThan(300);
    const l = await queryOne<{ etiquetas: string[] }>(`SELECT etiquetas FROM leads WHERE id = $1`, [lead!.id]);
    expect(l!.etiquetas).toContain('Llamada lista');
    expect(l!.etiquetas).not.toContain('Calendario enviado');
    expect(l!.etiquetas).not.toContain('Reunión agendada');
  });
});
