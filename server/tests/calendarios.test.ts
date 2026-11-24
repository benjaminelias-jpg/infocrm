import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { construirApp } from '../src/app.js';
import { closePool, queryOne } from '../src/db/pool.js';
import { registrarEvento } from '../src/modules/eventos.js';
import { aInstante, desfaseMin, leerCalendly, linkPersonal, parsearIcs } from '../src/modules/calendarios.js';
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
