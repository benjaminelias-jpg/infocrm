import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closePool, query, queryOne } from '../src/db/pool.js';
import { construirApp } from '../src/app.js';
import { cuentaDePrueba } from './ayuda.js';

let app: FastifyInstance;
let token: string;
let usuarioId: string;
let pipelineId: string;
let etapas: any[];
const auth = () => ({ authorization: `Bearer ${token}` });

async function leadRapido(etapaId: string, usuario: string) {
  return (await app.inject({ method: 'POST', url: '/api/ux/pipeline/lead-rapido', headers: auth(), payload: { etapa_id: etapaId, usuario } })).json();
}

beforeAll(async () => {
  app = await construirApp();
  await app.ready();
  const { usuario } = await cuentaDePrueba('PipelineUX');
  usuarioId = usuario.id;
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: usuario.email, password: 'contrasena-larga-123' } });
  token = login.json().token;
  const pipes = (await app.inject({ method: 'GET', url: '/api/pipelines', headers: auth() })).json();
  pipelineId = pipes[0].id;
  etapas = pipes[0].etapas;
});

afterAll(async () => {
  await app.close();
  await closePool();
});

describe('tablero del pipeline', () => {
  it('busca en el servidor ANTES del límite de 50 por etapa y dice cuántos coinciden', async () => {
    const etapa = etapas[1];
    for (let i = 0; i < 55; i++) await leadRapido(etapa.id, `relleno.${i}`);
    await leadRapido(etapa.id, 'aguja.en.pajar');
    // El más viejo queda fuera de los 50 más recientes: igual lo encuentra.
    await query(`UPDATE oportunidades o SET abierta_en = now() - interval '30 days'
                   FROM leads l WHERE l.id = o.lead_id AND l.ig_username = 'aguja.en.pajar'`);
    await query(`UPDATE leads SET ultimo_contacto_en = now() - interval '30 days', ultimo_mensaje_en = NULL WHERE ig_username = 'aguja.en.pajar'`);

    const todo = (await app.inject({ method: 'GET', url: `/api/kanban?pipeline_id=${pipelineId}`, headers: auth() })).json();
    const col = todo.find((e: any) => e.id === etapa.id);
    expect(col.total).toBe(56);
    expect(col.tarjetas).toHaveLength(50);
    expect(col.tarjetas.some((t: any) => t.ig_username === 'aguja.en.pajar')).toBe(false);

    const r = (await app.inject({ method: 'GET', url: `/api/kanban?pipeline_id=${pipelineId}&q=aguja`, headers: auth() })).json();
    const c2 = r.find((e: any) => e.id === etapa.id);
    expect(c2.total).toBe(56);
    expect(c2.coinciden).toBe(1);
    expect(c2.tarjetas.map((t: any) => t.ig_username)).toEqual(['aguja.en.pajar']);
    // "@aguja" también (el @ se ignora).
    const r2 = (await app.inject({ method: 'GET', url: `/api/kanban?pipeline_id=${pipelineId}&q=%40aguja`, headers: auth() })).json();
    expect(r2.find((e: any) => e.id === etapa.id).coinciden).toBe(1);
  });

  it('filtra Míos / Sin asignar / Sin leer en el servidor', async () => {
    const etapa = etapas[0];
    const a = await leadRapido(etapa.id, 'filtro.mio');           // lo atiende quien lo crea
    const b = await leadRapido(etapa.id, 'filtro.sin.dueno');
    await app.inject({ method: 'POST', url: '/api/ux/pipeline/asignar', headers: auth(), payload: { oportunidad_id: b.oportunidad_id, usuario_id: null } });
    await query(`UPDATE leads SET mensajes_sin_leer = 2 WHERE id = $1`, [a.lead_id]);

    const mios = (await app.inject({ method: 'GET', url: `/api/kanban?pipeline_id=${pipelineId}&propietario=mios`, headers: auth() })).json();
    const usuariosMios = mios.flatMap((e: any) => e.tarjetas.map((t: any) => t.ig_username));
    expect(usuariosMios).toContain('filtro.mio');
    expect(usuariosMios).not.toContain('filtro.sin.dueno');
    expect(mios.flatMap((e: any) => e.tarjetas).every((t: any) => t.propietario_id === usuarioId)).toBe(true);

    const sin = (await app.inject({ method: 'GET', url: `/api/kanban?pipeline_id=${pipelineId}&propietario=sin`, headers: auth() })).json();
    expect(sin.flatMap((e: any) => e.tarjetas.map((t: any) => t.ig_username))).toContain('filtro.sin.dueno');
    expect(sin.flatMap((e: any) => e.tarjetas).every((t: any) => !t.propietario_id)).toBe(true);

    const noLeidos = (await app.inject({ method: 'GET', url: `/api/kanban?pipeline_id=${pipelineId}&sin_leer=1`, headers: auth() })).json();
    const tarjetas = noLeidos.flatMap((e: any) => e.tarjetas);
    expect(tarjetas.map((t: any) => t.ig_username)).toEqual(['filtro.mio']);
  });

  it('"¿ya existe?" dice en qué etapa está, para preguntar antes de mover', async () => {
    const r = (await app.inject({ method: 'GET', url: `/api/ux/pipeline/existe?usuario=%40filtro.mio&pipeline_id=${pipelineId}`, headers: auth() })).json();
    expect(r.existe).toBe(true);
    expect(r.etapa).toBe(etapas[0].nombre);
    const no = (await app.inject({ method: 'GET', url: '/api/ux/pipeline/existe?usuario=nadie.asi', headers: auth() })).json();
    expect(no.existe).toBe(false);
  });

  it('perdido guarda el motivo y deja una nota', async () => {
    const perdida = etapas.find((e: any) => e.tipo === 'perdida');
    const l = await leadRapido(etapas[0].id, 'se.perdio');
    const r = await app.inject({ method: 'POST', url: '/api/ux/pipeline/perdido', headers: auth(), payload: { oportunidad_id: l.oportunidad_id, etapa_id: perdida.id, motivo: 'Le pareció caro' } });
    expect(r.statusCode).toBe(200);
    const o = await queryOne(`SELECT estado, motivo_perdida, etapa_id FROM oportunidades WHERE id = $1`, [l.oportunidad_id]);
    expect(o.estado).toBe('perdida');
    expect(o.motivo_perdida).toBe('Le pareció caro');
    expect(o.etapa_id).toBe(perdida.id);
    const n = await queryOne(`SELECT cuerpo FROM notas WHERE lead_id = $1 ORDER BY creado_en DESC LIMIT 1`, [l.lead_id]);
    expect(n.cuerpo).toMatch(/Le pareció caro/);
  });

  it('Deshacer vuelve a la etapa anterior SIN repetir sus automatizaciones', async () => {
    const origen = etapas[0];
    const destino = etapas[1];
    await query(`UPDATE etapas SET acciones = '[{"tipo":"etiquetar","etiqueta":"bienvenida"}]'::jsonb WHERE id = $1`, [origen.id]);
    const l = await leadRapido(destino.id, 'deshacer.sin.acciones');
    await query(`UPDATE leads SET etiquetas = '{}' WHERE id = $1`, [l.lead_id]);

    // Volver con sin_acciones: no le pone la etiqueta de la etapa.
    await app.inject({ method: 'POST', url: `/api/oportunidades/${l.oportunidad_id}/etapa`, headers: auth(), payload: { etapa_id: origen.id, sin_acciones: true } });
    let lead = await queryOne(`SELECT etiquetas FROM leads WHERE id = $1`, [l.lead_id]);
    expect(lead.etiquetas).not.toContain('bienvenida');

    // Un movimiento normal sí la ejecuta.
    await app.inject({ method: 'POST', url: `/api/oportunidades/${l.oportunidad_id}/etapa`, headers: auth(), payload: { etapa_id: destino.id } });
    await app.inject({ method: 'POST', url: `/api/oportunidades/${l.oportunidad_id}/etapa`, headers: auth(), payload: { etapa_id: origen.id } });
    lead = await queryOne(`SELECT etiquetas FROM leads WHERE id = $1`, [l.lead_id]);
    expect(lead.etiquetas).toContain('bienvenida');
  });

  it('asignar valida que el usuario sea de la cuenta', async () => {
    const l = await leadRapido(etapas[0].id, 'asignar.ajeno');
    const r = await app.inject({ method: 'POST', url: '/api/ux/pipeline/asignar', headers: auth(), payload: { oportunidad_id: l.oportunidad_id, usuario_id: '00000000-0000-4000-8000-000000000000' } });
    expect(r.statusCode).toBe(404);
  });
});
