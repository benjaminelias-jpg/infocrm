import { randomBytes } from 'node:crypto';
import { query, queryOne } from '../src/db/pool.js';
import { crearCuenta } from '../src/modules/cuentas.js';

/** Cada archivo de test trabaja sobre su propia cuenta: aislamiento total. */
export async function cuentaDePrueba(nombre = 'Test') {
  const sufijo = randomBytes(4).toString('hex');
  const { cuenta, usuario, endpoints } = await crearCuenta({
    nombre: `${nombre} ${sufijo}`,
    slug: `test-${sufijo}`,
    owner: {
      nombre: 'Dueño Test',
      email: `owner-${sufijo}@test.local`,
      password: 'contrasena-larga-123',
    },
  });
  return { cuenta, usuario, endpoints, sufijo };
}

export async function crearContenido(
  cuentaId: string,
  datos: { titulo: string; igMediaId?: string; publicadoEn?: Date },
) {
  return queryOne(
    `INSERT INTO contenidos (cuenta_id, titulo, tipo, ig_media_id, publicado_en)
     VALUES ($1,$2,'reel',$3,$4) RETURNING *`,
    [cuentaId, datos.titulo, datos.igMediaId ?? null, datos.publicadoEn ?? new Date()],
  );
}

export async function crearAutomatizacion(
  cuentaId: string,
  datos: { nombre?: string; palabra: string; contenidoId?: string | null; flowId?: string },
) {
  return queryOne(
    `INSERT INTO automatizaciones (cuenta_id, nombre, palabra_clave, contenido_id, manychat_flow_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [cuentaId, datos.nombre ?? `Auto ${datos.palabra}`, datos.palabra,
     datos.contenidoId ?? null, datos.flowId ?? null],
  );
}

export async function etapaPorSlug(cuentaId: string, slug: string) {
  return queryOne(`SELECT * FROM etapas WHERE cuenta_id = $1 AND slug = $2`, [cuentaId, slug]);
}

export async function oportunidadDe(leadId: string) {
  return queryOne(
    `SELECT o.*, e.slug AS etapa_slug FROM oportunidades o
       JOIN etapas e ON e.id = o.etapa_id
      WHERE o.lead_id = $1 ORDER BY o.abierta_en DESC LIMIT 1`,
    [leadId],
  );
}

export async function leadPorId(leadId: string) {
  return queryOne(`SELECT * FROM leads WHERE id = $1`, [leadId]);
}

export async function toquesDe(leadId: string) {
  return query(`SELECT * FROM toques WHERE lead_id = $1 ORDER BY ocurrido_en ASC, id ASC`, [leadId]);
}
