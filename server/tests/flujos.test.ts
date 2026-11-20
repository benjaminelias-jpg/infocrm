import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closePool, query, queryOne, pool } from '../src/db/pool.js';
import { construirApp } from '../src/app.js';
import {
  normalizarPasos, validarFlujo, coincidePalabra, procesarEsperasVencidas,
} from '../src/modules/instagram_dm.js';
import { parsearWebhookInstagram, procesarEventoInstagram } from '../src/modules/instagram_eventos.js';
import { cuentaDePrueba, leadPorId } from './ayuda.js';

let app: FastifyInstance;
let cuentaId: string;
let token: string;
let recursoId: string;
let tokenWebhook: string;

const auth = () => ({ authorization: `Bearer ${token}` });

async function crearFlujo(cuerpo: any) {
  const r = await app.inject({ method: 'POST', url: '/api/flujos', headers: auth(), payload: cuerpo });
  expect(r.statusCode).toBe(201);
  return r.json();
}

async function nuevoLead(username: string) {
  return queryOne(
    `INSERT INTO leads (cuenta_id, ig_username, ig_user_id, nombre) VALUES ($1,$2,$3,$4) RETURNING *`,
    [cuentaId, username, `igsid_${username}`, username]);
}

async function simular(leadId: string, tipo: string, texto?: string, payload?: string) {
  const r = await app.inject({
    method: 'POST', url: '/api/instagram/simular-evento', headers: auth(),
    payload: { lead_id: leadId, tipo, texto, payload },
  });
  expect(r.statusCode).toBe(200);
  return r.json();
}

async function ultimaEjecucion(leadId: string) {
  return queryOne(
    `SELECT * FROM flujo_ejecuciones WHERE lead_id = $1 AND estado <> 'simulado' ORDER BY id DESC LIMIT 1`, [leadId]);
}

beforeAll(async () => {
  app = await construirApp();
  await app.ready();
  const { cuenta, usuario } = await cuentaDePrueba('Flujos');
  cuentaId = cuenta.id;
  const login = await app.inject({
    method: 'POST', url: '/api/auth/login',
    payload: { email: usuario.email, password: 'contrasena-larga-123' },
  });
  token = login.json().token;

  const rec = await app.inject({
    method: 'POST', url: '/api/recursos', headers: auth(),
    payload: { nombre: 'Guía PDF', tipo: 'link', url: 'https://ejemplo.com/guia.pdf' },
  });
  recursoId = rec.json().id;

  tokenWebhook = `igtest_${cuenta.id.slice(0, 8)}`;
  await pool.query(
    `INSERT INTO webhook_endpoints (cuenta_id, nombre, slug, token, fuente, evento_defecto)
     VALUES ($1,'Instagram','instagram',$2,'instagram','lead_creado')`, [cuentaId, tokenWebhook]);
});

afterAll(async () => {
  await app.close();
  await closePool();
});

describe('palabras clave', () => {
  it('encuentra la palabra dentro del comentario, sin importar mayúsculas ni tildes', () => {
    expect(coincidePalabra('Quiero la GUÍA porfa!!', 'guia')).toBe(true);
    expect(coincidePalabra('info por favor', 'GUIA, info')).toBe(true);
    expect(coincidePalabra('me guiaron mal', 'guia')).toBe(false); // palabra entera
    expect(coincidePalabra('lo que sea', '')).toBe(true);          // comodín
  });
});

