import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closePool, query } from '../src/db/pool.js';
import { construirApp } from '../src/app.js';
import { registrarEvento } from '../src/modules/eventos.js';
import { cuentaDePrueba } from './ayuda.js';

// Las tasas del Panel ("19 % de los leads", "52 % de las reuniones hechas",
// el "Cierre" y la "Agenda" del equipo) comparan cosas del MISMO grupo y
// nunca pasan de 100 %. Antes dividían ventas de calendario por reuniones de
// calendario: una semana con ventas sin reunión daba "200 % de las reuniones".
// Y una cuenta recién creada (sin nada) también tiene que dar un panel sano.

let app: FastifyInstance;
let token: string;
let cuentaId: string;
let usuarioId: string;
const ids: Record<string, string> = {};
const DIA = 86_400_000;
const hace = (dias: number) => new Date(Date.now() - dias * DIA);
const desde = (dias: number) => `desde=${encodeURIComponent(hace(dias).toISOString())}`;

async function nuevoLead(nombre: string, dias: number) {
  const r = await registrarEvento({
    cuentaId, tipo: 'lead_creado', identidad: { igUsername: nombre, nombre }, ocurridoEn: hace(dias), sinReglas: true,
  });
  ids[nombre] = r.leadId;
}
async function evento(tipo: string, lead: string, dias: number, extra: Record<string, unknown> = {}) {
  return registrarEvento({ cuentaId, tipo, leadId: ids[lead], ocurridoEn: hace(dias), sinReglas: true, ...extra });
}
async function panel(token_: string, params = '') {
  const res = await app.inject({ method: 'GET', url: `/api/analitica/panel?${params}`, headers: { authorization: `Bearer ${token_}` } });
  expect(res.statusCode).toBe(200);
  return res.json();
}
async function entrar(email: string) {
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'contrasena-larga-123' } });
  return login.json().token as string;
}

beforeAll(async () => {
  app = await construirApp();
  await app.ready();
  const { cuenta, usuario } = await cuentaDePrueba('PanelTasas');
  cuentaId = cuenta.id;
  usuarioId = usuario.id;
  token = await entrar(usuario.email);

  // A: entró hace 3 días y compró directo hace 1 (sin reunión).
  await nuevoLead('ana', 3);
  await evento('venta', 'ana', 1, { valor: 400 });
  // B: lead viejo (20 días): reunión hace 10 días y compra hace 2.
  await nuevoLead('beto', 20);
  await evento('reunion_agendada', 'beto', 15);
  await evento('reunion_realizada', 'beto', 10);
  await evento('venta', 'beto', 2, { valor: 1000 });
  // C: entró hace 2 días y agendó ayer (todavía sin resultado).
  await nuevoLead('caro', 2);
  await evento('reunion_agendada', 'caro', 1);
  // D: lead de hace 40 días que agendó hace 5 y vino hace 4, sin compra.
  await nuevoLead('dani', 40);
  await evento('reunion_agendada', 'dani', 5);
  await evento('reunion_realizada', 'dani', 4);
  // E: lead de hace 50 días que agendó hace 3.
  await nuevoLead('eli', 50);
  await evento('reunion_agendada', 'eli', 3);

  // Todo lo atiende el dueño (para la tabla del equipo).
  await query(`UPDATE oportunidades SET propietario_id = $2 WHERE cuenta_id = $1`, [cuentaId, usuarioId]);
});

afterAll(async () => {
  await app.close();
  await closePool();
});

