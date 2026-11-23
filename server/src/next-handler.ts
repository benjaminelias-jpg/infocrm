// Entrada para Next.js: el servidor del CRM corre DENTRO de las rutas de API de
// Next (app/api/[...ruta]/route.ts) usando fastify.inject, sin abrir otro puerto.
// Toda la lógica (pipeline, automensajes, Instagram, finanzas) es la misma.
import { construirApp } from './app.js';

let listo: Promise<any> | null = null;
async function app() {
  listo ??= (async () => { const a = await construirApp(); await a.ready(); return a; })();
  return listo;
}

/** Convierte un Request de Next en una llamada al CRM y devuelve su Response. */
export async function manejar(req: Request, ruta: string): Promise<Response> {
  const a = await app();
  const url = new URL(req.url);
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { headers[k] = v; });
  const cuerpo = req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.from(await req.arrayBuffer());
  const r = await a.inject({ method: req.method as any, url: ruta + url.search, headers, payload: cuerpo });
  const salida = new Headers();
  for (const [k, v] of Object.entries(r.headers)) {
    if (v === undefined || ['content-length', 'transfer-encoding', 'connection'].includes(k)) continue;
    for (const x of Array.isArray(v) ? v : [String(v)]) salida.append(k, x);
  }
  return new Response(r.statusCode === 204 || r.statusCode === 304 ? null : r.rawPayload, { status: r.statusCode, headers: salida });
}
