import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { closePool, query, queryOne } from '../src/db/pool.js';
import { construirApp } from '../src/app.js';
import { cuentaDePrueba } from './ayuda.js';

let app: FastifyInstance;
let token: string;
let cuentaId: string;
let principal: any;
const auth = () => ({ authorization: `Bearer ${token}` });
const pedir = (method: string, url: string, payload?: unknown) =>
  app.inject({ method: method as any, url, headers: auth(), ...(payload !== undefined ? { payload: payload as any } : {}) });
const pipelines = async () => (await pedir('GET', '/api/pipelines')).json() as any[];

// Una "otra app" de mentira que registra lo que le llega.
let receptor: Server;
let urlReceptor = '';
const recibidos: any[] = [];

beforeAll(async () => {
  app = await construirApp();
  await app.ready();
  const { usuario, cuenta } = await cuentaDePrueba('ConfigPipelines');
  cuentaId = cuenta.id;
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: usuario.email, password: 'contrasena-larga-123' } });
  token = r.json().token;
  principal = (await pipelines())[0];

  receptor = createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (c) => { cuerpo += c; });
    req.on('end', () => {
      recibidos.push({ url: req.url, firma: req.headers['x-infocrm-firma'], cuerpo: JSON.parse(cuerpo || '{}') });
      res.statusCode = req.url?.includes('falla') ? 500 : 200;
      res.end('ok');
    });
  });
  await new Promise<void>((ok) => receptor.listen(0, '127.0.0.1', () => ok()));
  const dir = receptor.address();
  urlReceptor = `http://127.0.0.1:${typeof dir === 'object' && dir ? dir.port : 0}`;
});

afterAll(async () => {
  receptor?.close();
  await app.close();
  await closePool();
});

async function leadEn(etapaId: string, usuario: string) {
  return (await pedir('POST', '/api/ux/pipeline/lead-rapido', { etapa_id: etapaId, usuario })).json();
}

describe('crear pipelines', () => {
  it('no deja dos pipelines con el mismo nombre (sin importar mayúsculas)', async () => {
    const a = await pedir('POST', '/api/pipelines', { nombre: 'Cierre high-ticket' });
    expect(a.statusCode).toBe(201);
    const b = await pedir('POST', '/api/pipelines', { nombre: '  cierre HIGH-ticket ' });
    expect(b.statusCode).toBe(409);
    expect(JSON.stringify(b.json())).toMatch(/Ya tenés un pipeline/);
    // Renombrar a un nombre ocupado tampoco.
    const c = await pedir('PATCH', `/api/pipelines/${principal.id}`, { nombre: 'Cierre High-Ticket' });
    expect(c.statusCode).toBe(409);
  });

  it('si falta el nombre, el error dice qué hacer en español (no el mensaje en inglés de zod)', async () => {
    const r = await pedir('POST', '/api/pipelines', { nombre: '   ' });
    expect(r.statusCode).toBe(400);
    expect(r.json().mensaje).toBe('Escribí el nombre del pipeline');
  });

  it('un archivo demasiado pesado responde 413 con un mensaje claro', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/pipelines', headers: { ...auth(), 'content-type': 'application/json' },
      payload: JSON.stringify({ nombre: 'x'.repeat(12 * 1024 * 1024) }) });
    expect(r.statusCode).toBe(413);
    expect(r.json().mensaje).toMatch(/muy pesado/);
  });

  it('las etapas básicas ya saben con qué evento se mueven solas', async () => {
    const p = (await pedir('POST', '/api/pipelines', { nombre: 'Lanzamiento julio' })).json();
    const etapas = (await pipelines()).find((x) => x.id === p.id).etapas;
    const evento = (n: string) => etapas.find((e: any) => e.nombre === n)?.evento_asociado;
    expect(evento('Interesado')).toBe('lead_creado');
    expect(evento('En conversación')).toBe('respondio_dm');
    expect(evento('Llamada agendada')).toBe('reunion_agendada');
    expect(evento('Cliente')).toBe('venta');
    expect(evento('Perdido')).toBeNull();
  });

  it('puede copiar las etapas de otro pipeline (con sus acciones)', async () => {
    await pedir('PATCH', `/api/etapas/${principal.etapas[1].id}`, { acciones: [{ tipo: 'etiquetar', etiqueta: 'copiada' }] });
    const p = (await pedir('POST', '/api/pipelines', { nombre: 'Copia del principal', copiar_de: principal.id })).json();
    const etapas = (await pipelines()).find((x) => x.id === p.id).etapas;
    expect(etapas.map((e: any) => e.nombre)).toEqual(principal.etapas.map((e: any) => e.nombre));
    expect(etapas[1].acciones).toEqual([{ tipo: 'etiquetar', etiqueta: 'copiada' }]);
  });
});

