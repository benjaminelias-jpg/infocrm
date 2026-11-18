import type { PoolClient } from 'pg';
import { transaction, pool } from '../db/pool.js';
import { limpiarUsername } from '../lib/utils.js';
import { noEncontrado } from '../lib/errores.js';
import {
  resolverAtribucion, registrarToque,
  type SenalesAtribucion, type ResultadoAtribucion, type Ejecutor,
} from './atribucion.js';
import { oportunidadAbierta, moverEtapa, etapaParaEvento } from './pipeline.js';
import { ejecutarReglas } from './reglas.js';
import { recomputarScore } from './infoproduccion.js';
import { despacharEvento } from './webhooks_salida.js';

/** Eventos que mueven la oportunidad aunque suponga retroceder de etapa. */
const EVENTOS_FUERTES = new Set([
  'reunion_agendada', 'reunion_no_asistio', 'reunion_realizada',
  'reunion_cancelada', 'venta', 'reembolso',
]);

export interface IdentidadLead {
  manychatSubscriberId?: string;
  igUserId?: string;
  igUsername?: string;
  email?: string;
  telefono?: string;
  nombre?: string;
  apellido?: string;
  pais?: string;
  zonaHoraria?: string;
  idioma?: string;
  avatarUrl?: string;
  camposExtra?: Record<string, unknown>;
  consentimiento?: boolean;
  // Datos que descubre la fase de calificación del flujo de DM
  modeloNegocio?: string;
  ingresosAprox?: string;
  cuelloBotella?: string;
}

export interface EntradaEvento {
  cuentaId: string;
  tipo: string;
  identidad?: IdentidadLead;
  leadId?: string;
  senales?: SenalesAtribucion;
  valor?: number;
  moneda?: string;
  titulo?: string;
  tipoPago?: 'completo' | 'cuotas';
  pagoCompletado?: boolean;
  fuente?: string;
  payload?: Record<string, unknown>;
  ocurridoEn?: Date;
  idempotencyKey?: string;
  origenToque?: string;
  pipelineId?: string;
  /** No ejecutar el motor de reglas (se usa al sembrar datos) */
  sinReglas?: boolean;
}

export interface ResultadoEvento {
  eventoId: number | null;
  leadId: string;
  oportunidadId: string | null;
  atribucion: ResultadoAtribucion;
  duplicado: boolean;
  etapaMovida: { desde: string | null; hasta: string } | null;
}

function nombreVacio(i: IdentidadLead) {
  return !i.nombre && !i.apellido;
}

/** Busca un lead por cualquiera de sus identidades conocidas. */
async function buscarLead(cuentaId: string, i: IdentidadLead, db: Ejecutor) {
  const intentos: Array<[string, string]> = [];
  if (i.manychatSubscriberId) intentos.push(['manychat_subscriber_id = $2', i.manychatSubscriberId]);
  if (i.igUserId) intentos.push(['ig_user_id = $2', i.igUserId]);
  if (i.igUsername) intentos.push(['lower(ig_username) = lower($2)', i.igUsername]);
  if (i.email) intentos.push(['lower(email) = lower($2)', i.email]);

  for (const [cond, valor] of intentos) {
    const { rows } = await db.query(
      `SELECT * FROM leads WHERE cuenta_id = $1 AND ${cond} LIMIT 1`,
      [cuentaId, valor],
    );
    if (rows[0]) return rows[0];
  }
  return null;
}

/**
 * Encuentra o crea el lead. Los datos nuevos rellenan huecos pero nunca
 * pisan información que ya teníamos (COALESCE sobre el valor existente).
 */
