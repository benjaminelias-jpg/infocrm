import type { PoolClient } from 'pg';
import { transaction, query, queryOne } from '../db/pool.js';
import { hashPassword, generarTokenWebhook } from '../lib/auth.js';
import { slugify } from '../lib/utils.js';

/**
 * Pipeline por defecto de infoproducto (embudo de llamada).
 * marca_reunion / marca_venta le dicen al motor de eventos a qué etapa
 * mover una oportunidad cuando llega un webhook de reunión o de venta.
 */
export const ETAPAS_DEFECTO = [
  { slug: 'nuevo',             nombre: 'Lead nuevo',        orden: 0, tipo: 'abierta', color: '#64748b', probabilidad: 5,   evento: 'lead_creado' },
  { slug: 'recurso-entregado', nombre: 'Recurso entregado', orden: 1, tipo: 'abierta', color: '#0ea5e9', probabilidad: 10,  evento: 'recurso_entregado' },
  { slug: 'en-conversacion',   nombre: 'En conversación',   orden: 2, tipo: 'abierta', color: '#0891b2', probabilidad: 20,  evento: 'respondio_dm' },
  { slug: 'reunion-agendada',  nombre: 'Reunión agendada',  orden: 3, tipo: 'abierta', color: '#f59e0b', probabilidad: 40,  evento: 'reunion_agendada', marca_reunion: true },
  { slug: 'no-asistio',        nombre: 'No asistió',        orden: 4, tipo: 'abierta', color: '#ef4444', probabilidad: 15,  evento: 'reunion_no_asistio' },
  { slug: 'reunion-realizada', nombre: 'Reunión realizada', orden: 5, tipo: 'abierta', color: '#14b8a6', probabilidad: 60,  evento: 'reunion_realizada' },
  { slug: 'venta',             nombre: 'Venta',             orden: 6, tipo: 'ganada',  color: '#22c55e', probabilidad: 100, evento: 'venta', marca_venta: true },
  { slug: 'perdido',           nombre: 'Perdido',           orden: 7, tipo: 'perdida', color: '#94a3b8', probabilidad: 0,   evento: null },
] as const;

const REGLAS_DEFECTO = [
  {
    nombre: 'Etiquetar lead caliente al agendar',
    descripcion: 'Cuando un lead agenda reunión se marca como caliente para priorizarlo en el inbox.',
    disparador: { evento: 'reunion_agendada' },
    condiciones: [],
    acciones: [{ tipo: 'etiquetar', etiqueta: 'caliente' }],
    orden: 10,
  },
  {
    nombre: 'Etiquetar no-show',
    descripcion: 'Marca los leads que no se presentaron para poder recuperarlos con una secuencia aparte.',
    disparador: { evento: 'reunion_no_asistio' },
    condiciones: [],
    acciones: [{ tipo: 'etiquetar', etiqueta: 'no-show' }],
    orden: 20,
  },
  {
    nombre: 'Etiquetar comprador',
    descripcion: 'Al registrarse una venta, el lead queda etiquetado como comprador y sale de las secuencias de captación.',
    disparador: { evento: 'venta' },
    condiciones: [],
    acciones: [
      { tipo: 'etiquetar', etiqueta: 'comprador' },
      { tipo: 'quitar_etiqueta', etiqueta: 'caliente' },
    ],
    orden: 30,
  },
  {
    nombre: 'Avisar por webhook cuando hay venta de +1000',
    descripcion: 'Ejemplo de webhook saliente. Desactivada: pon tu URL (Slack, Make, Telegram) y actívala.',
    disparador: { evento: 'venta' },
    condiciones: [{ campo: 'evento.valor', operador: 'mayor_que', valor: 1000 }],
    acciones: [{ tipo: 'webhook_saliente', url: '' }],
    orden: 40,
    activo: false,
  },
];

const WEBHOOKS_DEFECTO = [
  {
    nombre: 'ManyChat — entrada de leads',
    slug: 'manychat-leads',
    fuente: 'manychat',
    evento_defecto: 'lead_creado',
  },
  {
    nombre: 'Calendly / agenda — reunión agendada',
    slug: 'reunion-agendada',
    fuente: 'calendly',
    evento_defecto: 'reunion_agendada',
  },
  {
    nombre: 'Pasarela de pago — venta',
    slug: 'venta',
    fuente: 'generico',
    evento_defecto: 'venta',
  },
];

