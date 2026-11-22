import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closePool, query, queryOne } from '../src/db/pool.js';
import { construirApp } from '../src/app.js';
import { cuentaDePrueba, crearContenido } from './ayuda.js';

// Zona Contenidos y Leads: la lista de leads con los filtros que pide la
// pantalla y el rendimiento de contenidos sin números que confundan.

let app: FastifyInstance;
let token: string;
let cuentaId: string;
let usuarioId: string;
let otraCuentaId: string;
const auth = () => ({ authorization: `Bearer ${token}` });

const DIA = 86_400_000;
const haceDias = (n: number) => new Date(Date.now() - n * DIA);

async function nuevoLead(cuenta: string, datos: {
  usuario: string; nombre?: string; score?: number; propietario?: string | null; sinLeer?: number;
  etiquetas?: string[]; contenidoId?: string | null; entro?: Date;
}) {
  return queryOne(
    `INSERT INTO leads (cuenta_id, ig_username, nombre, score, propietario_id, mensajes_sin_leer, etiquetas,
                        primer_contenido_id, primer_contacto_en, ultimo_contacto_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
    [cuenta, datos.usuario, datos.nombre ?? null, datos.score ?? 0, datos.propietario ?? null,
     datos.sinLeer ?? 0, datos.etiquetas ?? [], datos.contenidoId ?? null, datos.entro ?? new Date()],
  );
}

beforeAll(async () => {
  app = await construirApp();
  await app.ready();
  const { usuario, cuenta } = await cuentaDePrueba('ContenidosLeads');
  cuentaId = cuenta.id;
  usuarioId = usuario.id;
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: usuario.email, password: 'contrasena-larga-123' } });
  token = login.json().token;
  const otra = await cuentaDePrueba('OtraCuenta');
  otraCuentaId = otra.cuenta.id;
});

afterAll(async () => {
  await app.close();
  await closePool();
});

describe('GET /api/ux/leads/lista', () => {
  beforeAll(async () => {
    await nuevoLead(cuentaId, { usuario: 'paula.rojas', nombre: 'Paula', score: 86, propietario: usuarioId, etiquetas: ['comprador'] });
    await nuevoLead(cuentaId, { usuario: 'juan.tibio', nombre: 'Juan', score: 30, sinLeer: 2 });
    await nuevoLead(cuentaId, { usuario: 'sofi.fria', nombre: 'Sofía', score: 5, entro: haceDias(40) });
    await nuevoLead(cuentaId, { usuario: 'caro.caliente', nombre: 'Carolina', score: 55, propietario: usuarioId });
    // De otra cuenta: nunca tiene que aparecer.
    await nuevoLead(otraCuentaId, { usuario: 'paula.ajena', nombre: 'Paula', score: 90 });
  });

  const lista = async (qs = '') => {
    const r = await app.inject({ method: 'GET', url: `/api/ux/leads/lista${qs}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    return r.json();
  };

  it('trae solo los leads de la cuenta, con los conteos de los atajos', async () => {
    const r = await lista();
    expect(r.total).toBe(4);
    expect(r.leads.map((l: any) => l.ig_username)).not.toContain('paula.ajena');
    expect(r.conteos).toEqual({ todos: 4, mios: 2, sin_asignar: 2, sin_leer: 1, sin_atribuir: 4 });
  });

  it('filtra "Míos", "Sin asignar" y "Sin leer"', async () => {
    expect((await lista('?vista=mios')).leads.map((l: any) => l.ig_username).sort()).toEqual(['caro.caliente', 'paula.rojas']);
    expect((await lista('?vista=sin_asignar')).leads.map((l: any) => l.ig_username).sort()).toEqual(['juan.tibio', 'sofi.fria']);
    expect((await lista('?vista=sin_leer')).leads.map((l: any) => l.ig_username)).toEqual(['juan.tibio']);
  });

  it('filtra por temperatura (según el puntaje) y por días desde que entró', async () => {
    expect((await lista('?temperatura=listo')).leads.map((l: any) => l.ig_username)).toEqual(['paula.rojas']);
    expect((await lista('?temperatura=caliente')).leads.map((l: any) => l.ig_username)).toEqual(['caro.caliente']);
    expect((await lista('?temperatura=tibio')).leads.map((l: any) => l.ig_username)).toEqual(['juan.tibio']);
    const recientes = await lista('?dias=30');
    expect(recientes.leads.map((l: any) => l.ig_username)).not.toContain('sofi.fria');
    expect(recientes.total).toBe(3);
  });

  it('busca aunque se escriba con @ y ordena por interés', async () => {
    expect((await lista('?q=%40paula')).leads.map((l: any) => l.ig_username)).toEqual(['paula.rojas']);
    expect((await lista('?q=carolina')).leads.map((l: any) => l.ig_username)).toEqual(['caro.caliente']);
    const orden = (await lista('?orden=interes')).leads.map((l: any) => l.score);
    expect(orden).toEqual([...orden].sort((a, b) => b - a));
  });

  it('dice quién lo atiende y pagina', async () => {
    const r = await lista('?vista=mios&orden=interes&limite=1');
    expect(r.leads).toHaveLength(1);
    expect(r.total).toBe(2);
    expect(r.leads[0].propietario_nombre).toBe('Dueño Test');
    const p2 = await lista('?vista=mios&orden=interes&limite=1&offset=1');
    expect(p2.leads[0].ig_username).toBe('caro.caliente');
  });

  it('filtra por etiqueta y no se rompe con parámetros vacíos', async () => {
    expect((await lista('?etiqueta=comprador&etapa_id=&q=')).leads.map((l: any) => l.ig_username)).toEqual(['paula.rojas']);
  });

  it('rechaza valores inválidos con 400', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/ux/leads/lista?vista=todo_el_mundo', headers: auth() });
    expect(r.statusCode).toBe(400);
    const r2 = await app.inject({ method: 'GET', url: '/api/ux/leads/lista?etapa_id=no-es-un-id', headers: auth() });
    expect(r2.statusCode).toBe(400);
  });

  it('pide sesión', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/ux/leads/lista' });
    expect(r.statusCode).toBe(401);
  });

  it('con contenido_id trae el título del contenido para el chip "Vino de"', async () => {
    const c = await crearContenido(cuentaId, { titulo: 'Reel de prueba de la lista' });
    await nuevoLead(cuentaId, { usuario: 'vino.del.reel', contenidoId: c!.id });
    const r = await lista(`?contenido_id=${c!.id}`);
    expect(r.contenido?.titulo).toBe('Reel de prueba de la lista');
    expect(r.leads.map((l: any) => l.ig_username)).toEqual(['vino.del.reel']);
    expect(r.leads[0].contenido_titulo).toBe('Reel de prueba de la lista');
    // Un contenido de otra cuenta no se filtra.
    const ajeno = await crearContenido(otraCuentaId, { titulo: 'Ajeno' });
    const r2 = await lista(`?contenido_id=${ajeno!.id}`);
    expect(r2.contenido).toBeNull();
    expect(r2.total).toBe(0);
  });
});

