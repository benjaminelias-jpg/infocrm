import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { construirApp } from '../src/app.js';
import { closePool, queryOne } from '../src/db/pool.js';
import { registrarEvento } from '../src/modules/eventos.js';
import { aInstante, desfaseMin, leerCalendly, linkPersonal, parsearIcs } from '../src/modules/calendarios.js';
import { ejecutarFlujo } from '../src/modules/instagram_dm.js';
import { cuentaDePrueba } from './ayuda.js';

let app: any; let token = ''; let cuentaId = '';
const pedir = async (method: string, url: string, payload?: any, conSesion = true) => {
  const r = await app.inject({ method, url, headers: conSesion ? { authorization: `Bearer ${token}` } : {}, payload });
  let datos: any = null; try { datos = r.json(); } catch { datos = r.body; }
  return { codigo: r.statusCode, datos, cuerpo: r.body as string, tipo: r.headers['content-type'] };
};
const manana = () => { const d = new Date(Date.now() + 2 * 86400000); return d.toISOString().slice(0, 10); };

beforeAll(async () => {
  app = await construirApp(); await app.ready();
  const r = await cuentaDePrueba('Agenda');
  cuentaId = r.cuenta.id;
  token = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: r.usuario.email, password: 'contrasena-larga-123' } })).json().token;
});
afterAll(async () => { await app?.close(); await closePool(); });

