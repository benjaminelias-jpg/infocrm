import path from 'node:path';
const aqui = path.dirname(new URL(import.meta.url).pathname);
/** @type {import('next').NextConfig} */
const PREFIJOS = ['webhooks', 'instagram', 'recursos/pub', 'mcp', 'salud'];
export default {
  experimental: { externalDir: true },
  outputFileTracingRoot: path.join(aqui, '..'),
  serverExternalPackages: ['fastify', '@fastify/cors', '@fastify/static', 'pg', 'bcryptjs', 'jsonwebtoken', 'zod', 'dotenv', 'pino-pretty'],
  async rewrites() {
    return { beforeFiles: PREFIJOS.flatMap((p) => [
      { source: `/${p}`, destination: `/api/_crm/${p}` },
      { source: `/${p}/:resto*`, destination: `/api/_crm/${p}/:resto*` },
    ]) };
  },
  // El código de ../web usa las mismas librerías: que salgan de next/node_modules (una sola React).
  webpack(config) {
    for (const m of ['react-router-dom', '@xyflow/react']) config.resolve.alias[m] = path.join(aqui, 'node_modules', m);
    return config;
  },
  typescript: { ignoreBuildErrors: true }, // los tipos se revisan en web/ y server/ con su propio tsc
  eslint: { ignoreDuringBuilds: true },
};