describe('GET /api/contenidos/rendimiento', () => {
  let estrella: any;
  let dudoso: any;

  beforeAll(async () => {
    estrella = await crearContenido(cuentaId, { titulo: 'El reel que más vende' });
    dudoso = await crearContenido(cuentaId, { titulo: 'Reel con palabra repetida' });
    await query(`UPDATE contenidos SET ig_likes = 1234, ig_guardados = 56, ig_compartidos = 7 WHERE id = $1`, [estrella!.id]);
    // Hace 60 días: muchos leads y ventas (el reel que sostiene la cuenta).
    for (let i = 0; i < 12; i++) {
      const l = await nuevoLead(cuentaId, { usuario: `viejo.${i}`, contenidoId: estrella!.id, entro: haceDias(60) });
      if (i < 4) {
        await query(`INSERT INTO eventos (cuenta_id, lead_id, tipo, valor, fuente, ocurrido_en) VALUES ($1,$2,'venta',1000,'manual',$3)`,
          [cuentaId, l!.id, haceDias(55)]);
      }
    }
    // Esta semana: 3 leads y ninguna venta todavía.
    for (let i = 0; i < 3; i++) {
      await nuevoLead(cuentaId, { usuario: `nuevo.${i}`, contenidoId: estrella!.id, entro: haceDias(2) });
    }
    // Reel con origen dudoso: un lead con DOS toques dudosos (cuenta una vez) y otro fuera del período.
    const d1 = await nuevoLead(cuentaId, { usuario: 'dudoso.1', contenidoId: dudoso!.id, entro: haceDias(1) });
    const d2 = await nuevoLead(cuentaId, { usuario: 'dudoso.viejo', contenidoId: dudoso!.id, entro: haceDias(80) });
    await nuevoLead(cuentaId, { usuario: 'seguro.1', contenidoId: dudoso!.id, entro: haceDias(1) });
    for (const [lead, cuando] of [[d1, haceDias(1)], [d1, haceDias(1)], [d2, haceDias(80)]] as const) {
      await query(
        `INSERT INTO toques (cuenta_id, lead_id, contenido_id, metodo, confianza, ocurrido_en)
         VALUES ($1,$2,$3,'palabra_clave','baja',$4)`, [cuentaId, lead!.id, dudoso!.id, cuando]);
    }
  });

  const rendimiento = async (qs = '') => {
    const r = await app.inject({ method: 'GET', url: `/api/contenidos/rendimiento${qs}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    return r.json();
  };

  it('el rol no cambia por mirar solo 7 días (se juzga con 90)', async () => {
    const semana = await rendimiento(`?desde=${encodeURIComponent(haceDias(7).toISOString())}`);
    const tres = await rendimiento(`?desde=${encodeURIComponent(haceDias(90).toISOString())}`);
    const enSemana = semana.filas.find((f: any) => f.id === estrella.id);
    const enTres = tres.filas.find((f: any) => f.id === estrella.id);
    expect(enSemana.leads).toBe(3);
    expect(enSemana.ventas).toBe(0);
    expect(enTres.leads).toBe(15);
    expect(enSemana.rol).toBe(enTres.rol);
    expect(enSemana.rol).not.toBe('lastre');
    expect(enSemana.rol_leads).toBe(15);
    expect(semana.dias_rol).toBe(90);
  });

  it('cuenta leads dudosos distintos y solo del período', async () => {
    const semana = await rendimiento(`?desde=${encodeURIComponent(haceDias(7).toISOString())}`);
    const fila = semana.filas.find((f: any) => f.id === dudoso.id);
    expect(fila.leads).toBe(2);
    expect(fila.leads_dudosos).toBe(1);
    const todo = await rendimiento();
    expect(todo.filas.find((f: any) => f.id === dudoso.id).leads_dudosos).toBe(2);
  });

  it('trae me gusta, guardados y compartidos, y si Instagram está conectado', async () => {
    const r = await rendimiento();
    const fila = r.filas.find((f: any) => f.id === estrella.id);
    expect(fila.ig_likes).toBe(1234);
    expect(fila.ig_guardados).toBe(56);
    expect(fila.ig_compartidos).toBe(7);
    expect(r.instagram).toMatchObject({ conectado: false });
  });

  it('no mezcla contenidos de otra cuenta', async () => {
    const ajeno = await crearContenido(otraCuentaId, { titulo: 'Contenido de otra cuenta' });
    const r = await rendimiento();
    expect(r.filas.map((f: any) => f.id)).not.toContain(ajeno!.id);
  });
});

describe('contenidos: cargar a mano y sincronizar', () => {
  it('no deja cargar dos veces el mismo link', async () => {
    const link = 'https://www.instagram.com/reel/ABC123xyz/';
    const r1 = await app.inject({ method: 'POST', url: '/api/contenidos', headers: auth(), payload: { titulo: 'Mi reel', permalink: `${link}?igsh=xx` } });
    expect(r1.statusCode).toBe(201);
    expect(r1.json().permalink).toBe('https://www.instagram.com/reel/ABC123xyz');
    const r2 = await app.inject({ method: 'POST', url: '/api/contenidos', headers: auth(), payload: { titulo: 'Otra vez', permalink: link } });
    expect(r2.statusCode).toBe(409);
    expect(r2.json().mensaje).toMatch(/ya está en tu lista/);
  });

  it('sincronizar sin Instagram explica qué hacer, sin jerga', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/instagram/sincronizar', headers: auth() });
    expect(r.statusCode).toBe(200);
    const d = r.json();
    expect(d.ok).toBe(false);
    expect(d.motivo).toBe('sin_conexion');
    expect(d.mensaje).toMatch(/Conectalo en Configuración/);
    expect(d.mensaje).not.toMatch(/ig_media_id|webhook|Conecta tu/);
  });
});
