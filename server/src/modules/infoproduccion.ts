import { pool, query, queryOne } from '../db/pool.js';
import type { Ejecutor } from './atribucion.js';

// =====================================================================
// Ángulos y embudo (método de captación orgánica por Instagram)
// =====================================================================

export const ANGULOS = [
  'video_abierto', 'problema', 'solucion', 'producto', 'mentalidad', 'narrativa', 'otro',
] as const;
export type Angulo = (typeof ANGULOS)[number];

/** Cada ángulo tiene una posición fija en el embudo. */
const ANGULO_A_EMBUDO: Record<string, string> = {
  video_abierto: 'TOFU',   // alcance masivo, público frío
  problema: 'MOFU',        // filtro, da el QUÉ y retiene el CÓMO
  solucion: 'MOFU',        // autoridad técnica, enseña el CÓMO
  producto: 'BOFU',        // prueba social, caso de éxito
  mentalidad: 'transversal',
  narrativa: 'transversal',
  otro: 'transversal',
};

export function etapaEmbudoDe(angulo: string | null | undefined): string | null {
  if (!angulo) return null;
  return ANGULO_A_EMBUDO[angulo] ?? 'transversal';
}

export const ETIQUETA_ANGULO: Record<string, string> = {
  video_abierto: 'Vídeo abierto (TOFU)',
  problema: 'Problema (MOFU)',
  solucion: 'Solución (MOFU)',
  producto: 'Producto / caso (BOFU)',
  mentalidad: 'Mentalidad',
  narrativa: 'Narrativa de autoridad',
  otro: 'Otro',
};

// =====================================================================
// Grado del lead (sistema "DSBA" del vídeo)
// =====================================================================
// Tres criterios → grado por cuántos se cumplen. A (perfecto), B (apto),
// S (aún no), D (malísimo). Es el juicio EXPLÍCITO del setter, distinto del
// score conductual que se calcula solo.

export function gradoDe(c1: boolean, c2: boolean, c3: boolean): string {
  const n = [c1, c2, c3].filter(Boolean).length;
  return ['D', 'S', 'B', 'A'][n];
}

export const GRADOS = ['A', 'B', 'S', 'D'] as const;

// =====================================================================
// Score del lead (filtro antipodridos, transparente 0-100)
// =====================================================================
// La idea del método: el recurso gratis atrae a muchos, pero solo unos
// pocos "levantan la mano". El score separa al lead que avanza del
// cazador de freebies, y es AUDITABLE: cada punto viene con su motivo.

interface Aporte { motivo: string; puntos: number }

const PESOS = {
  email: 8,
  telefono: 6,
  respondio_dm: 14,
  califico_parcial: 8,   // dio 1-2 datos de calificación
  califico_completo: 18, // dio modelo de negocio + ingresos + cuello de botella
  reunion_agendada: 20,
  reunion_realizada: 15,
  venta: 25,
  // por el ángulo del contenido de origen: cuanto más abajo en el embudo,
  // más intención trae el lead
  origen_BOFU: 12,
  origen_solucion: 10,
  origen_MOFU: 6,
  origen_transversal: 4,
  origen_TOFU: 2,
};

/**
 * Recalcula el score de un lead desde sus datos, sus eventos y el ángulo
 * del contenido que lo trajo. Devuelve el total (cap 0-100) y el desglose.
 * Se llama tras cada evento del lead.
 */
