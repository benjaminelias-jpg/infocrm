import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { query, queryOne, closePool } from '../src/db/pool.js';
import { registrarEvento } from '../src/modules/eventos.js';
import {
  etapaEmbudoDe, recomputarScore, clasificarRoles, rendimientoPorAngulo,
} from '../src/modules/infoproduccion.js';
import { recibirWebhook } from '../src/modules/ingesta.js';
import { cuentaDePrueba, crearContenido, crearAutomatizacion, leadPorId } from './ayuda.js';

let cuentaId: string;

beforeAll(async () => {
  const { cuenta } = await cuentaDePrueba('Infoprod');
  cuentaId = cuenta.id;
});

afterAll(async () => { await closePool(); });

describe('ángulos y embudo', () => {
  it('cada ángulo cae en su etapa de embudo', () => {
    expect(etapaEmbudoDe('video_abierto')).toBe('TOFU');
    expect(etapaEmbudoDe('problema')).toBe('MOFU');
    expect(etapaEmbudoDe('solucion')).toBe('MOFU');
    expect(etapaEmbudoDe('producto')).toBe('BOFU');
    expect(etapaEmbudoDe('mentalidad')).toBe('transversal');
    expect(etapaEmbudoDe('narrativa')).toBe('transversal');
    expect(etapaEmbudoDe(null)).toBeNull();
  });

  it('atribuye leads y ventas al ángulo del contenido de origen', async () => {
    const { cuenta } = await cuentaDePrueba('Angulos');
    const cId = cuenta.id;

    const bofu = await queryOne(
      `INSERT INTO contenidos (cuenta_id, titulo, tipo, ig_media_id, angulo, etapa_embudo)
       VALUES ($1,'Caso de éxito','reel','m_bofu','producto','BOFU') RETURNING *`, [cId]);
    const tofu = await queryOne(
      `INSERT INTO contenidos (cuenta_id, titulo, tipo, ig_media_id, angulo, etapa_embudo)
       VALUES ($1,'Reel masivo','reel','m_tofu','video_abierto','TOFU') RETURNING *`, [cId]);

    // Lead del BOFU que compra
    const a = await registrarEvento({
      cuentaId: cId, tipo: 'lead_creado', identidad: { igUsername: 'bofu.lead' },
      senales: { igMediaId: 'm_bofu' }, sinReglas: true,
    });
    await registrarEvento({ cuentaId: cId, tipo: 'venta', leadId: a.leadId, valor: 1000, sinReglas: true });

    // Lead del TOFU que no compra
    await registrarEvento({
      cuentaId: cId, tipo: 'lead_creado', identidad: { igUsername: 'tofu.lead' },
      senales: { igMediaId: 'm_tofu' }, sinReglas: true,
    });

    const porAngulo = await rendimientoPorAngulo(cId);
    const producto = porAngulo.find((x: any) => x.angulo === 'producto');
    const video = porAngulo.find((x: any) => x.angulo === 'video_abierto');

    expect(producto?.ventas).toBe(1);
    expect(producto?.ingresos).toBe(1000);
    expect(producto?.etapa_embudo).toBe('BOFU');
    expect(video?.leads).toBe(1);
    expect(video?.ventas).toBe(0);
  });

  it('no infla las ventas por ángulo cuando un lead tiene varias oportunidades', async () => {
    const { cuenta } = await cuentaDePrueba('AngulosDup');
    const cId = cuenta.id;
    await queryOne(
      `INSERT INTO contenidos (cuenta_id, titulo, tipo, ig_media_id, angulo, etapa_embudo)
       VALUES ($1,'Repetidor','reel','m_dup','producto','BOFU')`, [cId]);

    // Un comprador que vuelve: dos oportunidades, dos ventas
    const r = await registrarEvento({
      cuentaId: cId, tipo: 'lead_creado', identidad: { igUsername: 'repite' },
      senales: { igMediaId: 'm_dup' }, sinReglas: true,
    });
    await registrarEvento({ cuentaId: cId, tipo: 'venta', leadId: r.leadId, valor: 500, sinReglas: true });
    await registrarEvento({ cuentaId: cId, tipo: 'venta', leadId: r.leadId, valor: 500, sinReglas: true });

    const opps = await query(`SELECT id FROM oportunidades WHERE lead_id=$1`, [r.leadId]);
    expect(opps.length).toBe(2); // de verdad tiene dos oportunidades

    const porAngulo = await rendimientoPorAngulo(cId);
    const producto = porAngulo.find((x: any) => x.angulo === 'producto');
    // dos ventas reales, 1000 en total — no 4 ventas ni 2000 por el cruce de joins
    expect(producto?.ventas).toBe(2);
    expect(producto?.ingresos).toBe(1000);
    expect(producto?.leads).toBe(1);
  });
});

