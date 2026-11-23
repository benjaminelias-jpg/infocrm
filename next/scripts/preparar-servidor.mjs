// Empaqueta el servidor del CRM (../server/src) para que Next lo use desde /api.
import { build } from 'esbuild';
await build({
  entryPoints: ['../server/src/next-handler.ts'], bundle: true, platform: 'node', format: 'esm',
  target: 'node20', packages: 'external', outfile: 'lib/crm-server.mjs', logLevel: 'warning',
});
console.log('lib/crm-server.mjs listo');
