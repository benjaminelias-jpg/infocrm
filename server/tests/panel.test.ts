import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closePool, queryOne } from '../src/db/pool.js';
import { construirApp } from '../src/app.js';
import { registrarEvento } from '../src/modules/eventos.js';
import { numeroRedondo } from '../src/routes/ux_panel.js';
import { cuentaDePrueba, crearContenido, crearAutomatizacion, etapaPorSlug } from './ayuda.js';

// Panel de inicio: que los números de arriba (KPIs) digan lo mismo que los
// gráficos de abajo, que la asistencia no cuente como faltazo lo que todavía
// no pasó, que el embudo sea de UN pipeline y que los leads quietos salgan
// primero los que todavía se pueden salvar.

let app: FastifyInstance;
let token: string;
let cuentaId: string;
let otroPipelineId: string;
const ids: Record<string, string> = {};
const auth = () => ({ authorization: `Bearer ${token}` });
const DIA = 86_400_000;
const hace = (dias: number) => new Date(Date.now() - dias * DIA);

async function evento(tipo: string, lead: string, dias: number, extra: Record<string, unknown> = {}) {
  return registrarEvento({ cuentaId, tipo, leadId: ids[lead], ocurridoEn: hace(dias), sinReglas: true, ...extra });
}
async function nuevoLead(nombre: string, dias: number, conReel = false) {
  const r = await registrarEvento({
    cuentaId, tipo: 'lead_creado', identidad: { igUsername: nombre, nombre },
    senales: conReel ? { igMediaId: 'media_panel' } : undefined, ocurridoEn: hace(dias), sinReglas: true,
  });
  ids[nombre] = r.leadId;
}
async function panel(params = '') {
  const res = await app.inject({ method: 'GET', url: `/api/analitica/panel?${params}`, headers: auth() });
  expect(res.statusCode).toBe(200);
  return res.json();
}
const desde = (dias: number) => `desde=${encodeURIComponent(hace(dias).toISOString())}`;
const suma = (serie: any[], campo: string) => serie.reduce((a, s) => a + Number(s[campo]), 0);

beforeAll(async () => {
  app = await construirApp();
  await app.ready();
  const { cuenta, usuario } = await cuentaDePrueba('Panel');
  cuentaId = cuenta.id;
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: usuario.email, password: 'contrasena-larga-123' } });
  token = login.json().token;

  const reel = await crearContenido(cuentaId, { titulo: 'Reel del panel', igMediaId: 'media_panel', publicadoEn: hace(70) });
  await crearAutomatizacion(cuentaId, { palabra: 'PANEL', contenidoId: reel!.id });

  // A: entró hace 60 días, vino a la reunión y compró hace 2 días.
  await nuevoLead('ana', 60, true);
  await evento('reunion_agendada', 'ana', 50);
  await evento('reunion_realizada', 'ana', 48);
  await evento('venta', 'ana', 2, { valor: 1000 });
  // B: agendó y faltó.
  await nuevoLead('beto', 20, true);
  await evento('reunion_agendada', 'beto', 18);
  await evento('reunion_no_asistio', 'beto', 16);
  // C: agendó ayer (todavía no pasó: no es un faltazo).
  await nuevoLead('caro', 5, true);
  await evento('reunion_agendada', 'caro', 1);
  // D: compró directo y pidió una devolución parcial.
  await nuevoLead('dani', 3);
  await evento('venta', 'dani', 1, { valor: 500 });
  await evento('reembolso', 'dani', 0.5, { valor: 200 });
  // E: entró hace 100 días y quedó quieto.
  await nuevoLead('eli', 100);
  // F y G: quietos (G más avanzado en el embudo).
  await nuevoLead('fede', 20);
  await nuevoLead('gabi', 15);
  await evento('reunion_agendada', 'gabi', 10);

  // Otro pipeline con sus propias etapas: no se tiene que mezclar en el embudo.
  const p = await app.inject({ method: 'POST', url: '/api/pipelines', headers: auth(), payload: { nombre: 'Lanzamiento' } });
  otroPipelineId = p.json().id;
});

afterAll(async () => {
  await app.close();
  await closePool();
});