export interface NuevaCuenta {
  nombre: string;
  slug?: string;
  zonaHoraria?: string;
  moneda?: string;
  igUsername?: string;
  owner: { nombre: string; email: string; password: string };
}

/**
 * Crea una cuenta completa y lista para usar: usuario propietario,
 * pipeline con sus etapas, reglas por defecto y endpoints de webhook.
 */
export async function crearCuenta(datos: NuevaCuenta) {
  return transaction(async (c: PoolClient) => {
    const slug = datos.slug ?? slugify(datos.nombre);

    const cuenta = (
      await c.query(
        `INSERT INTO cuentas (nombre, slug, zona_horaria, moneda, ig_username)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [datos.nombre, slug, datos.zonaHoraria ?? 'Europe/Madrid', datos.moneda ?? 'EUR', datos.igUsername ?? null],
      )
    ).rows[0];

    const usuario = (
      await c.query(
        `INSERT INTO usuarios (cuenta_id, email, nombre, password_hash, rol)
         VALUES ($1,$2,$3,$4,'owner')
         RETURNING id, cuenta_id, email, nombre, rol`,
        [cuenta.id, datos.owner.email.toLowerCase(), datos.owner.nombre, await hashPassword(datos.owner.password)],
      )
    ).rows[0];

    const pipeline = (
      await c.query(
        `INSERT INTO pipelines (cuenta_id, nombre, slug, descripcion, es_predeterminado, orden)
         VALUES ($1,'Embudo principal','embudo-principal','Lead de Instagram → recurso → conversación → reunión → venta', true, 0)
         RETURNING *`,
        [cuenta.id],
      )
    ).rows[0];

    for (const e of ETAPAS_DEFECTO) {
      await c.query(
        `INSERT INTO etapas (cuenta_id, pipeline_id, nombre, slug, orden, tipo, color, probabilidad, evento_asociado, marca_reunion, marca_venta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          cuenta.id, pipeline.id, e.nombre, e.slug, e.orden, e.tipo, e.color, e.probabilidad,
          e.evento,
          'marca_reunion' in e ? e.marca_reunion : false,
          'marca_venta' in e ? e.marca_venta : false,
        ],
      );
    }

    for (const r of REGLAS_DEFECTO) {
      await c.query(
        `INSERT INTO reglas (cuenta_id, nombre, descripcion, disparador, condiciones, acciones, orden, activo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          cuenta.id, r.nombre, r.descripcion,
          JSON.stringify(r.disparador), JSON.stringify(r.condiciones), JSON.stringify(r.acciones),
          r.orden, 'activo' in r ? r.activo : true,
        ],
      );
    }

    const endpoints = [];
    for (const w of WEBHOOKS_DEFECTO) {
      const fila = (
        await c.query(
          `INSERT INTO webhook_endpoints (cuenta_id, nombre, slug, token, fuente, evento_defecto)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [cuenta.id, w.nombre, w.slug, generarTokenWebhook(), w.fuente, w.evento_defecto],
        )
      ).rows[0];
      endpoints.push(fila);
    }

    // Integraciones vacías, listas para que el usuario pegue sus credenciales
    for (const tipo of ['instagram', 'manychat'] as const) {
      await c.query(
        `INSERT INTO integraciones (cuenta_id, tipo, nombre) VALUES ($1,$2,$3)`,
        [cuenta.id, tipo, tipo === 'instagram' ? 'Instagram Business' : 'ManyChat'],
      );
    }

    return { cuenta, usuario, pipeline, endpoints };
  });
}

export async function pipelinePredeterminado(cuentaId: string) {
  return queryOne(
    `SELECT * FROM pipelines WHERE cuenta_id = $1 AND activo
     ORDER BY es_predeterminado DESC, orden ASC LIMIT 1`,
    [cuentaId],
  );
}

export async function etapasDe(pipelineId: string) {
  return query(`SELECT * FROM etapas WHERE pipeline_id = $1 ORDER BY orden ASC`, [pipelineId]);
}

/** Primera etapa (donde entra todo lead nuevo) */
export async function etapaInicial(cuentaId: string, pipelineId: string) {
  return queryOne(
    `SELECT * FROM etapas WHERE cuenta_id = $1 AND pipeline_id = $2 AND tipo = 'abierta'
     ORDER BY orden ASC LIMIT 1`,
    [cuentaId, pipelineId],
  );
}
