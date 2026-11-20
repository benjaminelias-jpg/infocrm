// Textos para la gente: los valores que guarda la base ("en_cuotas",
// "closer_setter", "lead_creado") se muestran en palabras, con su color.
// Uso: <Estado tipo="venta" valor={v.estado} /> o textoDe('rol', 'team_lead').

import type { Tono } from './ui';

type Diccionario = Record<string, { texto: string; tono?: Tono }>;

export const TEXTOS: Record<string, Diccionario> = {
  // Ventas (Finanzas)
  venta: {
    // "activa" = venta cargada que todavía no se terminó de cobrar.
    activa: { texto: 'Por cobrar', tono: 'amarillo' },
    completada: { texto: 'Pagada', tono: 'verde' },
    en_cuotas: { texto: 'En cuotas', tono: 'azul' },
    en_mora: { texto: 'Atrasada', tono: 'rojo' },
    cancelada: { texto: 'Cancelada', tono: 'neutro' },
    reembolsada: { texto: 'Devuelta', tono: 'rojo' },
    senado: { texto: 'Señada', tono: 'amarillo' },
  },
  // Cobros / cuotas
  pago: {
    pendiente: { texto: 'Por cobrar', tono: 'amarillo' },
    pagado: { texto: 'Cobrado', tono: 'verde' },
    fallido: { texto: 'Rechazado', tono: 'rojo' },
    reembolsado: { texto: 'Devuelto', tono: 'rojo' },
    reagendado: { texto: 'Reprogramado', tono: 'azul' },
    atrasada: { texto: 'Atrasada', tono: 'rojo' },
  },
  metodo: {
    tarjeta: { texto: 'Tarjeta' },
    transferencia: { texto: 'Transferencia' },
    pasarela: { texto: 'Pasarela de pago' },
    billetera: { texto: 'Billetera virtual' },
    efectivo: { texto: 'Efectivo' },
    crypto: { texto: 'Cripto' },
    otro: { texto: 'Otro' },
  },
  categoria_gasto: {
    herramientas: { texto: 'Herramientas' },
    ads: { texto: 'Publicidad' },
    comisiones_ventas: { texto: 'Comisiones de ventas' },
    comisiones_pasarela: { texto: 'Comisiones de la pasarela' },
    freelancers: { texto: 'Freelancers' },
    administracion: { texto: 'Administración' },
    otros: { texto: 'Otros' },
  },
  centro_coste: {
    marketing: { texto: 'Marketing' }, ventas: { texto: 'Ventas' }, operaciones: { texto: 'Operaciones' },
    administracion: { texto: 'Administración' }, otro: { texto: 'Otro' },
  },
  tipo_gasto: { fijo: { texto: 'Fijo' }, variable: { texto: 'Variable' }, unico: { texto: 'Único' } },
  tipo_cobro: { unico: { texto: 'Pago único' }, cuotas: { texto: 'En cuotas' } },
  // Personas
  rol_equipo: {
    closer: { texto: 'Closer' }, setter: { texto: 'Setter' }, closer_setter: { texto: 'Closer y setter' },
    team_lead: { texto: 'Líder de equipo' }, otro: { texto: 'Otro' },
  },
  rol_usuario: {
    owner: { texto: 'Dueño' }, admin: { texto: 'Administrador' }, closer: { texto: 'Closer' },
    setter: { texto: 'Setter' }, solo_lectura: { texto: 'Solo lectura' },
  },
  // Leads
  calificacion: {
    calificado: { texto: 'Calificado', tono: 'verde' },
    sin_calificar: { texto: 'Sin calificar', tono: 'neutro' },
    no_calificado: { texto: 'No califica', tono: 'rojo' },
  },
  temperatura: { hot: { texto: 'Caliente', tono: 'rojo' }, warm: { texto: 'Tibio', tono: 'amarillo' }, cold: { texto: 'Frío', tono: 'azul' } },
  prioridad: { alta: { texto: 'Alta', tono: 'rojo' }, media: { texto: 'Media', tono: 'amarillo' }, baja: { texto: 'Baja', tono: 'neutro' } },
  oportunidad: { abierta: { texto: 'Abierta', tono: 'azul' }, ganada: { texto: 'Ganada', tono: 'verde' }, perdida: { texto: 'Perdida', tono: 'rojo' } },
  origen: {
    comentario: { texto: 'Comentario' }, dm: { texto: 'Mensaje directo' }, historia: { texto: 'Historia' },
    bio_link: { texto: 'Link de la bio' }, anuncio: { texto: 'Anuncio' }, directo: { texto: 'Directo' }, otro: { texto: 'Otro' },
  },
  reunion: {
    agendada: { texto: 'Agendada', tono: 'azul' }, confirmada: { texto: 'Confirmada', tono: 'verde' },
    proxima: { texto: 'Próxima', tono: 'azul' }, reagendada: { texto: 'Reprogramada', tono: 'amarillo' },
    completada: { texto: 'Hecha', tono: 'verde' }, no_show: { texto: 'No asistió', tono: 'rojo' }, cancelada: { texto: 'Cancelada', tono: 'neutro' },
  },
  resultado_llamada: {
    vendido_unico: { texto: 'Vendió (pago único)', tono: 'verde' }, vendido_cuotas: { texto: 'Vendió (en cuotas)', tono: 'verde' },
    seguimiento: { texto: 'Seguimiento', tono: 'azul' }, no_califica: { texto: 'No califica', tono: 'neutro' },
    no_interesado: { texto: 'No le interesa', tono: 'neutro' }, reagendar: { texto: 'Reprogramar', tono: 'amarillo' }, no_show: { texto: 'No asistió', tono: 'rojo' },
  },
  // Lo que pasa en la vida de un lead (eventos)
  evento: {
    lead_creado: { texto: 'Lead nuevo' }, recurso_entregado: { texto: 'Recurso entregado' }, respondio_dm: { texto: 'Respondió el DM' },
    comentario: { texto: 'Comentó' }, reunion_agendada: { texto: 'Reunión agendada' }, reunion_realizada: { texto: 'Reunión hecha' },
    reunion_no_asistio: { texto: 'No asistió' }, reunion_cancelada: { texto: 'Reunión cancelada' }, venta: { texto: 'Venta' },
    reembolso: { texto: 'Devolución' }, etapa_cambiada: { texto: 'Cambió de etapa' }, etiqueta: { texto: 'Etiqueta' }, nota: { texto: 'Nota' },
    mensaje_enviado: { texto: 'Mensaje enviado' }, mensaje_recibido: { texto: 'Mensaje recibido' }, otro: { texto: 'Otro' }, '*': { texto: 'Todo' },
  },
  // Técnicos (Para técnicos)
  webhook: {
    pendiente: { texto: 'En cola', tono: 'amarillo' }, procesado: { texto: 'Procesado', tono: 'verde' }, error: { texto: 'Con error', tono: 'rojo' },
    ignorado: { texto: 'Ignorado', tono: 'neutro' }, duplicado: { texto: 'Repetido', tono: 'neutro' },
  },
  entrega: { pendiente: { texto: 'En cola', tono: 'amarillo' }, entregado: { texto: 'Entregado', tono: 'verde' }, error: { texto: 'Falló', tono: 'rojo' } },
  integracion: {
    sin_configurar: { texto: 'Sin conectar', tono: 'neutro' }, conectado: { texto: 'Conectado', tono: 'verde' },
    error: { texto: 'Con error', tono: 'rojo' }, expirado: { texto: 'Venció', tono: 'amarillo' },
  },
  contenido: {
    reel: { texto: 'Reel' }, post: { texto: 'Post' }, carrusel: { texto: 'Carrusel' }, historia: { texto: 'Historia' },
    live: { texto: 'Directo' }, anuncio: { texto: 'Anuncio' }, otro: { texto: 'Otro' },
  },
};

/** "en_cuotas" → "En cuotas". Si no está en el diccionario, lo hace legible igual. */
export function textoDe(tipo: string, valor: string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  const t = TEXTOS[tipo]?.[valor]?.texto;
  if (t) return t;
  const limpio = String(valor).replace(/_/g, ' ');
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

export function tonoDe(tipo: string, valor: string | null | undefined): Tono {
  return (valor && TEXTOS[tipo]?.[valor]?.tono) || 'neutro';
}
