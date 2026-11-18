import { pool } from '../db/pool.js';
import { limpiarUsername } from '../lib/utils.js';

export interface Ejecutor {
  query(text: string, params?: any[]): Promise<{ rows: any[] }>;
}

/** Todo lo que un payload puede traer para saber de dónde viene un lead. */
export interface SenalesAtribucion {
  contenidoId?: string;
  igMediaId?: string;
  permalink?: string;
  automatizacionId?: string;
  manychatFlowId?: string;
  palabraClave?: string;
  campania?: string;
}

export type MetodoAtribucion =
  | 'ig_media_id' | 'automatizacion' | 'palabra_clave'
  | 'campania' | 'manual' | 'sin_atribuir';

export type Confianza = 'alta' | 'media' | 'baja' | 'ninguna';

export interface ResultadoAtribucion {
  contenidoId: string | null;
  automatizacionId: string | null;
  metodo: MetodoAtribucion;
  confianza: Confianza;
  nota: string | null;
  candidatos: number;
}

const SIN_ATRIBUIR: ResultadoAtribucion = {
  contenidoId: null,
  automatizacionId: null,
  metodo: 'sin_atribuir',
  confianza: 'ninguna',
  nota: 'El payload no traía ninguna señal de origen (ni ig_media_id, ni palabra clave, ni campaña).',
  candidatos: 0,
};

/**
 * Resuelve de qué contenido viene un lead.
 *
 * Orden de prioridad, de más fiable a menos:
 *   1. contenido_id explícito              → alta
 *   2. ig_media_id del post comentado      → alta  (crea el contenido si no existe)
 *   3. id de automatización / flujo        → alta
 *   4. palabra clave con UNA automatización → alta
 *   5. palabra clave ambigua (varias)      → baja  (elige el contenido más reciente)
 *   6. campaña / utm                       → media
 *   7. nada                                → ninguna
 *
 * La ambigüedad de la palabra clave es real: en ManyChat la automatización
 * se dispara por palabra, no por post, así que si reutilizas "GUIA" en
 * cinco reels la atribución no puede ser exacta. En vez de inventarse un
 * dato, el CRM lo marca con confianza baja y lo deja visible.
 */
