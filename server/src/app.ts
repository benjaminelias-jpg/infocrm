import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { config } from './config.js';
import { AppError, noAutorizado } from './lib/errores.js';
import { verificarToken, resolverApiKey, type Sesion } from './lib/auth.js';

import rutasAuth from './routes/auth.js';
import rutasCrm from './routes/crm.js';
import rutasContenidos from './routes/contenidos.js';
import rutasAnalitica from './routes/analitica.js';
import rutasWebhooks from './routes/webhooks.js';
import rutasUx_chat from './routes/ux_chat.js';
import rutasUx_leads from './routes/ux_leads.js';
import rutasUx_pipeline from './routes/ux_pipeline.js';
import rutasUx_integraciones from './routes/ux_integraciones.js';
import rutasUx_panel from './routes/ux_panel.js';
import rutasUx_finanzas from './routes/ux_finanzas.js';
import rutasUx_automensajes from './routes/ux_automensajes.js';
import rutasUx_global from './routes/ux_global.js';
import rutasConfig from './routes/configuracion.js';
import rutasInstagram from './routes/instagram.js';
import rutasFinanzas from './routes/finanzas.js';
import rutasRecursos from './routes/recursos.js';
import rutasChat from './routes/chat.js';
import rutasPipelines from './routes/pipelines.js';
import rutasMcp from './routes/mcp.js';

/**
 * Algunas URLs llevan un secreto (la URL del conector de Claude y las de
 * webhooks que se pegan en ManyChat/Stripe). No deben quedar en los logs.
 */
export function urlParaLog(url: string): string {
  return url
    .replace(/^\/mcp\/[^/?#]+/, '/mcp/***')
    .replace(/^\/webhooks\/(?!instagram(?:[/?#]|$)|cron\/)[^/?#]+/, '/webhooks/***')
    .replace(/^\/webhooks\/instagram\/[^/?#]+/, '/webhooks/instagram/***');
}

declare module 'fastify' {
  interface FastifyRequest {
    sesion: Sesion;
  }
}

/** Extrae la sesión de un Bearer JWT o de una clave de API. */
async function autenticar(req: FastifyRequest): Promise<Sesion> {
  const cabecera = req.headers.authorization;
  if (cabecera?.startsWith('Bearer ')) {
    return verificarToken(cabecera.slice(7).trim());
  }
  const apiKey = (req.headers['x-api-key'] as string | undefined)?.trim();
  if (apiKey) {
    const sesion = await resolverApiKey(apiKey);
    if (sesion) return sesion;
    throw noAutorizado('Clave de API inválida o revocada');
  }
  throw noAutorizado('Falta el token de acceso');
}

export async function construirApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.isTest
      ? false
      : {
          level: config.isProd ? 'info' : 'warn',
          transport: config.isProd ? undefined : { target: 'pino-pretty', options: { colorize: true } },
          serializers: {
            req: (req: any) => ({ method: req.method, url: urlParaLog(String(req.url ?? '')), remoteAddress: req.ip }),
          },
        },
    bodyLimit: 4_400_000, // audios del founder (~3 MB) en base64; Vercel corta en 4,5 MB
    trustProxy: true,
  });

  await app.register(cors, { origin: true, credentials: true });

  // JSON guardando también el cuerpo original: hace falta para verificar la
  // firma de Meta (X-Hub-Signature-256) en el webhook de Instagram. Mantiene
  // la protección de Fastify contra prototype poisoning.
  const parserJson = app.getDefaultJsonParser('error', 'ignore');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as any).rawBody = body;
    if (typeof body === 'string' && body.trim() === '') return done(null, {});
    parserJson(req, body as string, done);
  });

  app.decorateRequest('sesion', null as unknown as Sesion);

  // Todo lo que cuelga de /api requiere sesión. /webhooks es público
  // (se autentica con el token secreto de la URL).
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    if (req.url.startsWith('/api/auth/login') || req.url.startsWith('/api/auth/registro')) return;
    req.sesion = await autenticar(req);
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({
        error: err.codigo, mensaje: err.message, detalles: err.detalles,
      });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'peticion_invalida',
        mensaje: 'Los datos enviados no son válidos',
        detalles: err.issues.map((i) => ({ campo: i.path.join('.'), problema: i.message })),
      });
    }
    if ((err as any).statusCode === 400 || (err as any).code === 'FST_ERR_VALIDATION') {
      return reply.code(400).send({ error: 'peticion_invalida', mensaje: err.message });
    }
    req.log?.error({ err }, 'error no controlado');
    return reply.code(500).send({
      error: 'error_interno',
      mensaje: config.isProd ? 'Algo ha fallado en el servidor' : err.message,
    });
  });

  app.get('/salud', async () => ({
    ok: true,
    servicio: 'infocrm',
    entorno: config.env,
    hora: new Date().toISOString(),
  }));

  await app.register(rutasAuth, { prefix: '/api/auth' });
  await app.register(rutasCrm, { prefix: '/api' });
  await app.register(rutasContenidos, { prefix: '/api' });
  await app.register(rutasAnalitica, { prefix: '/api/analitica' });
  await app.register(rutasConfig, { prefix: '/api' });
  // Rutas de Instagram: mezcla /api/* (con sesión) y rutas públicas
  // (/instagram/callback, /webhooks/instagram/*) sin prefijo.
  await app.register(rutasInstagram);
  await app.register(rutasFinanzas, { prefix: '/api' });
  // Recursos: mezcla /api/recursos (con sesión) y /recursos/pub/:token (público).
  await app.register(rutasRecursos);
  await app.register(rutasChat, { prefix: '/api' });
  await app.register(rutasPipelines, { prefix: '/api' });
  await app.register(rutasWebhooks);
  // Conector MCP remoto: Claude se conecta pegando una URL (público, se
  // autentica con la clave de API que va en la URL o en una cabecera).
  await app.register(rutasMcp);
  // Rutas de mejoras de UX, una por zona de la app.
  await app.register(rutasUx_chat, { prefix: '/api/ux/chat' });
  await app.register(rutasUx_leads, { prefix: '/api/ux/leads' });
  await app.register(rutasUx_pipeline, { prefix: '/api/ux/pipeline' });
  await app.register(rutasUx_integraciones, { prefix: '/api/ux/integraciones' });
  await app.register(rutasUx_panel, { prefix: '/api/ux/panel' });
  await app.register(rutasUx_finanzas, { prefix: '/api/ux/finanzas' });
  await app.register(rutasUx_automensajes, { prefix: '/api/ux/automensajes' });
  await app.register(rutasUx_global, { prefix: '/api/ux/global' });

  // En producción, el mismo servicio sirve el panel ya compilado (web/dist).
  // Así el despliegue es UN solo contenedor + Postgres, en vez de dos servicios.
  // WEB_DIST apunta a la carpeta del build; si no existe, no se sirve nada.
  const webDist = process.env.WEB_DIST
    ? resolve(process.env.WEB_DIST)
    : resolve(__dirname, '../../web/dist');
  // En Vercel el panel lo sirve la CDN estática, no la función.
  if (!process.env.VERCEL && existsSync(join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
    // Fallback SPA: cualquier ruta que no sea API/webhooks devuelve index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') &&
          !req.url.startsWith('/webhooks') && !req.url.startsWith('/salud')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'no_encontrado', mensaje: 'Ruta no encontrada' });
    });
    app.log?.info(`Sirviendo el panel desde ${webDist}`);
  }

  return app;
}
