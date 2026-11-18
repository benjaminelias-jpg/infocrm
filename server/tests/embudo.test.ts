import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { query, queryOne, closePool } from '../src/db/pool.js';
import { registrarEvento } from '../src/modules/eventos.js';
import { cuentaDePrueba, crearContenido, crearAutomatizacion, oportunidadDe, leadPorId } from './ayuda.js';

let cuentaId: string;
let contenidoId: string;

beforeAll(async () => {
  const { cuenta } = await cuentaDePrueba('Embudo');
  cuentaId = cuenta.id;
  const c = await crearContenido(cuentaId, { titulo: 'Reel del embudo', igMediaId: 'media_embudo' });
  contenidoId = c!.id;
  await crearAutomatizacion(cuentaId, { palabra: 'EMBUDO', contenidoId });
});

afterAll(async () => { await closePool(); });

const identidad = (u: string) => ({ igUsername: u, nombre: u });

describe('recorrido por el embudo', () => {
  it('un lead nuevo entra en la primera etapa', async () => {
    const r = await registrarEvento({
      cuentaId, tipo: 'lead_creado', identidad: identidad('nuevo.lead'),
      senales: { igMediaId: 'media_embudo' }, sinReglas: true,
    });
    const opp = await oportunidadDe(r.leadId);
    expect(opp!.etapa_slug).toBe('nuevo');
    expect(opp!.estado).toBe('abierta');
    expect(opp!.contenido_id).toBe(contenidoId);
  });

  it('agendar una reunión mueve la etapa y sella la fecha', async () => {
    const r = await registrarEvento({
      cuentaId, tipo: 'lead_creado', identidad: identidad('agenda.conmigo'),
      senales: { igMediaId: 'media_embudo' }, sinReglas: true,
    });
    await registrarEvento({
      cuentaId, tipo: 'reunion_agendada', leadId: r.leadId, sinReglas: true,
    });

    const opp = await oportunidadDe(r.leadId);
    expect(opp!.etapa_slug).toBe('reunion-agendada');
    expect(opp!.reunion_agendada_en).not.toBeNull();
  });

  it('una venta cierra la oportunidad como ganada y suma al lead', async () => {
    const r = await registrarEvento({
      cuentaId, tipo: 'lead_creado', identidad: identidad('compra.ya'),
      senales: { igMediaId: 'media_embudo' }, sinReglas: true,
    });
    await registrarEvento({
      cuentaId, tipo: 'venta', leadId: r.leadId, valor: 1497, moneda: 'EUR',
      titulo: 'Programa Acelerador', sinReglas: true,
    });

    const opp = await oportunidadDe(r.leadId);
    expect(opp!.etapa_slug).toBe('venta');
    expect(opp!.estado).toBe('ganada');
    expect(Number(opp!.valor)).toBe(1497);
    expect(opp!.cerrada_en).not.toBeNull();

    const lead = await leadPorId(r.leadId);
    expect(Number(lead!.valor_total)).toBe(1497);
    expect(lead!.estado).toBe('ganado');
  });

  it('no retrocede de etapa con eventos blandos que llegan tarde', async () => {
    const r = await registrarEvento({
      cuentaId, tipo: 'lead_creado', identidad: identidad('orden.raro'),
      senales: { igMediaId: 'media_embudo' }, sinReglas: true,
    });
    await registrarEvento({ cuentaId, tipo: 'reunion_agendada', leadId: r.leadId, sinReglas: true });
    // ManyChat reenvía el "recurso entregado" con retraso
    await registrarEvento({ cuentaId, tipo: 'recurso_entregado', leadId: r.leadId, sinReglas: true });

    const opp = await oportunidadDe(r.leadId);
    expect(opp!.etapa_slug).toBe('reunion-agendada');
  });

  it('sí retrocede con un no-show, que es información real', async () => {
    const r = await registrarEvento({
      cuentaId, tipo: 'lead_creado', identidad: identidad('no.vino'),
      senales: { igMediaId: 'media_embudo' }, sinReglas: true,
    });
    await registrarEvento({ cuentaId, tipo: 'reunion_agendada', leadId: r.leadId, sinReglas: true });
    await registrarEvento({ cuentaId, tipo: 'reunion_no_asistio', leadId: r.leadId, sinReglas: true });

    const opp = await oportunidadDe(r.leadId);
    expect(opp!.etapa_slug).toBe('no-asistio');
    expect(opp!.reunion_no_asistio).toBe(true);
  });

  it('un comprador que vuelve abre una oportunidad nueva', async () => {
    const r = await registrarEvento({
      cuentaId, tipo: 'lead_creado', identidad: identidad('cliente.repetidor'),
      senales: { igMediaId: 'media_embudo' }, sinReglas: true,
    });
    await registrarEvento({
      cuentaId, tipo: 'venta', leadId: r.leadId, valor: 997, sinReglas: true,
    });
    await registrarEvento({
      cuentaId, tipo: 'venta', leadId: r.leadId, valor: 2497, sinReglas: true,
    });

    const oportunidades = await query(
      `SELECT * FROM oportunidades WHERE lead_id = $1 ORDER BY abierta_en ASC`, [r.leadId]);
    expect(oportunidades.length).toBe(2);
    expect(oportunidades.every((o: any) => o.estado === 'ganada')).toBe(true);

    const lead = await leadPorId(r.leadId);
    expect(Number(lead!.valor_total)).toBe(997 + 2497);
  });

  it('deja rastro de cada movimiento en el historial', async () => {
    const r = await registrarEvento({
      cuentaId, tipo: 'lead_creado', identidad: identidad('con.historial'),
      senales: { igMediaId: 'media_embudo' }, sinReglas: true,
    });
    await registrarEvento({ cuentaId, tipo: 'reunion_agendada', leadId: r.leadId, sinReglas: true });
    await registrarEvento({ cuentaId, tipo: 'reunion_realizada', leadId: r.leadId, sinReglas: true });

    const opp = await oportunidadDe(r.leadId);
    const historial = await query(
      `SELECT h.*, e.slug FROM etapa_historial h JOIN etapas e ON e.id = h.etapa_hasta_id
        WHERE h.oportunidad_id = $1 ORDER BY h.cambiado_en ASC, h.id ASC`,
      [opp!.id]);

    const slugs = historial.map((h: any) => h.slug);
    expect(slugs).toEqual(['nuevo', 'reunion-agendada', 'reunion-realizada']);
  });
});

