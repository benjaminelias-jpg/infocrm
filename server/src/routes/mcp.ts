import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { resolverApiKey } from '../lib/auth.js';
import { atenderMensajeMcp, type LlamarApi } from '../modules/mcp_remoto.js';

// Conector MCP remoto: la URL que el usuario pega en Claude → Conectores.
//
//   POST /mcp/<clave>   (la clave de API va en la URL: la URL es la contraseña)
//   POST /mcp           (para clientes que mandan la clave en una cabecera:
//                        x-api-key: ic_…  o  Authorization: Bearer ic_…)
//
// Transporte "Streamable HTTP" sin sesión: cada POST trae uno o varios
// mensajes JSON-RPC y la respuesta va en JSON. GET (canal SSE) no se ofrece.

function claveDeCabeceras(req: FastifyRequest): string | undefined {
  const x = (req.headers['x-api-key'] as string | undefined)?.trim();
  if (x) return x;
  const auth = req.headers.authorization?.trim();
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return undefined;
}

export default async function rutasMcp(app: FastifyInstance) {
  async function manejar(req: FastifyRequest, reply: FastifyReply, claveUrl?: string) {
    const clave = claveUrl ?? claveDeCabeceras(req);
    const sesion = clave ? await resolverApiKey(clave) : null;
    if (!clave || !sesion) {
      return reply.code(401).send({
        jsonrpc: '2.0', id: null,
        error: { code: -32001, message: 'Clave inválida o borrada. Creá una nueva en InfoCRM → Configuración → Claude.' },
      });
    }

    // Cada herramienta llama a la API del propio CRM con la clave del usuario.
    const llamar: LlamarApi = async (method, ruta, body) => {
      const r = await app.inject({
        method,
        url: `/api${ruta}`,
        headers: {
          'x-api-key': clave,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        payload: body !== undefined ? JSON.stringify(body) : undefined,
      });
      let datos: any = null;
      try { datos = r.body ? JSON.parse(r.body) : null; } catch { datos = r.body; }
      return { status: r.statusCode, datos };
    };

    const cuerpo = req.body as any;
    if (Array.isArray(cuerpo)) {
      if (cuerpo.length === 0) {
        return reply.code(400).send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Lote vacío' } });
      }
      const respuestas = (await Promise.all(cuerpo.map((m) => atenderMensajeMcp(m, llamar)))).filter(Boolean);
      return respuestas.length ? reply.send(respuestas) : reply.code(202).send();
    }
    if (!cuerpo || typeof cuerpo !== 'object') {
      return reply.code(400).send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Se esperaba JSON-RPC' } });
    }
    const r = await atenderMensajeMcp(cuerpo, llamar);
    return r ? reply.send(r) : reply.code(202).send();
  }

  const sinCanal = async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.code(405).header('allow', 'POST').send({ error: 'metodo_no_permitido', mensaje: 'Este conector solo acepta POST.' });

  app.post('/mcp', (req, reply) => manejar(req, reply));
  app.post('/mcp/:clave', (req, reply) => manejar(req, reply, (req.params as { clave: string }).clave));
  for (const ruta of ['/mcp', '/mcp/:clave']) {
    app.get(ruta, sinCanal);
    app.delete(ruta, sinCanal);
  }
}
