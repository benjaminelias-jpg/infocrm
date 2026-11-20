import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closePool, queryOne } from '../src/db/pool.js';
import { construirApp } from '../src/app.js';
import { cuentaDePrueba } from './ayuda.js';

let app: FastifyInstance;
let token: string;
const auth = () => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  app = await construirApp();
  await app.ready();
  const { usuario } = await cuentaDePrueba('UX');
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: usuario.email, password: 'contrasena-larga-123' } });
  token = login.json().token;
});

afterAll(async () => {
  await app.close();
  await closePool();
});

describe('pipeline estilo Kommo', () => {
  it('lead rápido: lo carga en la etapa elegida, con etiqueta y lo atiende quien lo creó', async () => {
    const pipes = (await app.inject({ method: 'GET', url: '/api/pipelines', headers: auth() })).json();
    const etapa = pipes[0].etapas[2];
    const r = await app.inject({
      method: 'POST', url: '/api/ux/pipeline/lead-rapido', headers: auth(),
      payload: { etapa_id: etapa.id, usuario: '@Lead.Rapido', etiqueta: 'vip' },
    });
    expect(r.statusCode).toBe(201);
    const { lead_id, oportunidad_id, ya_existia } = r.json();
    expect(ya_existia).toBe(false);
    const opp = await queryOne(`SELECT etapa_id, propietario_id FROM oportunidades WHERE id = $1`, [oportunidad_id]);
    expect(opp.etapa_id).toBe(etapa.id);
    expect(opp.propietario_id).toBeTruthy();
    const lead = await queryOne(`SELECT ig_username, etiquetas FROM leads WHERE id = $1`, [lead_id]);
    expect(lead.ig_username).toBe('Lead.Rapido');
    expect(lead.etiquetas).toContain('vip');

    // El mismo @usuario otra vez: no duplica, lo mueve.
    const otra = pipes[0].etapas[3];
    const r2 = await app.inject({
      method: 'POST', url: '/api/ux/pipeline/lead-rapido', headers: auth(),
      payload: { etapa_id: otra.id, usuario: 'lead.rapido' },
    });
    expect(r2.json().ya_existia).toBe(true);
    expect(r2.json().lead_id).toBe(lead_id);
    const opp2 = await queryOne(`SELECT etapa_id FROM oportunidades WHERE id = $1`, [r2.json().oportunidad_id]);
    expect(opp2.etapa_id).toBe(otra.id);
  });

  it('sin @usuario ni nombre explica qué falta', async () => {
    const pipes = (await app.inject({ method: 'GET', url: '/api/pipelines', headers: auth() })).json();
    const r = await app.inject({ method: 'POST', url: '/api/ux/pipeline/lead-rapido', headers: auth(), payload: { etapa_id: pipes[0].etapas[0].id } });
    expect(r.statusCode).toBe(400);
    expect(r.json().mensaje).toMatch(/@usuario/);
  });

  it('conteos de leads abiertos por pipeline (para el selector con +)', async () => {
    const c = (await app.inject({ method: 'GET', url: '/api/ux/pipeline/conteos', headers: auth() })).json();
    const total = Object.values(c).reduce((a: number, b: any) => a + Number(b), 0);
    expect(total).toBeGreaterThanOrEqual(1);
  });

  it('el tablero trae última actividad y mensajes sin leer para la tarjeta', async () => {
    const k = (await app.inject({ method: 'GET', url: '/api/kanban', headers: auth() })).json();
    const t = k.flatMap((e: any) => e.tarjetas)[0];
    expect(t).toHaveProperty('ultima_actividad');
    expect(t).toHaveProperty('mensajes_sin_leer');
  });
});
