import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { query, queryOne, closePool } from '../src/db/pool.js';
import { normalizarPayload, recibirWebhook, reprocesarWebhook } from '../src/modules/ingesta.js';
import { cuentaDePrueba, crearContenido, crearAutomatizacion, oportunidadDe, leadPorId } from './ayuda.js';

let cuentaId: string;
let endpointLeads: any;
let endpointVenta: any;

beforeAll(async () => {
  const { cuenta, endpoints } = await cuentaDePrueba('Ingesta');
  cuentaId = cuenta.id;
  endpointLeads = endpoints.find((e: any) => e.slug === 'manychat-leads');
  endpointVenta = endpoints.find((e: any) => e.slug === 'venta');

  const c = await crearContenido(cuentaId, { titulo: 'Reel ingesta', igMediaId: 'media_ing' });
  await crearAutomatizacion(cuentaId, { palabra: 'INGESTA', contenidoId: c!.id });
});

afterAll(async () => { await closePool(); });

describe('normalización de payloads', () => {
  it('lee un payload típico de ManyChat', () => {
    const n = normalizarPayload(
      { fuente: 'manychat', evento_defecto: 'lead_creado' },
      {
        id: '123456',
        first_name: 'Ana',
        last_name: 'Pérez',
        ig_username: '@ana.perez',
        ig_id: '17841400000',
        custom_fields: { palabra_clave: 'GUIA', ig_media_id: 'media_x' },
      },
    );

    expect(n.identidad.manychatSubscriberId).toBe('123456');
    expect(n.identidad.igUsername).toBe('ana.perez'); // sin la arroba
    expect(n.identidad.nombre).toBe('Ana');
    expect(n.senales.palabraClave).toBe('GUIA');
    expect(n.senales.igMediaId).toBe('media_x');
    expect(n.tipo).toBe('lead_creado');
  });

  it('traduce nombres de evento de terceros', () => {
    const casos: Array<[string, string]> = [
      ['invitee.created', 'reunion_agendada'],
      ['purchase', 'venta'],
      ['checkout.session.completed', 'venta'],
      ['no_show', 'reunion_no_asistio'],
      ['charge.refunded', 'reembolso'],
    ];
    for (const [entrada, esperado] of casos) {
      const n = normalizarPayload(
        { fuente: 'generico', evento_defecto: 'otro' }, { event: entrada });
      expect(n.tipo, `${entrada} debería mapear a ${esperado}`).toBe(esperado);
    }
  });

  it('acepta un mapeo propio que manda sobre el de por defecto', () => {
    const n = normalizarPayload(
      {
        fuente: 'generico',
        evento_defecto: 'venta',
        mapeo: {
          campos: { email: ['comprador.correo'], valor: ['pedido.importe'] },
          opciones: { valor_divisor: 100 },
        },
      },
      { comprador: { correo: 'x@y.com' }, pedido: { importe: 149700 } },
    );

    expect(n.identidad.email).toBe('x@y.com');
    expect(n.valor).toBe(1497);
  });

  it('entiende fechas en epoch y en ISO', () => {
    const iso = normalizarPayload(
      { fuente: 'generico', evento_defecto: 'otro' }, { timestamp: '2026-03-01T10:00:00Z' });
    expect(iso.ocurridoEn?.toISOString()).toBe('2026-03-01T10:00:00.000Z');

    const epoch = normalizarPayload(
      { fuente: 'generico', evento_defecto: 'otro' }, { timestamp: 1772359200 });
    expect(epoch.ocurridoEn).toBeInstanceOf(Date);
  });
});

describe('recepción de webhooks', () => {
  it('procesa un lead de ManyChat de principio a fin', async () => {
    const res = await recibirWebhook(endpointLeads, {
      id: 'mc_ing_1',
      first_name: 'Carlos',
      ig_username: 'carlos.test',
      custom_fields: { palabra_clave: 'INGESTA', ig_media_id: 'media_ing' },
    });

    expect(res.estado).toBe('procesado');
    expect(res.leadId).toBeTruthy();

    const lead = await leadPorId(res.leadId!);
    expect(lead!.ig_username).toBe('carlos.test');
    expect(lead!.primer_contenido_id).toBeTruthy();
  });

  it('guarda el payload crudo aunque el procesado falle, y permite reprocesarlo', async () => {
    // Sin ninguna forma de identificar al lead: debe fallar pero no perderse
    const res = await recibirWebhook(endpointLeads, { algo: 'que no sirve' });

    expect(res.estado).toBe('error');
    expect(res.error).toContain('identificar');

    const bruto = await queryOne(
      `SELECT * FROM webhook_eventos WHERE id = $1`, [res.webhookEventoId]);
    expect(bruto!.payload).toEqual({ algo: 'que no sirve' });
    expect(bruto!.estado).toBe('error');

    // Lo reprocesamos tal cual: sigue fallando, pero el intento queda contado
    const reintento = await reprocesarWebhook(cuentaId, res.webhookEventoId);
    expect(reintento!.estado).toBe('error');

    const tras = await queryOne(`SELECT * FROM webhook_eventos WHERE id = $1`, [res.webhookEventoId]);
    expect(Number(tras!.intentos)).toBe(2);
  });

  it('ignora reenvíos duplicados del mismo evento', async () => {
    const payload = {
      event: 'purchase',
      email: 'repetido@test.com',
      amount: 997,
      transaction_id: 'tx_unico_123',
    };

    const r1 = await recibirWebhook(endpointVenta, payload);
    const r2 = await recibirWebhook(endpointVenta, payload);

    expect(r1.estado).toBe('procesado');
    expect(r2.estado).toBe('duplicado');

    const ventas = await query(
      `SELECT * FROM eventos WHERE cuenta_id = $1 AND tipo = 'venta' AND lead_id = $2`,
      [cuentaId, r1.leadId]);
    expect(ventas.length).toBe(1);
  });

  it('cuenta los recibidos en el endpoint', async () => {
    const antes = await queryOne(
      `SELECT total_recibidos FROM webhook_endpoints WHERE id = $1`, [endpointLeads.id]);

    await recibirWebhook(endpointLeads, { id: 'mc_contador', ig_username: 'contador.test' });

    const despues = await queryOne(
      `SELECT total_recibidos FROM webhook_endpoints WHERE id = $1`, [endpointLeads.id]);
    expect(Number(despues!.total_recibidos)).toBe(Number(antes!.total_recibidos) + 1);
  });

  it('un webhook de Calendly con payload anidado encuentra al lead por email', async () => {
    await recibirWebhook(endpointLeads, {
      id: 'mc_calendly', ig_username: 'agenda.calendly', email: 'agenda@calendly.test',
      custom_fields: { palabra_clave: 'INGESTA' },
    });

    const endpointReunion = await queryOne(
      `SELECT * FROM webhook_endpoints WHERE cuenta_id = $1 AND slug = 'reunion-agendada'`,
      [cuentaId]);

    const res = await recibirWebhook(endpointReunion, {
      event: 'invitee.created',
      payload: {
        invitee: { name: 'Agenda Calendly', email: 'agenda@calendly.test' },
        scheduled_event: { start_time: '2026-12-01T09:00:00Z' },
        uri: 'https://api.calendly.com/scheduled_events/XYZ',
      },
    });

    expect(res.estado).toBe('procesado');
    expect(res.tipo).toBe('reunion_agendada');

    const opp = await oportunidadDe(res.leadId!);
    expect(opp!.etapa_slug).toBe('reunion-agendada');
  });
});