describe('zonas horarias', () => {
  it('convierte hora local a UTC con horario de verano', () => {
    expect(new Date(aInstante('2026-07-01', '10:00', 'Europe/Madrid')).toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(new Date(aInstante('2026-12-01', '10:00', 'Europe/Madrid')).toISOString()).toBe('2026-12-01T09:00:00.000Z');
    expect(desfaseMin(Date.UTC(2026, 0, 1), 'America/Lima')).toBe(-300);
  });
  it('lee un .ics ocupado', () => {
    const t = parsearIcs('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261201T090000Z\r\nDTEND:20261201T100000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART;TZID=Europe/Madrid:20261202T100000\r\nDTEND;TZID=Europe/Madrid:20261202T110000\r\nTRANSP:TRANSPARENT\r\nEND:VEVENT\r\nEND:VCALENDAR', 'UTC');
    expect(t).toHaveLength(1);
    expect(new Date(t[0].desde).toISOString()).toBe('2026-12-01T09:00:00.000Z');
  });
});

describe('calendario propio', () => {
  it('crea, da huecos, agenda con link personal y marca al lead en verde', async () => {
    const todos = { '0': [['09:00', '12:00']], '1': [['09:00', '12:00']], '2': [['09:00', '12:00']], '3': [['09:00', '12:00']], '4': [['09:00', '12:00']], '5': [['09:00', '12:00']], '6': [['09:00', '12:00']] };
    const c = await pedir('POST', '/api/calendarios', { nombre: 'Llamada de diagnóstico', duracion_min: 30, intervalo_min: 30, zona_horaria: 'Europe/Madrid', horario: todos, antelacion_min: 0, preguntas: [{ nombre: '¿Qué querés lograr?', obligatoria: true }] });
    expect(c.codigo).toBe(201);
    expect(c.datos.url).toContain(`/agendar/${c.datos.slug}`);

    const pagina = await pedir('GET', `/agendar/${c.datos.slug}`, undefined, false);
    expect(pagina.codigo).toBe(200);
    expect(pagina.cuerpo).toContain('Llamada de diagnóstico');

    const h = await pedir('GET', `/agendar/${c.datos.slug}/huecos?desde=${manana()}&dias=1`, undefined, false);
    expect(h.datos.dias[0].huecos).toHaveLength(6);
    const hueco = h.datos.dias[0].huecos[0];

    const lead = (await registrarEvento({ cuentaId, tipo: 'lead_creado', identidad: { igUsername: 'agenda.propia', igUserId: 'ig_ap' }, fuente: 'manual' })).leadId;
    await queryOne(`UPDATE leads SET etiquetas = ARRAY['Calendario enviado'] WHERE id = $1`, [lead]);
    const link = await linkPersonal(cuentaId, c.datos.id, lead);
    const inv = new URL(link!).searchParams.get('i')!;

    const falta = await pedir('POST', `/agendar/${c.datos.slug}/reservar`, { inicio: hueco, nombre: 'Ana Pérez', email: 'ana@mail.com', invitacion: inv }, false);
    expect(falta.codigo).toBe(400);
    const ok = await pedir('POST', `/agendar/${c.datos.slug}/reservar`, { inicio: hueco, nombre: 'Ana Pérez', email: 'ana@mail.com', invitacion: inv, respuestas: { '¿Qué querés lograr?': 'Vender más' } }, false);
    expect(ok.codigo).toBe(201);

    const l = await queryOne<{ etiquetas: string[] }>(`SELECT etiquetas FROM leads WHERE id = $1`, [lead]);
    expect(l!.etiquetas).toContain('Reunión agendada');
    expect(l!.etiquetas).not.toContain('Calendario enviado');

    const otra = await pedir('POST', `/agendar/${c.datos.slug}/reservar`, { inicio: hueco, nombre: 'Otro', email: 'o@mail.com' }, false);
    expect(otra.codigo).toBe(400);
    const h2 = await pedir('GET', `/agendar/${c.datos.slug}/huecos?desde=${manana()}&dias=1`, undefined, false);
    expect(h2.datos.dias[0].huecos).not.toContain(hueco);

    const feed = await pedir('GET', new URL(c.datos.feed_url).pathname, undefined, false);
    expect(feed.tipo).toContain('text/calendar');
    expect(feed.cuerpo).toContain('Ana Pérez');

    const cancel = await pedir('GET', new URL(ok.datos.cancelar).pathname, undefined, false);
    expect(cancel.codigo).toBe(200);
    const h3 = await pedir('GET', `/agendar/${c.datos.slug}/huecos?desde=${manana()}&dias=1`, undefined, false);
    expect(h3.datos.dias[0].huecos).toContain(hueco);
  });
});

describe('migrador desde Calendly', () => {
  it('copia nombre, duración, preguntas, horario e intervalo', async () => {
    const lunes = '2026-11-30';
    const fetcher: any = async (url: string) => ({
      json: async () => url.includes('/lookup')
        ? { uuid: 'U1', name: 'Sesión estratégica', duration: 45, availability_timezone: 'Europe/Madrid', custom_fields: [{ name: 'Tu Instagram', required: true }], last_availability: new Date(Date.now() + 30 * 86400000).toISOString(), color: '#123456' }
        : url.includes(`range_start=`) && url.includes('2026') ? { days: [{ date: lunes, spots: [
            { status: 'available', start_time: `${lunes}T10:00:00+01:00` }, { status: 'available', start_time: `${lunes}T10:30:00+01:00` }, { status: 'available', start_time: `${lunes}T16:15:00+01:00` }] }] } : { days: [] },
    });
    const r = await leerCalendly('https://calendly.com/benja/sesion', fetcher);
    expect(r.nombre).toBe('Sesión estratégica');
    expect(r.duracion_min).toBe(45);
    expect(r.intervalo_min).toBe(30);
    expect(r.preguntas[0]).toEqual({ nombre: 'Tu Instagram', obligatoria: true });
    expect(r.horario?.['1']).toEqual([['10:00', '17:00']]);
    expect(r.dias_max).toBeGreaterThanOrEqual(29);
  });
});

describe('calendario nativo dentro de un automensaje (todo a la vista en la pizarra)', () => {
  it('manda el link, espera, y al agendar sigue por «Si agenda» con sus propios nodos', async () => {
    const todos = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), [['09:00', '12:00']]]));
    const cal = (await pedir('POST', '/api/calendarios', { nombre: 'Diagnóstico flujo', horario: todos, antelacion_min: 0, zona_horaria: 'Europe/Madrid' })).datos;
    const f = (await pedir('POST', '/api/flujos', { nombre: 'Agenda nativa', disparo: 'dm', palabra_clave: 'AGENDAX', pasos: [
      { id: 'inicio', tipo: 'inicio', siguiente: 'cal' },
      { id: 'cal', tipo: 'enviar_calendario', calendario_id: cal.id, texto: 'Elegí horario', siguiente: 'roja' },
      { id: 'roja', tipo: 'etiquetar', etiqueta: 'Calendario enviado', siguiente: 'esp' },
      { id: 'esp', tipo: 'esperar_agenda', limite_min: 120, siguiente: 'verde', siguiente_sin_respuesta: null },
      { id: 'verde', tipo: 'etiquetar', etiqueta: 'Agendó por flujo', siguiente: null },
    ] })).datos;
    expect(f.id).toBeTruthy();
    const lead = (await registrarEvento({ cuentaId, tipo: 'lead_creado', identidad: { igUsername: 'flujo.agenda', igUserId: 'ig_fa' }, fuente: 'manual' })).leadId;
    await ejecutarFlujo(cuentaId, f.id, { leadId: lead, sinInstagram: true });

    const msg = await queryOne<{ cuerpo: string }>(`SELECT cuerpo FROM mensajes WHERE lead_id = $1 AND direccion = 'saliente' ORDER BY ocurrido_en DESC LIMIT 1`, [lead]);
    const link = /https?:\/\/\S+\/agendar\/\S+/.exec(msg!.cuerpo)![0];
    expect((await queryOne<{ etiquetas: string[] }>(`SELECT etiquetas FROM leads WHERE id = $1`, [lead]))!.etiquetas).toEqual(['Calendario enviado']);
    const espera = await queryOne(`SELECT esperando FROM flujo_ejecuciones WHERE lead_id = $1 AND estado = 'esperando'`, [lead]);
    expect(espera?.esperando).toBe('agenda');

    const url = new URL(link);
    const h = await pedir('GET', `${url.pathname}/huecos?desde=${manana()}&dias=1`, undefined, false);
    const ok = await pedir('POST', `${url.pathname}/reservar`, { inicio: h.datos.dias[0].huecos[0], nombre: 'Flu Jo', email: 'fj@mail.com', invitacion: url.searchParams.get('i') }, false);
    expect(ok.codigo).toBe(201);

    const l = await queryOne<{ etiquetas: string[] }>(`SELECT etiquetas FROM leads WHERE id = $1`, [lead]);
    expect(l!.etiquetas).toContain('Agendó por flujo');
    expect(l!.etiquetas).toContain('Calendario enviado'); // el flujo no tenía «quitar»: no se toca solo
    expect(l!.etiquetas).not.toContain('Reunión agendada');
    const etapa = await queryOne(`SELECT e.marca_reunion FROM oportunidades o JOIN etapas e ON e.id = o.etapa_id WHERE o.lead_id = $1 AND o.estado = 'abierta'`, [lead]);
    expect(etapa?.marca_reunion).toBeFalsy(); // sin «Mover de etapa» en la pizarra, no se mueve solo
    expect(await queryOne(`SELECT 1 FROM flujo_ejecuciones WHERE lead_id = $1 AND estado = 'esperando'`, [lead])).toBeNull();
  });
});

describe('flechas del disparador', () => {
  it('si el disparador solo tiene «Y también», esa pasa a ser el primer paso', async () => {
    const { normalizarFlujo, validarFlujo } = await import('../src/modules/instagram_dm.js');
    const n = normalizarFlujo([
      { id: 'inicio', tipo: 'inicio', siguiente: 'borrado', tambien: ['q'] },
      { id: 'q', tipo: 'enviar_dm', texto: 'Hola', siguiente: null },
    ] as any);
    expect(n.find((x: any) => x.id === 'inicio')!.siguiente).toBe('q');
    expect(validarFlujo(n)).toEqual([]);
  });
});
