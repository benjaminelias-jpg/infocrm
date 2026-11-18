import { resetDatabase } from '../src/db/migrate.js';
import { config } from '../src/config.js';

/** Base de datos de pruebas limpia antes de cada ejecución. */
export async function setup() {
  process.env.NODE_ENV = 'test';
  await resetDatabase(config.databaseUrl);
}
