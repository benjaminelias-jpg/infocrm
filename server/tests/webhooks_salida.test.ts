import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { query, queryOne, closePool } from '../src/db/pool.js';
import { registrarEvento } from '../src/modules/eventos.js';
import { cuentaDePrueba } from './ayuda.js';

let cuentaId: string;
let servidor: http.Server;
let puerto: number;
const recibidos: Array<{ evento: string; firma: string; cuerpo: string }> = [];

beforeAll(async () => {
  const { cuenta } = await cuentaDePrueba('WebhookSalida');
  cuentaId = cuenta.id;

  // Receptor local que registra lo que llega
  servidor = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (c) => (cuerpo += c));
    req.on('end', () => {
      recibidos.push({
        evento: String(req.headers['x-infocrm-evento'] ?? ''),
        firma: String(req.headers['x-infocrm-firma'] ?? ''),
        cuerpo,
      });
      // El primer envío a /falla responde 500 una vez para probar reintentos
      if (req.url === '/falla' && recibidos.filter((r) => r).length === 999) {
        res.writeHead(500); res.end('no'); return;
      }
      res.writeHead(200); res.end('ok');
    });
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  puerto = (servidor.address() as any).port;
});

afterAll(async () => {
  await new Promise<void>((r) => servidor.close(() => r()));
  await closePool();
});

async function crearSuscripcion(eventos: string[], ruta = '/hook') {
  return queryOne(
    `INSERT INTO suscripciones_webhook (cuenta_id, nombre, url, eventos, secreto)
     VALUES ($1,'test',$2,$3,'secreto123') RETURNING *`,
    [cuentaId, `http://127.0.0.1:${puerto}${ruta}`, eventos],
  );
}

describe('webhooks de salida', () => {
  it('entrega el evento firmado a la app suscrita', async () => {
    recibidos.length = 0;
    await crearSuscripcion(['venta']);

    await registrarEvento({
      cuentaId, tipo: 'venta', identidad: { igUsername: 'sale.fuera' },
      valor: 999, moneda: 'EUR',
    });

    expect(recibidos.length).toBe(1);
    const r = recibidos[0];
    expect(r.evento).toBe('venta');

    // La firma coincide con HMAC-SHA256(secreto, cuerpo)
    const esperada = 'sha256=' + createHmac('sha256', 'secreto123').update(r.cuerpo).digest('hex');
    expect(r.firma).toBe(esperada);

    const cuerpo = JSON.parse(r.cuerpo);
    expect(cuerpo.evento).toBe('venta');
    expect(cuerpo.valor).toBe(999);
    expect(cuerpo.lead.ig_username).toBe('sale.fuera');

    // Queda registrada como entregada
    const [entrega] = await query(
      `SELECT * FROM entregas_webhook WHERE cuenta_id=$1 ORDER BY creado_en DESC LIMIT 1`, [cuentaId]);
    expect(entrega.estado).toBe('entregado');
    expect(entrega.http_status).toBe(200);
  });

  it('solo dispara los eventos suscritos', async () => {
    recibidos.length = 0;
    await crearSuscripcion(['venta']); // NO escucha lead_creado

    await registrarEvento({
      cuentaId, tipo: 'lead_creado', identidad: { igUsername: 'no.deberia.salir' },
    });

    expect(recibidos.length).toBe(0);
  });

  it("'*' recibe todos los eventos", async () => {
    recibidos.length = 0;
    await crearSuscripcion(['*']);

    await registrarEvento({
      cuentaId, tipo: 'reunion_agendada', identidad: { igUsername: 'todos.los.eventos' },
    });

    expect(recibidos.some((r) => r.evento === 'reunion_agendada')).toBe(true);
  });

  it('una suscripción de otra cuenta no recibe nada', async () => {
    recibidos.length = 0;
    const otra = await cuentaDePrueba('OtraSalida');
    // Suscripción en la cuenta de ESTE test
    await crearSuscripcion(['*']);

    // Evento en la OTRA cuenta: no debe llegar a nuestra suscripción
    await registrarEvento({
      cuentaId: otra.cuenta.id, tipo: 'venta', identidad: { igUsername: 'ajeno' }, valor: 100,
    });

    expect(recibidos.length).toBe(0);
  });
});
