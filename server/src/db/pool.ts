import pg from 'pg';
import { config } from '../config.js';

// Postgres devuelve numeric como string para no perder precisión.
// En este CRM los importes caben de sobra en un double, así que los
// convertimos a número para que la API no devuelva "1497.00" como texto.
pg.types.setTypeParser(1700, (v: string) => (v === null ? null : Number(v)));
// bigint (eventos.id, toques.id): los IDs caben en Number.MAX_SAFE_INTEGER
pg.types.setTypeParser(20, (v: string) => (v === null ? null : Number(v)));

/** Los Postgres gestionados (Neon, Supabase, Railway…) exigen SSL; los locales no. */
export function sslDe(connectionString: string) {
  const local = /@(localhost|127\.0\.0\.1|db)[:/]/.test(connectionString);
  return local ? undefined : { rejectUnauthorized: false };
}

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: sslDe(config.databaseUrl),
  // En serverless conviene un pool pequeño (muchas instancias efímeras).
  max: config.isTest ? 5 : process.env.VERCEL ? 3 : 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export type Row = Record<string, any>;

export async function query<T extends Row = Row>(
  text: string,
  params: any[] = [],
): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function queryOne<T extends Row = Row>(
  text: string,
  params: any[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Ejecuta fn dentro de una transacción. Hace rollback si lanza. */
export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}