describe('árbol del flujo', () => {
  it('normaliza ids y recorta botones al límite de Instagram', () => {
    const pasos = normalizarPasos([
      { tipo: 'pregunta', texto: '¿Te sirve?', opciones: Array.from({ length: 15 }, (_, i) => ({ titulo: `Opción muy larga número ${i}` })) },
    ]);
    expect(pasos[0].id).toBeTruthy();
    expect(pasos[0].opciones).toHaveLength(13);
    expect(pasos[0].opciones[0].titulo.length).toBeLessThanOrEqual(20);
    expect(pasos[0].opciones[0].id).toBeTruthy();
  });

  it('explica en lenguaje normal lo que falta', () => {
    const problemas = validarFlujo(normalizarPasos([
      { tipo: 'enviar_recurso' },
      { tipo: 'pregunta', texto: '', opciones: [] },
    ]));
    expect(problemas.join(' ')).toMatch(/elegí qué audio/);
    expect(problemas.join(' ')).toMatch(/al menos un botón/);
  });

  it('un flujo con problemas se guarda igual pero en pausa (nunca corre roto)', async () => {
    const f = await crearFlujo({ nombre: 'Roto', disparo: 'dm', pasos: [{ tipo: 'enviar_recurso' }], activo: true });
    expect(f.activo).toBe(false);
    expect(f.avisos.length).toBeGreaterThan(0);
  });
});

describe('flujo con botones: pausa y reanuda donde quedó', () => {
  let flujoId: string;
  let lead: any;

  beforeAll(async () => {
    const f = await crearFlujo({
      nombre: 'Guía por comentario', disparo: 'comentario', palabra_clave: 'GUIA', activo: true,
      pasos: [
        { tipo: 'responder_comentario', texto: '¡Te lo mandé por DM! 📩' },
        {
          tipo: 'pregunta', texto: 'Hola {{nombre}} 👋 ¿Te paso la guía?',
          opciones: [
            { titulo: '¡Sí, pasámela!', pasos: [
              { tipo: 'enviar_recurso', recurso_id: '__REC__' },
              { tipo: 'etiquetar', etiqueta: 'pidió-guía' },
            ] },
            { titulo: 'No por ahora', pasos: [{ tipo: 'etiquetar', etiqueta: 'frío' }] },
          ],
        },
      ].map((p: any) => JSON.parse(JSON.stringify(p).replace('__REC__', recursoId))),
    });
    expect(f.activo).toBe(true);
    expect(f.avisos).toEqual([]);
    flujoId = f.id;
    lead = await nuevoLead('ana_test');
  });

  it('el comentario arranca el flujo y queda esperando el botón', async () => {
    const r = await simular(lead.id, 'comentario', 'Quiero la guia!');
    expect(r.flujo).toBe('Guía por comentario');
    expect(r.estado).toBe('esperando');
    const ej = await ultimaEjecucion(lead.id);
    expect(ej.estado).toBe('esperando');
    expect(ej.esperando).toBe('respuesta');
    // La pregunta quedó en el Chat, marcada como simulada (no salió a Instagram)
    const msgs = await query(`SELECT * FROM mensajes WHERE lead_id = $1 ORDER BY ocurrido_en`, [lead.id]);
    const pregunta = msgs.find((m: any) => String(m.cuerpo).includes('¿Te paso la guía?'));
    expect(pregunta).toBeTruthy();
    expect(pregunta.estado).toBe('simulado');
    expect(pregunta.cuerpo).toContain('Hola ana_test'); // {{nombre}} rellenado
  });

  it('si escribe algo que no es un botón, el flujo sigue esperando (lo atiende el setter)', async () => {
    const r = await simular(lead.id, 'dm', '¿cuánto sale el curso?');
    expect(r.reanudado).toBeUndefined();
    const ej = await ultimaEjecucion(lead.id);
    expect(ej.estado).toBe('esperando');
  });

  it('al escribir el texto del botón, sigue por esa rama y termina', async () => {
    const r = await simular(lead.id, 'dm', 'si, pasamela');
    expect(r.reanudado).toBe(true);
    const ej = await ultimaEjecucion(lead.id);
    expect(ej.estado).toBe('ok');
    const l = await leadPorId(lead.id);
    expect(l!.etiquetas).toContain('pidió-guía');
    expect(l!.etiquetas).not.toContain('frío');
    // El recurso se mandó (simulado) y quedó en el Chat
    const env = await queryOne(`SELECT * FROM mensajes WHERE lead_id = $1 AND recurso_id = $2`, [lead.id, recursoId]);
    expect(env).toBeTruthy();
  });

  it('tocar el botón (payload) también reanuda la rama exacta', async () => {
    const otro = await nuevoLead('beto_test');
    await simular(otro.id, 'comentario', 'GUIA');
    const ej = await ultimaEjecucion(otro.id);
    const flujo = await queryOne(`SELECT pasos FROM flujos WHERE id = $1`, [flujoId]);
    const pregunta = flujo.pasos[1];
    const no = pregunta.opciones[1];
    const r = await simular(otro.id, 'boton', 'No por ahora', `fx:${ej.id}:${pregunta.id}:${no.id}`);
    expect(r.reanudado).toBe(true);
    const l = await leadPorId(otro.id);
    expect(l!.etiquetas).toContain('frío');
    // Un botón viejo no vuelve a disparar nada
    const r2 = await simular(otro.id, 'boton', 'No por ahora', `fx:${ej.id}:${pregunta.id}:${no.id}`);
    expect(r2.reanudado).toBe(true);
    const n = await queryOne(`SELECT COUNT(*)::int AS n FROM flujo_ejecuciones WHERE lead_id = $1`, [otro.id]);
    expect(n.n).toBe(1);
  });
});

