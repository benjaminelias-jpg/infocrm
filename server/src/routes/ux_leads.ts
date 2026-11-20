import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db/pool.js';

// Rutas propias de la zona "leads" (mejoras de UX). Montadas en /api/ux/leads.
// Requieren sesión (cuelgan de /api). Usar req.sesion.cuentaId en TODAS las
// consultas: nada de datos de otra cuenta.

/**
 * Temperatura del lead según su puntaje (0-100). Es la única señal de
 * calidad que se ve en la lista, la tarjeta y la ficha.
 */
export const TEMPERATURAS = {
  frio: { min: 0, max: 24 },
  tibio: { min: 25, max: 44 },
  caliente: { min: 45, max: 69 },
  listo: { min: 70, max: 100000 },
} as const;

const ORDENES: Record<string, string> = {
  // Lo que se movió hace poco, arriba (como el tablero).
  reciente: 'b.ultima_actividad DESC, b.id',
  interes: 'b.score DESC, b.ultima_actividad DESC, b.id',
  valor: 'b.valor_total DESC, b.ultima_actividad DESC, b.id',
  nuevos: 'b.primer_contacto_en DESC, b.id',
  antiguos: 'b.primer_contacto_en ASC, b.id',
};

const esquemaLista = z.object({
  q: z.string().trim().max(120).optional(),
  /** Atajos de la fila de chips. */
  vista: z.enum(['todos', 'mios', 'sin_asignar', 'sin_leer', 'sin_atribuir']).default('todos'),
  etiqueta: z.string().trim().max(60).optional(),
  etapa_id: z.string().uuid().optional(),
  pipeline_id: z.string().uuid().optional(),
  contenido_id: z.string().uuid().optional(),
  responsable_id: z.string().uuid().optional(),
  calificacion: z.enum(['calificado', 'sin_calificar', 'no_calificado']).optional(),
  temperatura: z.enum(['frio', 'tibio', 'caliente', 'listo']).optional(),
  /** Entró hace como mucho N días. */
  dias: z.coerce.number().int().min(1).max(3650).optional(),
  orden: z.enum(['reciente', 'interes', 'valor', 'nuevos', 'antiguos']).default('reciente'),
  limite: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

/**
 * Cada lead con su oportunidad principal (la abierta más nueva; si no hay,
 * la última), quién lo atiende (el de la oportunidad o, si no, el del lead)
 * y su última actividad (contacto o mensaje).
 */
const BASE = `
  SELECT l.id, l.nombre, l.apellido, l.ig_username, l.email, l.telefono, l.pais, l.avatar_url,
         l.etiquetas, l.score, l.calificacion, l.valor_total, l.primer_contacto_en,
         l.mensajes_sin_leer, l.primer_contenido_id AS contenido_id, l.primer_automatizacion_id,
         GREATEST(l.ultimo_contacto_en, COALESCE(l.ultimo_mensaje_en, l.ultimo_contacto_en)) AS ultima_actividad,
         o.id AS oportunidad_id, o.etapa_id, o.pipeline_id, o.estado AS oportunidad_estado,
         COALESCE(o.propietario_id, l.propietario_id) AS propietario_id
    FROM leads l
    LEFT JOIN LATERAL (
      SELECT o2.id, o2.etapa_id, o2.pipeline_id, o2.estado, o2.propietario_id
        FROM oportunidades o2
       WHERE o2.lead_id = l.id
       ORDER BY (o2.estado = 'abierta') DESC, o2.abierta_en DESC
       LIMIT 1
    ) o ON true
   WHERE l.cuenta_id = $1`;

export default async function rutasUx_leads(app: FastifyInstance) {
  /**
   * Lista de leads con los filtros que pide la pantalla (además de los de
   * GET /leads): "Míos", "Sin asignar", "Sin leer", temperatura, días desde
   * que entró y orden por interés. Trae los conteos de los atajos y, si se
   * filtra por contenido, su título (para el chip "Vino de: …").
   */
  app.get('/lista', async (req) => {
    const crudo = Object.fromEntries(
      Object.entries((req.query ?? {}) as Record<string, string>).filter(([, v]) => v !== '' && v !== undefined),
    );
    const f = esquemaLista.parse(crudo);
    const cuentaId = req.sesion.cuentaId;
    const yo = req.sesion.usuarioId && req.sesion.usuarioId !== 'api-key' ? req.sesion.usuarioId : null;

    const params: any[] = [cuentaId];
    const cond: string[] = [];
    const add = (sql: string, valor: unknown) => {
      params.push(valor);
      cond.push(sql.replaceAll('$n', `$${params.length}`));
    };

    if (f.q) {
      const texto = f.q.replace(/^@+/, '').trim();
      if (texto) {
        add(`(b.ig_username ILIKE '%'||$n||'%' OR b.nombre ILIKE '%'||$n||'%' OR b.apellido ILIKE '%'||$n||'%'
              OR (COALESCE(b.nombre,'')||' '||COALESCE(b.apellido,'')) ILIKE '%'||$n||'%'
              OR b.email ILIKE '%'||$n||'%' OR b.telefono ILIKE '%'||$n||'%')`, texto);
      }
    }
    if (f.vista === 'mios') {
      if (yo) add('b.propietario_id = $n::uuid', yo);
      else cond.push('false');
    }
    if (f.vista === 'sin_asignar') cond.push('b.propietario_id IS NULL');
    if (f.vista === 'sin_leer') cond.push('b.mensajes_sin_leer > 0');
    if (f.vista === 'sin_atribuir') cond.push('b.contenido_id IS NULL');
    if (f.etiqueta) add('$n = ANY(b.etiquetas)', f.etiqueta);
    if (f.etapa_id) add('b.etapa_id = $n::uuid', f.etapa_id);
    if (f.pipeline_id) add('b.pipeline_id = $n::uuid', f.pipeline_id);
    if (f.contenido_id) add('b.contenido_id = $n::uuid', f.contenido_id);
    if (f.responsable_id) add('b.propietario_id = $n::uuid', f.responsable_id);
    if (f.calificacion) add('b.calificacion = $n', f.calificacion);
    if (f.temperatura) {
      const t = TEMPERATURAS[f.temperatura];
      add('b.score >= $n', t.min);
      add('b.score <= $n', t.max);
    }
    if (f.dias) add(`b.primer_contacto_en >= now() - ($n::int * interval '1 day')`, f.dias);

    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const nFiltros = params.length;
    const pLimite = `$${nFiltros + 1}`;
    const pOffset = `$${nFiltros + 2}`;

    const [leads, conteo, conteos, contenido] = await Promise.all([
      query(
        `WITH b AS (${BASE})
         SELECT b.*, e.nombre AS etapa_nombre, e.color AS etapa_color, e.tipo AS etapa_tipo,
                u.nombre AS propietario_nombre,
                c.titulo AS contenido_titulo, c.thumbnail_url AS contenido_thumbnail,
                c.tipo AS contenido_tipo, c.permalink AS contenido_permalink,
                a.palabra_clave
           FROM b
           LEFT JOIN etapas e ON e.id = b.etapa_id
           LEFT JOIN usuarios u ON u.id = b.propietario_id
           LEFT JOIN contenidos c ON c.id = b.contenido_id
           LEFT JOIN automatizaciones a ON a.id = b.primer_automatizacion_id
           ${where}
          ORDER BY ${ORDENES[f.orden]}
          LIMIT ${pLimite} OFFSET ${pOffset}`,
        [...params, f.limite, f.offset],
      ),
      queryOne<{ total: number }>(`WITH b AS (${BASE}) SELECT COUNT(*)::int AS total FROM b ${where}`, params),
      // Los atajos cuentan sobre TODOS los leads (no cambian al buscar).
      queryOne(
        `WITH b AS (${BASE})
         SELECT COUNT(*)::int AS todos,
                COUNT(*) FILTER (WHERE $2::uuid IS NOT NULL AND b.propietario_id = $2::uuid)::int AS mios,
                COUNT(*) FILTER (WHERE b.propietario_id IS NULL)::int AS sin_asignar,
                COUNT(*) FILTER (WHERE b.mensajes_sin_leer > 0)::int AS sin_leer,
                COUNT(*) FILTER (WHERE b.contenido_id IS NULL)::int AS sin_atribuir
           FROM b`,
        [cuentaId, yo],
      ),
      f.contenido_id
        ? queryOne(`SELECT id, titulo, tipo, permalink, thumbnail_url FROM contenidos WHERE cuenta_id = $1 AND id = $2`,
          [cuentaId, f.contenido_id])
        : Promise.resolve(null),
    ]);

    return {
      leads: leads.map(({ primer_automatizacion_id: _a, ...l }: any) => l),
      total: conteo?.total ?? 0,
      limite: f.limite,
      offset: f.offset,
      conteos,
      contenido,
    };
  });
}
