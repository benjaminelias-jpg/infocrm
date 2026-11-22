/**
 * Conector MCP remoto ("Conectá tu Claude" con una sola URL).
 *
 * Habla MCP por HTTP (transporte "Streamable HTTP", modo sin sesión): Claude
 * manda mensajes JSON-RPC por POST y recibe la respuesta en JSON. Así el
 * usuario no instala nada: pega su URL en Claude → Conectores y listo.
 *
 * Cada herramienta se traduce a una llamada a la propia API REST del CRM con
 * la clave de API del usuario, de modo que respeta exactamente los mismos
 * permisos, validaciones y el aislamiento por cuenta que el panel.
 *
 * Las mismas herramientas existen en el servidor MCP local (mcp/src/index.ts)
 * para quien prefiera correrlo en su máquina.
 */

export interface Herramienta {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  /** Cómo se traduce a la API REST del CRM (rutas sin el prefijo /api). */
  peticion: (args: Record<string, any>) => { method: 'GET' | 'POST' | 'PATCH'; ruta: string; body?: unknown };
}

const fecha = (que: string) => ({ type: 'string', description: `${que} en formato ISO (p. ej. 2026-09-01). Opcional.` });
const RANGO = { desde: fecha('Desde'), hasta: fecha('Hasta') };
const UUID = { type: 'string', format: 'uuid' };

