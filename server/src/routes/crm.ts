import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db/pool.js';
import { noEncontrado, peticionInvalida } from '../lib/errores.js';
import {
  listarLeads, obtenerLead, actualizarLead, crearNota, kanban, etiquetasUsadas,
} from '../modules/leads.js';
import { moverEtapa } from '../modules/pipeline.js';
import { registrarEvento } from '../modules/eventos.js';

const esquemaEvento = z.object({
  tipo: z.string().min(1),
  lead_id: z.string().uuid().optional(),
  identidad: z.object({
    manychatSubscriberId: z.string().optional(),
    igUserId: z.string().optional(),
    igUsername: z.string().optional(),
    email: z.string().optional(),
    telefono: z.string().optional(),
    nombre: z.string().optional(),
    apellido: z.string().optional(),
    pais: z.string().optional(),
  }).optional(),
  senales: z.object({
    contenidoId: z.string().uuid().optional(),
    igMediaId: z.string().optional(),
    palabraClave: z.string().optional(),
    campania: z.string().optional(),
    permalink: z.string().optional(),
  }).optional(),
  valor: z.number().optional(),
  moneda: z.string().optional(),
  titulo: z.string().optional(),
  ocurrido_en: z.string().optional(),
  idempotency_key: z.string().optional(),
});