describe('score del lead (filtro antipodridos)', () => {
  it('un lead que solo pide el recurso puntúa bajo', async () => {
    const r = await registrarEvento({
      cuentaId, tipo: 'lead_creado', identidad: { igUsername: 'solo.freebie' }, sinReglas: true,
    });
    const s = await recomputarScore(r.leadId);
    expect(s!.score).toBeLessThan(25);
    expect(s!.calificacion).toBe('sin_calificar');
  });

  it('el score sube con cada señal de compromiso y es auditable', async () => {
    const c = await crearContenido(cuentaId, { titulo: 'BOFU score', igMediaId: 'm_score' });
    await queryOne(`UPDATE contenidos SET angulo='producto', etapa_embudo='BOFU' WHERE id=$1`, [c!.id]);

    const r = await registrarEvento({
      cuentaId, tipo: 'lead_creado',
      identidad: { igUsername: 'buen.lead', email: 'buen@lead.com' },
      senales: { igMediaId: 'm_score' }, sinReglas: true,
    });
    await registrarEvento({ cuentaId, tipo: 'respondio_dm', leadId: r.leadId, sinReglas: true });
    await registrarEvento({ cuentaId, tipo: 'reunion_agendada', leadId: r.leadId, sinReglas: true });

    const s = await recomputarScore(r.leadId);
    expect(s!.score).toBeGreaterThanOrEqual(45);
    expect(s!.calificacion).toBe('calificado');

    const motivos = s!.detalle.map((d) => d.motivo);
    expect(motivos).toContain('Respondió por DM');
    expect(motivos).toContain('Agendó reunión');
    expect(motivos.some((m) => m.includes('BOFU'))).toBe(true);
    // la suma del desglose es el score (con tope en 100)
    expect(Math.min(100, s!.detalle.reduce((a, d) => a + d.puntos, 0))).toBe(s!.score);
  });

  it('no pisa una calificación puesta a mano', async () => {
    const r = await registrarEvento({
      cuentaId, tipo: 'lead_creado',
      identidad: { igUsername: 'descartado.manual', email: 'x@y.com' }, sinReglas: true,
    });
    // Un humano lo marca como no calificado
    await queryOne(`UPDATE leads SET calificacion='no_calificado' WHERE id=$1`, [r.leadId]);
    // Aunque haga cosas que normalmente lo promoverían
    await registrarEvento({ cuentaId, tipo: 'reunion_agendada', leadId: r.leadId, sinReglas: true });
    const s = await recomputarScore(r.leadId);
    expect(s!.calificacion).toBe('no_calificado');
  });

  it('el webhook captura los datos de calificación de ManyChat', async () => {
    const { cuenta, endpoints } = await cuentaDePrueba('Califwebhook');
    const ep = endpoints.find((e: any) => e.slug === 'manychat-leads');

    await recibirWebhook(ep, {
      id: 'mc_calif', ig_username: 'califica.me',
      custom_fields: {
        modelo_negocio: 'Agencia de marketing',
        ingresos: '5-10k/mes',
        cuello_botella: 'No consigo reuniones',
      },
    });

    const lead = await queryOne(
      `SELECT * FROM leads WHERE cuenta_id=$1 AND ig_username='califica.me'`, [cuenta.id]);
    expect(lead!.modelo_negocio).toBe('Agencia de marketing');
    expect(lead!.ingresos_aprox).toBe('5-10k/mes');
    expect(lead!.cuello_botella).toBe('No consigo reuniones');
    expect(Number(lead!.score)).toBeGreaterThan(0);
  });
});