function qs(args: Record<string, any>, claves: string[]) {
  const p = new URLSearchParams();
  for (const k of claves) {
    const v = args[k];
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

const LECTURA = { readOnlyHint: true, openWorldHint: false };
const ESCRITURA = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

export const HERRAMIENTAS: Herramienta[] = [
  {
    name: 'resumen',
    title: 'Resumen de KPIs',
    description: 'KPIs del CRM: leads, reuniones, ventas, ingresos, tasas de conversión, ticket medio, valor por lead y cobertura de atribución, en el periodo dado.',
    inputSchema: { type: 'object', properties: RANGO },
    annotations: LECTURA,
    peticion: (a) => ({ method: 'GET', ruta: `/analitica/resumen${qs(a, ['desde', 'hasta'])}` }),
  },
  {
    name: 'rendimiento_por_contenido',
    title: 'Rendimiento por contenido',
    description: 'De qué reel/post vienen los leads, reuniones y ventas. Cada contenido incluye su ROL de rendimiento (prospector/closer/caballo/lastre) y las tasas de conversión. Responde "qué contenido factura".',
    inputSchema: {
      type: 'object',
      properties: { ...RANGO, modelo: { type: 'string', enum: ['primer_toque', 'ultimo_toque'], description: 'Modelo de atribución. Opcional.' } },
    },
    annotations: LECTURA,
    peticion: (a) => ({ method: 'GET', ruta: `/analitica/contenidos${qs(a, ['desde', 'hasta', 'modelo'])}` }),
  },
  {
    name: 'rendimiento_por_angulo',
    title: 'Rendimiento por ángulo',
    description: 'De qué ÁNGULO de contenido (problema/solución/producto/mentalidad/narrativa) y etapa de embudo (TOFU/MOFU/BOFU) vienen los leads y las ventas. Responde "de qué tipo de contenido viene el dinero".',
    inputSchema: { type: 'object', properties: RANGO },
    annotations: LECTURA,
    peticion: (a) => ({ method: 'GET', ruta: `/analitica/angulos${qs(a, ['desde', 'hasta'])}` }),
  },
  {
    name: 'embudo',
    title: 'Embudo',
    description: 'Cuántas oportunidades hay en cada etapa del pipeline y la conversión entre etapas.',
    inputSchema: { type: 'object', properties: RANGO },
    annotations: LECTURA,
    peticion: (a) => ({ method: 'GET', ruta: `/analitica/embudo${qs(a, ['desde', 'hasta'])}` }),
  },
  {
    name: 'buscar_leads',
    title: 'Buscar leads',
    description: 'Lista y filtra leads: por texto (usuario de Instagram, nombre o email), etiqueta o calificación. Ordená por score con orden=score. Devuelve los IDs que piden otras herramientas.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Texto a buscar en usuario, nombre o email' },
        etiqueta: { type: 'string' },
        calificacion: { type: 'string', enum: ['calificado', 'sin_calificar', 'no_calificado'] },
        orden: { type: 'string', enum: ['reciente', 'valor', 'antiguo', 'score'] },
        limite: { type: 'integer', minimum: 1, maximum: 200 },
      },
    },
    annotations: LECTURA,
    peticion: (a) => ({ method: 'GET', ruta: `/leads${qs(a, ['q', 'etiqueta', 'calificacion', 'orden', 'limite'])}` }),
  },
  {
    name: 'lead_detalle',
    title: 'Detalle de un lead',
    description: 'Ficha completa de un lead: datos, score con su desglose, atribución (de qué contenido vino), oportunidades, timeline de eventos y notas.',
    inputSchema: { type: 'object', properties: { lead_id: UUID }, required: ['lead_id'] },
    annotations: LECTURA,
    peticion: (a) => ({ method: 'GET', ruta: `/leads/${encodeURIComponent(a.lead_id)}` }),
  },
  {
    name: 'objetivo_del_mes',
    title: 'Objetivo del mes',
    description: 'El objetivo del mes en curso (leads, calificados, ventas, ingresos) y el progreso real hacia él.',
    inputSchema: { type: 'object', properties: {} },
    annotations: LECTURA,
    peticion: () => ({ method: 'GET', ruta: '/analitica/metas' }),
  },
  {
    name: 'registrar_evento',
    title: 'Registrar un evento',
    description: 'Registra un evento en el CRM (recurso_entregado, respondio_dm, reunion_agendada, reunion_realizada, reunion_no_asistio, venta, reembolso, nota…). Identificá al lead por lead_id o por ig_username/email. Una venta mueve la oportunidad a ganada y actualiza el score.',
    inputSchema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', description: 'Tipo de evento, p. ej. "venta" o "reunion_agendada"' },
        lead_id: UUID,
        ig_username: { type: 'string', description: 'Si no pasás lead_id, identificá al lead por su usuario de Instagram' },
        email: { type: 'string' },
        valor: { type: 'number', description: 'Importe, para ventas' },
        moneda: { type: 'string' },
        titulo: { type: 'string', description: 'Nombre del producto, para ventas' },
        tipo_pago: { type: 'string', enum: ['completo', 'cuotas'], description: 'Para ventas: pago completo o en cuotas' },
      },
      required: ['tipo'],
    },
    annotations: ESCRITURA,
    peticion: (a) => {
      const body: Record<string, unknown> = { tipo: a.tipo, valor: a.valor, moneda: a.moneda, titulo: a.titulo, tipo_pago: a.tipo_pago };
      if (a.lead_id) body.lead_id = a.lead_id;
      else body.identidad = { igUsername: a.ig_username, email: a.email };
      return { method: 'POST', ruta: '/eventos', body };
    },
  },
  {
    name: 'mover_etapa',
    title: 'Mover una oportunidad de etapa',
    description: 'Mueve una oportunidad a otra etapa del pipeline (lo mismo que arrastrar la tarjeta en el kanban).',
    inputSchema: { type: 'object', properties: { oportunidad_id: UUID, etapa_id: UUID }, required: ['oportunidad_id', 'etapa_id'] },
    annotations: { ...ESCRITURA, idempotentHint: true },
    peticion: (a) => ({ method: 'POST', ruta: `/oportunidades/${encodeURIComponent(a.oportunidad_id)}/etapa`, body: { etapa_id: a.etapa_id } }),
  },
  {
    name: 'clasificar_contenido',
    title: 'Asignar ángulo a un contenido',
    description: 'Asigna el ángulo de un contenido (video_abierto/problema/solucion/producto/mentalidad/narrativa/otro). La etapa del embudo se deriva sola.',
    inputSchema: {
      type: 'object',
      properties: {
        contenido_id: UUID,
        angulo: { type: 'string', enum: ['video_abierto', 'problema', 'solucion', 'producto', 'mentalidad', 'narrativa', 'otro'] },
      },
      required: ['contenido_id', 'angulo'],
    },
    annotations: { ...ESCRITURA, idempotentHint: true },
    peticion: (a) => ({ method: 'PATCH', ruta: `/contenidos/${encodeURIComponent(a.contenido_id)}`, body: { angulo: a.angulo } }),
  },
  {
    name: 'crear_nota',
    title: 'Agregar una nota a un lead',
    description: 'Deja una nota en la ficha de un lead.',
    inputSchema: { type: 'object', properties: { lead_id: UUID, cuerpo: { type: 'string', minLength: 1 } }, required: ['lead_id', 'cuerpo'] },
    annotations: ESCRITURA,
    peticion: (a) => ({ method: 'POST', ruta: `/leads/${encodeURIComponent(a.lead_id)}/notas`, body: { cuerpo: a.cuerpo } }),
  },
];

/** Versiones del protocolo MCP que entendemos (la primera es la más nueva). */
export const VERSIONES_MCP = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

export const INSTRUCCIONES_MCP =
  'Herramientas del CRM InfoCRM (Instagram, leads, pipeline y ventas) de la cuenta del usuario. ' +
  'Para hablar de un lead concreto, primero buscalo con buscar_leads y usá su id. ' +
  'Los importes están en la moneda de la cuenta. Respondé en el idioma del usuario.';

