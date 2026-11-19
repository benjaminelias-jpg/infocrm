// Entrada serverless para Vercel. Envuelve la app Fastify como una función:
// la construye una vez por instancia y reenvía cada petición. Las migraciones
// NO corren aquí (se aplican en el build, que sí tiene los .sql en disco).
import { construirApp } from './app.js';

let listo: Promise<any> | null = null;

async function arrancar() {
  const app = await construirApp();
  await app.ready();
  return app;
}

export default async function handler(req: any, res: any) {
  listo ??= arrancar();
  const app = await listo;
  app.server.emit('request', req, res);
}