describe('roles de contenido (cartera, no ranking)', () => {
  it('clasifica por el trabajo que hace cada contenido, no por un único KPI', () => {
    const filas = [
      // caballo: mucho volumen y conversión sana
      { id: 'a', leads: 100, ventas: 10, tasa_lead_venta: 10 },
      // closer: pocos leads, conversión altísima
      { id: 'b', leads: 15, ventas: 6, tasa_lead_venta: 40 },
      // prospector: mucho volumen, no convierte (pero NO es "malo")
      { id: 'c', leads: 90, ventas: 0, tasa_lead_venta: 0 },
      // lastre: poco de todo
      { id: 'd', leads: 12, ventas: 0, tasa_lead_venta: 0 },
      // explorador: sin datos suficientes
      { id: 'e', leads: 4, ventas: 0, tasa_lead_venta: 0 },
    ];
    const r = clasificarRoles(filas);
    const rol = (id: string) => r.find((x) => x.id === id)!.rol;

    expect(rol('a')).toBe('caballo');
    expect(rol('b')).toBe('closer');
    expect(rol('c')).toBe('prospector');
    expect(rol('d')).toBe('lastre');
    expect(rol('e')).toBe('explorador');

    // el prospector trae el mayor share pero se juzga por volumen, no por ventas
    const prospector = r.find((x) => x.id === 'c')!;
    expect(prospector.metrica_veredicto.toLowerCase()).toContain('volumen');
  });

  it('marca los leads sin contenido como sin_atribuir', () => {
    const r = clasificarRoles([{ id: null, leads: 30, ventas: 1, tasa_lead_venta: 3.3 }]);
    expect(r[0].rol).toBe('sin_atribuir');
  });

  it('respeta el rol fijado a mano (override)', () => {
    const r = clasificarRoles([
      { id: 'a', leads: 100, ventas: 0, tasa_lead_venta: 0, rol_manual: 'closer' },
    ]);
    expect(r[0].rol).toBe('closer');
    expect(r[0].metrica_veredicto).toContain('mano');
  });

  it('la fila sin_atribuir no distorsiona el share de los reales', () => {
    const r = clasificarRoles([
      { id: null, leads: 1000, ventas: 0, tasa_lead_venta: 0 }, // mucho ruido
      { id: 'a', leads: 50, ventas: 5, tasa_lead_venta: 10 },
    ]);
    const a = r.find((x) => x.id === 'a')!;
    // share de 'a' es 50/50 = 100%, no 50/1050
    expect(a.share_leads).toBe(100);
  });
});

describe('seguridad multi-cuenta', () => {
  it('rechaza registrar un evento sobre un lead de otra cuenta', async () => {
    const a = await cuentaDePrueba('CuentaA');
    const b = await cuentaDePrueba('CuentaB');

    // Lead de la cuenta A
    const lead = await registrarEvento({
      cuentaId: a.cuenta.id, tipo: 'lead_creado', identidad: { igUsername: 'de.cuenta.a' },
      sinReglas: true,
    });

    // La cuenta B intenta registrar un evento sobre el lead de A
    await expect(registrarEvento({
      cuentaId: b.cuenta.id, tipo: 'venta', leadId: lead.leadId, valor: 9999, sinReglas: true,
    })).rejects.toThrow();

    // El lead de A no se tocó: sigue sin venta
    const fresco = await leadPorId(lead.leadId);
    expect(Number(fresco!.valor_total)).toBe(0);
    expect(fresco!.estado).not.toBe('ganado');
  });
});