describe('etapas', () => {
  it('una etapa nueva entra ANTES de Venta/Perdido y con un color que no se repite', async () => {
    const p = (await pedir('POST', '/api/pipelines', { nombre: 'Para etapas' })).json();
    const r = await pedir('POST', `/api/pipelines/${p.id}/etapas`, { nombre: 'Seguimiento' });
    expect(r.statusCode).toBe(201);
    const etapas = (await pipelines()).find((x) => x.id === p.id).etapas;
    const nombres = etapas.map((e: any) => e.nombre);
    expect(nombres).toEqual(['Interesado', 'En conversación', 'Llamada agendada', 'Seguimiento', 'Cliente', 'Perdido']);
    const colores = etapas.map((e: any) => e.color.toLowerCase());
    expect(new Set(colores).size).toBe(colores.length);
    // Los órdenes quedan sin repetir.
    expect(new Set(etapas.map((e: any) => e.orden)).size).toBe(etapas.length);
  });

  it('con antes_de se inserta justo ahí; duplicar deja la copia debajo', async () => {
    const p = (await pedir('POST', '/api/pipelines', { nombre: 'Insertar' })).json();
    let etapas = (await pipelines()).find((x) => x.id === p.id).etapas;
    await pedir('POST', `/api/pipelines/${p.id}/etapas`, { nombre: 'Primera llamada', antes_de: etapas[1].id });
    await pedir('POST', `/api/etapas/${etapas[0].id}/duplicar`);
    etapas = (await pipelines()).find((x) => x.id === p.id).etapas;
    expect(etapas.map((e: any) => e.nombre)).toEqual([
      'Interesado', 'Interesado (copia)', 'Primera llamada', 'En conversación', 'Llamada agendada', 'Cliente', 'Perdido']);
  });

  it('borrar una etapa pasa sus leads a la elegida (o a la anterior) y dice cuántos', async () => {
    const p = (await pedir('POST', '/api/pipelines', { nombre: 'Borrar etapas' })).json();
    const etapas = (await pipelines()).find((x) => x.id === p.id).etapas;
    const [interesado, conversacion, llamada] = etapas;
    await leadEn(llamada.id, 'borra.uno');
    await leadEn(llamada.id, 'borra.dos');
    const r = await pedir('DELETE', `/api/etapas/${llamada.id}`);
    expect(r.statusCode).toBe(200);
    expect(r.json().movidas).toBe(2);
    expect(r.json().destino.id).toBe(conversacion.id);
    await leadEn(conversacion.id, 'borra.tres');
    const r2 = await pedir('DELETE', `/api/etapas/${conversacion.id}?mover_a=${interesado.id}`);
    expect(r2.json()).toMatchObject({ movidas: 3, destino: { id: interesado.id } });
    // La única abierta no se puede borrar.
    expect((await pedir('DELETE', `/api/etapas/${interesado.id}`)).statusCode).toBe(400);
  });
});