describe('condiciones, esperar respuesta y esperar tiempo', () => {
  it('rama sí/no según la etiqueta del lead', async () => {
    await crearFlujo({
      nombre: 'Condición VIP', disparo: 'dm', palabra_clave: 'VIP', activo: true,
      pasos: [{
        tipo: 'condicion', campo: 'etiqueta', valor: 'cliente',
        si: [{ tipo: 'etiquetar', etiqueta: 'rama-si' }],
        no: [{ tipo: 'etiquetar', etiqueta: 'rama-no' }],
      }],
    });
    const a = await nuevoLead('cliente_test');
    await pool.query(`UPDATE leads SET etiquetas = ARRAY['cliente'] WHERE id = $1`, [a.id]);
    const b = await nuevoLead('nuevo_test');
    await simular(a.id, 'dm', 'quiero lo VIP');
    await simular(b.id, 'dm', 'vip');
    expect((await leadPorId(a.id))!.etiquetas).toContain('rama-si');
    expect((await leadPorId(b.id))!.etiquetas).toContain('rama-no');
  });

  it('pide el email, espera la respuesta y lo guarda en el lead', async () => {
    await crearFlujo({
      nombre: 'Pedir email', disparo: 'dm', palabra_clave: 'CLASE', activo: true,
      pasos: [
        { tipo: 'enviar_dm', texto: '¿A qué email te mando la clase?' },
        { tipo: 'esperar_respuesta', guardar_en: 'email' },
        { tipo: 'etiquetar', etiqueta: 'dejó-email' },
      ],
    });
    const l = await nuevoLead('email_test');
    const r1 = await simular(l.id, 'dm', 'CLASE');
    expect(r1.estado).toBe('esperando');
    const r2 = await simular(l.id, 'dm', 'claro! es Lucia@Correo.com');
    expect(r2.reanudado).toBe(true);
    const fresco = await leadPorId(l.id);
    expect(fresco!.email).toBe('lucia@correo.com');
    expect(fresco!.etiquetas).toContain('dejó-email');
  });

  it('una espera por tiempo se reanuda sola cuando vence', async () => {
    await crearFlujo({
      nombre: 'Seguimiento', disparo: 'dm', palabra_clave: 'SEGUI', activo: true,
      pasos: [{ tipo: 'esperar', minutos: 60 }, { tipo: 'etiquetar', etiqueta: 'seguimiento-hecho' }],
    });
    const l = await nuevoLead('espera_test');
    const r = await simular(l.id, 'dm', 'segui');
    expect(r.estado).toBe('esperando');
    expect((await leadPorId(l.id))!.etiquetas).not.toContain('seguimiento-hecho');
    await pool.query(
      `UPDATE flujo_ejecuciones SET reanudar_en = now() - interval '1 minute' WHERE lead_id = $1`, [l.id]);
    const n = await procesarEsperasVencidas(cuentaId);
    expect(n).toBe(1);
    expect((await leadPorId(l.id))!.etiquetas).toContain('seguimiento-hecho');
  });
});

