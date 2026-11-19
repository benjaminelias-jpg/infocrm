import 'dotenv/config';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isTest,
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl: isTest
    ? req('DATABASE_URL_TEST', 'postgres://postgres@127.0.0.1:5432/infocrm_test')
    : req('DATABASE_URL', 'postgres://postgres@127.0.0.1:5432/infocrm'),
  jwtSecret: req('JWT_SECRET', 'dev-secret-cambiar-en-produccion'),
  jwtExpiresInSegundos: 60 * 60 * 24 * 7,
  // La URL pública llega sola por env en los hosts habituales; se usa como
  // respaldo para no fijar API_URL/APP_URL a mano tras el primer deploy.
  appUrl: process.env.APP_URL ?? urlPublica() ?? 'http://localhost:5173',
  apiUrl: process.env.API_URL ?? urlPublica() ?? 'http://localhost:4000',
};

function urlPublica(): string | undefined {
  // Vercel: dominio estable de producción. Render: URL externa.
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return undefined;
}