describe('borrar un pipeline no esconde sus leads', () => {
  it('los pasa a otro pipeline (misma etapa si existe), cambia el predeterminado y Deshacer lo devuelve todo', async () => {
    const p = (await pedir('POST', '/api/pipelines', { nombre: 'Se va a borrar' })).json();
    const etapas = (await pipelines()).find((x) => x.id === p.id).etapas;
    const llamada = etapas.find((e: any) => e.slug === 'llamada-agendada');
    const a = await leadEn(llamada.id, 'mudanza.uno');
    const b = await leadEn(etapas[0].id, 'mudanza.dos');
    await pedir('PATCH', `/api/pipelines/${p.id}`, { es_predeterminado: true });

    const destino = (await pedir('POST', '/api/pipelines', { nombre: 'Destino' })).json();
    const r = await pedir('DELETE', `/api/pipelines/${p.id}?mover_a=${destino.id}`);
    expect(r.statusCode).toBe(200);
    const res = r.json();
    expect(res.movidas).toHaveLength(2);
    expect(res.predeterminado_id).toBe(destino.id);

    const enDestino = await query(
      `SELECT o.id, e.slug FROM oportunidades o JOIN etapas e ON e.id = o.etapa_id WHERE o.pipeline_id = $1 AND o.estado = 'abierta'`,
      [destino.id]);
    expect(enDestino.map((o: any) => o.id).sort()).toEqual([a.oportunidad_id, b.oportunidad_id].sort());
    // "Llamada agendada" existe también en el destino: queda en la misma etapa.
    expect(enDestino.find((o: any) => o.id === a.oportunidad_id).slug).toBe('llamada-agendada');
    const lista = await pipelines();
    expect(lista.some((x) => x.id === p.id)).toBe(false);
    expect(lista.find((x) => x.id === destino.id).es_predeterminado).toBe(true);

    // Deshacer
    const u = await pedir('POST', `/api/pipelines/${p.id}/restaurar`, { movidas: res.movidas, era_predeterminado: true });
    expect(u.statusCode).toBe(200);
    expect(u.json().devueltas).toBe(2);
    const otra = await pipelines();
    expect(otra.find((x) => x.id === p.id).es_predeterminado).toBe(true);
    const vuelta = await queryOne(`SELECT pipeline_id, etapa_id FROM oportunidades WHERE id = $1`, [a.oportunidad_id]);
    expect(vuelta).toEqual({ pipeline_id: p.id, etapa_id: llamada.id });
  });

  it('no deja borrar el único pipeline ni restaurar uno de otra cuenta', async () => {
    const { usuario } = await cuentaDePrueba('UnSoloPipeline');
    const t = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: usuario.email, password: 'contrasena-larga-123' } })).json().token;
    const solo = (await app.inject({ method: 'GET', url: '/api/pipelines', headers: { authorization: `Bearer ${t}` } })).json()[0];
    const r = await app.inject({ method: 'DELETE', url: `/api/pipelines/${solo.id}`, headers: { authorization: `Bearer ${t}` } });
    expect(r.statusCode).toBe(400);
    const ajeno = await pedir('POST', `/api/pipelines/${solo.id}/restaurar`, { movidas: [] });
    expect(ajeno.statusCode).toBe(404);
  });
});

describe('reglas', () => {
  it('no se puede crear dos veces la misma regla, ni editar una para que quede igual a otra', async () => {
    const regla = { nombre: 'Compra → cliente', disparador: { evento: 'venta' }, acciones: [{ tipo: 'etiquetar', etiqueta: 'cliente' }] };
    expect((await pedir('POST', '/api/reglas', regla)).statusCode).toBe(201);
    const otra = await pedir('POST', '/api/reglas', { ...regla, nombre: 'Otro nombre, misma regla' });
    expect(otra.statusCode).toBe(409);
    const distinta = (await pedir('POST', '/api/reglas', { ...regla, acciones: [{ tipo: 'etiquetar', etiqueta: 'vip' }] })).json();
    const editar = await pedir('PATCH', `/api/reglas/${distinta.id}`, { acciones: [{ tipo: 'etiquetar', etiqueta: 'cliente' }] });
    expect(editar.statusCode).toBe(409);
    // Pausar o renombrar no choca con nada.
    expect((await pedir('PATCH', `/api/reglas/${distinta.id}`, { activo: false })).statusCode).toBe(200);
  });
});

