import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../config.js';

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
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (rows.length === 0) {
      await admin.query(`CREATE DATABASE "${dbName}"`);
      console.log(`[migrate] base de datos creada: ${dbName}`);
    }
  } finally {
    await admin.end();
  }
}

export async function runMigrations(url = config.databaseUrl, silent = false) {
  await ensureDatabase(url);
  const client = new pg.Client({ connectionString: url });
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
  const client = new pg.Client({ connectionString: url });
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
  const run = cmd === 'reset' ? resetDatabase() : runMigrations();
  run
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[migrate] ERROR:', err.message);
      process.exit(1);
    });
}