describe('identidad del lead', () => {
  it('reconoce al mismo lead aunque llegue por otro canal', async () => {
    const r1 = await registrarEvento({
      cuentaId, tipo: 'lead_creado',
      identidad: { manychatSubscriberId: 'mc_777', igUsername: 'mismo.tipo' },
      sinReglas: true,
    });
    // Después Calendly solo manda el email, que ManyChat ya había guardado
    await queryOne(`UPDATE leads SET email = 'mismo@tipo.com' WHERE id = $1`, [r1.leadId]);

    const r2 = await registrarEvento({
      cuentaId, tipo: 'reunion_agendada',
      identidad: { email: 'mismo@tipo.com', nombre: 'Mismo Tipo' },
      sinReglas: true,
    });

    expect(r2.leadId).toBe(r1.leadId);
  });

  it('no duplica el lead si ManyChat reenvía el mismo evento', async () => {
    const comun = {
      cuentaId, tipo: 'lead_creado',
      identidad: { manychatSubscriberId: 'mc_idem', igUsername: 'solo.una.vez' },
      idempotencyKey: 'evento-repetido-1',
      sinReglas: true,
    };
    const r1 = await registrarEvento(comun);
    const r2 = await registrarEvento(comun);

    expect(r2.duplicado).toBe(true);
    expect(r2.leadId).toBe(r1.leadId);

    const eventos = await query(
      `SELECT * FROM eventos WHERE cuenta_id = $1 AND idempotency_key = 'evento-repetido-1'`,
      [cuentaId]);
    expect(eventos.length).toBe(1);
  });

  it('rellena huecos sin pisar lo que ya sabíamos', async () => {
    const r1 = await registrarEvento({
      cuentaId, tipo: 'lead_creado',
      identidad: { igUsername: 'datos.parciales', nombre: 'Nombre Bueno' },
      sinReglas: true,
    });
    await registrarEvento({
      cuentaId, tipo: 'respondio_dm',
      identidad: { igUsername: 'datos.parciales', nombre: 'Nombre Malo', email: 'nuevo@dato.com' },
      sinReglas: true,
    });

    const lead = await leadPorId(r1.leadId);
    expect(lead!.nombre).toBe('Nombre Bueno');
    expect(lead!.email).toBe('nuevo@dato.com');
  });
});