export async function recomputarScore(
  leadId: string,
  db: Ejecutor = pool,
): Promise<{ score: number; detalle: Aporte[]; calificacion: string } | null> {
  const { rows } = await db.query(
    `SELECT l.id, l.cuenta_id, l.email, l.telefono,
            l.modelo_negocio, l.ingresos_aprox, l.cuello_botella,
            l.calificacion,
            c.angulo, c.etapa_embudo,
            EXISTS (SELECT 1 FROM eventos e WHERE e.lead_id = l.id AND e.tipo='respondio_dm') AS respondio,
            EXISTS (SELECT 1 FROM eventos e WHERE e.lead_id = l.id AND e.tipo='reunion_agendada') AS agendo,
            EXISTS (SELECT 1 FROM eventos e WHERE e.lead_id = l.id AND e.tipo='reunion_realizada') AS asistio,
            EXISTS (SELECT 1 FROM eventos e WHERE e.lead_id = l.id AND e.tipo='venta') AS compro
       FROM leads l
       LEFT JOIN contenidos c ON c.id = l.primer_contenido_id
      WHERE l.id = $1`,
    [leadId],
  );
  const l = rows[0];
  if (!l) return null;

  const detalle: Aporte[] = [];
  const add = (motivo: string, puntos: number) => { if (puntos) detalle.push({ motivo, puntos }); };

  if (l.email) add('Dejó email', PESOS.email);
  if (l.telefono) add('Dejó teléfono', PESOS.telefono);
  if (l.respondio) add('Respondió por DM', PESOS.respondio_dm);

  const datosCalif = [l.modelo_negocio, l.ingresos_aprox, l.cuello_botella].filter(Boolean).length;
  if (datosCalif >= 3) add('Calificación completa (negocio + ingresos + cuello de botella)', PESOS.califico_completo);
  else if (datosCalif >= 1) add('Calificación parcial', PESOS.califico_parcial);

  if (l.agendo) add('Agendó reunión', PESOS.reunion_agendada);
  if (l.asistio) add('Asistió a la reunión', PESOS.reunion_realizada);
  if (l.compro) add('Compró', PESOS.venta);

  // Intención según el ángulo de origen
  if (l.etapa_embudo === 'BOFU') add('Vino de contenido BOFU (alta intención)', PESOS.origen_BOFU);
  else if (l.angulo === 'solucion') add('Vino de contenido de solución', PESOS.origen_solucion);
  else if (l.etapa_embudo === 'MOFU') add('Vino de contenido MOFU', PESOS.origen_MOFU);
  else if (l.etapa_embudo === 'TOFU') add('Vino de contenido TOFU (frío)', PESOS.origen_TOFU);
  else if (l.etapa_embudo === 'transversal') add('Vino de contenido transversal', PESOS.origen_transversal);

  const bruto = detalle.reduce((a, d) => a + d.puntos, 0);
  const score = Math.max(0, Math.min(100, bruto));

  // Auto-calificación: solo promueve desde "sin_calificar"; nunca pisa una
  // decisión humana (calificado / no_calificado puestos a mano).
  let calificacion = l.calificacion as string;
  if (calificacion === 'sin_calificar' && score >= 45) calificacion = 'calificado';

  await db.query(
    `UPDATE leads SET score = $2, score_detalle = $3::jsonb, calificacion = $4 WHERE id = $1`,
    [leadId, score, JSON.stringify(detalle), calificacion],
  );

  return { score, detalle, calificacion };
}

// =====================================================================
// Roles de contenido (cartera, no ranking)
// =====================================================================
// Un reel que trae 400 leads y 0 ventas no es "malo": es un PROSPECTOR,
// compra la atención que otro contenido convierte. Juzgar todo con el
// mismo KPI (ventas) vacía la estrategia de contenido. Cada rol se mide
// con SU métrica. Los umbrales son heurísticas accionables, no una prueba
// estadística — adaptados del sistema de roles de Meta Ads a señales
// orgánicas (share de leads y tasa lead→venta).

export interface FilaRol {
  id: string | null;
  leads: number;
  ventas: number;
  tasa_lead_venta: number;
  share_leads: number;
  rol: string;
  metrica_veredicto: string;
}

const MIN_LEADS_DATOS = 10; // por debajo no se juzga

