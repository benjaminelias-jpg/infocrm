import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { closePool, query, queryOne } from '../src/db/pool.js';
import { revisarComentarios } from '../src/modules/instagram_comentarios.js';
import { cuentaDePrueba } from './ayuda.js';

let cuentaId = '';
beforeAll(async () => {
  cuentaId = (await cuentaDePrueba('Comentarios')).cuenta.id;
  const cred = JSON.stringify({ tipo_login: 'facebook', page_token: 'tok', ig_user_id: '999' });
  const ya = await queryOne(`SELECT id FROM integraciones WHERE cuenta_id = $1 AND tipo = 'instagram'`, [cuentaId]);
  if (ya) await query(`UPDATE integraciones SET estado = 'conectado', activo = true, credenciales = $2::jsonb WHERE id = $1`, [ya.id, cred]);
  else await query(`INSERT INTO integraciones (cuenta_id, tipo, nombre, estado, activo, credenciales, config) VALUES ($1, 'instagram', 'Instagram', 'conectado', true, $2::jsonb, '{}'::jsonb)`, [cuentaId, cred]);
  await query(
    `INSERT INTO flujos (cuenta_id, nombre, disparo, palabra_clave, activo, pasos)
     VALUES ($1, 'Todos los comentarios', 'comentario', NULL, true, $2::jsonb)`,
    [cuentaId, JSON.stringify([{ id: 'inicio', tipo: 'inicio', siguiente: 'm' }, { id: 'm', tipo: 'enviar_dm', texto: 'Hola!', siguiente: null }])]);
  // Que mandar el DM no salga a internet.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ id: 'ok', message_id: 'm1' }), { status: 200 }));
});
afterAll(async () => { vi.restoreAllMocks(); await closePool(); });

describe('comentarios a buscar (sin avisos de Meta)', () => {
  it('procesa un comentario nuevo una sola vez y dispara el automensaje', async () => {
    const ahora = new Date().toISOString();
    const fetcher: any = async () => ({ ok: true, json: async () => ({ data: [{ id: 'media1', comments: { data: [
      { id: 'c1', text: 'me interesa', timestamp: ahora, from: { id: '555', username: 'benjalegree' } },
      { id: 'c0', text: 'viejo', timestamp: '2020-01-01T00:00:00Z', from: { id: '556', username: 'viejo' } },
      { id: 'c2', text: 'yo respondo', timestamp: ahora, from: { id: '999', username: 'yo' } },
    ] } }] }) });
    const r = await revisarComentarios(cuentaId, fetcher);
    expect(r.mensaje ?? '').toBe(''); expect(r.ok).toBe(true);
    expect(r.nuevos).toBe(1);
    const lead = await queryOne(`SELECT id FROM leads WHERE cuenta_id = $1 AND ig_username = 'benjalegree'`, [cuentaId]);
    expect(lead).toBeTruthy();
    expect(await queryOne(`SELECT id FROM leads WHERE cuenta_id = $1 AND ig_username = 'viejo'`, [cuentaId])).toBeNull();
    const ej = await queryOne(`SELECT COUNT(*)::int AS n FROM flujo_ejecuciones WHERE cuenta_id = $1`, [cuentaId]);
    expect(ej.n).toBe(1);
    const otra = await revisarComentarios(cuentaId, fetcher);
    expect(otra.nuevos).toBe(0);
  });
});