describe('las tasas nunca pasan de 100 %', () => {
  it('KPIs: cada tasa compara cosas del mismo grupo', async () => {
    const d = await panel(token, desde(7));
    const k = d.kpis;
    // Calendario: lo que pasó en estos 7 días.
    expect(k.leads).toBe(2); // ana y caro
    expect(k.ventas).toBe(2); // ana y beto
    expect(k.reuniones_agendadas).toBe(3); // caro, dani y eli
    expect(k.reuniones_realizadas).toBe(1); // dani
    // Antes: 2 ventas ÷ 1 reunión = 200 %. Ahora: de la reunión hecha (dani), ninguna terminó en venta.
    expect(k.reuniones_con_venta).toBe(0);
    expect(k.tasa_reunion_venta).toBe(0);
    // Antes: 3 reuniones ÷ 2 leads = 150 %. Ahora: de los 2 leads que entraron, agendó 1 (caro).
    expect(k.leads_con_reunion).toBe(1);
    expect(k.tasa_lead_reunion).toBe(50);
    // De los 2 leads que entraron, compró 1 (ana).
    expect(k.tasa_lead_venta).toBe(50);
    for (const campo of ['tasa_lead_reunion', 'tasa_asistencia', 'tasa_reunion_venta', 'tasa_lead_venta', 'cobertura_atribucion']) {
      expect(k[campo]).toBeGreaterThanOrEqual(0);
      expect(k[campo]).toBeLessThanOrEqual(100);
    }
  });

  it('una reunión hecha en el período que terminó en venta cuenta para el cierre', async () => {
    const d = await panel(token, desde(12));
    expect(d.kpis.reuniones_realizadas).toBe(2); // beto (hace 10) y dani (hace 4)
    expect(d.kpis.reuniones_con_venta).toBe(1); // beto
    expect(d.kpis.tasa_reunion_venta).toBe(50);
  });

  it('equipo: "Cierre" y "Agenda" tampoco pasan de 100 %', async () => {
    const d = await panel(token, desde(7));
    const yo = d.closers.find((p: any) => p.id === usuarioId);
    expect(yo).toBeTruthy();
    expect(yo.ventas).toBe(2); // ana y beto cerraron en estos 7 días
    expect(yo.reuniones).toBe(1); // dani
    expect(yo.reuniones_con_venta).toBe(0);
    expect(yo.tasa_cierre).toBe(0); // antes: 2 ÷ 1 = 200 %
    expect(yo.oportunidades).toBe(2); // ana y caro
    expect(yo.oportunidades_con_reunion).toBe(1); // caro
    expect(yo.tasa_agenda).toBe(50); // antes: 3 agendadas ÷ 2 leads = 150 %
    for (const p of d.closers) {
      expect(p.tasa_cierre).toBeLessThanOrEqual(100);
      expect(p.tasa_agenda).toBeLessThanOrEqual(100);
    }
  });
});

describe('cuenta recién creada', () => {
  it('el panel responde sano: ceros, serie en cero, embudo vacío y nada quieto', async () => {
    const nueva = await cuentaDePrueba('PanelVacia');
    const t = await entrar(nueva.usuario.email);
    for (const params of ['granularidad=auto', `${desde(7)}&granularidad=auto`]) {
      const d = await panel(t, params);
      expect(d.kpis.leads).toBe(0);
      expect(d.kpis.ventas).toBe(0);
      expect(d.kpis.ingresos).toBe(0);
      expect(d.kpis.tasa_asistencia).toBe(0);
      expect(Array.isArray(d.serie)).toBe(true);
      expect(d.serie.length).toBeGreaterThan(0);
      expect(d.serie.every((s: any) => Number(s.leads) === 0 && Number(s.ingresos) === 0)).toBe(true);
      expect(d.pipelines.length).toBeGreaterThanOrEqual(1);
      expect(d.embudo.every((p: any) => p.alcanzaron === 0)).toBe(true);
      expect(d.estancados.total).toBe(0);
      expect(d.contenidos).toEqual([]);
    }
    const todo = await panel(t, 'granularidad=auto');
    expect(todo.anterior).toBeNull();
    const estado = await app.inject({ method: 'GET', url: '/api/ux/panel/estado', headers: { authorization: `Bearer ${t}` } });
    expect(estado.json().leads_total).toBe(0);
    expect(estado.json().sugerido).toEqual({ leads: 0, calificados: 0, ventas: 0, ingresos: 0 });
  });
});
