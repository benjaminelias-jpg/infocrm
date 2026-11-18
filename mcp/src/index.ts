#!/usr/bin/env -S npx tsx
/**
 * Servidor MCP de InfoCRM.
 *
 * Expone el CRM como herramientas para cualquier cliente MCP (Claude
 * Desktop, Claude Code, etc.). El usuario lo conecta a SU Claude con una
 * API key de su cuenta, y entonces Claude puede leer y actuar sobre los
 * datos de su CRM: "¿de qué ángulo vinieron más ventas este mes?",
 * "marca este lead como venta", "mueve a Ana a reunión agendada".
 *
 * Autenticación: una API key de InfoCRM (Conexiones → Claves de API en el
 * panel). Se pasa por la cabecera x-api-key a la propia API REST del CRM,
 * así el MCP respeta exactamente los permisos y el aislamiento por cuenta.
 *
 * Variables de entorno:
 *   INFOCRM_API_URL   URL de la API del CRM (por defecto http://localhost:4000)
 *   INFOCRM_API_KEY   la clave de API de la cuenta (obligatoria)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_URL = (process.env.INFOCRM_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const API_KEY = process.env.INFOCRM_API_KEY ?? '';

if (!API_KEY) {
  console.error('Falta INFOCRM_API_KEY. Genera una clave en el panel (Conexiones → Claves de API) ' +
    'y expórtala antes de arrancar el servidor MCP.');
  process.exit(1);
}

async function crm(ruta: string, opciones: { method?: string; body?: unknown } = {}): Promise<any> {
  const res = await fetch(`${API_URL}/api${ruta}`, {
    method: opciones.method ?? 'GET',
    headers: {
      'x-api-key': API_KEY,
      ...(opciones.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: opciones.body !== undefined ? JSON.stringify(opciones.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const texto = await res.text();
  let datos: any;
  try { datos = texto ? JSON.parse(texto) : null; } catch { datos = texto; }
  if (!res.ok) {
    const msg = (datos && datos.mensaje) ? datos.mensaje : `HTTP ${res.status}`;
    throw new Error(`La API del CRM respondió ${res.status}: ${msg}`);
  }
  return datos;
}

/** Envuelve el resultado como texto JSON legible para el modelo. */
function texto(datos: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(datos, null, 2) }] };
}

function error(e: unknown) {
  return {
    content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
    isError: true,
  };
}

const rango = {
  desde: z.string().optional().describe('ISO desde (p. ej. 2026-09-01). Opcional.'),
  hasta: z.string().optional().describe('ISO hasta. Opcional.'),
};

const server = new McpServer({ name: 'infocrm', version: '1.0.0' });

// ---------------------------------------------------------------------
// Analítica (lectura)
// ---------------------------------------------------------------------

server.registerTool('resumen', {
  title: 'Resumen de KPIs',
  description: 'KPIs del CRM: leads, reuniones, ventas, ingresos, tasas de conversión, ticket medio, valor por lead y cobertura de atribución, en el periodo dado.',
  inputSchema: rango,
}, async ({ desde, hasta }) => {
  try {
    const q = new URLSearchParams();
    if (desde) q.set('desde', desde);
    if (hasta) q.set('hasta', hasta);
    return texto(await crm(`/analitica/resumen?${q}`));
  } catch (e) { return error(e); }
});

server.registerTool('rendimiento_por_contenido', {
  title: 'Rendimiento por contenido',
  description: 'De qué reel/post vienen los leads, reuniones y ventas. Cada contenido incluye su ROL de rendimiento (prospector/closer/caballo/lastre) y las tasas de conversión. Responde "qué contenido factura".',
  inputSchema: { ...rango, modelo: z.enum(['primer_toque', 'ultimo_toque']).optional() },
}, async ({ desde, hasta, modelo }) => {
  try {
    const q = new URLSearchParams();
    if (desde) q.set('desde', desde);
    if (hasta) q.set('hasta', hasta);
    if (modelo) q.set('modelo', modelo);
    return texto(await crm(`/analitica/contenidos?${q}`));
  } catch (e) { return error(e); }
});

server.registerTool('rendimiento_por_angulo', {
  title: 'Rendimiento por ángulo',
  description: 'De qué ÁNGULO de contenido (problema/solución/producto/mentalidad/narrativa) y etapa de embudo (TOFU/MOFU/BOFU) vienen los leads y las ventas. Responde "de qué tipo de contenido viene el dinero".',
  inputSchema: rango,
}, async ({ desde, hasta }) => {
  try {
    const q = new URLSearchParams();
    if (desde) q.set('desde', desde);
    if (hasta) q.set('hasta', hasta);
    return texto(await crm(`/analitica/angulos?${q}`));
  } catch (e) { return error(e); }
});

