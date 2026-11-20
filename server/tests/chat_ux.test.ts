import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closePool, query, queryOne } from '../src/db/pool.js';
import { construirApp } from '../src/app.js';
import { cuentaDePrueba } from './ayuda.js';

// Bandeja del Chat (búsqueda y paginación en el servidor, filtros, archivar,
// leído/no leído), acciones desde el chat (etapa, asignar, cortar
// automensajes) y edición de atajos.

let app: FastifyInstance;
let token: string;
let cuentaId: string;
let yoId: string;
let otraCuenta: { cuentaId: string; usuarioId: string; token: string };
const auth = (t = token) => ({ authorization: `Bearer ${t}` });

async function login(email: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'contrasena-larga-123' } });
  return r.json().token as string;
}

async function crearLead(datos: { nombre?: string | null; usuario?: string | null; creado?: string; propietario?: string | null; cuenta?: string }) {
  return (await queryOne(
    `INSERT INTO leads (cuenta_id, nombre, ig_username, propietario_id, creado_en)
     VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now())) RETURNING id`,
    [datos.cuenta ?? cuentaId, datos.nombre ?? null, datos.usuario ?? null, datos.propietario ?? null, datos.creado ?? null]))!.id as string;
}

async function mensaje(leadId: string, direccion: 'entrante' | 'saliente', cuerpo: string, opts: { hace?: string; por?: string | null; sinLeer?: boolean } = {}) {
  const fila = await queryOne(
    `INSERT INTO mensajes (cuenta_id, lead_id, direccion, cuerpo, estado, enviado_por, ocurrido_en)
     VALUES ($1, $2, $3, $4, $5, $6, now() - COALESCE($7::interval, '0 seconds'::interval)) RETURNING ocurrido_en`,
    [cuentaId, leadId, direccion, cuerpo, direccion === 'entrante' ? 'recibido' : 'enviado', opts.por ?? null, opts.hace ?? null]);
  await query(
    `UPDATE leads SET ultimo_mensaje_en = GREATEST(COALESCE(ultimo_mensaje_en, $2), $2),
            mensajes_sin_leer = mensajes_sin_leer + $3 WHERE id = $1`,
    [leadId, fila!.ocurrido_en, direccion === 'entrante' && opts.sinLeer !== false ? 1 : 0]);
}

async function bandeja(qs: string, t = token) {
  const r = await app.inject({ method: 'GET', url: `/api/ux/chat/conversaciones?${qs}`, headers: auth(t) });
  expect(r.statusCode).toBe(200);
  return r.json();
}
const ids = (b: any) => b.items.map((i: any) => i.id);

beforeAll(async () => {
  app = await construirApp();
  await app.ready();
  const { usuario, cuenta } = await cuentaDePrueba('Chat');
  cuentaId = cuenta.id;
  yoId = usuario.id;
  token = await login(usuario.email);
  const otra = await cuentaDePrueba('ChatOtra');
  otraCuenta = { cuentaId: otra.cuenta.id, usuarioId: otra.usuario.id, token: await login(otra.usuario.email) };
});

afterAll(async () => {
  await app.close();
  await closePool();
});