describe('avisar a una conexión guardada', () => {
  it('la acción de etapa usa la conexión (firmada y registrada) en vez de una URL suelta', async () => {
    const con = (await pedir('POST', '/api/webhooks/salida', { nombre: 'Zapier · Bienvenida', url: `${urlReceptor}/hook`, eventos: ['solo_etapas'] })).json();
    const p = (await pedir('POST', '/api/pipelines', { nombre: 'Con aviso' })).json();
    const etapas = (await pipelines()).find((x) => x.id === p.id).etapas;
    await pedir('PATCH', `/api/etapas/${etapas[1].id}`, { acciones: [{ tipo: 'webhook', suscripcion_id: con.id }] });
    const lead = await leadEn(etapas[0].id, 'aviso.etapa');
    recibidos.length = 0;
    await pedir('POST', `/api/oportunidades/${lead.oportunidad_id}/etapa`, { etapa_id: etapas[1].id });
    expect(recibidos).toHaveLength(1);
    expect(recibidos[0].cuerpo).toMatchObject({ evento: 'lead_movido_a_etapa', etapa: etapas[1].nombre, lead: { ig_username: 'aviso.etapa' } });
    expect(String(recibidos[0].firma)).toMatch(/^sha256=/);
    const entrega = await queryOne(`SELECT estado FROM entregas_webhook WHERE suscripcion_id = $1 ORDER BY id DESC LIMIT 1`, [con.id]);
    expect(entrega?.estado).toBe('entregado');
  });

  it('una conexión «solo desde etapas» no recibe los eventos generales', async () => {
    const con = (await pedir('POST', '/api/webhooks/salida', { nombre: 'Solo etapas', url: `${urlReceptor}/solo`, eventos: ['solo_etapas'] })).json();
    recibidos.length = 0;
    await leadEn(principal.etapas[0].id, 'evento.general');
    expect(recibidos.filter((x) => x.url === '/solo')).toHaveLength(0);
    void con;
  });

  it('«Probar» una dirección pegada a mano dice si llegó o por qué no', async () => {
    const bien = (await pedir('POST', '/api/ux/pipeline/probar-aviso', { url: `${urlReceptor}/prueba` })).json();
    expect(bien.ok).toBe(true);
    const mal = (await pedir('POST', '/api/ux/pipeline/probar-aviso', { url: `${urlReceptor}/falla` })).json();
    expect(mal).toMatchObject({ ok: false, status: 500 });
    const rara = await pedir('POST', '/api/ux/pipeline/probar-aviso', { url: 'ftp://algo' });
    expect(rara.statusCode).toBe(400);
  });
});

describe('migración 013', () => {
  it('a los pipelines viejos sin eventos les pone los de sus etapas básicas, sin pisar lo configurado', async () => {
    const viejo = (await pedir('POST', '/api/pipelines', { nombre: 'Viejo sin eventos' })).json();
    const tocado = (await pedir('POST', '/api/pipelines', { nombre: 'Viejo configurado' })).json();
    await query(`UPDATE etapas SET evento_asociado = NULL WHERE pipeline_id = ANY($1::uuid[])`, [[viejo.id, tocado.id]]);
    await query(`UPDATE etapas SET evento_asociado = 'venta' WHERE pipeline_id = $1 AND slug = 'llamada-agendada'`, [tocado.id]);
    const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/db/migrations/013_etapas_que_se_mueven_solas.sql'), 'utf8');
    await query(sql);
    const ev = async (pid: string) => Object.fromEntries((await query(
      `SELECT slug, evento_asociado FROM etapas WHERE pipeline_id = $1`, [pid])).map((e: any) => [e.slug, e.evento_asociado]));
    expect(await ev(viejo.id)).toMatchObject({ interesado: 'lead_creado', 'en-conversacion': 'respondio_dm', 'llamada-agendada': 'reunion_agendada', cliente: 'venta', perdido: null });
    expect(await ev(tocado.id)).toMatchObject({ interesado: null, 'llamada-agendada': 'venta' });
    void cuentaId;
  });
});