export async function resolverLead(
  cuentaId: string,
  identidad: IdentidadLead,
  db: Ejecutor,
  ocurridoEn = new Date(),
): Promise<{ lead: any; creado: boolean }> {
  const i: IdentidadLead = { ...identidad, igUsername: limpiarUsername(identidad.igUsername) };

  const existente = await buscarLead(cuentaId, i, db);
  if (existente) {
    const { rows } = await db.query(
      `UPDATE leads SET
         manychat_subscriber_id = COALESCE(manychat_subscriber_id, $3),
         ig_user_id   = COALESCE(ig_user_id, $4),
         ig_username  = COALESCE(ig_username, $5),
         nombre       = COALESCE(nombre, $6),
         apellido     = COALESCE(apellido, $7),
         email        = COALESCE(email, $8),
         telefono     = COALESCE(telefono, $9),
         pais         = COALESCE(pais, $10),
         zona_horaria = COALESCE(zona_horaria, $11),
         idioma       = COALESCE(idioma, $12),
         avatar_url   = COALESCE(avatar_url, $13),
         campos_extra = campos_extra || $14::jsonb,
         consentimiento = consentimiento OR $15,
         ultimo_contacto_en = GREATEST(ultimo_contacto_en, $16)
       WHERE cuenta_id = $1 AND id = $2 RETURNING *`,
      [
        cuentaId, existente.id, i.manychatSubscriberId ?? null, i.igUserId ?? null,
        i.igUsername ?? null, i.nombre ?? null, i.apellido ?? null, i.email ?? null,
        i.telefono ?? null, i.pais ?? null, i.zonaHoraria ?? null, i.idioma ?? null,
        i.avatarUrl ?? null, JSON.stringify(i.camposExtra ?? {}), i.consentimiento ?? false,
        ocurridoEn,
      ],
    );
    return { lead: rows[0], creado: false };
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO leads (cuenta_id, manychat_subscriber_id, ig_user_id, ig_username, nombre,
                          apellido, email, telefono, pais, zona_horaria, idioma, avatar_url,
                          campos_extra, consentimiento, primer_contacto_en, ultimo_contacto_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$15)
       RETURNING *`,
      [
        cuentaId, i.manychatSubscriberId ?? null, i.igUserId ?? null, i.igUsername ?? null,
        nombreVacio(i) ? (i.igUsername ?? null) : (i.nombre ?? null),
        i.apellido ?? null, i.email ?? null, i.telefono ?? null, i.pais ?? null,
        i.zonaHoraria ?? null, i.idioma ?? null, i.avatarUrl ?? null,
        JSON.stringify(i.camposExtra ?? {}), i.consentimiento ?? false, ocurridoEn,
      ],
    );
    return { lead: rows[0], creado: true };
  } catch (err: any) {
    // Carrera entre dos webhooks del mismo lead: reintentamos la búsqueda.
    if (err?.code === '23505') {
      const otro = await buscarLead(cuentaId, i, db);
      if (otro) return { lead: otro, creado: false };
    }
    throw err;
  }
}

/**
 * Registra un evento completo: resuelve el lead, atribuye el contenido,
 * guarda el evento, mueve la oportunidad por el embudo y dispara reglas.
 *
 * Es el único punto por el que entra información al CRM, venga de un
 * webhook, de la API o de un clic en el panel.
 */
export async function registrarEvento(entrada: EntradaEvento): Promise<ResultadoEvento> {
  const ocurridoEn = entrada.ocurridoEn ?? new Date();

  const resultado = await transaction(async (c: PoolClient) => {
    // 1. Idempotencia: si ya procesamos esta clave, no duplicamos nada
    if (entrada.idempotencyKey) {
      const { rows } = await c.query(
        `SELECT id, lead_id, oportunidad_id FROM eventos WHERE cuenta_id = $1 AND idempotency_key = $2`,
        [entrada.cuentaId, entrada.idempotencyKey],
      );
      if (rows[0]) {
        return {
          eventoId: rows[0].id,
          leadId: rows[0].lead_id,
          oportunidadId: rows[0].oportunidad_id,
          atribucion: {
            contenidoId: null, automatizacionId: null, metodo: 'sin_atribuir' as const,
            confianza: 'ninguna' as const, nota: 'Evento duplicado, ignorado.', candidatos: 0,
          },
          duplicado: true,
          etapaMovida: null,
          eventoCompleto: null,
        };
      }
    }

    // 2. Lead
    let leadId = entrada.leadId;
    if (leadId) {
      // Seguridad multi-cuenta: un lead_id pasado desde fuera DEBE pertenecer
      // a la cuenta de la sesión. Si no, se rechaza — nunca se opera sobre un
      // lead ajeno (ni su score, ni su estado, ni sus oportunidades).
      const dueno = await c.query(
        `SELECT 1 FROM leads WHERE id = $1 AND cuenta_id = $2`, [leadId, entrada.cuentaId]);
      if (!dueno.rows[0]) throw noEncontrado('Lead');
    } else {
      if (!entrada.identidad) throw new Error('Hace falta leadId o identidad para registrar un evento');
      const { lead } = await resolverLead(entrada.cuentaId, entrada.identidad, c, ocurridoEn);
      leadId = lead.id;
    }

    // Datos de calificación (rellenan huecos, no pisan lo que ya había)
    const id = entrada.identidad;
    if (leadId && id && (id.modeloNegocio || id.ingresosAprox || id.cuelloBotella)) {
      await c.query(
        `UPDATE leads SET
           modelo_negocio = COALESCE(modelo_negocio, $2),
           ingresos_aprox = COALESCE(ingresos_aprox, $3),
           cuello_botella = COALESCE(cuello_botella, $4)
         WHERE id = $1`,
        [leadId, id.modeloNegocio ?? null, id.ingresosAprox ?? null, id.cuelloBotella ?? null],
      );
    }

    // 3. Atribución
    const atribucion = await resolverAtribucion(entrada.cuentaId, entrada.senales ?? {}, c);

    // 4. Oportunidad abierta (o nueva si la anterior ya se cerró)
    const opp = await oportunidadAbierta(entrada.cuentaId, leadId!, c, {
      pipelineId: entrada.pipelineId,
      atribucion,
      abiertaEn: ocurridoEn,
    });

    // 5. Evento
    const { rows: evRows } = await c.query(
      `INSERT INTO eventos (cuenta_id, lead_id, oportunidad_id, tipo, contenido_id, automatizacion_id,
                            valor, moneda, titulo, fuente, payload, idempotency_key, ocurrido_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)
       RETURNING *`,
      [
        entrada.cuentaId, leadId, opp.id, entrada.tipo,
        atribucion.contenidoId, atribucion.automatizacionId,
        entrada.valor ?? null, entrada.moneda ?? null, entrada.titulo ?? null,
        entrada.fuente ?? 'api', JSON.stringify(entrada.payload ?? {}),
        entrada.idempotencyKey ?? null, ocurridoEn,
      ],
    );
    const evento = evRows[0];

    // 6. Toque de atribución
    await registrarToque(entrada.cuentaId, leadId!, atribucion, {
      eventoId: evento.id,
      origen: entrada.origenToque ?? 'comentario',
      ocurridoEn,
    }, c);

    // Si la oportunidad nació sin atribución pero el toque sí la trae, la heredamos
    if (!opp.contenido_id && atribucion.contenidoId) {
      await c.query(
        `UPDATE oportunidades SET contenido_id = COALESCE(contenido_id, $2),
                                  automatizacion_id = COALESCE(automatizacion_id, $3)
          WHERE id = $1`,
        [opp.id, atribucion.contenidoId, atribucion.automatizacionId],
      );
    }
    if (atribucion.contenidoId) {
      await c.query(`UPDATE oportunidades SET contenido_ultimo_id = $2 WHERE id = $1`,
        [opp.id, atribucion.contenidoId]);
    }

    // 7. Hitos del embudo (datos duros, no política)
    if (entrada.tipo === 'reunion_agendada') {
      await c.query(
        `UPDATE oportunidades SET reunion_agendada_en = COALESCE(reunion_agendada_en, $2), reunion_no_asistio = false
          WHERE id = $1`, [opp.id, ocurridoEn]);
    } else if (entrada.tipo === 'reunion_realizada') {
      await c.query(
        `UPDATE oportunidades SET reunion_realizada_en = COALESCE(reunion_realizada_en, $2), reunion_no_asistio = false
          WHERE id = $1`, [opp.id, ocurridoEn]);
    } else if (entrada.tipo === 'reunion_no_asistio') {
      await c.query(`UPDATE oportunidades SET reunion_no_asistio = true WHERE id = $1`, [opp.id]);
    } else if (entrada.tipo === 'venta') {
      const valor = entrada.valor ?? 0;
      await c.query(
        `UPDATE oportunidades SET valor = $2, moneda = COALESCE($3, moneda), titulo = COALESCE(titulo, $4),
                tipo_pago = COALESCE($5, tipo_pago),
                pago_completado = COALESCE($6, pago_completado)
          WHERE id = $1`,
        [opp.id, valor, entrada.moneda ?? null, entrada.titulo ?? null,
         entrada.tipoPago ?? null, entrada.pagoCompletado ?? null]);
      await c.query(
        `UPDATE leads SET valor_total = valor_total + $2, estado = 'ganado' WHERE id = $1`,
        [leadId, valor]);
    } else if (entrada.tipo === 'reembolso') {
      const valor = entrada.valor ?? 0;
      await c.query(`UPDATE leads SET valor_total = GREATEST(valor_total - $2, 0) WHERE id = $1`,
        [leadId, valor]);
    }

    // 8. Movimiento de etapa según el mapeo evento -> etapa
    let etapaMovida: { desde: string | null; hasta: string } | null = null;
    const destino = await etapaParaEvento(opp.pipeline_id, entrada.tipo, c);
    if (destino) {
      const { rows: actualRows } = await c.query(
        `SELECT e.orden FROM oportunidades o JOIN etapas e ON e.id = o.etapa_id WHERE o.id = $1`,
        [opp.id]);
      const ordenActual = actualRows[0]?.orden ?? -1;
      const debeMover = EVENTOS_FUERTES.has(entrada.tipo) || destino.orden > ordenActual;
      if (debeMover) {
        etapaMovida = await moverEtapa(entrada.cuentaId, opp.id, destino.id, c, {
          origen: 'webhook', cuando: ocurridoEn,
        });
      }
    }

    return {
      eventoId: evento.id as number,
      leadId: leadId!,
      oportunidadId: opp.id as string,
      atribucion,
      duplicado: false,
      etapaMovida,
      eventoCompleto: evento,
    };
  });

  // 9. Reglas, ya fuera de la transacción (pueden llamar a webhooks externos)
  if (!entrada.sinReglas && !resultado.duplicado && resultado.eventoCompleto) {
    await ejecutarReglas(entrada.cuentaId, resultado.eventoCompleto).catch((err) => {
      console.error('[reglas] error ejecutando reglas:', err?.message);
    });
  }

  // 10. Score del lead (filtro antipodridos). Después de reglas, para que
  //     recoja cualquier cambio que una regla haya hecho en el lead.
  if (!resultado.duplicado && resultado.leadId) {
    await recomputarScore(resultado.leadId).catch((err) => {
      console.error('[score] error recomputando score:', err?.message);
    });
  }

  // 11. Webhooks de salida: avisar a las apps suscritas (Zapier, Make, …).
  //     En segundo plano; un receptor caído no debe afectar al evento.
  if (!entrada.sinReglas && !resultado.duplicado && resultado.eventoCompleto) {
    await despacharEvento(entrada.cuentaId, resultado.eventoCompleto).catch((err) => {
      console.error('[webhooks-salida] error despachando:', err?.message);
    });
  }

  const { eventoCompleto, ...limpio } = resultado as any;
  return limpio as ResultadoEvento;
}

/** Línea de tiempo de un lead: eventos, notas y cambios de etapa juntos. */
export async function timelineLead(cuentaId: string, leadId: string) {
  const { rows } = await pool.query(
    `SELECT e.id, e.tipo, e.titulo, e.valor, e.moneda, e.fuente, e.ocurrido_en,
            e.contenido_id, c.titulo AS contenido_titulo, c.permalink AS contenido_permalink,
            a.nombre AS automatizacion_nombre, a.palabra_clave
       FROM eventos e
       LEFT JOIN contenidos c ON c.id = e.contenido_id
       LEFT JOIN automatizaciones a ON a.id = e.automatizacion_id
      WHERE e.cuenta_id = $1 AND e.lead_id = $2
      ORDER BY e.ocurrido_en DESC, e.id DESC
      LIMIT 200`,
    [cuentaId, leadId],
  );
  return rows;
}