describe('KPIs y evolución cuentan lo mismo', () => {
  for (const rango of [7, 30, 90, null]) {
    it(`la suma de la serie es igual a la tarjeta (${rango ?? 'todo'})`, async () => {
      const d = await panel(`${rango ? `${desde(rango)}&` : ''}granularidad=auto`);
      expect(suma(d.serie, 'leads')).toBe(d.kpis.leads);
      expect(suma(d.serie, 'reuniones')).toBe(d.kpis.reuniones_agendadas);
      expect(suma(d.serie, 'ventas')).toBe(d.kpis.ventas);
      expect(suma(d.serie, 'ingresos')).toBe(d.kpis.ingresos);
      expect(['dia', 'semana', 'mes']).toContain(d.serie_granularidad);
    });
  }

  it('ventas e ingresos son de calendario (lo cobrado en el período), el valor por lead es de cohorte', async () => {
    const d = await panel(desde(7));
    // Ana entró hace 60 días pero compró hace 2: la venta es de esta semana.
    expect(d.kpis.ventas).toBe(1); // 2 ventas − 1 devolución
    expect(d.kpis.ingresos).toBe(1300); // 1000 + 500 − 200
    expect(d.kpis.leads).toBe(2); // caro y dani
    // Valor por lead: lo que facturaron los que entraron en estos 7 días (solo dani: 300).
    expect(d.kpis.valor_por_lead).toBe(150);
  });

  it('"Todo" arranca en la primera actividad de la cuenta, no en los últimos 30 días', async () => {
    const d = await panel('granularidad=auto');
    expect(new Date(d.serie[0].periodo).getTime()).toBeLessThanOrEqual(hace(99).getTime());
    expect(suma(d.serie, 'leads')).toBe(7);
    expect(d.anterior).toBeNull();
  });

  it('compara contra el período pedido (anterior_desde / anterior_hasta)', async () => {
    const ad = hace(70).toISOString();
    const ah = hace(50).toISOString();
    const d = await panel(`${desde(20)}&anterior_desde=${encodeURIComponent(ad)}&anterior_hasta=${encodeURIComponent(ah)}`);
    expect(d.anterior.leads).toBe(1); // ana
    expect(d.anterior_rango).toEqual({ desde: ad, hasta: ah });
    // Sin pedirlo: el período inmediatamente anterior del mismo largo.
    const solo = await panel(desde(20));
    expect(new Date(solo.anterior_rango.hasta).getTime() - new Date(solo.anterior_rango.desde).getTime())
      .toBeGreaterThan(19 * DIA);
  });
});

describe('asistencia', () => {
  it('las reuniones que todavía no pasaron no son faltazos', async () => {
    const d = await panel(desde(90));
    expect(d.kpis.reuniones_agendadas).toBe(4); // ana, beto, caro, gabi
    expect(d.kpis.reuniones_realizadas).toBe(1);
    expect(d.kpis.no_shows).toBe(1);
    expect(d.kpis.reuniones_pendientes).toBe(2); // caro y gabi
    expect(d.kpis.tasa_asistencia).toBe(50); // 1 vino / (1 vino + 1 faltó)
  });

  it('el rendimiento por contenido usa el mismo cálculo', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/analitica/contenidos', headers: auth() });
    const fila = res.json().find((c: any) => c.titulo === 'Reel del panel');
    expect(fila.reuniones_agendadas).toBe(3); // ana, beto, caro
    expect(fila.tasa_asistencia).toBe(50); // antes daba 33,3 (contaba a caro como faltazo)
  });
});

describe('embudo', () => {
  it('sin pipeline_id muestra solo el predeterminado (no mezcla pipelines)', async () => {
    const d = await panel(desde(90));
    const predeterminado = d.pipelines.find((p: any) => p.es_predeterminado);
    expect(d.pipelines[0].id).toBe(predeterminado.id);
    expect(d.embudo_pipeline_id).toBe(predeterminado.id);
    expect(d.embudo.every((e: any) => e.pipeline_id === predeterminado.id)).toBe(true);
    expect(d.pipelines.some((p: any) => p.id === otroPipelineId)).toBe(true);
  });

  it('nunca sube: cada paso tiene a lo sumo los del paso anterior', async () => {
    const d = await panel(desde(90));
    const pasos = d.embudo.filter((e: any) => !e.es_salida);
    for (let i = 1; i < pasos.length; i++) {
      expect(pasos[i].alcanzaron).toBeLessThanOrEqual(pasos[i - 1].alcanzaron);
      expect(pasos[i].conversion_desde_anterior).not.toBeNull();
    }
    // El primer paso = todas las oportunidades que se abrieron en el período (eli no: entró hace 100 días).
    const abiertas = await queryOne(
      `SELECT COUNT(*)::int AS n FROM oportunidades o JOIN pipelines p ON p.id = o.pipeline_id
        WHERE o.cuenta_id = $1 AND p.es_predeterminado AND o.abierta_en >= $2`, [cuentaId, hace(90)]);
    expect(pasos[0].alcanzaron).toBe(abiertas!.n);
    expect(pasos[0].conversion_desde_inicio).toBe(100);
    expect(pasos[0].conversion_desde_anterior).toBeNull();
  });

  it('"No asistió" es una salida del paso "Reunión agendada", no un paso', async () => {
    const d = await panel(desde(90));
    const noAsistio = d.embudo.find((e: any) => e.slug === 'no-asistio');
    const agendada = d.embudo.find((e: any) => e.slug === 'reunion-agendada');
    const perdido = d.embudo.find((e: any) => e.tipo === 'perdida');
    expect(noAsistio.es_salida).toBe(true);
    expect(noAsistio.alcanzaron).toBe(1); // beto
    expect(noAsistio.salida_de).toBe(agendada.id);
    expect(perdido.es_salida).toBe(true);
    expect(perdido.salida_de).toBeNull();
  });

  it('con pipeline_id muestra ese pipeline (y /analitica/embudo también acepta no mandarlo)', async () => {
    const d = await panel(`${desde(90)}&pipeline_id=${otroPipelineId}`);
    expect(d.embudo_pipeline_id).toBe(otroPipelineId);
    expect(d.embudo.every((e: any) => e.pipeline_id === otroPipelineId)).toBe(true);

    const solo = await app.inject({ method: 'GET', url: '/api/analitica/embudo', headers: auth() });
    expect(solo.statusCode).toBe(200);
    const pipes = new Set(solo.json().map((e: any) => e.pipeline_id));
    expect(pipes.size).toBe(1);

    // Un pipeline_id que no es de la cuenta (o inválido) no rompe: vuelve al predeterminado.
    const raro = await panel(`pipeline_id=no-es-un-id`);
    expect(raro.embudo_pipeline_id).toBe(d.pipelines[0].id);
  });
});