export function clasificarRoles<T extends {
  id: string | null; leads: number; ventas: number; tasa_lead_venta: number; rol_manual?: string | null;
}>(
  contenidos: T[],
): Array<T & { rol: string; share_leads: number; metrica_veredicto: string }> {
  // La fila sintética "Sin atribuir" (id null) NO cuenta para el denominador
  // del share ni para la mediana: distorsionaría el rol de todo lo real.
  const reales = contenidos.filter((c) => c.id);
  const totalLeads = reales.reduce((a, c) => a + Number(c.leads ?? 0), 0) || 1;

  // Mediana de conversión entre los reales con datos suficientes
  const convs = reales
    .filter((c) => Number(c.leads) >= MIN_LEADS_DATOS)
    .map((c) => Number(c.tasa_lead_venta ?? 0))
    .sort((a, b) => a - b);
  const medianaConv = convs.length ? convs[Math.floor(convs.length / 2)] : 0;

  return contenidos.map((c) => {
    const leads = Number(c.leads ?? 0);
    const conv = Number(c.tasa_lead_venta ?? 0);
    const share = c.id ? leads / totalLeads : 0;

    let rol: string;
    let metrica: string;

    if (!c.id) {
      rol = 'sin_atribuir';
      metrica = 'Leads sin contenido de origen';
    } else if (c.rol_manual) {
      // Override humano: manda sobre el cálculo automático.
      rol = c.rol_manual;
      metrica = 'Rol fijado a mano';
    } else if (leads < MIN_LEADS_DATOS) {
      rol = 'explorador';
      metrica = `Todavía pocos leads (${leads}); déjalo correr`;
    } else if (conv > 0 && conv >= medianaConv && share >= 0.15) {
      // Caballo exige conversión real (>0); si la mediana es 0, no cuela.
      rol = 'caballo';
      metrica = 'Sostiene la cuenta: vigila su share de leads y su conversión';
    } else if (conv > 0 && conv >= Math.max(medianaConv * 1.3, 1)) {
      rol = 'closer';
      metrica = 'Convierte muy bien: dale más alcance (reciclarlo, anclarlo)';
    } else if (conv <= medianaConv * 0.5 && share >= 0.12) {
      rol = 'prospector';
      metrica = 'Trae volumen barato: júzgalo por alcance y leads, NO por ventas';
    } else if (conv <= medianaConv * 0.5) {
      rol = 'lastre';
      metrica = 'Ni volumen ni conversión: candidato a dejar de priorizar';
    } else {
      rol = 'estable';
      metrica = 'Rinde en la media del resto';
    }

    return { ...c, rol, share_leads: Math.round(share * 1000) / 10, metrica_veredicto: metrica };
  });
}

export const ETIQUETA_ROL: Record<string, string> = {
  caballo: 'Caballo de batalla',
  closer: 'Closer',
  prospector: 'Prospector',
  calificador: 'Calificador',
  abridor: 'Abridor',
  lastre: 'Lastre',
  explorador: 'Explorador',
  estable: 'Estable',
  sin_atribuir: 'Sin atribuir',
};

// =====================================================================
// Analítica por ángulo y por etapa de embudo
// =====================================================================

function pct(a: number, b: number) {
  return b > 0 ? Math.round((a / b) * 1000) / 10 : 0;
}

/** De qué ÁNGULO (no solo de qué reel) viene cada lead, reunión y venta. */
export async function rendimientoPorAngulo(
  cuentaId: string,
  f: { desde?: string | null; hasta?: string | null } = {},
) {
  // Las reuniones (en oportunidades) y las ventas (en eventos) se cuentan en
  // CTEs separadas y luego se unen por ángulo. Si se juntaran en un mismo
  // JOIN, un lead con dos oportunidades multiplicaría sus ventas.
  const filas = await query(
    `WITH base AS (
       SELECT l.id AS lead_id,
              COALESCE(c.angulo, 'sin_clasificar') AS angulo,
              c.etapa_embudo
         FROM leads l
         LEFT JOIN contenidos c ON c.id = l.primer_contenido_id
        WHERE l.cuenta_id = $1
          AND ($2::timestamptz IS NULL OR l.primer_contacto_en >= $2::timestamptz)
          AND ($3::timestamptz IS NULL OR l.primer_contacto_en <  $3::timestamptz)
     ),
     lds AS (
       SELECT angulo, MAX(etapa_embudo) AS etapa_embudo, COUNT(DISTINCT lead_id) AS leads
         FROM base GROUP BY angulo
     ),
     reu AS (
       SELECT b.angulo, COUNT(DISTINCT o.id) AS reuniones
         FROM base b JOIN oportunidades o ON o.lead_id = b.lead_id
        WHERE o.reunion_agendada_en IS NOT NULL
        GROUP BY b.angulo
     ),
     vts AS (
       SELECT b.angulo, COUNT(e.id) AS ventas, COALESCE(SUM(e.valor), 0) AS ingresos
         FROM base b JOIN eventos e ON e.lead_id = b.lead_id AND e.tipo = 'venta'
        GROUP BY b.angulo
     )
     SELECT lds.angulo, lds.etapa_embudo, lds.leads,
            COALESCE(reu.reuniones, 0) AS reuniones,
            COALESCE(vts.ventas, 0)    AS ventas,
            COALESCE(vts.ingresos, 0)  AS ingresos
       FROM lds
       LEFT JOIN reu ON reu.angulo = lds.angulo
       LEFT JOIN vts ON vts.angulo = lds.angulo
      ORDER BY ingresos DESC, leads DESC`,
    [cuentaId, f.desde ?? null, f.hasta ?? null],
  );

  return filas.map((r: any) => ({
    angulo: r.angulo,
    etiqueta: ETIQUETA_ANGULO[r.angulo] ?? 'Sin clasificar',
    etapa_embudo: r.etapa_embudo,
    leads: Number(r.leads),
    reuniones: Number(r.reuniones),
    ventas: Number(r.ventas),
    ingresos: Number(r.ingresos),
    tasa_lead_venta: pct(Number(r.ventas), Number(r.leads)),
    valor_por_lead: Number(r.leads) > 0 ? Math.round((Number(r.ingresos) / Number(r.leads)) * 100) / 100 : 0,
  }));
}

