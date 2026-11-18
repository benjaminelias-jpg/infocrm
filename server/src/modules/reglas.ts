import { pool, query } from '../db/pool.js';
import { moverEtapa } from './pipeline.js';
import { leerRuta } from '../lib/utils.js';

type Operador =
  | 'igual' | 'distinto' | 'contiene' | 'no_contiene'
  | 'mayor_que' | 'menor_que' | 'existe' | 'no_existe' | 'empieza_por';

interface Condicion { campo: string; operador: Operador; valor?: unknown }

interface Accion {
  tipo: 'mover_etapa' | 'etiquetar' | 'quitar_etiqueta' | 'asignar'
      | 'crear_nota' | 'webhook_saliente' | 'marcar_perdido';
  [k: string]: unknown;
}

/** Contexto plano sobre el que se evalúan condiciones y plantillas. */
async function construirContexto(cuentaId: string, evento: any) {
  const [lead] = await query(`SELECT * FROM leads WHERE id = $1`, [evento.lead_id]);
  const [oportunidad] = evento.oportunidad_id
    ? await query(`SELECT * FROM oportunidades WHERE id = $1`, [evento.oportunidad_id])
    : [null];
  const [contenido] = evento.contenido_id
    ? await query(`SELECT * FROM contenidos WHERE id = $1`, [evento.contenido_id])
    : [null];
  const [automatizacion] = evento.automatizacion_id
    ? await query(`SELECT * FROM automatizaciones WHERE id = $1`, [evento.automatizacion_id])
    : [null];
  return { evento, lead, oportunidad, contenido, automatizacion };
}

function evaluarCondicion(ctx: any, cond: Condicion): boolean {
  const actual = leerRuta(ctx, cond.campo);
  const esperado = cond.valor;

  switch (cond.operador) {
    case 'existe':      return actual !== null && actual !== undefined && actual !== '';
    case 'no_existe':   return actual === null || actual === undefined || actual === '';
    case 'igual':       return String(actual ?? '').toLowerCase() === String(esperado ?? '').toLowerCase();
    case 'distinto':    return String(actual ?? '').toLowerCase() !== String(esperado ?? '').toLowerCase();
    case 'mayor_que':   return Number(actual) > Number(esperado);
    case 'menor_que':   return Number(actual) < Number(esperado);
    case 'empieza_por': return String(actual ?? '').toLowerCase().startsWith(String(esperado ?? '').toLowerCase());
    case 'contiene':
      if (Array.isArray(actual)) return actual.map(String).includes(String(esperado));
      return String(actual ?? '').toLowerCase().includes(String(esperado ?? '').toLowerCase());
    case 'no_contiene':
      if (Array.isArray(actual)) return !actual.map(String).includes(String(esperado));
      return !String(actual ?? '').toLowerCase().includes(String(esperado ?? '').toLowerCase());
    default:            return false;
  }
}

/** Sustituye {{lead.nombre}} o {{contenido.titulo}} en textos y URLs. */
function plantilla(texto: string, ctx: any): string {
  return texto.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, ruta) => {
    const v = leerRuta(ctx, ruta);
    return v === null || v === undefined ? '' : String(v);
  });
}

