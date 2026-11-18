import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { query, queryOne, closePool } from '../src/db/pool.js';
import { registrarEvento } from '../src/modules/eventos.js';
import { cuentaDePrueba, leadPorId, oportunidadDe } from './ayuda.js';

let cuentaId: string;

beforeAll(async () => {
  const { cuenta } = await cuentaDePrueba('Reglas');
  cuentaId = cuenta.id;
});

afterAll(async () => { await closePool(); });

async function crearRegla(datos: {
  nombre: string; evento: string; condiciones?: any[]; acciones: any[]; orden?: number;
}) {
  return queryOne(
    `INSERT INTO reglas (cuenta_id, nombre, disparador, condiciones, acciones, orden)
     VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6) RETURNING *`,
    [cuentaId, datos.nombre, JSON.stringify({ evento: datos.evento }),
     JSON.stringify(datos.condiciones ?? []), JSON.stringify(datos.acciones), datos.orden ?? 1],
  );
}

describe('motor de reglas', () => {
  it('las reglas por defecto etiquetan al comprador', async () => {
    const r = await registrarEvento({
      cuentaId, tipo: 'lead_creado', identidad: { igUsername: 'compra.etiquetado' },
    });
    await registrarEvento({ cuentaId, tipo: 'venta', leadId: r.leadId, valor: 1497 });

    const lead = await leadPorId(r.leadId);
    expect(lead!.etiquetas).toContain('comprador');
  });

  it('las reglas por defecto marcan caliente al agendar y lo quitan al comprar', async () => {
    const r = await registrarEvento({
      cuentaId, tipo: 'lead_creado', identidad: { igUsername: 'caliente.luego.compra' },
    });

    await registrarEvento({ cuentaId, tipo: 'reunion_agendada', leadId: r.leadId });
    let lead = await leadPorId(r.leadId);
    expect(lead!.etiquetas).toContain('caliente');

    await registrarEvento({ cuentaId, tipo: 'venta', leadId: r.leadId, valor: 997 });
    lead = await leadPorId(r.leadId);
    expect(lead!.etiquetas).toContain('comprador');
    expect(lead!.etiquetas).not.toContain('caliente');
  });

  it('respeta las condiciones y no se dispara si no se cumplen', async () => {
    await crearRegla({
      nombre: 'Solo ventas grandes',
      evento: 'venta',
      condiciones: [{ campo: 'evento.valor', operador: 'mayor_que', valor: 2000 }],
      acciones: [{ tipo: 'etiquetar', etiqueta: 'alto-ticket' }],
    });

    const pequena = await registrarEvento({
      cuentaId, tipo: 'lead_creado', identidad: { igUsername: 'venta.pequena' },
    });
    await registrarEvento({ cuentaId, tipo: 'venta', leadId: pequena.leadId, valor: 500 });

    const grande = await registrarEvento({
      cuentaId, tipo: 'lead_creado', identidad: { igUsername: 'venta.grande' },
    });
    await registrarEvento({ cuentaId, tipo: 'venta', leadId: grande.leadId, valor: 4200 });

    const leadPequena = await leadPorId(pequena.leadId);
    const leadGrande = await leadPorId(grande.leadId);

    expect(leadPequena!.etiquetas).not.toContain('alto-ticket');
    expect(leadGrande!.etiquetas).toContain('alto-ticket');
  });

  it('puede mover de etapa desde una regla', async () => {
    await crearRegla({
      nombre: 'Descartar leads sin país',
      evento: 'respondio_dm',
      condiciones: [{ campo: 'lead.pais', operador: 'no_existe' }],
      acciones: [{ tipo: 'mover_etapa', etapa_slug: 'perdido' }],
      orden: 5,
    });

    const r = await registrarEvento({
      cuentaId, tipo: 'lead_creado', identidad: { igUsername: 'sin.pais.definido' },
    });
    await registrarEvento({ cuentaId, tipo: 'respondio_dm', leadId: r.leadId });

    const opp = await oportunidadDe(r.leadId);
    expect(opp!.etapa_slug).toBe('perdido');
  });

  it('asigna al closer con menos carga', async () => {
    const closer = await queryOne(
      `INSERT INTO usuarios (cuenta_id, email, nombre, password_hash, rol)
       VALUES ($1,'closer.reglas@test.local','Closer Reglas','x','closer') RETURNING *`,
      [cuentaId]);

    await crearRegla({
      nombre: 'Repartir reuniones',
      evento: 'reunion_agendada',
      acciones: [{ tipo: 'asignar', usuario_id: closer!.id }],
    });

    const r = await registrarEvento({
      cuentaId, tipo: 'lead_creado', identidad: { igUsername: 'para.asignar' },
    });
    await registrarEvento({ cuentaId, tipo: 'reunion_agendada', leadId: r.leadId });

    const lead = await leadPorId(r.leadId);
    expect(lead!.propietario_id).toBe(closer!.id);
  });

  it('deja registro auditable de cada ejecución', async () => {
    const r = await registrarEvento({
      cuentaId, tipo: 'lead_creado', identidad: { igUsername: 'auditame' },
    });
    await registrarEvento({ cuentaId, tipo: 'venta', leadId: r.leadId, valor: 1497 });

    const ejecuciones = await query(
      `SELECT x.*, g.nombre FROM regla_ejecuciones x JOIN reglas g ON g.id = x.regla_id
        WHERE x.cuenta_id = $1 AND x.lead_id = $2`,
      [cuentaId, r.leadId]);

    expect(ejecuciones.length).toBeGreaterThan(0);
    const ok = ejecuciones.filter((e: any) => e.estado === 'ok');
    expect(ok.length).toBeGreaterThan(0);
    expect(ok[0].resultado).toBeDefined();
  });

  it('una regla que falla no tumba el registro del evento', async () => {
    await crearRegla({
      nombre: 'Webhook a un sitio que no existe',
      evento: 'reembolso',
      acciones: [{ tipo: 'webhook_saliente', url: 'http://127.0.0.1:1/no-existe' }],
    });

    const r = await registrarEvento({
      cuentaId, tipo: 'lead_creado', identidad: { igUsername: 'regla.rota' },
    });
    const venta = await registrarEvento({
      cuentaId, tipo: 'reembolso', leadId: r.leadId, valor: 100,
    });

    // El evento se guardó igualmente
    expect(venta.eventoId).toBeTruthy();
    const evento = await queryOne(`SELECT * FROM eventos WHERE id = $1`, [venta.eventoId]);
    expect(evento).not.toBeNull();
  });
});