export async function resolverAtribucion(
  cuentaId: string,
  senales: SenalesAtribucion,
  db: Ejecutor = pool,
): Promise<ResultadoAtribucion> {
  // 1. Contenido explícito
  if (senales.contenidoId) {
    const { rows } = await db.query(
      `SELECT id FROM contenidos WHERE cuenta_id = $1 AND id = $2`,
      [cuentaId, senales.contenidoId],
    );
    if (rows[0]) {
      return {
        contenidoId: rows[0].id,
        automatizacionId: senales.automatizacionId ?? null,
        metodo: 'manual',
        confianza: 'alta',
        nota: null,
        candidatos: 1,
      };
    }
  }

  // 2. ig_media_id: la señal más fiable que puede mandar ManyChat
  if (senales.igMediaId) {
    const contenidoId = await contenidoPorMediaId(cuentaId, senales.igMediaId, senales.permalink, db);
    const automatizacionId = senales.palabraClave
      ? await automatizacionPorPalabra(cuentaId, senales.palabraClave, db)
      : null;
    return {
      contenidoId,
      automatizacionId,
      metodo: 'ig_media_id',
      confianza: 'alta',
      nota: null,
      candidatos: 1,
    };
  }

  // 3. Automatización identificada directamente
  if (senales.automatizacionId || senales.manychatFlowId) {
    const { rows } = await db.query(
      `SELECT id, contenido_id FROM automatizaciones
       WHERE cuenta_id = $1 AND (id::text = $2 OR manychat_flow_id = $3)
       LIMIT 1`,
      [cuentaId, senales.automatizacionId ?? '', senales.manychatFlowId ?? ''],
    );
    if (rows[0]) {
      return {
        contenidoId: rows[0].contenido_id,
        automatizacionId: rows[0].id,
        metodo: 'automatizacion',
        confianza: rows[0].contenido_id ? 'alta' : 'ninguna',
        nota: rows[0].contenido_id
          ? null
          : 'La automatización existe pero no está enlazada a ningún contenido. Enlázala y usa "Reatribuir" para recuperar los leads antiguos.',
        candidatos: 1,
      };
    }
  }

  // 4 y 5. Palabra clave
  if (senales.palabraClave) {
    const palabra = senales.palabraClave.trim().toLowerCase();
    const { rows } = await db.query(
      `SELECT a.id, a.contenido_id, c.publicado_en
         FROM automatizaciones a
         LEFT JOIN contenidos c ON c.id = a.contenido_id
        WHERE a.cuenta_id = $1 AND a.activo AND lower(a.palabra_clave) = $2
        ORDER BY c.publicado_en DESC NULLS LAST, a.creado_en DESC`,
      [cuentaId, palabra],
    );

    if (rows.length === 0) {
      // No existe: la creamos para que aparezca en el panel y el usuario
      // solo tenga que enlazarla a un reel.
      const nueva = await crearAutomatizacionDetectada(cuentaId, senales.palabraClave, db);
      return {
        contenidoId: null,
        automatizacionId: nueva,
        metodo: 'palabra_clave',
        confianza: 'ninguna',
        nota: `Palabra clave "${senales.palabraClave}" desconocida. Se ha creado la automatización automáticamente: enlázala a un reel y pulsa "Reatribuir".`,
        candidatos: 0,
      };
    }

    const conContenido = rows.filter((r: any) => r.contenido_id);
    if (conContenido.length === 1) {
      return {
        contenidoId: conContenido[0].contenido_id,
        automatizacionId: conContenido[0].id,
        metodo: 'palabra_clave',
        confianza: 'alta',
        nota: null,
        candidatos: 1,
      };
    }
    if (conContenido.length > 1) {
      // Ambiguo: misma palabra en varios reels. Elegimos el más reciente
      // publicado y lo marcamos con confianza baja.
      return {
        contenidoId: conContenido[0].contenido_id,
        automatizacionId: conContenido[0].id,
        metodo: 'palabra_clave',
        confianza: 'baja',
        nota: `La palabra "${senales.palabraClave}" está en ${conContenido.length} contenidos. Se atribuye al más reciente. Para exactitud, usa una palabra distinta por reel o haz que ManyChat mande el ig_media_id.`,
        candidatos: conContenido.length,
      };
    }
    return {
      contenidoId: null,
      automatizacionId: rows[0].id,
      metodo: 'palabra_clave',
      confianza: 'ninguna',
      nota: 'La automatización no está enlazada a ningún contenido.',
      candidatos: 0,
    };
  }

  // 6. Campaña / utm
  if (senales.campania) {
    const { rows } = await db.query(
      `SELECT id FROM contenidos
        WHERE cuenta_id = $1 AND ($2 = ANY(etiquetas) OR lower(titulo) = lower($2))
        ORDER BY publicado_en DESC NULLS LAST LIMIT 1`,
      [cuentaId, senales.campania],
    );
    if (rows[0]) {
      return {
        contenidoId: rows[0].id,
        automatizacionId: null,
        metodo: 'campania',
        confianza: 'media',
        nota: null,
        candidatos: 1,
      };
    }
  }

  return { ...SIN_ATRIBUIR };
}

/** Busca el contenido por ig_media_id; si no existe lo crea como marcador. */
async function contenidoPorMediaId(
  cuentaId: string,
  igMediaId: string,
  permalink: string | undefined,
  db: Ejecutor,
): Promise<string> {
  const { rows } = await db.query(
    `SELECT id FROM contenidos WHERE cuenta_id = $1 AND ig_media_id = $2`,
    [cuentaId, igMediaId],
  );
  if (rows[0]) return rows[0].id;

  const creado = await db.query(
    `INSERT INTO contenidos (cuenta_id, ig_media_id, tipo, titulo, permalink, notas)
     VALUES ($1,$2,'reel',$3,$4,'Creado automáticamente al recibir un lead. Sincroniza Instagram para rellenar título, portada y métricas.')
     ON CONFLICT (cuenta_id, ig_media_id) WHERE ig_media_id IS NOT NULL DO UPDATE SET actualizado_en = now()
     RETURNING id`,
    [cuentaId, igMediaId, `Contenido ${igMediaId}`, permalink ?? null],
  );
  return creado.rows[0].id;
}

async function automatizacionPorPalabra(
  cuentaId: string,
  palabra: string,
  db: Ejecutor,
): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT id FROM automatizaciones
      WHERE cuenta_id = $1 AND activo AND lower(palabra_clave) = lower($2)
      ORDER BY creado_en DESC LIMIT 1`,
    [cuentaId, palabra],
  );
  return rows[0]?.id ?? null;
}

async function crearAutomatizacionDetectada(
  cuentaId: string,
  palabra: string,
  db: Ejecutor,
): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO automatizaciones (cuenta_id, nombre, palabra_clave, tipo_disparo)
     VALUES ($1,$2,$3,'comentario') RETURNING id`,
    [cuentaId, `Detectada: ${palabra}`, palabra],
  );
  return rows[0].id;
}

// ---------------------------------------------------------------------
// Toques y atribución desnormalizada en el lead
// ---------------------------------------------------------------------