async function ejecutarAccion(
  cuentaId: string, accion: Accion, ctx: any, reglaId: string,
): Promise<Record<string, unknown>> {
  switch (accion.tipo) {
    case 'etiquetar': {
      const etiqueta = String(accion.etiqueta ?? '').trim();
      if (!etiqueta || !ctx.lead) return { omitida: 'sin etiqueta' };
      await pool.query(
        `UPDATE leads SET etiquetas = (
           SELECT array_agg(DISTINCT x) FROM unnest(etiquetas || ARRAY[$2]) AS x
         ) WHERE id = $1`,
        [ctx.lead.id, etiqueta],
      );
      return { etiqueta };
    }

    case 'quitar_etiqueta': {
      const etiqueta = String(accion.etiqueta ?? '').trim();
      if (!etiqueta || !ctx.lead) return { omitida: 'sin etiqueta' };
      await pool.query(`UPDATE leads SET etiquetas = array_remove(etiquetas, $2) WHERE id = $1`,
        [ctx.lead.id, etiqueta]);
      return { etiqueta };
    }

    case 'mover_etapa': {
      if (!ctx.oportunidad) return { omitida: 'el lead no tiene oportunidad' };
      const { rows } = await pool.query(
        `SELECT id FROM etapas WHERE pipeline_id = $1 AND (slug = $2 OR id::text = $2) LIMIT 1`,
        [ctx.oportunidad.pipeline_id, String(accion.etapa_slug ?? accion.etapa_id ?? '')],
      );
      if (!rows[0]) return { omitida: 'etapa no encontrada' };
      const mov = await moverEtapa(cuentaId, ctx.oportunidad.id, rows[0].id, pool, {
        origen: 'regla', reglaId,
      });
      return { movido: Boolean(mov), etapa_id: rows[0].id };
    }

    case 'marcar_perdido': {
      if (!ctx.oportunidad) return { omitida: 'sin oportunidad' };
      await pool.query(
        `UPDATE oportunidades SET estado='perdida', motivo_perdida=$2, cerrada_en=COALESCE(cerrada_en, now())
          WHERE id = $1`,
        [ctx.oportunidad.id, String(accion.motivo ?? 'Marcado por regla')],
      );
      return { oportunidad: ctx.oportunidad.id };
    }

    case 'asignar': {
      if (!ctx.lead) return { omitida: 'sin lead' };
      let usuarioId = accion.usuario_id as string | undefined;
      if (!usuarioId || usuarioId === 'round_robin') {
        // Reparte al closer con menos oportunidades abiertas
        const { rows } = await pool.query(
          `SELECT u.id, COUNT(o.id) AS carga
             FROM usuarios u
             LEFT JOIN oportunidades o ON o.propietario_id = u.id AND o.estado = 'abierta'
            WHERE u.cuenta_id = $1 AND u.activo AND u.rol IN ('closer','owner','admin')
            GROUP BY u.id ORDER BY carga ASC, u.creado_en ASC LIMIT 1`,
          [cuentaId],
        );
        usuarioId = rows[0]?.id;
      }
      if (!usuarioId) return { omitida: 'no hay closers disponibles' };
      await pool.query(`UPDATE leads SET propietario_id = $2 WHERE id = $1`, [ctx.lead.id, usuarioId]);
      if (ctx.oportunidad) {
        await pool.query(`UPDATE oportunidades SET propietario_id = $2 WHERE id = $1`,
          [ctx.oportunidad.id, usuarioId]);
      }
      return { usuario_id: usuarioId };
    }

    case 'crear_nota': {
      if (!ctx.lead) return { omitida: 'sin lead' };
      const cuerpo = plantilla(String(accion.texto ?? ''), ctx);
      await pool.query(
        `INSERT INTO notas (cuenta_id, lead_id, oportunidad_id, cuerpo) VALUES ($1,$2,$3,$4)`,
        [cuentaId, ctx.lead.id, ctx.oportunidad?.id ?? null, cuerpo],
      );
      return { nota: cuerpo.slice(0, 80) };
    }

    case 'webhook_saliente': {
      const url = plantilla(String(accion.url ?? ''), ctx);
      if (!url) return { omitida: 'sin url' };
      const cuerpo = {
        evento: ctx.evento.tipo,
        ocurrido_en: ctx.evento.ocurrido_en,
        valor: ctx.evento.valor,
        lead: ctx.lead && {
          id: ctx.lead.id, nombre: ctx.lead.nombre, ig_username: ctx.lead.ig_username,
          email: ctx.lead.email, etiquetas: ctx.lead.etiquetas,
        },
        contenido: ctx.contenido && {
          id: ctx.contenido.id, titulo: ctx.contenido.titulo, permalink: ctx.contenido.permalink,
        },
      };
      const ctrl = AbortSignal.timeout(8000);
      const res = await fetch(url, {
        method: String(accion.metodo ?? 'POST'),
        headers: { 'content-type': 'application/json', ...(accion.cabeceras as any ?? {}) },
        body: JSON.stringify(cuerpo),
        signal: ctrl,
      });
      return { url, status: res.status };
    }

    default:
      return { omitida: `acción desconocida: ${accion.tipo}` };
  }
}

/**
 * Ejecuta todas las reglas activas que coincidan con el evento.
 * Cada ejecución queda registrada para que se pueda auditar por qué
 * un lead acabó donde acabó.
 */
export async function ejecutarReglas(cuentaId: string, evento: any): Promise<void> {
  const reglas = await query(
    `SELECT * FROM reglas WHERE cuenta_id = $1 AND activo ORDER BY orden ASC, creado_en ASC`,
    [cuentaId],
  );
  if (reglas.length === 0) return;

  const aplicables = reglas.filter((r: any) => {
    const disp = r.disparador ?? {};
    if (!disp.evento) return false;
    return disp.evento === '*' || disp.evento === evento.tipo;
  });
  if (aplicables.length === 0) return;

  const ctx = await construirContexto(cuentaId, evento);

  for (const regla of aplicables) {
    const condiciones: Condicion[] = regla.condiciones ?? [];
    const cumple = condiciones.every((c) => evaluarCondicion(ctx, c));
    if (!cumple) {
      await pool.query(
        `INSERT INTO regla_ejecuciones (cuenta_id, regla_id, lead_id, evento_id, estado, resultado)
         VALUES ($1,$2,$3,$4,'omitida','{"motivo":"condiciones no cumplidas"}'::jsonb)`,
        [cuentaId, regla.id, evento.lead_id, evento.id],
      );
      continue;
    }

    const acciones: Accion[] = regla.acciones ?? [];
    const resultados: Record<string, unknown>[] = [];
    let error: string | null = null;

    for (const accion of acciones) {
      try {
        resultados.push({ accion: accion.tipo, ...(await ejecutarAccion(cuentaId, accion, ctx, regla.id)) });
      } catch (err: any) {
        error = `${accion.tipo}: ${err?.message ?? err}`;
        resultados.push({ accion: accion.tipo, error: error });
        break;
      }
    }

    await pool.query(
      `INSERT INTO regla_ejecuciones (cuenta_id, regla_id, lead_id, evento_id, estado, resultado, error)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [cuentaId, regla.id, evento.lead_id, evento.id,
       error ? 'error' : 'ok', JSON.stringify(resultados), error],
    );
    await pool.query(
      `UPDATE reglas SET total_ejecuciones = total_ejecuciones + 1, ultima_ejecucion_en = now() WHERE id = $1`,
      [regla.id],
    );

    // Refrescamos el lead por si una regla anterior lo cambió
    if (ctx.lead) {
      const [fresco] = await query(`SELECT * FROM leads WHERE id = $1`, [ctx.lead.id]);
      ctx.lead = fresco ?? ctx.lead;
    }
  }
}