describe('bandeja del Chat', () => {
  let tomas: string; let doble: string; let pendiente: string; let respondido: string; let seCierra: string; let enFlujo: string;

  beforeAll(async () => {
    // Un lead viejo, sin mensajes, enterrado debajo de 160 leads más nuevos.
    tomas = await crearLead({ nombre: 'Tomás Díaz', usuario: 'tomas.diaz90', creado: '2020-01-01T10:00:00Z' });
    await query(
      `INSERT INTO leads (cuenta_id, nombre, ig_username, creado_en)
       SELECT $1, 'Relleno ' || g, 'relleno.' || g, now() - (g || ' minutes')::interval FROM generate_series(1, 160) g`, [cuentaId]);

    // Un lead con DOS oportunidades abiertas (en pipelines distintos): una sola fila.
    doble = await crearLead({ nombre: 'Olivia Doble', usuario: 'olivia.doble' });
    const pipe = await queryOne(`SELECT id FROM pipelines WHERE cuenta_id = $1 ORDER BY orden LIMIT 1`, [cuentaId]);
    const etapa = await queryOne(`SELECT id FROM etapas WHERE pipeline_id = $1 ORDER BY orden LIMIT 1`, [pipe!.id]);
    const p2 = await app.inject({ method: 'POST', url: '/api/pipelines', headers: auth(), payload: { nombre: 'Segundo' } });
    const etapa2 = await queryOne(`SELECT id FROM etapas WHERE pipeline_id = $1 ORDER BY orden LIMIT 1`, [p2.json().id]);
    await query(`INSERT INTO oportunidades (cuenta_id, lead_id, pipeline_id, etapa_id) VALUES ($1,$2,$3,$4)`, [cuentaId, doble, pipe!.id, etapa!.id]);
    await query(`INSERT INTO oportunidades (cuenta_id, lead_id, pipeline_id, etapa_id) VALUES ($1,$2,$3,$4)`, [cuentaId, doble, p2.json().id, etapa2!.id]);
    await mensaje(doble, 'entrante', 'hola, quiero info', { hace: '3 hours' });

    pendiente = await crearLead({ nombre: 'Lucía Pendiente', usuario: 'lucia.p' });
    await mensaje(pendiente, 'entrante', 'me interesa', { hace: '10 minutes' });
    await mensaje(pendiente, 'entrante', '¿cuánto sale?', { hace: '5 minutes' });

    respondido = await crearLead({ nombre: 'Diego Respondido', usuario: 'diego.r', propietario: yoId });
    await mensaje(respondido, 'entrante', 'hola', { hace: '2 hours', sinLeer: false });
    await mensaje(respondido, 'saliente', 'Hola Diego! Te cuento…', { hace: '1 hour', por: yoId });

    seCierra = await crearLead({ nombre: 'Sofía Apurada', usuario: 'sofia.a' });
    await mensaje(seCierra, 'entrante', 'sigo esperando', { hace: '21 hours', sinLeer: false });

    enFlujo = await crearLead({ nombre: 'Agustín Flujo', usuario: 'agus.f' });
    await mensaje(enFlujo, 'saliente', '¿Qué te gustaría lograr?', { hace: '30 minutes' });
    const flujo = await queryOne(`INSERT INTO flujos (cuenta_id, nombre) VALUES ($1, 'Bienvenida') RETURNING id`, [cuentaId]);
    await query(
      `INSERT INTO flujo_ejecuciones (cuenta_id, flujo_id, lead_id, estado, esperando, nodo_id, ejecutado_en, actualizado_en)
       VALUES ($1, $2, $3, 'esperando', 'respuesta', 'n1', now() - interval '31 minutes', now() - interval '29 minutes')`,
      [cuentaId, flujo!.id, enFlujo]);
  });

  it('no repite al lead que tiene dos oportunidades abiertas (tampoco en la lista vieja)', async () => {
    const b = await bandeja('filtro=todos');
    expect(ids(b).filter((x: string) => x === doble)).toHaveLength(1);
    const vieja = (await app.inject({ method: 'GET', url: '/api/chat/conversaciones', headers: auth() })).json();
    expect(new Set(vieja.map((c: any) => c.id)).size).toBe(vieja.length);
  });

  it('busca en el servidor en TODOS los leads (también los que no entraban en los 150)', async () => {
    const b = await bandeja('q=tomas.diaz');
    expect(ids(b)).toEqual([tomas]);
    expect(ids(await bandeja('q=%40tomas'))).toEqual([tomas]); // con la @ delante
    expect(ids(await bandeja('q=Tom%C3%A1s%20D%C3%ADaz'))).toEqual([tomas]); // nombre completo
    expect(ids(await bandeja('q=tomas%20diaz'))).toEqual([tomas]); // sin tildes también
    expect((await bandeja('q=no-existe-nadie')).items).toHaveLength(0);
    // Los comodines de LIKE no rompen ni traen todo.
    expect((await bandeja('q=%25')).items).toHaveLength(0);
  });

  it('filtros con conteos: por responder, sin leer, míos, se cierra pronto, en automensaje', async () => {
    const b = await bandeja('filtro=por_responder');
    expect(ids(b)).toEqual(expect.arrayContaining([doble, pendiente, seCierra]));
    expect(ids(b)).not.toContain(respondido);
    expect(ids(b)).not.toContain(enFlujo);
    // El primero es el que escribió más recién.
    expect(ids(b)[0]).toBe(pendiente);
    const fila = b.items.find((i: any) => i.id === pendiente);
    expect(fila.mensajes_sin_leer).toBe(2);
    expect(fila.ultimo_texto).toBe('¿cuánto sale?');
    expect(fila.ultimo_autor).toBe('lead');
    expect(fila.ventana_abierta).toBe(true);

    expect(ids(await bandeja('filtro=sin_leer'))).toEqual(expect.arrayContaining([doble, pendiente]));
    expect(ids(await bandeja('filtro=sin_leer'))).not.toContain(respondido);
    const mios = await bandeja('filtro=mios');
    expect(ids(mios)).toEqual([respondido]);
    expect(mios.items[0].ultimo_autor).toBe('yo');
    expect(ids(await bandeja('filtro=se_cierra'))).toEqual([seCierra]);
    const auto = await bandeja('filtro=automensaje');
    expect(ids(auto)).toEqual([enFlujo]);
    expect(auto.items[0].ultimo_autor).toBe('automatico');

    expect(b.conteos.por_responder).toBe(3);
    expect(b.conteos.mios).toBe(1);
    expect(b.conteos.se_cierra).toBe(1);
    expect(b.conteos.automensaje).toBe(1);
    expect(b.conteos.todos).toBe(5);
    expect(b.conteos.sin_conversacion).toBeGreaterThanOrEqual(161);
  });

  it('pagina con cursor sin repetir ni saltear a nadie', async () => {
    const primera = await bandeja('filtro=sin_conversacion&limite=50');
    const total = primera.conteos.sin_conversacion;
    const vistos: string[] = [...ids(primera)];
    let siguiente = primera.siguiente;
    let vueltas = 0;
    while (siguiente && vueltas++ < 20) {
      const p = await bandeja(`filtro=sin_conversacion&limite=50&cursor=${siguiente}`);
      expect(p.conteos).toBeUndefined();
      vistos.push(...ids(p));
      siguiente = p.siguiente;
    }
    expect(new Set(vistos).size).toBe(vistos.length);
    expect(vistos.length).toBe(total);
    expect(vistos[vistos.length - 1]).toBe(tomas); // el más viejo, al final
    const malo = await app.inject({ method: 'GET', url: '/api/ux/chat/conversaciones?cursor=basura', headers: auth() });
    expect(malo.statusCode).toBe(400);
  });

  it('marcar como no leído / leído', async () => {
    let r = await app.inject({ method: 'POST', url: `/api/ux/chat/${respondido}/leido`, headers: auth(), payload: { leido: false } });
    expect(r.json().mensajes_sin_leer).toBe(1);
    expect(ids(await bandeja('filtro=sin_leer'))).toContain(respondido);
    r = await app.inject({ method: 'POST', url: `/api/ux/chat/${respondido}/leido`, headers: auth(), payload: { leido: true } });
    expect(r.json().mensajes_sin_leer).toBe(0);
  });

  it('archivar saca la conversación de la bandeja y vuelve sola si el lead escribe', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/ux/chat/${doble}/archivar`, headers: auth(), payload: { archivado: true } });
    expect(r.statusCode).toBe(200);
    expect(ids(await bandeja('filtro=todos'))).not.toContain(doble);
    expect(ids(await bandeja('filtro=por_responder'))).not.toContain(doble);
    const arch = await bandeja('filtro=archivados');
    expect(ids(arch)).toEqual([doble]);
    expect(arch.items[0].mensajes_sin_leer).toBe(0); // archivar la da por leída
    // La búsqueda la encuentra igual.
    expect(ids(await bandeja('q=olivia.doble'))).toEqual([doble]);

    await new Promise((res) => setTimeout(res, 20));
    await mensaje(doble, 'entrante', 'sigo acá');
    expect(ids(await bandeja('filtro=por_responder'))).toContain(doble);
    expect(ids(await bandeja('filtro=archivados'))).not.toContain(doble);

    // Desarchivar a mano también funciona.
    await app.inject({ method: 'POST', url: `/api/ux/chat/${seCierra}/archivar`, headers: auth(), payload: { archivado: true } });
    expect(ids(await bandeja('filtro=archivados'))).toContain(seCierra);
    await app.inject({ method: 'POST', url: `/api/ux/chat/${seCierra}/archivar`, headers: auth(), payload: { archivado: false } });
    expect(ids(await bandeja('filtro=archivados'))).not.toContain(seCierra);
  });

  it('nadie ve ni toca conversaciones de otra cuenta', async () => {
    const b = await bandeja('filtro=todos', otraCuenta.token);
    expect(b.items).toHaveLength(0);
    expect((await bandeja('q=tomas', otraCuenta.token)).items).toHaveLength(0);
    const r = await app.inject({ method: 'POST', url: `/api/ux/chat/${pendiente}/archivar`, headers: auth(otraCuenta.token), payload: { archivado: true } });
    expect(r.statusCode).toBe(404);
    const r2 = await app.inject({ method: 'POST', url: `/api/ux/chat/${pendiente}/leido`, headers: auth(otraCuenta.token), payload: { leido: true } });
    expect(r2.statusCode).toBe(404);
    const r3 = await app.inject({ method: 'POST', url: '/api/ux/chat/no-es-un-id/leido', headers: auth(), payload: { leido: true } });
    expect(r3.statusCode).toBe(404);
  });
});

describe('acciones desde el chat', () => {
  let lead: string;
  beforeAll(async () => {
    lead = await crearLead({ nombre: 'Julieta Acciones', usuario: 'juli.acc' });
  });

  it('asignar: a alguien del equipo, sin asignar, y nunca a alguien de otra cuenta', async () => {
    let r = await app.inject({ method: 'POST', url: `/api/ux/chat/${lead}/asignar`, headers: auth(), payload: { usuario_id: yoId } });
    expect(r.statusCode).toBe(200);
    expect(r.json().responsable).toBe('Dueño Test');
    expect((await queryOne(`SELECT propietario_id FROM leads WHERE id = $1`, [lead]))!.propietario_id).toBe(yoId);

    r = await app.inject({ method: 'POST', url: `/api/ux/chat/${lead}/asignar`, headers: auth(), payload: { usuario_id: otraCuenta.usuarioId } });
    expect(r.statusCode).toBe(404);
    expect((await queryOne(`SELECT propietario_id FROM leads WHERE id = $1`, [lead]))!.propietario_id).toBe(yoId);

    r = await app.inject({ method: 'POST', url: `/api/ux/chat/${lead}/asignar`, headers: auth(), payload: { usuario_id: null } });
    expect(r.json()).toMatchObject({ propietario_id: null, anterior_id: yoId });
  });

  it('etapa: lo mete en el pipeline si no estaba, después lo mueve, y no acepta etapas ajenas', async () => {
    const pipe = (await app.inject({ method: 'GET', url: '/api/pipelines', headers: auth() })).json()
      .find((p: any) => p.es_predeterminado) ;
    const [, segunda, tercera] = pipe.etapas;

    let r = await app.inject({ method: 'POST', url: `/api/ux/chat/${lead}/etapa`, headers: auth(), payload: { etapa_id: segunda.id } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ creada: true, movido: true, desde_etapa_id: null });
    const opp = r.json().oportunidad_id;
    expect((await queryOne(`SELECT etapa_id FROM oportunidades WHERE id = $1`, [opp]))!.etapa_id).toBe(segunda.id);

    r = await app.inject({ method: 'POST', url: `/api/ux/chat/${lead}/etapa`, headers: auth(), payload: { etapa_id: tercera.id } });
    expect(r.json()).toMatchObject({ creada: false, movido: true, desde_etapa_id: segunda.id, oportunidad_id: opp });
    const hilo = (await app.inject({ method: 'GET', url: `/api/chat/${lead}`, headers: auth() })).json();
    expect(hilo.lead.etapa_id).toBe(tercera.id);
    expect(hilo.lead.etapa_color).toBeTruthy();

    r = await app.inject({ method: 'POST', url: `/api/ux/chat/${lead}/etapa`, headers: auth(), payload: { etapa_id: tercera.id } });
    expect(r.json().movido).toBe(false);

    const ajena = await queryOne(`SELECT id FROM etapas WHERE cuenta_id = $1 LIMIT 1`, [otraCuenta.cuentaId]);
    r = await app.inject({ method: 'POST', url: `/api/ux/chat/${lead}/etapa`, headers: auth(), payload: { etapa_id: ajena!.id } });
    expect(r.statusCode).toBe(404);
    r = await app.inject({ method: 'POST', url: `/api/ux/chat/${lead}/etapa`, headers: auth(otraCuenta.token), payload: { etapa_id: ajena!.id } });
    expect(r.statusCode).toBe(404);
  });

  it('etapa con "Deshacer": vuelve sin repetir las automatizaciones de la etapa', async () => {
    const otro = await crearLead({ nombre: 'Bruno Deshacer', usuario: 'bruno.d' });
    const pipe = (await app.inject({ method: 'GET', url: '/api/pipelines', headers: auth() })).json()
      .find((p: any) => p.es_predeterminado);
    const [primera, segunda] = pipe.etapas;
    // La primera etapa le pone una etiqueta a quien entra.
    await query(`UPDATE etapas SET acciones = $2::jsonb WHERE id = $1`,
      [primera.id, JSON.stringify([{ tipo: 'etiquetar', etiqueta: 'volvio' }])]);
    const etiquetas = async () => ((await queryOne(`SELECT etiquetas FROM leads WHERE id = $1`, [otro]))!.etiquetas ?? []) as string[];

    let r = await app.inject({ method: 'POST', url: `/api/ux/chat/${otro}/etapa`, headers: auth(), payload: { etapa_id: segunda.id } });
    expect(r.json()).toMatchObject({ creada: true, movido: true });
    expect(await etiquetas()).not.toContain('volvio');

    // "Deshacer" a la primera etapa: no la etiqueta.
    r = await app.inject({ method: 'POST', url: `/api/ux/chat/${otro}/etapa`, headers: auth(), payload: { etapa_id: primera.id, sin_acciones: true } });
    expect(r.json()).toMatchObject({ movido: true, desde_etapa_id: segunda.id });
    expect(await etiquetas()).not.toContain('volvio');

    // Moverlo a mano (sin "Deshacer") sí corre la acción.
    await app.inject({ method: 'POST', url: `/api/ux/chat/${otro}/etapa`, headers: auth(), payload: { etapa_id: segunda.id } });
    await app.inject({ method: 'POST', url: `/api/ux/chat/${otro}/etapa`, headers: auth(), payload: { etapa_id: primera.id } });
    expect(await etiquetas()).toContain('volvio');
    await query(`UPDATE etapas SET acciones = '[]'::jsonb WHERE id = $1`, [primera.id]);
  });

  it('la bandeja reanuda los automensajes cuya espera por tiempo ya venció', async () => {
    const dormido = await crearLead({ nombre: 'Carla Espera', usuario: 'carla.e' });
    const flujo = await queryOne(`INSERT INTO flujos (cuenta_id, nombre) VALUES ($1, 'Recordatorio') RETURNING id`, [cuentaId]);
    const ej = await queryOne(
      `INSERT INTO flujo_ejecuciones (cuenta_id, flujo_id, lead_id, estado, esperando, nodo_id, reanudar_en)
       VALUES ($1, $2, $3, 'esperando', 'tiempo', 'n9', now() - interval '1 minute') RETURNING id`,
      [cuentaId, flujo!.id, dormido]);
    await bandeja('filtro=todos');
    let estado = 'esperando';
    for (let i = 0; i < 20 && estado === 'esperando'; i++) {
      await new Promise((res) => setTimeout(res, 50));
      estado = (await queryOne(`SELECT estado FROM flujo_ejecuciones WHERE id = $1`, [ej!.id]))!.estado;
    }
    expect(estado).not.toBe('esperando');
  });

  it('cortar los automensajes que esperan al lead', async () => {
    const flujo = await queryOne(`INSERT INTO flujos (cuenta_id, nombre) VALUES ($1, 'Seguimiento') RETURNING id`, [cuentaId]);
    await query(
      `INSERT INTO flujo_ejecuciones (cuenta_id, flujo_id, lead_id, estado, esperando, nodo_id)
       VALUES ($1, $2, $3, 'esperando', 'tiempo', 'n2')`, [cuentaId, flujo!.id, lead]);
    let hilo = (await app.inject({ method: 'GET', url: `/api/chat/${lead}`, headers: auth() })).json();
    expect(hilo.esperas).toHaveLength(1);
    // Otra cuenta no puede cortarlos.
    const ajeno = await app.inject({ method: 'POST', url: `/api/ux/chat/${lead}/cortar-automensajes`, headers: auth(otraCuenta.token) });
    expect(ajeno.json().cortados).toBe(0);
    const r = await app.inject({ method: 'POST', url: `/api/ux/chat/${lead}/cortar-automensajes`, headers: auth() });
    expect(r.json().cortados).toBe(1);
    hilo = (await app.inject({ method: 'GET', url: `/api/chat/${lead}`, headers: auth() })).json();
    expect(hilo.esperas).toHaveLength(0);
    const fila = await queryOne(`SELECT estado FROM flujo_ejecuciones WHERE lead_id = $1`, [lead]);
    expect(fila!.estado).toBe('cancelado');
  });
});

describe('hilo', () => {
  it('?sin_marcar=1 precarga sin dar por leído; trae quién escribió cada mensaje y lo que pasó con el lead', async () => {
    const lead = await crearLead({ nombre: 'Martina Hilo', usuario: 'martina.h' });
    await mensaje(lead, 'entrante', 'hola', { hace: '3 minutes' });
    await mensaje(lead, 'saliente', 'automático', { hace: '2 minutes' });
    await mensaje(lead, 'saliente', 'escrito a mano', { hace: '1 minute', por: yoId });
    await mensaje(lead, 'entrante', '¿y el precio?');
    await query(`INSERT INTO eventos (cuenta_id, lead_id, tipo, fuente) VALUES ($1, $2, 'lead_creado', 'manychat')`, [cuentaId, lead]);

    let h = (await app.inject({ method: 'GET', url: `/api/chat/${lead}?sin_marcar=1`, headers: auth() })).json();
    expect(h.lead.mensajes_sin_leer).toBe(2);
    expect((await queryOne(`SELECT mensajes_sin_leer FROM leads WHERE id = $1`, [lead]))!.mensajes_sin_leer).toBe(2);
    expect(h.mensajes.map((m: any) => m.autor_tipo)).toEqual(['lead', 'automatico', 'yo', 'lead']);
    expect(h.eventos.map((e: any) => e.tipo)).toContain('lead_creado');
    expect(h.ventana.abierta).toBe(true);

    h = (await app.inject({ method: 'GET', url: `/api/chat/${lead}`, headers: auth() })).json();
    expect((await queryOne(`SELECT mensajes_sin_leer FROM leads WHERE id = $1`, [lead]))!.mensajes_sin_leer).toBe(0);

    const malo = await app.inject({ method: 'GET', url: '/api/chat/no-es-un-id', headers: auth() });
    expect(malo.statusCode).toBe(404);
    const ajeno = await app.inject({ method: 'GET', url: `/api/chat/${lead}`, headers: auth(otraCuenta.token) });
    expect(ajeno.statusCode).toBe(404);
  });
});

describe('atajos (recursos del chat)', () => {
  it('edita el texto de una respuesta rápida y la URL de un enlace sin perder su lugar', async () => {
    const rapida = (await app.inject({ method: 'POST', url: '/api/recursos', headers: auth(), payload: { nombre: 'Saludo', tipo: 'texto', texto: 'Hola {{nombre}}' } })).json();
    const link = (await app.inject({ method: 'POST', url: '/api/recursos', headers: auth(), payload: { nombre: 'Agenda', tipo: 'link', url: 'https://cal.com/viejo' } })).json();

    let r = await app.inject({ method: 'PATCH', url: `/api/ux/chat/recursos/${rapida.id}`, headers: auth(), payload: { nombre: 'Saludo corto', texto: '¡Hola {{nombre}}! 👋' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ nombre: 'Saludo corto', texto: '¡Hola {{nombre}}! 👋' });

    r = await app.inject({ method: 'PATCH', url: `/api/ux/chat/recursos/${link.id}`, headers: auth(), payload: { url: 'javascript:alert(1)' } });
    expect(r.statusCode).toBe(400);
    r = await app.inject({ method: 'PATCH', url: `/api/ux/chat/recursos/${link.id}`, headers: auth(), payload: { texto: 'no corresponde' } });
    expect(r.statusCode).toBe(400);
    r = await app.inject({ method: 'PATCH', url: `/api/ux/chat/recursos/${link.id}`, headers: auth(), payload: { url: 'https://cal.com/nuevo' } });
    expect(r.json().url).toBe('https://cal.com/nuevo');

    const ajeno = await app.inject({ method: 'PATCH', url: `/api/ux/chat/recursos/${link.id}`, headers: auth(otraCuenta.token), payload: { nombre: 'X' } });
    expect(ajeno.statusCode).toBe(404);
  });

  it('reemplaza el archivo de un audio (volver a grabar) sin cambiarle el lugar', async () => {
    const wav = (n: number) => `data:audio/wav;base64,${Buffer.alloc(n, 7).toString('base64')}`;
    const audio = (await app.inject({ method: 'POST', url: '/api/recursos', headers: auth(), payload: { nombre: 'Bienvenida', tipo: 'audio', mime: 'audio/wav', archivo_base64: wav(100) } })).json();
    const antes = (await app.inject({ method: 'GET', url: '/api/recursos', headers: auth() })).json().map((x: any) => x.id);

    const r = await app.inject({ method: 'PATCH', url: `/api/ux/chat/recursos/${audio.id}`, headers: auth(), payload: { archivo_base64: wav(300), mime: 'audio/wav' } });
    expect(r.statusCode).toBe(200);
    expect((await queryOne(`SELECT length(datos) AS n FROM recursos WHERE id = $1`, [audio.id]))!.n).toBe(300);
    const despues = (await app.inject({ method: 'GET', url: '/api/recursos', headers: auth() })).json().map((x: any) => x.id);
    expect(despues).toEqual(antes);

    // Una respuesta rápida no lleva archivo; uno vacío o enorme tampoco pasa.
    const rapida = (await app.inject({ method: 'POST', url: '/api/recursos', headers: auth(), payload: { nombre: 'Hola', tipo: 'texto', texto: 'Hola' } })).json();
    expect((await app.inject({ method: 'PATCH', url: `/api/ux/chat/recursos/${rapida.id}`, headers: auth(), payload: { archivo_base64: wav(10) } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: `/api/ux/chat/recursos/${audio.id}`, headers: auth(), payload: { archivo_base64: '' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: `/api/ux/chat/recursos/${audio.id}`, headers: auth(), payload: { archivo_base64: wav(3_250_000) } })).statusCode).toBe(400);
    // Nadie de otra cuenta.
    expect((await app.inject({ method: 'PATCH', url: `/api/ux/chat/recursos/${audio.id}`, headers: auth(otraCuenta.token), payload: { archivo_base64: wav(10) } })).statusCode).toBe(404);
  });

  it('duplicar deja la copia justo debajo del original', async () => {
    const lista0 = (await app.inject({ method: 'GET', url: '/api/recursos', headers: auth() })).json();
    const original = lista0[lista0.length - 1];
    const r = await app.inject({ method: 'POST', url: `/api/ux/chat/recursos/${original.id}/duplicar`, headers: auth() });
    expect(r.statusCode).toBe(201);
    expect(r.json().nombre).toBe(`${original.nombre} (copia)`);
    const lista = (await app.inject({ method: 'GET', url: '/api/recursos', headers: auth() })).json();
    const i = lista.findIndex((x: any) => x.id === original.id);
    expect(lista[i + 1].id).toBe(r.json().id);
    expect(lista).toHaveLength(lista0.length + 1);

    const ajeno = await app.inject({ method: 'POST', url: `/api/ux/chat/recursos/${original.id}/duplicar`, headers: auth(otraCuenta.token) });
    expect(ajeno.statusCode).toBe(404);
  });
});