describe('prueba en seco', () => {
  it('recorre la rama elegida sin tocar la base', async () => {
    const f = await crearFlujo({
      nombre: 'Seco', disparo: 'dm', palabra_clave: 'SECO', activo: true,
      pasos: [{
        tipo: 'pregunta', texto: '¿Qué preferís?',
        opciones: [
          { id: 'a', titulo: 'Audio', pasos: [{ tipo: 'etiquetar', etiqueta: 'quiere-audio' }] },
          { id: 'b', titulo: 'PDF', pasos: [{ tipo: 'etiquetar', etiqueta: 'quiere-pdf' }] },
        ],
      }],
    });
    const preguntaId = f.pasos[0].id;
    const r = await app.inject({
      method: 'POST', url: `/api/flujos/${f.id}/simular`, headers: auth(),
      payload: { respuestas: { [preguntaId]: 'b' } },
    });
    expect(r.statusCode).toBe(200);
    const textos = r.json().resultados.map((x: any) => x.texto).join('\n');
    expect(textos).toMatch(/toca «PDF»/);
    expect(textos).toMatch(/quiere-pdf/);
    expect(textos).not.toMatch(/quiere-audio/);
    const reales = await queryOne(
      `SELECT COUNT(*)::int AS n FROM flujo_ejecuciones WHERE flujo_id = $1 AND estado <> 'simulado'`, [f.id]);
    expect(reales.n).toBe(0);
  });
});

