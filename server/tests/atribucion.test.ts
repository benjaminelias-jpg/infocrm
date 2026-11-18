import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { queryOne, closePool } from '../src/db/pool.js';
import { resolverAtribucion, reatribuir } from '../src/modules/atribucion.js';
import { registrarEvento } from '../src/modules/eventos.js';
import { cuentaDePrueba, crearContenido, crearAutomatizacion, leadPorId } from './ayuda.js';

let cuentaId: string;

beforeAll(async () => {
  const { cuenta } = await cuentaDePrueba('Atribución');
  cuentaId = cuenta.id;
});

afterAll(async () => { await closePool(); });

describe('motor de atribución', () => {
  it('atribuye por ig_media_id con confianza alta', async () => {
    const contenido = await crearContenido(cuentaId, { titulo: 'Reel A', igMediaId: 'media_A' });

    const r = await resolverAtribucion(cuentaId, { igMediaId: 'media_A' });

    expect(r.contenidoId).toBe(contenido!.id);
    expect(r.metodo).toBe('ig_media_id');
    expect(r.confianza).toBe('alta');
  });

  it('crea el contenido solo cuando llega un ig_media_id desconocido, sin perder el lead', async () => {
    const r = await resolverAtribucion(cuentaId, { igMediaId: 'media_nuevo_999' });

    expect(r.contenidoId).not.toBeNull();
    expect(r.confianza).toBe('alta');

    const creado = await queryOne(
      `SELECT * FROM contenidos WHERE cuenta_id = $1 AND ig_media_id = 'media_nuevo_999'`,
      [cuentaId],
    );
    expect(creado).not.toBeNull();
    expect(creado!.notas).toContain('automáticamente');
  });

  it('atribuye por palabra clave única con confianza alta', async () => {
    const contenido = await crearContenido(cuentaId, { titulo: 'Reel único', igMediaId: 'media_U' });
    await crearAutomatizacion(cuentaId, { palabra: 'UNICA', contenidoId: contenido!.id });

    const r = await resolverAtribucion(cuentaId, { palabraClave: 'unica' });

    expect(r.contenidoId).toBe(contenido!.id);
    expect(r.metodo).toBe('palabra_clave');
    expect(r.confianza).toBe('alta');
  });

  it('marca confianza baja cuando la misma palabra está en varios reels', async () => {
    const viejo = await crearContenido(cuentaId, {
      titulo: 'Reel viejo', igMediaId: 'media_V',
      publicadoEn: new Date(Date.now() - 30 * 86400000),
    });
    const nuevo = await crearContenido(cuentaId, {
      titulo: 'Reel nuevo', igMediaId: 'media_N',
      publicadoEn: new Date(Date.now() - 2 * 86400000),
    });
    await crearAutomatizacion(cuentaId, { palabra: 'REPE', contenidoId: viejo!.id });
    await crearAutomatizacion(cuentaId, { palabra: 'REPE', contenidoId: nuevo!.id });

    const r = await resolverAtribucion(cuentaId, { palabraClave: 'REPE' });

    expect(r.confianza).toBe('baja');
    expect(r.candidatos).toBe(2);
    // Ante la duda elige el más reciente, pero lo deja marcado
    expect(r.contenidoId).toBe(nuevo!.id);
    expect(r.nota).toContain('2 contenidos');
  });

  it('crea la automatización cuando la palabra clave es desconocida', async () => {
    const r = await resolverAtribucion(cuentaId, { palabraClave: 'DESCONOCIDA' });

    expect(r.contenidoId).toBeNull();
    expect(r.automatizacionId).not.toBeNull();
    expect(r.confianza).toBe('ninguna');
    expect(r.nota).toContain('Reatribuir');
  });

  it('devuelve sin_atribuir cuando el payload no trae ninguna señal', async () => {
    const r = await resolverAtribucion(cuentaId, {});
    expect(r.metodo).toBe('sin_atribuir');
    expect(r.confianza).toBe('ninguna');
    expect(r.contenidoId).toBeNull();
  });

  it('el ig_media_id manda sobre la palabra clave cuando se contradicen', async () => {
    const porMedia = await crearContenido(cuentaId, { titulo: 'Gana este', igMediaId: 'media_G' });
    const porPalabra = await crearContenido(cuentaId, { titulo: 'Pierde este', igMediaId: 'media_P' });
    await crearAutomatizacion(cuentaId, { palabra: 'CONFLICTO', contenidoId: porPalabra!.id });

    const r = await resolverAtribucion(cuentaId, {
      igMediaId: 'media_G', palabraClave: 'CONFLICTO',
    });

    expect(r.contenidoId).toBe(porMedia!.id);
    expect(r.metodo).toBe('ig_media_id');
  });
});

describe('reatribuir', () => {
  it('recupera leads antiguos al enlazar una automatización a un reel', async () => {
    const { cuenta } = await cuentaDePrueba('Reatribuir');
    const cId = cuenta.id;

    // Entra un lead por una palabra clave que aún no está enlazada a nada
    const auto = await crearAutomatizacion(cId, { palabra: 'HUERFANA', contenidoId: null });
    const res = await registrarEvento({
      cuentaId: cId,
      tipo: 'lead_creado',
      identidad: { igUsername: 'perdido.en.el.limbo' },
      senales: { palabraClave: 'HUERFANA' },
      sinReglas: true,
    });

    expect(res.atribucion.contenidoId).toBeNull();
    let lead = await leadPorId(res.leadId);
    expect(lead!.primer_contenido_id).toBeNull();

    // El usuario enlaza la automatización con su reel y pulsa "Reatribuir"
    const contenido = await crearContenido(cId, { titulo: 'El reel olvidado', igMediaId: 'media_R' });
    await queryOne(`UPDATE automatizaciones SET contenido_id = $2 WHERE id = $1`,
      [auto!.id, contenido!.id]);

    const resultado = await reatribuir(cId);

    expect(resultado.toques).toBeGreaterThan(0);
    lead = await leadPorId(res.leadId);
    expect(lead!.primer_contenido_id).toBe(contenido!.id);

    // Y también se propaga a la oportunidad, que es lo que mide la analítica
    const opp = await queryOne(`SELECT * FROM oportunidades WHERE lead_id = $1`, [res.leadId]);
    expect(opp!.contenido_id).toBe(contenido!.id);
  });
});