export async function registrarToque(
  cuentaId: string,
  leadId: string,
  atribucion: ResultadoAtribucion,
  opts: { eventoId?: number | null; origen?: string; ocurridoEn?: Date },
  db: Ejecutor = pool,
): Promise<void> {
  await db.query(
    `INSERT INTO toques (cuenta_id, lead_id, contenido_id, automatizacion_id, evento_id, origen, metodo, confianza, ocurrido_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      cuentaId, leadId, atribucion.contenidoId, atribucion.automatizacionId,
      opts.eventoId ?? null, opts.origen ?? 'comentario',
      atribucion.metodo, atribucion.confianza, opts.ocurridoEn ?? new Date(),
    ],
  );

  // first touch solo si aún está vacío; last touch siempre que haya contenido
  await db.query(
    `UPDATE leads SET
       primer_contenido_id      = COALESCE(primer_contenido_id, $3),
       primer_automatizacion_id = COALESCE(primer_automatizacion_id, $4),
       ultimo_contenido_id      = COALESCE($3, ultimo_contenido_id),
       ultimo_automatizacion_id = COALESCE($4, ultimo_automatizacion_id),
       ultimo_contacto_en       = GREATEST(ultimo_contacto_en, $5)
     WHERE cuenta_id = $1 AND id = $2`,
    [cuentaId, leadId, atribucion.contenidoId, atribucion.automatizacionId, opts.ocurridoEn ?? new Date()],
  );
}

/**
 * Recalcula la atribución de los toques que quedaron sin contenido.
 * Se usa después de enlazar una automatización a un reel: recupera
 * retroactivamente todos los leads que entraron por esa palabra clave.
 */
export async function reatribuir(cuentaId: string): Promise<{ toques: number; leads: number }> {
  // 1. Toques sin contenido cuya automatización ya tiene uno asignado
  const { rows: actualizados } = await pool.query(
    `UPDATE toques t
        SET contenido_id = a.contenido_id,
            metodo = 'palabra_clave',
            confianza = 'alta'
       FROM automatizaciones a
      WHERE t.automatizacion_id = a.id
        AND t.cuenta_id = $1
        AND t.contenido_id IS NULL
        AND a.contenido_id IS NOT NULL
      RETURNING t.lead_id`,
    [cuentaId],
  );

  // 2. Repropagar first/last touch al lead desde sus toques
  const { rows: leads } = await pool.query(
    `WITH ordenados AS (
       SELECT lead_id,
              (array_agg(contenido_id ORDER BY ocurrido_en ASC)  FILTER (WHERE contenido_id IS NOT NULL))[1] AS primero,
              (array_agg(contenido_id ORDER BY ocurrido_en DESC) FILTER (WHERE contenido_id IS NOT NULL))[1] AS ultimo,
              (array_agg(automatizacion_id ORDER BY ocurrido_en ASC)  FILTER (WHERE automatizacion_id IS NOT NULL))[1] AS primera_auto,
              (array_agg(automatizacion_id ORDER BY ocurrido_en DESC) FILTER (WHERE automatizacion_id IS NOT NULL))[1] AS ultima_auto
         FROM toques WHERE cuenta_id = $1 GROUP BY lead_id
     )
     UPDATE leads l
        SET primer_contenido_id = o.primero,
            ultimo_contenido_id = o.ultimo,
            primer_automatizacion_id = o.primera_auto,
            ultimo_automatizacion_id = o.ultima_auto
       FROM ordenados o
      WHERE l.id = o.lead_id AND l.cuenta_id = $1
        AND (l.primer_contenido_id IS DISTINCT FROM o.primero
          OR l.ultimo_contenido_id IS DISTINCT FROM o.ultimo)
      RETURNING l.id`,
    [cuentaId],
  );

  // 3. Propagar también a las oportunidades y a los eventos de venta,
  //    que son los que alimentan "de qué reel vino esta venta".
  await pool.query(
    `UPDATE oportunidades o
        SET contenido_id = l.primer_contenido_id,
            contenido_ultimo_id = l.ultimo_contenido_id,
            automatizacion_id = COALESCE(o.automatizacion_id, l.primer_automatizacion_id)
       FROM leads l
      WHERE o.lead_id = l.id AND o.cuenta_id = $1 AND o.contenido_id IS NULL
        AND l.primer_contenido_id IS NOT NULL`,
    [cuentaId],
  );

  await pool.query(
    `UPDATE eventos e
        SET contenido_id = l.primer_contenido_id
       FROM leads l
      WHERE e.lead_id = l.id AND e.cuenta_id = $1 AND e.contenido_id IS NULL
        AND l.primer_contenido_id IS NOT NULL`,
    [cuentaId],
  );

  return { toques: actualizados.length, leads: leads.length };
}

export { limpiarUsername };
