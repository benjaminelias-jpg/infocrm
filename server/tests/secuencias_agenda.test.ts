import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { construirApp } from '../src/app.js';
import { closePool, query, queryOne, pool } from '../src/db/pool.js';
import { registrarEvento } from '../src/modules/eventos.js';
import { procesarEnviosProgramados, ETIQUETA_AGENDA } from '../src/modules/secuencias.js';
import { describirCondicion } from '../src/modules/instagram_dm.js';
import { cuentaDePrueba } from './ayuda.js';

let app: any; let token = ''; let cuentaId = '';
const pedir = async (method: string, url: string, payload?: any) => {
  const r = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload });
  return { codigo: r.statusCode, datos: r.body ? r.json() : null };
};
async function nuevoLead(u: string) {
  const r = await registrarEvento({ cuentaId, tipo: 'lead_creado', identidad: { igUsername: u, igUserId: `ig_${u}` }, fuente: 'manual' });
  return r.leadId;
}
async function etapaDe(leadId: string) {
  return (await queryOne(`SELECT e.slug FROM oportunidades o JOIN etapas e ON e.id = o.etapa_id WHERE o.lead_id = $1 AND o.estado = 'abierta'`, [leadId]))?.slug;
}

beforeAll(async () => {
  app = await construirApp(); await app.ready();
  const r = await cuentaDePrueba('Secuencias');
  cuentaId = r.cuenta.id;
  token = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: r.usuario.email, password: 'contrasena-larga-123' } })).json().token;
});
afterAll(async () => { await app?.close(); await closePool(); });

describe('secuencias de atajos', () => {
  it('manda el primero ya y programa el resto con sus esperas', async () => {
    const a = (await pedir('POST', '/api/recursos', { nombre: 'Audio 1', tipo: 'texto', texto: 'uno' })).datos;
    const b = (await pedir('POST', '/api/recursos', { nombre: 'Audio 2', tipo: 'texto', texto: 'dos' })).datos;
    const c = (await pedir('POST', '/api/recursos', { nombre: 'Audio 3', tipo: 'texto', texto: 'tres' })).datos;
    const s = await pedir('POST', '/api/recursos', { nombre: 'Secuencia A', tipo: 'secuencia',
      pasos: [{ recurso_id: a.id }, { recurso_id: b.id, espera_seg: 60 }, { recurso_id: c.id, espera_seg: 120 }] });
    expect(s.codigo).toBe(201);
    const mala = await pedir('POST', '/api/recursos', { nombre: 'Mala', tipo: 'secuencia', pasos: [{ recurso_id: s.datos.id }] });
    expect(mala.codigo).toBe(400);

    const lead = await nuevoLead('seq.uno');
    const env = await pedir('POST', `/api/chat/${lead}/enviar`, { recurso_id: s.datos.id });
    expect(env.codigo).toBe(201);
    expect(env.datos.programados).toBe(2);
    expect((await query(`SELECT cuerpo FROM mensajes WHERE lead_id = $1`, [lead])).map((m: any) => m.cuerpo)).toEqual(['uno']);
    const prog = (await pedir('GET', `/api/chat/${lead}/programados`)).datos;
    expect(prog.map((p: any) => p.nombre)).toEqual(['Audio 2', 'Audio 3']);
    const dif = (+new Date(prog[1].enviar_en) - +new Date(prog[0].enviar_en)) / 1000;
    expect(Math.round(dif)).toBe(120);

    // Pasa el tiempo: el segundo vence y sale; el tercero todavía no.
    await pool.query(`UPDATE envios_programados SET enviar_en = now() - interval '1 second' WHERE lead_id = $1 AND recurso_id = $2`, [lead, b.id]);
    expect(await procesarEnviosProgramados(cuentaId)).toBe(1);
    expect((await query(`SELECT cuerpo FROM mensajes WHERE lead_id = $1 ORDER BY creado_en`, [lead])).map((m: any) => m.cuerpo)).toEqual(['uno', 'dos']);

    expect((await pedir('POST', `/api/chat/${lead}/programados/cancelar`)).datos.cancelados).toBe(1);
  });
});

describe('link de agenda', () => {
  it('pone «Calendario enviado» al mandarlo y lo saca cuando agenda', async () => {
    const link = (await pedir('POST', '/api/recursos', { nombre: 'Mi agenda', tipo: 'link', url: 'https://calendly.com/benja/30min' })).datos;
    const lead = await nuevoLead('agenda.uno');
    await pedir('POST', `/api/chat/${lead}/enviar`, { recurso_id: link.id });
    expect((await queryOne(`SELECT etiquetas FROM leads WHERE id = $1`, [lead])).etiquetas).toContain(ETIQUETA_AGENDA);
    await registrarEvento({ cuentaId, tipo: 'reunion_agendada', leadId: lead, fuente: 'calendly' });
    expect((await queryOne(`SELECT etiquetas FROM leads WHERE id = $1`, [lead])).etiquetas).not.toContain(ETIQUETA_AGENDA);
    expect(await etapaDe(lead)).toBe('reunion-agendada');
  });

  it('un atajo marcado a mano como agenda también la pone', async () => {
    const otro = (await pedir('POST', '/api/recursos', { nombre: 'Agenda propia', tipo: 'link', url: 'https://miweb.com/agendar' })).datos;
    await pedir('PATCH', `/api/recursos/${otro.id}`, { es_agenda: true });
    const lead = await nuevoLead('agenda.dos');
    await pedir('POST', `/api/chat/${lead}/enviar`, { recurso_id: otro.id });
    expect((await queryOne(`SELECT etiquetas FROM leads WHERE id = $1`, [lead])).etiquetas).toContain(ETIQUETA_AGENDA);
  });
});

describe('etapas por respuesta', () => {
  it('si ya agendó y vuelve a escribir, no vuelve a «En conversación»', async () => {
    const lead = await nuevoLead('etapa.uno');
    await registrarEvento({ cuentaId, tipo: 'respondio_dm', leadId: lead, fuente: 'instagram' });
    expect(await etapaDe(lead)).toBe('en-conversacion');
    await registrarEvento({ cuentaId, tipo: 'reunion_agendada', leadId: lead, fuente: 'calendly' });
    await registrarEvento({ cuentaId, tipo: 'respondio_dm', leadId: lead, fuente: 'instagram' });
    expect(await etapaDe(lead)).toBe('reunion-agendada');
  });
});

describe('condición ¿Te sigue?', () => {
  it('se describe en palabras', () => {
    expect(describirCondicion({ id: 'x', tipo: 'condicion', campo: 'sigue' })).toBe('¿Te sigue en Instagram?');
  });
});