server.registerTool('embudo', {
  title: 'Embudo',
  description: 'Cuántas oportunidades hay en cada etapa del pipeline y la conversión entre etapas.',
  inputSchema: rango,
}, async ({ desde, hasta }) => {
  try {
    const q = new URLSearchParams();
    if (desde) q.set('desde', desde);
    if (hasta) q.set('hasta', hasta);
    return texto(await crm(`/analitica/embudo?${q}`));
  } catch (e) { return error(e); }
});

// ---------------------------------------------------------------------
// Leads (lectura)
// ---------------------------------------------------------------------

server.registerTool('buscar_leads', {
  title: 'Buscar leads',
  description: 'Lista y filtra leads: por texto (usuario/nombre/email), etiqueta, calificación (calificado/sin_calificar/no_calificado), contenido de origen, o sin atribuir. Ordena por score con orden=score.',
  inputSchema: {
    q: z.string().optional().describe('Texto a buscar en usuario, nombre o email'),
    etiqueta: z.string().optional(),
    calificacion: z.enum(['calificado', 'sin_calificar', 'no_calificado']).optional(),
    orden: z.enum(['reciente', 'valor', 'antiguo', 'score']).optional(),
    limite: z.number().int().min(1).max(200).optional(),
  },
}, async (args) => {
  try {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(args)) if (v !== undefined) q.set(k, String(v));
    return texto(await crm(`/leads?${q}`));
  } catch (e) { return error(e); }
});

server.registerTool('lead_detalle', {
  title: 'Detalle de un lead',
  description: 'Ficha completa de un lead: datos, score con su desglose, atribución (de qué contenido vino), oportunidades, timeline de eventos y notas.',
  inputSchema: { lead_id: z.string().uuid() },
}, async ({ lead_id }) => {
  try { return texto(await crm(`/leads/${lead_id}`)); } catch (e) { return error(e); }
});

// ---------------------------------------------------------------------
// Acciones (escritura)
// ---------------------------------------------------------------------

server.registerTool('registrar_evento', {
  title: 'Registrar un evento',
  description: 'Registra un evento en el CRM (recurso_entregado, respondio_dm, reunion_agendada, reunion_realizada, reunion_no_asistio, venta, reembolso, nota…). Identifica al lead por lead_id o por identidad (ig_username/email). Una venta mueve la oportunidad a ganada y actualiza el score.',
  inputSchema: {
    tipo: z.string().describe('Tipo de evento, p. ej. "venta" o "reunion_agendada"'),
    lead_id: z.string().uuid().optional(),
    ig_username: z.string().optional().describe('Si no pasas lead_id, identifica al lead por su usuario de Instagram'),
    email: z.string().optional(),
    valor: z.number().optional().describe('Importe, para ventas'),
    moneda: z.string().optional(),
    titulo: z.string().optional().describe('Nombre del producto, para ventas'),
  },
}, async ({ tipo, lead_id, ig_username, email, valor, moneda, titulo }) => {
  try {
    const body: any = { tipo, valor, moneda, titulo };
    if (lead_id) body.lead_id = lead_id;
    else body.identidad = { igUsername: ig_username, email };
    return texto(await crm('/eventos', { method: 'POST', body }));
  } catch (e) { return error(e); }
});

server.registerTool('mover_etapa', {
  title: 'Mover una oportunidad de etapa',
  description: 'Mueve una oportunidad a otra etapa del pipeline (arrastre del kanban por API).',
  inputSchema: { oportunidad_id: z.string().uuid(), etapa_id: z.string().uuid() },
}, async ({ oportunidad_id, etapa_id }) => {
  try {
    return texto(await crm(`/oportunidades/${oportunidad_id}/etapa`, {
      method: 'POST', body: { etapa_id },
    }));
  } catch (e) { return error(e); }
});

server.registerTool('clasificar_contenido', {
  title: 'Asignar ángulo a un contenido',
  description: 'Asigna el ángulo de un contenido (video_abierto/problema/solucion/producto/mentalidad/narrativa). La etapa del embudo se deriva sola.',
  inputSchema: {
    contenido_id: z.string().uuid(),
    angulo: z.enum(['video_abierto', 'problema', 'solucion', 'producto', 'mentalidad', 'narrativa', 'otro']),
  },
}, async ({ contenido_id, angulo }) => {
  try {
    return texto(await crm(`/contenidos/${contenido_id}`, { method: 'PATCH', body: { angulo } }));
  } catch (e) { return error(e); }
});

server.registerTool('crear_nota', {
  title: 'Añadir una nota a un lead',
  description: 'Deja una nota en la ficha de un lead.',
  inputSchema: { lead_id: z.string().uuid(), cuerpo: z.string().min(1) },
}, async ({ lead_id, cuerpo }) => {
  try {
    return texto(await crm(`/leads/${lead_id}/notas`, { method: 'POST', body: { cuerpo } }));
  } catch (e) { return error(e); }
});

// ---------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`InfoCRM MCP conectado a ${API_URL}`);
}

main().catch((err) => {
  console.error('No se pudo arrancar el servidor MCP:', err);
  process.exit(1);
});