describe('leads quietos', () => {
  it('primero los que todavía se pueden salvar (etapas más avanzadas, menos días)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ux/panel/quietos', headers: auth() });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    const orden = d.leads.map((l: any) => l.nombre);
    // beto (No asistió) → gabi (Reunión agendada) → fede (20 d) → eli (100 d)
    expect(orden).toEqual(['beto', 'gabi', 'fede', 'eli']);
    expect(d.total).toBe(4);
    expect(d.por_etapa.reduce((a: number, e: any) => a + e.n, 0)).toBe(4);
    expect(d.leads[0].dias_quieto).toBeGreaterThanOrEqual(15);
    // Para "Mover a…" y "Perdido": las etapas del pipeline de cada lead.
    const etapas = d.etapas_por_pipeline[d.leads[0].pipeline_id];
    expect(etapas.some((e: any) => e.tipo === 'perdida')).toBe(true);
  });

  it('filtra por etapa y no cuenta los que ya cerraron', async () => {
    const nuevo = await etapaPorSlug(cuentaId, 'nuevo');
    const res = await app.inject({ method: 'GET', url: `/api/ux/panel/quietos?etapa_id=${nuevo!.id}`, headers: auth() });
    const d = res.json();
    expect(d.leads.map((l: any) => l.nombre)).toEqual(['fede', 'eli']);
    expect(d.total).toBe(4); // el total sigue siendo de todas las etapas (para los chips)
  });

  it('el panel trae los quietos en el mismo orden', async () => {
    const d = await panel(desde(30));
    expect(d.estancados.total).toBe(4);
    expect(d.estancados.leads[0].nombre).toBe('beto');
  });

  it('no ve leads de otra cuenta', async () => {
    const otra = await cuentaDePrueba('PanelOtra');
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: otra.usuario.email, password: 'contrasena-larga-123' } });
    const res = await app.inject({ method: 'GET', url: '/api/ux/panel/quietos', headers: { authorization: `Bearer ${login.json().token}` } });
    expect(res.json().total).toBe(0);
    const estado = await app.inject({ method: 'GET', url: '/api/ux/panel/estado', headers: { authorization: `Bearer ${login.json().token}` } });
    expect(estado.json().leads_total).toBe(0);
    expect(estado.json().objetivo_mes).toBe(false);
  });
});

describe('estado de la cuenta (primeros pasos y objetivo)', () => {
  it('dice si hay leads, si Instagram está conectado y sugiere un objetivo', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ux/panel/estado', headers: auth() });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.leads_total).toBe(7);
    expect(d.instagram_conectado).toBe(false);
    expect(d.automensajes).toBeGreaterThanOrEqual(1);
    expect(d.objetivo_mes).toBe(false);
    expect(d.sugerido).toHaveProperty('leads');

    // Poner el objetivo (lo que hace el formulario del Panel) lo marca como hecho.
    const put = await app.inject({ method: 'PUT', url: '/api/metas', headers: auth(), payload: { leads_meta: 50, calificados_meta: 10, ventas_meta: 5, ingresos_meta: 5000 } });
    expect(put.statusCode).toBe(200);
    const despues = (await app.inject({ method: 'GET', url: '/api/ux/panel/estado', headers: auth() })).json();
    expect(despues.objetivo_mes).toBe(true);
    const meta = await queryOne(`SELECT leads_meta FROM metas WHERE cuenta_id = $1`, [cuentaId]);
    expect(Number(meta!.leads_meta)).toBe(50);
  });

  it('redondea el objetivo sugerido a números lindos', () => {
    expect(numeroRedondo(0)).toBe(0);
    expect(numeroRedondo(7.7)).toBe(8);
    expect(numeroRedondo(47)).toBe(50);
    expect(numeroRedondo(174.9)).toBe(180);
    expect(numeroRedondo(1234)).toBe(1250);
    expect(numeroRedondo(10_980)).toBe(11_000);
  });
});

describe('calidad de la atribución por período', () => {
  it('cuenta los leads del período según su primer toque', async () => {
    const d = await panel(desde(30));
    expect(d.calidad.leads.total).toBe(d.kpis.leads);
    expect(d.calidad.leads.seguros + d.calidad.leads.dudosos + d.calidad.leads.sin_origen).toBe(d.kpis.leads);
  });
});
