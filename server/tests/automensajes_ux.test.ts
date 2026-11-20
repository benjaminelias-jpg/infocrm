import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closePool, queryOne } from '../src/db/pool.js';
import { construirApp } from '../src/app.js';
import { cuentaDePrueba } from './ayuda.js';

let app: FastifyInstance;
let token: string;
let cuentaId: string;
const auth = () => ({ authorization: `Bearer ${token}` });

const grafo = (...pasos: any[]) => [{ id: 'inicio', tipo: 'inicio', siguiente: pasos[0]?.id ?? null }, ...pasos];

beforeAll(async () => {
  app = await construirApp();
  await app.ready();
  const { usuario, cuenta } = await cuentaDePrueba('AutomensajesUX');
  cuentaId = cuenta.id;
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: usuario.email, password: 'contrasena-larga-123' } });
  token = login.json().token;
});

afterAll(async () => {
  await app.close();
  await closePool();
});

describe('probar sin guardar', () => {
  it('recorre lo que se ve en la pizarra sin crear, activar ni registrar nada', async () => {
    const antes = await queryOne(`SELECT (SELECT COUNT(*) FROM flujos WHERE cuenta_id = $1)::int AS f,
                                         (SELECT COUNT(*) FROM flujo_ejecuciones WHERE cuenta_id = $1)::int AS e`, [cuentaId]);
    const pasos = grafo(
      { id: 'p1', tipo: 'pregunta', texto: '¿Te paso la guía, {{nombre}}?', opciones: [
        { id: 'si', titulo: 'Sí', siguiente: 'm1' }, { id: 'no', titulo: 'No', siguiente: 'm2' }] },
      { id: 'm1', tipo: 'enviar_dm', texto: 'Acá va 📄', siguiente: null },
      { id: 'm2', tipo: 'enviar_dm', texto: 'Dale, cuando quieras', siguiente: null },
    );
    const r1 = await app.inject({ method: 'POST', url: '/api/ux/automensajes/simular', headers: auth(), payload: { pasos } });
    expect(r1.statusCode).toBe(200);
    const nodos1 = r1.json().resultados.map((x: any) => x.nodo).filter(Boolean);
    expect(nodos1).toContain('p1');
    expect(nodos1).toContain('m1');
    expect(nodos1).not.toContain('m2');

    // Elegir el otro botón cambia el camino.
    const r2 = await app.inject({ method: 'POST', url: '/api/ux/automensajes/simular', headers: auth(), payload: { pasos, respuestas: { p1: 'no' } } });
    const nodos2 = r2.json().resultados.map((x: any) => x.nodo).filter(Boolean);
    expect(nodos2).toContain('m2');
    expect(nodos2).not.toContain('m1');
    expect(JSON.stringify(r2.json().resultados)).not.toContain('{{nombre}}');

    const despues = await queryOne(`SELECT (SELECT COUNT(*) FROM flujos WHERE cuenta_id = $1)::int AS f,
                                           (SELECT COUNT(*) FROM flujo_ejecuciones WHERE cuenta_id = $1)::int AS e`, [cuentaId]);
    expect(despues).toEqual(antes);
  });

  it('dice qué falta completar sin guardar', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/ux/automensajes/simular', headers: auth(),
      payload: { pasos: grafo({ id: 'v', tipo: 'enviar_dm', texto: '', siguiente: null }) } });
    expect(r.json().problemas.some((p: any) => p.nodo === 'v')).toBe(true);
  });
});

describe('ventana de 24 h de Instagram', () => {
  it('avisa si una espera de un día termina en un mensaje', async () => {
    const pasos = grafo(
      { id: 'e', tipo: 'esperar', minutos: 1440, siguiente: 'm' },
      { id: 'm', tipo: 'enviar_dm', texto: '¿Pudiste verlo?', siguiente: null },
    );
    const r = await app.inject({ method: 'POST', url: '/api/flujos', headers: auth(), payload: { nombre: 'Seguimiento', disparo: 'dm', pasos, activo: false } });
    const f = r.json();
    expect(f.advertencias).toHaveLength(1);
    expect(f.advertencias[0].nodo).toBe('e');
    expect(f.advertencias[0].texto).toMatch(/24 h/);
    // Es un aviso, no un error: no lo deja en pausa por eso.
    expect(f.avisos).toHaveLength(0);
  });

  it('no avisa con 22 h ni si el lead responde en el medio', async () => {
    const corta = grafo({ id: 'e', tipo: 'esperar', minutos: 22 * 60, siguiente: 'm' }, { id: 'm', tipo: 'enviar_dm', texto: 'Hola', siguiente: null });
    const r1 = (await app.inject({ method: 'POST', url: '/api/ux/automensajes/simular', headers: auth(), payload: { pasos: corta } })).json();
    expect(r1.advertencias).toHaveLength(0);
    const conRespuesta = grafo(
      { id: 'e', tipo: 'esperar', minutos: 2880, siguiente: 'r' },
      { id: 'r', tipo: 'esperar_respuesta', siguiente: 'm' },
      { id: 'm', tipo: 'enviar_dm', texto: 'Gracias', siguiente: null },
    );
    const r2 = (await app.inject({ method: 'POST', url: '/api/ux/automensajes/simular', headers: auth(), payload: { pasos: conRespuesta } })).json();
    expect(r2.advertencias).toHaveLength(0);
  });
});

describe('referencias que ya no existen', () => {
  it('una etapa o un recurso borrados dejan el automensaje en pausa con un texto claro', async () => {
    const pasos = grafo(
      { id: 'mv', tipo: 'mover_etapa', etapa_slug: 'etapa-que-no-existe', siguiente: 'rc' },
      { id: 'rc', tipo: 'enviar_recurso', recurso_id: '00000000-0000-4000-8000-000000000000', siguiente: null },
    );
    const r = await app.inject({ method: 'POST', url: '/api/flujos', headers: auth(), payload: { nombre: 'Viejo', disparo: 'dm', pasos, activo: true } });
    const f = r.json();
    expect(f.activo).toBe(false);
    expect(f.marcados).toEqual(expect.arrayContaining(['mv', 'rc']));
    expect(f.avisos.join(' ')).toMatch(/esa etapa ya no existe/);
    expect(f.avisos.join(' ')).toMatch(/ese recurso ya no existe/);
  });

  it('la lista trae última ejecución y fallos de la semana', async () => {
    const lista = (await app.inject({ method: 'GET', url: '/api/flujos', headers: auth() })).json();
    expect(lista.length).toBeGreaterThan(0);
    expect(lista[0]).toHaveProperty('ultima_ejecucion');
    expect(lista[0]).toHaveProperty('errores_7d');
  });
});
