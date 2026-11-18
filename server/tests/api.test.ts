import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closePool, queryOne } from '../src/db/pool.js';
import { construirApp } from '../src/app.js';
import { registrarEvento } from '../src/modules/eventos.js';
import { cuentaDePrueba, crearContenido, crearAutomatizacion } from './ayuda.js';

let app: FastifyInstance;
let cuentaId: string;
let token: string;
let email: string;
let endpoints: any[];

beforeAll(async () => {
  app = await construirApp();
  await app.ready();

  const { cuenta, usuario, endpoints: eps } = await cuentaDePrueba('API');
  cuentaId = cuenta.id;
  email = usuario.email;
  endpoints = eps;

  const login = await app.inject({
    method: 'POST', url: '/api/auth/login',
    payload: { email, password: 'contrasena-larga-123' },
  });
  token = login.json().token;

  const c = await crearContenido(cuentaId, { titulo: 'Reel API', igMediaId: 'media_api' });
  await crearAutomatizacion(cuentaId, { palabra: 'APITEST', contenidoId: c!.id });
});

afterAll(async () => {
  await app.close();
  await closePool();
});

const auth = () => ({ authorization: `Bearer ${token}` });

describe('autenticación', () => {
  it('rechaza el acceso sin token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leads' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('no_autorizado');
  });

  it('rechaza una contraseña incorrecta', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email, password: 'incorrecta' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('devuelve token y cuenta al iniciar sesión', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email, password: 'contrasena-larga-123' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTruthy();
    expect(res.json().cuenta.id).toBe(cuentaId);
  });

  it('acepta clave de API como alternativa al token', async () => {
    const creada = await app.inject({
      method: 'POST', url: '/api/api-keys', headers: auth(),
      payload: { nombre: 'Clave de prueba' },
    });
    const clave = creada.json().clave;
    expect(clave).toMatch(/^ic_/);

    const res = await app.inject({
      method: 'GET', url: '/api/leads', headers: { 'x-api-key': clave },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('aislamiento entre cuentas', () => {
  it('no deja ver los leads de otra cuenta', async () => {
    const otra = await cuentaDePrueba('Ajena');
    await registrarEvento({
      cuentaId: otra.cuenta.id, tipo: 'lead_creado',
      identidad: { igUsername: 'secreto.ajeno' }, sinReglas: true,
    });

    const res = await app.inject({
      method: 'GET', url: '/api/leads?q=secreto.ajeno', headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().leads).toHaveLength(0);
  });
});

describe('webhook público', () => {
  it('acepta el POST sin autenticación, con el token en la URL', async () => {
    const ep = endpoints.find((e: any) => e.slug === 'manychat-leads');
    const res = await app.inject({
      method: 'POST', url: `/webhooks/${ep.token}`,
      payload: {
        id: 'mc_api_1', first_name: 'Webhook', ig_username: 'via.webhook',
        custom_fields: { palabra_clave: 'APITEST' },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().estado).toBe('procesado');
  });

  it('devuelve 404 con un token inventado', async () => {
    const res = await app.inject({ method: 'POST', url: '/webhooks/whk_inventado', payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it('responde 202 (no error) cuando el payload no sirve, para que ManyChat no reintente en bucle', async () => {
    const ep = endpoints.find((e: any) => e.slug === 'manychat-leads');
    const res = await app.inject({
      method: 'POST', url: `/webhooks/${ep.token}`, payload: { nada: 'util' },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().estado).toBe('error');
  });

  it('el probador explica qué entiende sin guardar nada', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/webhooks/probar', headers: auth(),
      payload: {
        fuente: 'manychat',
        payload: { id: '999', ig_username: 'probador', custom_fields: { keyword: 'APITEST' } },
      },
    });

    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.lead_identificable).toBe(true);
    expect(d.lo_que_entiendo.senales.palabraClave).toBe('APITEST');

    const guardado = await queryOne(
      `SELECT * FROM leads WHERE cuenta_id = $1 AND ig_username = 'probador'`, [cuentaId]);
    expect(guardado).toBeNull();
  });
});

describe('endpoints del CRM', () => {
  it('lista leads con su etapa y el contenido de origen', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leads', headers: auth() });
    expect(res.statusCode).toBe(200);

    const d = res.json();
    expect(d.leads.length).toBeGreaterThan(0);
    const lead = d.leads.find((l: any) => l.ig_username === 'via.webhook');
    expect(lead.etapa_nombre).toBeTruthy();
    expect(lead.contenido_titulo).toBe('Reel API');
  });

  it('devuelve la ficha completa de un lead', async () => {
    const lista = await app.inject({ method: 'GET', url: '/api/leads', headers: auth() });
    const id = lista.json().leads[0].id;

    const res = await app.inject({ method: 'GET', url: `/api/leads/${id}`, headers: auth() });
    expect(res.statusCode).toBe(200);

    const d = res.json();
    expect(Array.isArray(d.eventos)).toBe(true);
    expect(Array.isArray(d.toques)).toBe(true);
    expect(Array.isArray(d.oportunidades)).toBe(true);
  });

  it('registra un evento por la API', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/eventos', headers: auth(),
      payload: {
        tipo: 'venta',
        identidad: { igUsername: 'via.webhook' },
        valor: 1497, moneda: 'EUR', titulo: 'Programa',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().eventoId).toBeTruthy();
  });

  it('devuelve el kanban agrupado por etapa', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/kanban', headers: auth() });
    expect(res.statusCode).toBe(200);

    const etapas = res.json();
    expect(etapas.length).toBe(8);
    expect(etapas[0].slug).toBe('nuevo');
    expect(Array.isArray(etapas[0].tarjetas)).toBe(true);
  });

  it('valida la entrada y explica qué campo falla', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/eventos', headers: auth(), payload: { valor: 100 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('peticion_invalida');
    expect(res.json().detalles[0].campo).toBe('tipo');
  });

  it('da 404 con mensaje claro para un lead que no existe', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/leads/00000000-0000-0000-0000-000000000000', headers: auth(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().mensaje).toContain('no encontrado');
  });
});

describe('analítica', () => {
  it('el panel devuelve todo en una llamada', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/analitica/panel', headers: auth() });
    expect(res.statusCode).toBe(200);

    const d = res.json();
    expect(d.kpis).toBeDefined();
    expect(Array.isArray(d.contenidos)).toBe(true);
    expect(Array.isArray(d.embudo)).toBe(true);
    expect(Array.isArray(d.serie)).toBe(true);
    expect(d.calidad).toBeDefined();
  });

  it('el rendimiento por contenido cuenta leads y ventas del reel correcto', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/analitica/contenidos', headers: auth() });
    const fila = res.json().find((c: any) => c.titulo === 'Reel API');

    expect(fila.leads).toBeGreaterThan(0);
    expect(fila.ventas).toBeGreaterThan(0);
    expect(fila.ingresos).toBeGreaterThan(0);
    expect(fila.tasa_lead_venta).toBeGreaterThan(0);
  });
});
