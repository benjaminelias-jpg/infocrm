import { construirApp } from './app.js';
import { config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { closePool } from './db/pool.js';

async function main() {
  await runMigrations();
  const app = await construirApp();

  await app.listen({ port: config.port, host: config.host });
  console.log(`\n  InfoCRM escuchando en http://localhost:${config.port}`);
  console.log(`  Webhooks:  http://localhost:${config.port}/webhooks/<token>\n`);

  for (const senal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(senal, async () => {
      await app.close();
      await closePool();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error('No se pudo arrancar:', err);
  process.exit(1);
});
