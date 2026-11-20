import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db/pool.js';
import { leadsEstancados } from '../modules/analitica.js';

// Rutas propias de la zona "panel" (mejoras de UX). Montadas en /api/ux/panel.
// Requieren sesión (cuelgan de /api). Usar req.sesion.cuentaId en TODAS las
// consultas: nada de datos de otra cuenta.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Redondea "para arriba" a un número lindo para un objetivo (47 → 50, 1.234 → 1.250). */
export function numeroRedondo(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  const paso = v < 20 ? 1 : v < 100 ? 5 : v < 1_000 ? 10 : v < 10_000 ? 50 : v < 100_000 ? 500 : 5_000;
  return Math.ceil(v / paso) * paso;
}

export default async function rutasUx_panel(app: FastifyInstance) {
  /**
   * Estado de la cuenta para el Panel: ¿es nueva? (primeros pasos), ¿está
   * conectado Instagram?, ¿tiene objetivo este mes? y un objetivo sugerido
   * (lo del mes pasado + 10 %) para precargar el formulario.
   */
  app.get('/estado', async (req) => {
    const c = req.sesion.cuentaId;
    const [r, mp] = await Promise.all([
      queryOne(
        `SELECT
           (SELECT COUNT(*) FROM leads WHERE cuenta_id = $1) AS leads,
           EXISTS (SELECT 1 FROM integraciones
                    WHERE cuenta_id = $1 AND tipo = 'instagram' AND activo AND estado = 'conectado'
                      AND (credenciales ? 'access_token' OR credenciales ? 'page_token' OR credenciales ? 'user_token')) AS instagram,
           (SELECT COUNT(*) FROM flujos WHERE cuenta_id = $1)
             + (SELECT COUNT(*) FROM automatizaciones WHERE cuenta_id = $1) AS automensajes,
           (SELECT COUNT(*) FROM productos WHERE cuenta_id = $1 AND activo) AS cursos,
           (SELECT COUNT(*) FROM productos
             WHERE cuenta_id = $1 AND activo AND NULLIF(trim(COALESCE(link_pago, '')), '') IS NOT NULL) AS cursos_con_link,
           EXISTS (SELECT 1 FROM metas WHERE cuenta_id = $1 AND mes = date_trunc('month', now())::date) AS objetivo`,
        [c]),
      queryOne(
        `WITH mes AS (
           SELECT date_trunc('month', now()) - interval '1 month' AS ini, date_trunc('month', now()) AS fin
         )
         SELECT
           (SELECT COUNT(*) FROM leads l, mes
             WHERE l.cuenta_id = $1 AND l.primer_contacto_en >= mes.ini AND l.primer_contacto_en < mes.fin) AS leads,
           (SELECT COUNT(*) FROM leads l, mes
             WHERE l.cuenta_id = $1 AND l.primer_contacto_en >= mes.ini AND l.primer_contacto_en < mes.fin
               AND l.calificacion = 'calificado') AS calificados,
           (SELECT COUNT(*) FROM eventos e, mes
             WHERE e.cuenta_id = $1 AND e.tipo = 'venta' AND e.ocurrido_en >= mes.ini AND e.ocurrido_en < mes.fin) AS ventas,
           (SELECT COALESCE(SUM(e.valor), 0) FROM eventos e, mes
             WHERE e.cuenta_id = $1 AND e.tipo = 'venta' AND e.ocurrido_en >= mes.ini AND e.ocurrido_en < mes.fin) AS ingresos`,
        [c]),
    ]);
    const n = (v: unknown) => Number(v ?? 0);
    const mesPasado = { leads: n(mp?.leads), calificados: n(mp?.calificados), ventas: n(mp?.ventas), ingresos: n(mp?.ingresos) };
    return {
      leads_total: n(r?.leads),
      instagram_conectado: Boolean(r?.instagram),
      automensajes: n(r?.automensajes),
      cursos: n(r?.cursos),
      cursos_con_link: n(r?.cursos_con_link),
      objetivo_mes: Boolean(r?.objetivo),
      mes_pasado: mesPasado,
      sugerido: {
        leads: numeroRedondo(mesPasado.leads * 1.1),
        calificados: numeroRedondo(mesPasado.calificados * 1.1),
        ventas: numeroRedondo(mesPasado.ventas * 1.1),
        ingresos: numeroRedondo(mesPasado.ingresos * 1.1),
      },
    };
  });

  /**
   * Leads quietos (sin movimiento ni mensajes hace más de `dias`): los que
   * todavía se pueden salvar primero, con el conteo por etapa (para los
   * chips) y las etapas de cada pipeline (para "Mover a…" y "Perdido").
   * mios=1: solo los que atiende quien pregunta.
   */
  app.get('/quietos', async (req) => {
    const c = req.sesion.cuentaId;
    const q = z.object({
      dias: z.coerce.number().int().min(1).max(365).default(7),
      limite: z.coerce.number().int().min(1).max(100).default(30),
      etapa_id: z.string().regex(UUID).optional(),
      mios: z.enum(['0', '1']).optional(),
    }).parse(req.query);
    const yo = q.mios === '1' && UUID.test(req.sesion.usuarioId) ? req.sesion.usuarioId : null;
    const r = await leadsEstancados(c, q.dias, q.limite, { etapaId: q.etapa_id ?? null, propietarioId: yo });

    const pipelineIds = [...new Set(r.por_etapa.map((e) => e.pipeline_id))];
    const etapas = pipelineIds.length
      ? await query(
        `SELECT id, nombre, tipo, orden, pipeline_id FROM etapas
          WHERE cuenta_id = $1 AND pipeline_id = ANY($2::uuid[]) ORDER BY pipeline_id, orden`,
        [c, pipelineIds])
      : [];
    const etapasPorPipeline: Record<string, any[]> = {};
    for (const e of etapas) (etapasPorPipeline[e.pipeline_id] ??= []).push({ id: e.id, nombre: e.nombre, tipo: e.tipo, orden: e.orden });
    return { ...r, etapas_por_pipeline: etapasPorPipeline };
  });
}
