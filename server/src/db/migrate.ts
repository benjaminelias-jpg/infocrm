import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../config.js';

function sslDe(cs: string) { return /@(localhost|127\.0\.0\.1|db)[:/]/.test(cs) ? undefined : { rejectUnauthorized: false }; }

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

function dbNameFromUrl(url: string): { adminUrl: string; dbName: string } {
  const u = new URL(url);
  const dbName = u.pathname.replace(/^\//, '');
  u.pathname = '/postgres';
  return { adminUrl: u.toString(), dbName };
}

export async function ensureDatabase(url = config.databaseUrl) {
  const { adminUrl, dbName } = dbNameFromUrl(url);
  const admin = new pg.Client({ connectionString: adminUrl, ssl: sslDe(adminUrl) });
  try {
    await admin.connect();
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (rows.length === 0) {
      await admin.query(`CREATE DATABASE "${dbName}"`);
      console.log(`[migrate] base de datos creada: ${dbName}`);
    }
  } catch (err) {
    // En Postgres gestionado (Neon, Supabase, Railway…) la base ya existe y
    // normalmente no se puede conectar a "postgres" ni crear bases. No pasa
    // nada: seguimos y migramos directamente contra DATABASE_URL.
    console.warn(`[migrate] no se pudo verificar/crear la base (${(err as Error).message}). ` +
      'Se asume que ya existe y se continúa.');
  } finally {
    await admin.end().catch(() => {});
  }
}

export async function runMigrations(url = config.databaseUrl, silent = false) {
  await ensureDatabase(url);
  const client = new pg.Client({ connectionString: url, ssl: sslDe(url) });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migraciones (
        nombre      text PRIMARY KEY,
        aplicada_en timestamptz NOT NULL DEFAULT now()
      )`);

    const aplicadas = new Set(
      (await client.query('SELECT nombre FROM _migraciones')).rows.map((r: any) => r.nombre),
    );

    const archivos = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let n = 0;
    for (const archivo of archivos) {
      if (aplicadas.has(archivo)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, archivo), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migraciones (nombre) VALUES ($1)', [archivo]);
        await client.query('COMMIT');
        if (!silent) console.log(`[migrate] aplicada ${archivo}`);
        n++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Fallo en la migración ${archivo}: ${(err as Error).message}`);
      }
    }
    if (!silent) {
      console.log(n === 0 ? '[migrate] sin cambios, ya estaba al día' : `[migrate] ${n} migración(es) aplicadas`);
    }
  } finally {
    await client.end();
  }
}

export async function resetDatabase(url = config.databaseUrl) {
  await ensureDatabase(url);
  const client = new pg.Client({ connectionString: url, ssl: sslDe(url) });
  await client.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } finally {
    await client.end();
  }
  await runMigrations(url, true);
}

const entryPoint = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (entryPoint) {
  const cmd = process.argv[2] ?? 'up';
  // Para DDL conviene la conexión DIRECTA (no la del pooler). Neon/Vercel la
  // exponen como DATABASE_URL_UNPOOLED / POSTGRES_URL_NON_POOLING.
  const urlMigracion =
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING ||
    config.databaseUrl;
  const run = cmd === 'reset' ? resetDatabase(urlMigracion) : runMigrations(urlMigracion);
  run
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[migrate] ERROR:', err.message);
      process.exit(1);
    });
}
