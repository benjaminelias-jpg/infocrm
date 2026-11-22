import type { RangoServidor } from './comun';

// Lo que devuelven las rutas de /api/ux/finanzas (y lo que se pasa entre pestañas).

export type Tab = 'resumen' | 'ventas' | 'cobros' | 'gastos' | 'cursos' | 'metodos' | 'equipo';

/** Lo que cada pestaña recibe de la pantalla de Finanzas. */
export interface PropsPestana {
  /** Sube cada vez que algo cambió (una venta nueva, una cuota cobrada…): las pestañas recargan. */
  version: number;
  onCambio: () => void;
  onRegistrarVenta: () => void;
  irA: (tab: Tab, nuevo?: boolean) => void;
  abrirVenta: (id: string) => void;
  /** Abrir el formulario de alta al entrar (desde "Primeros pasos"). */
  nuevo?: boolean;
}

export interface Numeros {
  ventas: number; vendido: number; ticket: number; cobrado: number; comision_cobro: number;
  comision_equipo: number; gastos: number; te_queda: number; cobrado_de_lo_vendido: number;
}

export interface RespResumen {
  periodo: RangoServidor; moneda: string; actual: Numeros; anterior: Numeros | null;
  por_cobrar: { total: number; cuotas: number; atrasado: number; atrasadas: number; semana: number; semana_n: number };
  por_mes: Array<{ mes: string; ventas: number; vendido: number }>;
  primeros_pasos: { cursos: number; metodos: number; equipo: number; ventas: number; gastos: number };
}

export interface VentaFila {
  id: string; fecha: string; lead_id: string | null; lead_nombre: string | null; ig_username: string | null; avatar_url: string | null;
  producto_id: string | null; producto: string | null; closer_id: string | null; closer_nombre: string | null;
  setter_id: string | null; setter_nombre: string | null; pasarela: string | null;
  precio_acordado: number; moneda: string; tipo_cobro: string; estado: string; estado_visible: string; notas: string | null;
  comision_closer_pct: number; comision_setter_pct: number; comision_closer: number; comision_setter: number;
  comision_equipo: number; comision_cobro: number; te_queda: number; cobrado: number;
  cuotas_total: number; cuotas_pagadas: number; por_cobrar: number; atrasadas: number; proxima_vence: string | null;
  origen: string;
}

export interface RespVentas {
  periodo: RangoServidor; moneda: string; ventas: VentaFila[];
  cobros_solos: { conectado: boolean; fuentes: string[]; ventas: number; ultima: string | null };
}

export interface Cobro {
  id: string; venta_id: string; num_cuota: number; monto: number; vence_en: string | null; cobrado_en: string | null;
  estado: string; pasarela: string | null; comision_pasarela: number; cuotas_total: number;
  moneda: string; venta_estado: string; tipo_cobro: string; precio_acordado: number; lead_id: string | null;
  lead_nombre: string | null; ig_username: string | null; avatar_url: string | null; producto: string | null;
}

export interface VentaDetalle extends VentaFila {
  pagos: Cobro[]; metodo_pago_id: string | null; metodo_pct: number; hoy: string;
}

export interface RespCobros { hoy: string; moneda: string; pendientes: Cobro[]; cobradas: Cobro[] }

export interface Curso {
  id: string; nombre: string; precio_lista: number | null; moneda: string; link_pago: string | null; activo: boolean;
  ventas_todas: number; ventas_total: number; ventas_mes: number; vendido_mes: number;
}

export interface Metodo {
  id: string; nombre: string; tipo: string; comision_pct: number; activo: boolean;
  usos: number; cobrado: number; comision: number; sin_comision: number;
}
export interface RespMetodos { periodo: RangoServidor; metodos: Metodo[]; sin_metodo: Array<{ nombre: string; cobros: number; total: number }> }

export interface Gasto {
  id: string; fecha: string; descripcion: string; categoria: string; tipo: string | null; periodicidad: string | null;
  importe: number; moneda: string; notas: string | null; es_comision_ventas?: boolean; es_comision_pasarela?: boolean;
  subcategoria?: string | null; centro_coste?: string | null; metodo?: string | null;
  venta_id?: string | null; pago_id?: string | null; contenido_id?: string | null;
}
export interface RespGastos {
  periodo: RangoServidor; moneda: string; gastos: Gasto[];
  fijos: { mensual: number; cantidad: number; por_cargar: Gasto[] };
}

export interface Miembro {
  clave: string; persona_id: string | null; usuario_id: string | null; nombre: string; email: string | null;
  rol: string | null; rol_usuario: string | null; comision_venta_pct: number | null; activo: boolean;
  acceso: boolean; ultimo_acceso_en: string | null; ventas: number; vendido: number; comision: number;
}
export interface RespEquipo {
  periodo: RangoServidor; puede_gestionar: boolean; yo: string; total_comisiones: number; miembros: Miembro[];
}
