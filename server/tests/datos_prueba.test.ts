import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { construirApp } from '../src/app.js';
import { closePool, queryOne } from '../src/db/pool.js';
import { cuentaDePrueba } from './ayuda.js';

let app: any; let token = ''; let cuentaId = '';
beforeAll(async () => {
  app = await construirApp(); await app.ready();
  const r = await cuentaDePrueba('Prueba');
  cuentaId = r.cuenta.id;
  token = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: r.usuario.email, password: 'contrasena-larga-123' } })).json().token;
});
afterAll(async () => { await app?.close(); await closePool(); });

const pedir = (method: string, url: string) => app.inject({ method, url, headers: { authorization: `Bearer ${token}` } });

describe('datos de prueba', () => {
  it('carga leads marcados y los borra sin tocar lo real', async () => {
    await queryOne(`INSERT INTO leads (cuenta_id, ig_username) VALUES ($1, 'real.uno') RETURNING id`, [cuentaId]);
    const c = await pedir('POST', '/api/demo/cargar?leads=12');
    expect(c.statusCode).toBe(200);
    expect(c.json().creados).toBe(12);
    expect((await pedir('GET', '/api/demo')).json().leads).toBe(12);
    const b = await pedir('POST', '/api/demo/borrar');
    expect(b.json().leads).toBe(12);
    expect((await pedir('GET', '/api/demo')).json().leads).toBe(0);
    const quedan = await queryOne(`SELECT COUNT(*)::int n FROM leads WHERE cuenta_id = $1`, [cuentaId]);
    expect(quedan.n).toBe(1);
    const cont = await queryOne(`SELECT COUNT(*)::int n FROM contenidos WHERE cuenta_id = $1`, [cuentaId]);
    expect(cont.n).toBe(0);
  });
});
