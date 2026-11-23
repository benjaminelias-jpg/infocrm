import { manejar } from '../../../lib/crm-server.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Todo /api/* (y, por los rewrites de next.config, /webhooks, /instagram,
// /recursos/pub, /mcp y /salud) lo atiende el servidor del CRM.
async function h(req: Request, ctx: { params: Promise<{ ruta: string[] }> }) {
  const { ruta } = await ctx.params;
  const partes = ruta[0] === '_crm' ? ruta.slice(1) : ['api', ...ruta];
  return manejar(req, '/' + partes.map(encodeURIComponent).join('/'));
}
export { h as GET, h as POST, h as PUT, h as PATCH, h as DELETE, h as OPTIONS, h as HEAD };
