import { build } from 'esbuild';
await build({
  entryPoints: ['server/src/vercel-app.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',       // fastify, pg, etc. se resuelven en runtime
  outfile: 'api/_bundle.mjs',
  logLevel: 'info',
});
console.log('api/_bundle.mjs listo');