export default async function rutasCrm(app: FastifyInstance) {
  // ---------------- Leads ----------------

  app.get('/leads', async (req) => {
    const q = req.query as Record<string, string>;
    return listarLeads(req.sesion.cuentaId, {
      q: q.q,
      etapaId: q.etapa_id,
      pipelineId: q.pipeline_id,
      contenidoId: q.contenido_id,
      automatizacionId: q.automatizacion_id,
      etiqueta: q.etiqueta,
      propietarioId: q.propietario_id,
      estado: q.estado,
      calificacion: q.calificacion,
      desde: q.desde,
      hasta: q.hasta,
      sinAtribuir: q.sin_atribuir === 'true',
      limite: q.limite ? Number(q.limite) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
      orden: q.orden as any,
    });
  });

  app.get('/leads/:id', async (req) => {
    const { id } = req.params as { id: string };
    return obtenerLead(req.sesion.cuentaId, id);
  });

  app.patch('/leads/:id', async (req) => {
    const { id } = req.params as { id: string };
    return actualizarLead(req.sesion.cuentaId, id, req.body as Record<string, any>);
  });

  app.post('/leads/:id/notas', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { cuerpo } = z.object({ cuerpo: z.string().min(1) }).parse(req.body);
    const nota = await crearNota(
      req.sesion.cuentaId, id,
      req.sesion.usuarioId === 'api-key' ? null : req.sesion.usuarioId,
      cuerpo,
    );
    return reply.code(201).send(nota);
  });

  /** Mover una oportunidad de etapa a mano (arrastrar en el kanban). */
  app.post('/oportunidades/:id/etapa', async (req) => {
    const { id } = req.params as { id: string };
    const { etapa_id } = z.object({ etapa_id: z.string().uuid() }).parse(req.body);

    const etapa = await queryOne(
      `SELECT * FROM etapas WHERE id = $1 AND cuenta_id = $2`, [etapa_id, req.sesion.cuentaId]);
    if (!etapa) throw noEncontrado('Etapa');

    const movimiento = await moverEtapa(req.sesion.cuentaId, id, etapa_id, undefined, {
      origen: 'manual',
      usuarioId: req.sesion.usuarioId === 'api-key' ? null : req.sesion.usuarioId,
    });

    return { movido: Boolean(movimiento), etapa };
  });

  app.get('/kanban', async (req) => {
    const q = req.query as Record<string, string>;
    return kanban(req.sesion.cuentaId, q.pipeline_id);
  });

  /** Paso del flujo de DM y seguimientos de una oportunidad (método Cubria). */
  app.patch('/oportunidades/:id', async (req) => {
    const { id } = req.params as { id: string };
    const d = z.object({
      dm_paso: z.enum(['apertura', 'calificacion', 'dolor', 'solucion', 'cierre', 'seguimiento'])
        .nullable().optional(),
      seguimientos: z.number().int().min(0).optional(),
      proximo_seguimiento_en: z.string().datetime({ offset: true }).nullable().optional(),
    }).parse(req.body);

    const campos = Object.keys(d);
    if (campos.length === 0) throw peticionInvalida('Nada que actualizar');
    const params: any[] = [req.sesion.cuentaId, id];
    const sets = campos.map((c) => {
      const v = (d as any)[c];
      params.push(c === 'proximo_seguimiento_en' && v ? new Date(v) : v);
      return `${c} = $${params.length}`;
    });
    const fila = await queryOne(
      `UPDATE oportunidades SET ${sets.join(', ')} WHERE cuenta_id = $1 AND id = $2 RETURNING *`,
      params);
    if (!fila) throw noEncontrado('Oportunidad');
    return fila;
  });

  app.get('/etiquetas', async (req) => etiquetasUsadas(req.sesion.cuentaId));

  // ---------------- Pipelines ----------------

  app.get('/pipelines', async (req) => {
    const pipelines = await query(
      `SELECT * FROM pipelines WHERE cuenta_id = $1 AND activo ORDER BY es_predeterminado DESC, orden ASC`,
      [req.sesion.cuentaId],
    );
    const etapas = await query(
      `SELECT * FROM etapas WHERE cuenta_id = $1 ORDER BY orden ASC`, [req.sesion.cuentaId]);
    return pipelines.map((p: any) => ({
      ...p,
      etapas: etapas.filter((e: any) => e.pipeline_id === p.id),
    }));
  });

  app.patch('/etapas/:id', async (req) => {
    const { id } = req.params as { id: string };
    const datos = z.object({
      nombre: z.string().optional(),
      color: z.string().optional(),
      orden: z.number().int().optional(),
      probabilidad: z.number().int().min(0).max(100).optional(),
      evento_asociado: z.string().nullable().optional(),
      marca_reunion: z.boolean().optional(),
      marca_venta: z.boolean().optional(),
    }).parse(req.body);

    const campos = Object.keys(datos);
    if (campos.length === 0) throw peticionInvalida('No hay nada que actualizar');

    const params: any[] = [req.sesion.cuentaId, id];
    const sets = campos.map((c) => {
      params.push((datos as any)[c]);
      return `${c} = $${params.length}`;
    });

    const fila = await queryOne(
      `UPDATE etapas SET ${sets.join(', ')} WHERE cuenta_id = $1 AND id = $2 RETURNING *`, params);
    if (!fila) throw noEncontrado('Etapa');
    return fila;
  });

  // ---------------- Eventos (API pública para integraciones propias) ----------------

  app.post('/eventos', async (req, reply) => {
    const d = esquemaEvento.parse(req.body);
    if (!d.lead_id && !d.identidad) {
      throw peticionInvalida('Hace falta lead_id o un objeto identidad para saber de quién es el evento');
    }
    const res = await registrarEvento({
      cuentaId: req.sesion.cuentaId,
      tipo: d.tipo,
      leadId: d.lead_id,
      identidad: d.identidad,
      senales: d.senales,
      valor: d.valor,
      moneda: d.moneda,
      titulo: d.titulo,
      fuente: 'api',
      ocurridoEn: d.ocurrido_en ? new Date(d.ocurrido_en) : undefined,
      idempotencyKey: d.idempotency_key,
    });
    return reply.code(res.duplicado ? 200 : 201).send(res);
  });

  app.get('/eventos', async (req) => {
    const q = req.query as Record<string, string>;
    return query(
      `SELECT e.id, e.tipo, e.valor, e.moneda, e.titulo, e.fuente, e.ocurrido_en,
              l.id AS lead_id, l.nombre AS lead_nombre, l.ig_username,
              c.titulo AS contenido_titulo
         FROM eventos e
         LEFT JOIN leads l ON l.id = e.lead_id
         LEFT JOIN contenidos c ON c.id = e.contenido_id
        WHERE e.cuenta_id = $1 AND ($2::text IS NULL OR e.tipo = $2)
        ORDER BY e.ocurrido_en DESC, e.id DESC
        LIMIT $3`,
      [req.sesion.cuentaId, q.tipo ?? null, Math.min(Number(q.limite ?? 100), 500)],
    );
  });

  app.get('/usuarios', async (req) =>
    query(
      `SELECT id, nombre, email, rol, activo, ultimo_acceso_en FROM usuarios
        WHERE cuenta_id = $1 ORDER BY creado_en ASC`,
      [req.sesion.cuentaId],
    ));
}