/** Objetivo del mes y progreso real (leads, calificados, ventas, ingresos). */
export async function metasProgreso(cuentaId: string) {
  const [meta] = await query(
    `SELECT * FROM metas WHERE cuenta_id = $1 AND mes = date_trunc('month', now())::date`,
    [cuentaId]);

  const [real] = await query(
    `SELECT
       (SELECT COUNT(*) FROM leads l
          WHERE l.cuenta_id = $1 AND l.primer_contacto_en >= date_trunc('month', now())) AS leads,
       (SELECT COUNT(*) FROM leads l
          WHERE l.cuenta_id = $1 AND l.primer_contacto_en >= date_trunc('month', now())
            AND l.calificacion = 'calificado') AS calificados,
       (SELECT COUNT(*) FROM eventos e
          WHERE e.cuenta_id = $1 AND e.tipo = 'venta' AND e.ocurrido_en >= date_trunc('month', now())) AS ventas,
       (SELECT COALESCE(SUM(e.valor),0) FROM eventos e
          WHERE e.cuenta_id = $1 AND e.tipo = 'venta' AND e.ocurrido_en >= date_trunc('month', now())) AS ingresos`,
    [cuentaId]);

  const n = (v: any) => Number(v ?? 0);
  const pct = (a: number, b: number) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);
  const real_ = {
    leads: n(real?.leads), calificados: n(real?.calificados),
    ventas: n(real?.ventas), ingresos: n(real?.ingresos),
  };
  const objetivo = meta
    ? { leads: n(meta.leads_meta), calificados: n(meta.calificados_meta),
        ventas: n(meta.ventas_meta), ingresos: n(meta.ingresos_meta) }
    : null;

  return {
    tiene_meta: Boolean(meta),
    objetivo,
    real: real_,
    progreso: objetivo ? {
      leads: pct(real_.leads, objetivo.leads),
      calificados: pct(real_.calificados, objetivo.calificados),
      ventas: pct(real_.ventas, objetivo.ventas),
      ingresos: pct(real_.ingresos, objetivo.ingresos),
    } : null,
  };
}

/** Mezcla de contenido 70-20-10 y madurez de la muestra. */
export async function mezclaContenido(cuentaId: string) {
  // La ventana de muestra se mide sobre el contenido CLASIFICADO (el que
  // cuenta para la regla 70-20-10), no sobre todo. MIN/MAX ignoran los NULL.
  const [r] = await query(
    `SELECT
       COUNT(*) FILTER (WHERE angulo IS NOT NULL)                       AS clasificados,
       COUNT(*)                                                         AS total,
       MIN(publicado_en) FILTER (WHERE angulo IS NOT NULL)              AS desde,
       MAX(publicado_en) FILTER (WHERE angulo IS NOT NULL)              AS hasta
       FROM contenidos WHERE cuenta_id = $1 AND activo`,
    [cuentaId],
  );
  const dias = r?.desde && r?.hasta
    ? Math.round((new Date(r.hasta).getTime() - new Date(r.desde).getTime()) / 86_400_000)
    : 0;
  return {
    clasificados: Number(r?.clasificados ?? 0),
    total: Number(r?.total ?? 0),
    dias_muestra: dias,
    muestra_suficiente: dias >= 90, // la regla 70-20-10 pide ≥3 meses
    aviso: dias < 90
      ? 'Muestra menor de 3 meses: no tomes decisiones de contenido definitivas todavía (regla 70-20-10).'
      : null,
  };
}
