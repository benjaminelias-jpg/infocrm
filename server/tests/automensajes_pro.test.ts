import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { construirApp } from '../src/app.js';
import { closePool, query, queryOne, pool } from '../src/db/pool.js';
import { registrarEvento } from '../src/modules/eventos.js';
import { ejecutarFlujo, reanudarPorMensaje, enHorario } from '../src/modules/instagram_dm.js';
import { procesarEventoInstagram } from '../src/modules/instagram_eventos.js';
import { cuentaDePrueba } from './ayuda.js';

let app: any; let token = ''; let cuentaId = '';
const pedir = async (method: string, url: string, payload?: any) => {
  const r = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload });
  return { codigo: r.statusCode, datos: r.body ? r.json() : null };
};
const nuevoLead = async (u: string) => (await registrarEvento({ cuentaId, tipo: 'lead_creado', identidad: { igUsername: u, igUserId: `ig_${u}` }, fuente: 'manual' })).leadId;
const salientes = async (leadId: string) => (await query(`SELECT cuerpo FROM mensajes WHERE lead_id = $1 AND direccion = 'saliente' ORDER BY creado_en`, [leadId])).map((m: any) => m.cuerpo);
const flujo = async (nombre: string, disparo: string, pasos: any[], palabra: string | null = null) =>
  (await pedir('POST', '/api/flujos', { nombre, disparo, palabra_clave: palabra, pasos, activo: true })).datos;

beforeAll(async () => {
  app = await construirApp(); await app.ready();
  const r = await cuentaDePrueba('Pro');
  cuentaId = r.cuenta.id;
  token = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: r.usuario.email, password: 'contrasena-larga-123' } })).json().token;
});
afterAll(async () => { await app?.close(); await closePool(); });

describe('campos personalizados', () => {
  it('guarda la respuesta en un campo, la usa en mensajes y en condiciones', async () => {
    const f = await flujo('Nicho', 'dm', [
      { id: 'inicio', tipo: 'inicio', siguiente: 'w' },
      { id: 'w', tipo: 'esperar_respuesta', guardar_en: 'campo:Nicho', siguiente: 'c' },
      { id: 'c', tipo: 'condicion', campo: 'campo', campo_nombre: 'Nicho', operador: 'contiene', valor: 'fitness', siguiente_si: 'si', siguiente_no: 'no' },
      { id: 'si', tipo: 'enviar_dm', texto: 'Genial, {{campo.Nicho}} es lo mío', siguiente: null },
      { id: 'no', tipo: 'enviar_dm', texto: 'Contame más', siguiente: null },
    ], 'NICHO');
    const lead = await nuevoLead('campo.uno');
    await ejecutarFlujo(cuentaId, f.id, { leadId: lead, sinInstagram: true });
    await reanudarPorMensaje(cuentaId, lead, { texto: 'Coaching fitness' });
    expect((await queryOne(`SELECT campos FROM leads WHERE id = $1`, [lead])).campos).toEqual({ Nicho: 'Coaching fitness' });
    expect(await salientes(lead)).toEqual(['Genial, Coaching fitness es lo mío']);
  });
});

describe('respuesta del comentario con varias versiones', () => {
  it('elige una de las versiones', async () => {
    const f = await flujo('Varias', 'comentario', [
      { id: 'inicio', tipo: 'inicio', siguiente: 'r' },
      { id: 'r', tipo: 'responder_comentario', texto: 'Te escribí 👀', variantes: ['¡Listo! Revisá tus DMs', 'Te mandé todo por privado'], siguiente: null },
    ], 'VARIAS');
    const sim = JSON.stringify((await pedir('POST', `/api/flujos/${f.id}/simular`, { texto: 'VARIAS' })).datos);
    expect(/Te escribí 👀|Revisá tus DMs|por privado/.test(sim)).toBe(true);
  });
});

describe('horario de atención', () => {
  it('respeta días y horas en la zona de la cuenta', async () => {
    await pool.query(`UPDATE cuentas SET zona_horaria = 'UTC' WHERE id = $1`, [cuentaId]);
    const lunes10 = new Date('2026-11-23T10:00:00Z'); // lunes
    const domingo10 = new Date('2026-11-22T10:00:00Z');
    expect(await enHorario(cuentaId, { id: 'h', tipo: 'condicion', desde: '09:00', hasta: '18:00' }, lunes10)).toBe(true);
    expect(await enHorario(cuentaId, { id: 'h', tipo: 'condicion', desde: '09:00', hasta: '18:00' }, domingo10)).toBe(false);
    expect(await enHorario(cuentaId, { id: 'h', tipo: 'condicion', desde: '11:00', hasta: '18:00' }, lunes10)).toBe(false);
    expect(await enHorario(cuentaId, { id: 'h', tipo: 'condicion', desde: '22:00', hasta: '06:00', dias: [0,1,2,3,4,5,6] }, new Date('2026-11-23T23:30:00Z'))).toBe(true);
  });
});

describe('pausa cuando responde una persona y respuesta por defecto', () => {
  it('si le escribís a mano, los automensajes no se meten; se pueden reanudar', async () => {
    await flujo('Por defecto', 'por_defecto', [
      { id: 'inicio', tipo: 'inicio', siguiente: 'm' },
      { id: 'm', tipo: 'enviar_dm', texto: 'Gracias por escribir, ya te respondemos', siguiente: null },
    ]);
    const lead = await nuevoLead('pausa.uno');
    await pedir('POST', `/api/chat/${lead}/enviar`, { texto: 'Hola, soy Marta del equipo' });
    expect((await queryOne(`SELECT automensajes_pausados_hasta > now() AS p FROM leads WHERE id = $1`, [lead])).p).toBe(true);
    const r1: any = await procesarEventoInstagram(cuentaId, { tipo: 'dm', igUserId: 'ig_pausa.uno', texto: 'algo cualquiera', mid: 'mid-p1' } as any);
    expect(r1?.pausado).toBeTruthy();
    await pedir('POST', `/api/ux/chat/${lead}/reanudar-automensajes`);
    const r2: any = await procesarEventoInstagram(cuentaId, { tipo: 'dm', igUserId: 'ig_pausa.uno', texto: 'otra cosa', mid: 'mid-p2' } as any);
    expect(r2?.flujo).toBe('Por defecto');
  });
});

describe('avisar a otra app y usar su respuesta', () => {
  it('guarda lo que responde en campos del lead', async () => {
    const srv = http.createServer((_q, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: { plan: 'Pro', puntos: 42 } })); });
    await new Promise<void>((r) => srv.listen(0, r));
    const puerto = (srv.address() as any).port;
    const f = await flujo('Externa', 'dm', [
      { id: 'inicio', tipo: 'inicio', siguiente: 'w' },
      { id: 'w', tipo: 'webhook', url: `http://127.0.0.1:${puerto}/x`, guardar: [{ ruta: 'data.plan', campo: 'Plan' }, { ruta: 'data.puntos', campo: 'Puntos' }], siguiente: null },
    ], 'EXTERNA');
    const lead = await nuevoLead('externa.uno');
    await ejecutarFlujo(cuentaId, f.id, { leadId: lead, sinInstagram: true });
    srv.close();
    expect((await queryOne(`SELECT campos FROM leads WHERE id = $1`, [lead])).campos).toEqual({ Plan: 'Pro', Puntos: '42' });
  });
});