describe('DMs a buscar (sin avisos de Meta)', () => {
  it('un DM nuevo dispara su automensaje una sola vez', async () => {
    const { importarConversaciones } = await import('../src/modules/instagram_chats.js');
    await query(
      `INSERT INTO flujos (cuenta_id, nombre, disparo, palabra_clave, activo, pasos)
       VALUES ($1, 'Info por DM', 'dm', 'info', true, $2::jsonb)`,
      [cuentaId, JSON.stringify([{ id: 'inicio', tipo: 'inicio', siguiente: 'm' }, { id: 'm', tipo: 'enviar_dm', texto: 'Te paso la info', siguiente: null }])]);
    // Le quedó una publicación elegida de cuando era «por comentario»: en DM no debe importar.
    const cont = await queryOne(`INSERT INTO contenidos (cuenta_id, ig_media_id, titulo) VALUES ($1, 'media-x', 'Reel') RETURNING id`, [cuentaId]);
    await query(`UPDATE flujos SET contenido_id = $2 WHERE cuenta_id = $1 AND nombre = 'Info por DM'`, [cuentaId, cont.id]);
    const ahora = new Date().toISOString();
    vi.mocked(globalThis.fetch).mockImplementation(async (url: any) => {
      if (String(url).includes('/conversations')) {
        return new Response(JSON.stringify({ data: [{ id: 'conv1', updated_time: ahora, participants: { data: [{ id: '999' }, { id: '777', username: 'pepa.dm' }] },
          messages: { data: [{ id: 'mid-1', message: 'info', created_time: ahora, from: { id: '777' } }] } }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ message_id: 'out1', recipient_id: '777' }), { status: 200 });
    });
    await importarConversaciones(cuentaId, { limite: 10, maxPaginas: 1 });
    await importarConversaciones(cuentaId, { limite: 10, maxPaginas: 1 });
    const lead = await queryOne(`SELECT id FROM leads WHERE cuenta_id = $1 AND ig_user_id = '777'`, [cuentaId]);
    expect(lead).toBeTruthy();
    const ej = await queryOne(`SELECT COUNT(*)::int AS n FROM flujo_ejecuciones e JOIN flujos f ON f.id = e.flujo_id WHERE f.cuenta_id = $1 AND f.nombre = 'Info por DM'`, [cuentaId]);
    expect(ej.n).toBe(1);
    const sal = await queryOne(`SELECT cuerpo FROM mensajes WHERE lead_id = $1 AND direccion = 'saliente'`, [lead.id]);
    expect(sal?.cuerpo).toBe('Te paso la info');
  });
});

describe('palabra clave por DM', () => {
  it('si la vuelve a escribir, el automensaje corre de nuevo (no lo frena el anti-spam)', async () => {
    const { importarConversaciones } = await import('../src/modules/instagram_chats.js');
    const t = () => new Date().toISOString();
    let n = 0;
    vi.mocked(globalThis.fetch).mockImplementation(async (url: any) => {
      if (String(url).includes('/conversations')) {
        n++;
        return new Response(JSON.stringify({ data: [{ id: 'conv2', updated_time: t(), participants: { data: [{ id: '999' }, { id: '778', username: 'otra.dm' }] },
          messages: { data: [{ id: `mid-r${n}`, message: 'INFO', created_time: t(), from: { id: '778' } }] } }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ message_id: `o${Math.random()}`, recipient_id: '778' }), { status: 200 });
    });
    await importarConversaciones(cuentaId, { limite: 10, maxPaginas: 1 });
    await importarConversaciones(cuentaId, { limite: 10, maxPaginas: 1 });
    const lead = await queryOne(`SELECT id FROM leads WHERE cuenta_id = $1 AND ig_user_id = '778'`, [cuentaId]);
    const sal = await queryOne(`SELECT COUNT(*)::int AS n FROM mensajes WHERE lead_id = $1 AND direccion = 'saliente'`, [lead.id]);
    expect(sal.n).toBe(2);
  });
});

describe('contadores, puntos y etiquetas dinámicas', () => {
  it('cuenta recursos, compara, suma puntos y actualiza «Recursos: N»', async () => {
    const { ejecutarFlujo, contadoresLead } = await import('../src/modules/instagram_dm.js');
    const lead = (await queryOne(`INSERT INTO leads (cuenta_id, ig_username, ig_user_id, etiquetas) VALUES ($1, 'cuenta.recursos', 'ig_cr', ARRAY['Recursos: 4']) RETURNING id`, [cuentaId])).id;
    const rec = (await queryOne(`INSERT INTO recursos (cuenta_id, nombre, tipo) VALUES ($1, 'Guía', 'pdf') RETURNING id`, [cuentaId])).id;
    for (let i = 0; i < 5; i++) {
      await query(`INSERT INTO mensajes (cuenta_id, lead_id, direccion, canal, cuerpo, estado, recurso_id) VALUES ($1,$2,'saliente','instagram_dm','guía','enviado',$3)`, [cuentaId, lead, rec]);
    }
    expect((await contadoresLead(cuentaId, lead)).recursos).toBe(5);
    const f = (await queryOne(
      `INSERT INTO flujos (cuenta_id, nombre, disparo, palabra_clave, activo, pasos) VALUES ($1, 'Scoring', 'dm', 'scorex', true, $2::jsonb) RETURNING id`,
      [cuentaId, JSON.stringify([
        { id: 'inicio', tipo: 'inicio', siguiente: 'c' },
        { id: 'c', tipo: 'condicion', campo: 'contador', contador: 'recursos', operador: 'mayor_igual', valor: 5, siguiente_si: 'e', siguiente_no: null },
        { id: 'e', tipo: 'etiquetar', etiqueta: 'Recursos: {{contador.recursos}}', siguiente: 's' },
        { id: 's', tipo: 'sumar', campo: 'puntos', cantidad: 10, siguiente: 'c2' },
        { id: 'c2', tipo: 'condicion', campo: 'campo', campo_nombre: 'puntos', operador: 'mayor_igual', valor: 10, siguiente_si: 'z', siguiente_no: null },
        { id: 'z', tipo: 'etiquetar', etiqueta: 'solo gratis', siguiente: null },
      ])])).id;
    await ejecutarFlujo(cuentaId, f, { leadId: lead, sinInstagram: true });
    const l = await queryOne(`SELECT etiquetas, campos FROM leads WHERE id = $1`, [lead]);
    expect(l.etiquetas).toContain('Recursos: 5');
    expect(l.etiquetas).not.toContain('Recursos: 4');
    expect(l.etiquetas).toContain('solo gratis');
    expect(Number(l.campos.puntos)).toBe(10);
  });
});
