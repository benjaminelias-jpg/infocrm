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
    const tras = (await queryOne(`SELECT etiquetas FROM leads WHERE id = $1`, [lead])).etiquetas;
    expect(tras).not.toContain(ETIQUETA_AGENDA);
    expect(tras).toContain('Reunión agendada');
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

describe('router de la pizarra', () => {
  it('reparte al azar parejo o según el %', async () => {
    const { elegirRama } = await import('../src/modules/instagram_dm.js');
    const ramas = [{ id: 'a', peso: 80, siguiente: 'x' }, { id: 'b', peso: 20, siguiente: 'y' }, { id: 'c', peso: 50, siguiente: null }];
    // Sin conectar no cuenta; en «pesos» 80/20.
    let n = 0; let semilla = 1;
    const azar = () => { semilla = (semilla * 16807) % 2147483647; return semilla / 2147483647; };
    for (let i = 0; i < 2000; i++) if (elegirRama({ id: 'r', tipo: 'router', modo: 'pesos', ramas }, azar)?.id === 'a') n++;
    expect(n / 2000).toBeGreaterThan(0.75);
    expect(n / 2000).toBeLessThan(0.85);
    let m = 0;
    for (let i = 0; i < 2000; i++) if (elegirRama({ id: 'r', tipo: 'router', modo: 'azar', ramas }, azar)?.id === 'a') m++;
    expect(m / 2000).toBeGreaterThan(0.45);
    expect(m / 2000).toBeLessThan(0.55);
    expect(elegirRama({ id: 'r', tipo: 'router', ramas: [] })).toBeNull();
  });

  it('un flujo con router manda uno de los mensajes', async () => {
    const pasos = [
      { id: 'inicio', tipo: 'inicio', siguiente: 'r' },
      { id: 'r', tipo: 'router', modo: 'azar', ramas: [{ id: 'a', nombre: 'Gancho A', siguiente: 'm1' }, { id: 'b', nombre: 'Gancho B', siguiente: 'm2' }] },
      { id: 'm1', tipo: 'enviar_dm', texto: 'Hola A', siguiente: null },
      { id: 'm2', tipo: 'enviar_dm', texto: 'Hola B', siguiente: null },
    ];
    const f = await pedir('POST', '/api/flujos', { nombre: 'Router test', disparo: 'dm', palabra_clave: 'ROUTERX', pasos });
    expect(f.codigo).toBeLessThan(300);
    const sim = await pedir('POST', `/api/flujos/${f.datos.id}/simular`, { texto: 'ROUTERX' });
    const txt = JSON.stringify(sim.datos);
    expect(txt).toMatch(/Router → Gancho [AB]/);
    expect(/Hola A/.test(txt) !== /Hola B/.test(txt)).toBe(true);
  });
});