describe('webhook de Instagram', () => {
  it('traduce todos los tipos de evento de Meta', () => {
    const evs = parsearWebhookInstagram({
      entry: [{
        id: 'mi_cuenta',
        changes: [
          { field: 'comments', value: { id: 'c1', text: 'GUIA', from: { id: 'u1', username: 'ana' }, media: { id: 'm1' } } },
          { field: 'comments', value: { id: 'c2', text: 'gracias!', from: { id: 'mi_cuenta' }, media: { id: 'm1' } } },
        ],
        messaging: [
          { sender: { id: 'u2' }, recipient: { id: 'mi_cuenta' }, timestamp: 1, message: { mid: 'a', text: 'hola' } },
          { sender: { id: 'u2' }, recipient: { id: 'mi_cuenta' }, message: { mid: 'b', text: 'Sí', quick_reply: { payload: 'fx:1:n1:o1' } } },
          { sender: { id: 'u3' }, recipient: { id: 'mi_cuenta' }, message: { mid: 'c', text: '🔥', reply_to: { story: { id: 's1' } } } },
          { sender: { id: 'u4' }, recipient: { id: 'mi_cuenta' }, message: { mid: 'd', attachments: [{ type: 'story_mention' }] } },
          { sender: { id: 'u5' }, recipient: { id: 'mi_cuenta' }, reaction: { mid: 'e', action: 'react', emoji: '❤️' } },
          { sender: { id: 'u6' }, recipient: { id: 'mi_cuenta' }, postback: { mid: 'f', title: 'Empezar', payload: 'EMPEZAR' } },
          { sender: { id: 'u7' }, recipient: { id: 'mi_cuenta' }, referral: { ref: 'promo', ad_id: 'ad1' } },
          { sender: { id: 'mi_cuenta' }, recipient: { id: 'u2' }, message: { mid: 'g', text: 'te escribo del cel', is_echo: true } },
        ],
      }],
    });
    expect(evs.map((e) => e.tipo)).toEqual(
      ['comentario', 'dm', 'boton', 'historia', 'mencion', 'reaccion', 'boton', 'anuncio', 'eco']);
    expect(evs[0]).toMatchObject({ igUserId: 'u1', commentId: 'c1', mediaId: 'm1', texto: 'GUIA' });
    expect(evs[8]).toMatchObject({ igUserId: 'u2', texto: 'te escribo del cel' });
  });

  it('un DM real entra al Chat una sola vez aunque Meta lo reintente', async () => {
    const cuerpo = {
      entry: [{
        id: 'mi_cuenta',
        messaging: [{ sender: { id: 'igsid_nuevo' }, recipient: { id: 'mi_cuenta' }, timestamp: Date.now(),
          message: { mid: 'mid_unico_1', text: 'hola, info del curso' } }],
      }],
    };
    for (let i = 0; i < 2; i++) {
      const r = await app.inject({ method: 'POST', url: `/webhooks/instagram/${tokenWebhook}`, payload: cuerpo });
      expect(r.statusCode).toBe(200);
    }
    const lead = await queryOne(`SELECT * FROM leads WHERE cuenta_id = $1 AND ig_user_id = 'igsid_nuevo'`, [cuentaId]);
    expect(lead).toBeTruthy();
    expect(lead.mensajes_sin_leer).toBe(1);
    const n = await queryOne(`SELECT COUNT(*)::int AS n FROM mensajes WHERE lead_id = $1`, [lead.id]);
    expect(n.n).toBe(1);
    // Lo que el founder manda desde el celular también aparece en el Chat
    await app.inject({
      method: 'POST', url: `/webhooks/instagram/${tokenWebhook}`,
      payload: { entry: [{ id: 'mi_cuenta', messaging: [{ sender: { id: 'mi_cuenta' }, recipient: { id: 'igsid_nuevo' },
        message: { mid: 'mid_eco_1', text: '¡Hola! Te cuento', is_echo: true } }] }] },
    });
    const eco = await queryOne(`SELECT * FROM mensajes WHERE externo_id = 'mid_eco_1'`, []);
    expect(eco.direccion).toBe('saliente');
  });

  it('la URL única de la app enruta por cuenta de Instagram y exige la firma de Meta', async () => {
    const { createHmac } = await import('node:crypto');
    const igCuenta = `ig_${cuentaId.slice(0, 6)}`;
    await pool.query(
      `UPDATE integraciones SET credenciales = credenciales || $2::jsonb, config = config || $3::jsonb
        WHERE cuenta_id = $1 AND tipo = 'instagram'`,
      [cuentaId, JSON.stringify({ ig_user_id: igCuenta }), JSON.stringify({ app_secret: 'secreto_test' })]);
    const cuerpo = JSON.stringify({ object: 'instagram', entry: [{ id: igCuenta, messaging: [
      { sender: { id: 'igsid_firmado' }, recipient: { id: igCuenta }, message: { mid: 'mid_firmado', text: 'hola' } },
    ] }] });
    const firma = (s: string) => `sha256=${createHmac('sha256', s).update(cuerpo).digest('hex')}`;

    const falsa = await app.inject({ method: 'POST', url: '/webhooks/instagram', payload: cuerpo,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': firma('otro') } });
    expect(falsa.statusCode).toBe(200);
    expect(falsa.json().procesados).toBe(0);

    const buena = await app.inject({ method: 'POST', url: '/webhooks/instagram', payload: cuerpo,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': firma('secreto_test') } });
    expect(buena.json().procesados).toBe(1);
    const lead = await queryOne(`SELECT id FROM leads WHERE cuenta_id = $1 AND ig_user_id = 'igsid_firmado'`, [cuentaId]);
    expect(lead).toBeTruthy();

    // Verificación de suscripción de Meta
    const estado = await app.inject({ method: 'GET', url: '/api/instagram/estado', headers: auth() });
    const vt = estado.json().webhook_verify_token;
    const ok = await app.inject({ method: 'GET', url: `/webhooks/instagram?hub.mode=subscribe&hub.challenge=123&hub.verify_token=${vt}` });
    expect(ok.body).toBe('123');
    const mal = await app.inject({ method: 'GET', url: '/webhooks/instagram?hub.mode=subscribe&hub.challenge=123&hub.verify_token=x' });
    expect(mal.statusCode).toBe(403);
    // Deja la cuenta como estaba para el resto de los tests
    await pool.query(`UPDATE integraciones SET credenciales = '{}'::jsonb, config = '{}'::jsonb WHERE cuenta_id = $1 AND tipo = 'instagram'`, [cuentaId]);
  });

  it('sin Instagram conectado, el mensaje queda con el motivo y el flujo no espera un botón que nadie vio', async () => {
    const l = await nuevoLead('real_test');
    const r = await procesarEventoInstagram(cuentaId, { tipo: 'comentario', igUserId: l.ig_user_id, texto: 'GUIA', commentId: 'cmt_real_1' });
    expect(r?.flujo).toBe('Guía por comentario');
    const ej = await ultimaEjecucion(l.id);
    expect(ej.estado).toBe('pendiente_envio');
    const textos = (ej.resultado as any[]).map((x) => x.texto).join('\n');
    expect(textos).toMatch(/no salió a Instagram/);
    const msg = await queryOne(`SELECT * FROM mensajes WHERE lead_id = $1 AND direccion = 'saliente'`, [l.id]);
    expect(msg.estado).toBe('no_enviado');
    expect(msg.error).toBeTruthy();
    // Mismo flujo y mismo lead en < 24 h: no se repite (anti-spam)
    const r2 = await procesarEventoInstagram(cuentaId, { tipo: 'comentario', igUserId: l.ig_user_id, texto: 'GUIA', commentId: 'cmt_real_2' });
    expect(r2?.omitido).toMatch(/24 h/);
  });
});

describe('automatizaciones por etapa', () => {
  it('al mover un lead se ejecutan antes de responder: etiqueta, nota y arranque de un automensaje', async () => {
    const l = await nuevoLead('etapa_test');
    const flujo = await crearFlujo({
      nombre: 'Bienvenida a llamada', disparo: 'dm', activo: true,
      pasos: [{ tipo: 'etiquetar', etiqueta: 'flujo-desde-etapa' }],
    });
    const { oportunidadAbierta } = await import('../src/modules/pipeline.js');
    const opp = await oportunidadAbierta(cuentaId, l.id, pool);
    const etapa = await queryOne(
      `SELECT * FROM etapas WHERE pipeline_id = $1 ORDER BY orden DESC LIMIT 1 OFFSET 1`, [opp.pipeline_id]);
    const patch = await app.inject({
      method: 'PATCH', url: `/api/etapas/${etapa.id}`, headers: auth(),
      payload: { acciones: [
        { tipo: 'etiquetar', etiqueta: 'paso-por-etapa' },
        { tipo: 'nota', texto: 'Llamar a {{nombre}} hoy' },
        { tipo: 'flujo', flujo_id: flujo.id },
        { tipo: 'email', url: 'https://ejemplo.invalid/hook', secuencia: 'Bienvenida' },
      ] },
    });
    expect(patch.statusCode).toBe(200);
    const mov = await app.inject({
      method: 'POST', url: `/api/oportunidades/${opp.id}/etapa`, headers: auth(),
      payload: { etapa_id: etapa.id },
    });
    expect(mov.json().movido).toBe(true);
    const fresco = await leadPorId(l.id);
    expect(fresco!.etiquetas).toContain('paso-por-etapa');
    expect(fresco!.etiquetas).toContain('flujo-desde-etapa');
    const notas = await query(`SELECT cuerpo FROM notas WHERE lead_id = $1`, [l.id]);
    const cuerpos = notas.map((n: any) => n.cuerpo).join('\n');
    expect(cuerpos).toContain('Llamar a etapa_test hoy');
    // Sin email no entra a la secuencia, y queda explicado en una nota
    expect(cuerpos).toMatch(/no tiene email/);
  });
});