/** Lo que necesita el despachador para ejecutar una herramienta contra la API. */
export type LlamarApi = (method: 'GET' | 'POST' | 'PATCH', ruta: string, body?: unknown) =>
  Promise<{ status: number; datos: any }>;

type Mensaje = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any; result?: unknown; error?: unknown };

const respuesta = (id: Mensaje['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result });
const fallo = (id: Mensaje['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** Faltan argumentos obligatorios → mensaje claro para el modelo en vez de un 400 críptico. */
function faltantes(h: Herramienta, args: Record<string, any>) {
  return (h.inputSchema.required ?? []).filter((k) => args[k] === undefined || args[k] === null || args[k] === '');
}

/** Opciones de la conexión: con soloLectura, Claude mira pero no toca nada. */
export interface OpcionesMcp { soloLectura?: boolean }

export const MENSAJE_SOLO_LECTURA =
  'Esta conexión de Claude es de solo lectura: puede mirar tus números y leads, pero no hacer cambios. ' +
  'Para permitirlo, en InfoCRM → Configuración → Tu Claude activá «Que también pueda hacer cambios».';

const esLectura = (h: Herramienta) => h.annotations?.readOnlyHint === true;

/**
 * Atiende UN mensaje JSON-RPC. Devuelve la respuesta, o null si era una
 * notificación o una respuesta del cliente (no llevan respuesta).
 */
export async function atenderMensajeMcp(m: Mensaje, llamar: LlamarApi, opciones: OpcionesMcp = {}): Promise<object | null> {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return fallo(null, -32600, 'Petición inválida');
  // Respuestas del cliente o notificaciones (sin id): no se contestan.
  if (m.method === undefined) return null;
  const esNotificacion = m.id === undefined || m.id === null;
  if (esNotificacion) return null;

  switch (m.method) {
    case 'initialize': {
      const pedida = String(m.params?.protocolVersion ?? '');
      return respuesta(m.id, {
        protocolVersion: VERSIONES_MCP.includes(pedida) ? pedida : VERSIONES_MCP[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'infocrm', title: 'InfoCRM', version: '1.1.0' },
        instructions: opciones.soloLectura
          ? `${INSTRUCCIONES_MCP} Esta conexión es de solo lectura: no puede hacer cambios en el CRM.`
          : INSTRUCCIONES_MCP,
      });
    }
    case 'ping':
      return respuesta(m.id, {});
    case 'tools/list':
      return respuesta(m.id, {
        tools: HERRAMIENTAS.filter((h) => !opciones.soloLectura || esLectura(h)).map(({ peticion: _p, ...h }) => h),
      });
    case 'tools/call': {
      const nombre = String(m.params?.name ?? '');
      const h = HERRAMIENTAS.find((x) => x.name === nombre);
      if (!h) return fallo(m.id, -32602, `Herramienta desconocida: ${nombre}`);
      if (opciones.soloLectura && !esLectura(h)) {
        return respuesta(m.id, { content: [{ type: 'text', text: MENSAJE_SOLO_LECTURA }], isError: true });
      }
      const args = (m.params?.arguments && typeof m.params.arguments === 'object') ? m.params.arguments : {};
      const sinDar = faltantes(h, args);
      if (sinDar.length) {
        return respuesta(m.id, {
          content: [{ type: 'text', text: `Faltan datos para "${h.name}": ${sinDar.join(', ')}.` }],
          isError: true,
        });
      }
      try {
        const p = h.peticion(args);
        const r = await llamar(p.method, p.ruta, p.body);
        if (r.status >= 400) {
          const msg = r.datos?.mensaje ?? r.datos?.error ?? `HTTP ${r.status}`;
          const detalle = Array.isArray(r.datos?.detalles) && r.datos.detalles.length
            ? ` (${r.datos.detalles.map((d: any) => `${d.campo}: ${d.problema}`).join('; ')})` : '';
          return respuesta(m.id, { content: [{ type: 'text', text: `El CRM respondió ${r.status}: ${msg}${detalle}` }], isError: true });
        }
        return respuesta(m.id, { content: [{ type: 'text', text: JSON.stringify(r.datos ?? null, null, 2) }] });
      } catch (e) {
        return respuesta(m.id, { content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true });
      }
    }
    // Sin recursos ni prompts: listas vacías para clientes que las piden igual.
    case 'resources/list':
      return respuesta(m.id, { resources: [] });
    case 'resources/templates/list':
      return respuesta(m.id, { resourceTemplates: [] });
    case 'prompts/list':
      return respuesta(m.id, { prompts: [] });
    default:
      return fallo(m.id, -32601, `Método no soportado: ${m.method}`);
  }
}