describe('«Y también» en la pizarra', () => {
  it('el paso «Mandar calendario» manda el link', async () => {
    const pasos = [
      { id: 'inicio', tipo: 'inicio', siguiente: 'c' },
      { id: 'c', tipo: 'enviar_calendario', texto: 'Elegí horario', url: 'https://calendly.com/yo/llamada', siguiente: null },
    ];
    const f = await pedir('POST', '/api/flujos', { nombre: 'Cal test', disparo: 'dm', palabra_clave: 'CALX', pasos });
    expect(f.codigo).toBeLessThan(300);
    const txt = JSON.stringify((await pedir('POST', `/api/flujos/${f.datos.id}/simular`, { texto: 'CALX' })).datos);
    expect(txt).toContain('calendly.com/yo/llamada');
  });

  it('«Y también» corre a la vez: no espera a que el otro camino termine su espera', async () => {
    const { ejecutarFlujo } = await import('../src/modules/instagram_dm.js');
    const pasos = [
      { id: 'inicio', tipo: 'inicio', siguiente: 'a', tambien: ['t'] },
      { id: 'a', tipo: 'enviar_dm', texto: 'Primero', siguiente: 'w' },
      { id: 'w', tipo: 'esperar', minutos: 60, siguiente: 'z' },
      { id: 'z', tipo: 'enviar_dm', texto: 'Una hora después', siguiente: null },
      { id: 't', tipo: 'etiquetar', etiqueta: 'a-la-vez', siguiente: 't2' },
      { id: 't2', tipo: 'enviar_dm', texto: 'Al mismo tiempo', siguiente: null },
    ];
    const f = await pedir('POST', '/api/flujos', { nombre: 'Paralelo', disparo: 'dm', palabra_clave: 'PARALELOX', pasos });
    const lead = await nuevoLead('paralelo.uno');
    await ejecutarFlujo(cuentaId, f.datos.id, { leadId: lead, sinInstagram: true });
    const msgs = (await query(`SELECT cuerpo FROM mensajes WHERE lead_id = $1 AND direccion = 'saliente' ORDER BY ocurrido_en`, [lead])).map((m: any) => m.cuerpo);
    expect(msgs).toContain('Primero');
    expect(msgs).toContain('Al mismo tiempo');
    expect(msgs).not.toContain('Una hora después');
    expect((await queryOne(`SELECT etiquetas FROM leads WHERE id = $1`, [lead])).etiquetas).toContain('a-la-vez');
  });

  it('desde el disparador hace esto Y esto', async () => {
    const pasos = [
      { id: 'inicio', tipo: 'inicio', siguiente: 'm1', tambien: ['t1'] },
      { id: 'm1', tipo: 'enviar_dm', texto: 'Hola uno', siguiente: null },
      { id: 't1', tipo: 'enviar_dm', texto: 'Hola dos', siguiente: null },
    ];
    const f = await pedir('POST', '/api/flujos', { nombre: 'Y tambien', disparo: 'dm', palabra_clave: 'YTAMBIEN', pasos });
    expect(f.codigo).toBeLessThan(300);
    const ini = (f.datos.pasos ?? []).find((p: any) => p.tipo === 'inicio');
    expect(ini?.tambien).toEqual(['t1']);
    const sim = JSON.stringify((await pedir('POST', `/api/flujos/${f.datos.id}/simular`, { texto: 'YTAMBIEN' })).datos);
    expect(sim).toContain('Hola uno');
    expect(sim).toContain('Hola dos');
  });
});

describe('seguimiento si no responde', () => {
  it('si no responde en X tiempo, sigue por «No respondió»; si responde, por el otro lado', async () => {
    const { ejecutarFlujo, procesarEsperasVencidas, reanudarPorMensaje } = await import('../src/modules/instagram_dm.js');
    const pasos = [
      { id: 'inicio', tipo: 'inicio', siguiente: 'w' },
      { id: 'w', tipo: 'esperar_respuesta', limite_min: 60, siguiente: 'ok', siguiente_sin_respuesta: 'fu' },
      { id: 'ok', tipo: 'enviar_dm', texto: 'Genial, gracias', siguiente: null },
      { id: 'fu', tipo: 'enviar_dm', texto: '¿Seguís por ahí?', siguiente: null },
    ];
    const f = (await pedir('POST', '/api/flujos', { nombre: 'Seguimiento', disparo: 'dm', palabra_clave: 'SEGUIR', pasos })).datos;
    expect(f.pasos.find((p: any) => p.id === 'w').siguiente_sin_respuesta).toBe('fu');

    const callado = await nuevoLead('calla.uno');
    await ejecutarFlujo(cuentaId, f.id, { leadId: callado, sinInstagram: true });
    await pool.query(`UPDATE flujo_ejecuciones SET reanudar_en = now() - interval '1 minute' WHERE lead_id = $1 AND estado = 'esperando'`, [callado]);
    await procesarEsperasVencidas(cuentaId, 10);
    const m1 = (await query(`SELECT cuerpo FROM mensajes WHERE lead_id = $1 AND direccion = 'saliente'`, [callado])).map((m: any) => m.cuerpo);
    expect(m1).toEqual(['¿Seguís por ahí?']);

    const habla = await nuevoLead('habla.uno');
    await ejecutarFlujo(cuentaId, f.id, { leadId: habla, sinInstagram: true });
    await reanudarPorMensaje(cuentaId, habla, { texto: 'hola!' });
    const m2 = (await query(`SELECT cuerpo FROM mensajes WHERE lead_id = $1 AND direccion = 'saliente'`, [habla])).map((m: any) => m.cuerpo);
    expect(m2).toEqual(['Genial, gracias']);
    // Ya respondió: aunque pase el tiempo, no le llega el seguimiento.
    await procesarEsperasVencidas(cuentaId, 10);
    expect((await query(`SELECT 1 FROM mensajes WHERE lead_id = $1 AND direccion = 'saliente'`, [habla])).length).toBe(1);
  });
});
