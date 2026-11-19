-- =====================================================================
-- Migración 006: Capa de VENTAS + FINANZAS (inspirada en el Airtable CRM)
-- =====================================================================
-- Añade la operación de cierre high-ticket que faltaba: equipo (closers/
-- setters) con comisiones, productos/ofertas, llamadas/agendas, ventas con
-- cuotas, pagos, gastos (P&L) y métodos de pago. Todo multi-tenant.
-- =====================================================================

-- --- Equipo: closers y setters -------------------------------------
CREATE TABLE personas_equipo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id       uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  nombre          text        NOT NULL,
  email           text,
  telefono        text,
  rol             text        NOT NULL DEFAULT 'closer'
                  CHECK (rol IN ('closer','setter','closer_setter','team_lead','otro')),
  comision_venta_pct   numeric(5,2) NOT NULL DEFAULT 0,   -- % sobre la venta
  comision_cobro_pct   numeric(5,2) NOT NULL DEFAULT 0,   -- % sobre cada cobro
  comision_cita_pct    numeric(5,2) NOT NULL DEFAULT 0,   -- % por cita que se presenta (setter)
  contrato_url    text,
  activo          boolean     NOT NULL DEFAULT true,
  notas           text,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX personas_equipo_cuenta_idx ON personas_equipo (cuenta_id) WHERE activo;

-- --- Productos / ofertas --------------------------------------------
CREATE TABLE productos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id       uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  nombre          text        NOT NULL,
  descripcion     text,
  precio_lista    numeric(12,2),
  moneda          text        NOT NULL DEFAULT 'EUR',
  duracion        text,        -- "3 meses", etc.
  activo          boolean     NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX productos_cuenta_idx ON productos (cuenta_id) WHERE activo;

-- --- Métodos de pago / billeteras -----------------------------------
CREATE TABLE metodos_pago (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id       uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  nombre          text        NOT NULL,
  tipo            text        NOT NULL DEFAULT 'pasarela'
                  CHECK (tipo IN ('tarjeta','transferencia','pasarela','billetera','efectivo','crypto','otro')),
  descripcion     text,
  region          text,
  comision_pct    numeric(5,2) NOT NULL DEFAULT 0,
  activo          boolean     NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX metodos_pago_cuenta_idx ON metodos_pago (cuenta_id) WHERE activo;

-- --- Llamadas / agendas ---------------------------------------------
CREATE TABLE llamadas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id       uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  lead_id         uuid        REFERENCES leads(id) ON DELETE SET NULL,
  setter_id       uuid        REFERENCES personas_equipo(id) ON DELETE SET NULL,
  closer_id       uuid        REFERENCES personas_equipo(id) ON DELETE SET NULL,
  producto_id     uuid        REFERENCES productos(id) ON DELETE SET NULL,
  programado_en   timestamptz,
  tipo            text        NOT NULL DEFAULT 'primera'
                  CHECK (tipo IN ('primera','seguimiento','onboarding','otro')),
  estado          text        NOT NULL DEFAULT 'agendada'
                  CHECK (estado IN ('agendada','confirmada','proxima','reagendada','completada','no_show','cancelada')),
  resultado       text        CHECK (resultado IN ('vendido_unico','vendido_cuotas','seguimiento','no_califica','no_interesado','reagendar','no_show') OR resultado IS NULL),
  valor_propuesto numeric(12,2),
  link_reunion    text,
  link_grabacion  text,
  feedback        text,
  notas           text,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX llamadas_cuenta_idx ON llamadas (cuenta_id, programado_en DESC);
CREATE INDEX llamadas_lead_idx ON llamadas (lead_id);

-- --- Ventas ---------------------------------------------------------
CREATE TABLE ventas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id       uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  lead_id         uuid        REFERENCES leads(id) ON DELETE SET NULL,
  llamada_id      uuid        REFERENCES llamadas(id) ON DELETE SET NULL,
  producto_id     uuid        REFERENCES productos(id) ON DELETE SET NULL,
  setter_id       uuid        REFERENCES personas_equipo(id) ON DELETE SET NULL,
  closer_id       uuid        REFERENCES personas_equipo(id) ON DELETE SET NULL,
  fecha           date        NOT NULL DEFAULT CURRENT_DATE,
  tipo_cobro      text        NOT NULL DEFAULT 'unico' CHECK (tipo_cobro IN ('unico','cuotas')),
  precio_lista    numeric(12,2),
  precio_acordado numeric(12,2) NOT NULL DEFAULT 0,
  moneda          text        NOT NULL DEFAULT 'EUR',
  num_cuotas      integer     NOT NULL DEFAULT 1,
  duracion        text,
  pasarela        text,
  estado          text        NOT NULL DEFAULT 'activa'
                  CHECK (estado IN ('activa','completada','en_cuotas','en_mora','cancelada','reembolsada','senado')),
  comision_setter_pct numeric(5,2) NOT NULL DEFAULT 0,
  comision_closer_pct numeric(5,2) NOT NULL DEFAULT 0,
  notas           text,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ventas_cuenta_idx ON ventas (cuenta_id, fecha DESC);
CREATE INDEX ventas_lead_idx ON ventas (lead_id);

-- --- Pagos (cuotas) -------------------------------------------------
CREATE TABLE pagos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id       uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  venta_id        uuid        NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  num_cuota       integer     NOT NULL DEFAULT 1,
  monto           numeric(12,2) NOT NULL DEFAULT 0,
  vence_en        date,
  cobrado_en      date,
  estado          text        NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente','pagado','fallido','reembolsado','reagendado')),
  pasarela        text,
  comision_pasarela numeric(12,2) NOT NULL DEFAULT 0,
  notas           text,
  creado_en       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pagos_cuenta_idx ON pagos (cuenta_id, vence_en);
CREATE INDEX pagos_venta_idx ON pagos (venta_id);

-- --- Gastos (P&L) ---------------------------------------------------
CREATE TABLE gastos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id       uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  fecha           date        NOT NULL DEFAULT CURRENT_DATE,
  descripcion     text        NOT NULL,
  categoria       text        NOT NULL DEFAULT 'otros'
                  CHECK (categoria IN ('herramientas','ads','comisiones_ventas','comisiones_pasarela','freelancers','administracion','otros')),
  subcategoria    text,
  centro_coste    text        CHECK (centro_coste IN ('marketing','ventas','operaciones','administracion','otro') OR centro_coste IS NULL),
  tipo            text        CHECK (tipo IN ('fijo','variable','unico') OR tipo IS NULL),
  periodicidad    text,
  importe         numeric(12,2) NOT NULL DEFAULT 0,
  moneda          text        NOT NULL DEFAULT 'EUR',
  metodo          text,
  venta_id        uuid        REFERENCES ventas(id) ON DELETE SET NULL,
  pago_id         uuid        REFERENCES pagos(id) ON DELETE SET NULL,
  contenido_id    uuid        REFERENCES contenidos(id) ON DELETE SET NULL,
  es_comision_ventas    boolean NOT NULL DEFAULT false,
  es_comision_pasarela  boolean NOT NULL DEFAULT false,
  notas           text,
  creado_en       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gastos_cuenta_idx ON gastos (cuenta_id, fecha DESC);
CREATE INDEX gastos_contenido_idx ON gastos (contenido_id) WHERE contenido_id IS NOT NULL;

-- --- Seguimientos (follow-ups, normalizados) ------------------------
CREATE TABLE seguimientos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id       uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  lead_id         uuid        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  numero          integer     NOT NULL DEFAULT 1,
  fecha           date        NOT NULL DEFAULT CURRENT_DATE,
  tipo_mensaje    text        CHECK (tipo_mensaje IN ('primer_contacto','recurso_enviado','audio','seguimiento','invitacion_llamada') OR tipo_mensaje IS NULL),
  estado          text        NOT NULL DEFAULT 'enviado'
                  CHECK (estado IN ('enviado','respondido','sin_respuesta')),
  canal           text,
  observaciones   text,
  creado_en       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seguimientos_lead_idx ON seguimientos (lead_id, fecha DESC);

-- --- Extensiones a tablas existentes --------------------------------
-- Contenido: finanzas por pieza (CPL/CPC/CPA se calculan en consultas).
ALTER TABLE contenidos
  ADD COLUMN IF NOT EXISTS inversion_ads  numeric(12,2),
  ADD COLUMN IF NOT EXISTS big_idea       text,
  ADD COLUMN IF NOT EXISTS interest_peak  text,
  ADD COLUMN IF NOT EXISTS cta_principal  text,
  ADD COLUMN IF NOT EXISTS hipotesis      text,
  ADD COLUMN IF NOT EXISTS clicks_dms     integer;

-- Leads: score cualitativo, canal y cierre.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS score_cualitativo text
    CHECK (score_cualitativo IN ('hot','warm','cold') OR score_cualitativo IS NULL),
  ADD COLUMN IF NOT EXISTS closer_id      uuid REFERENCES personas_equipo(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS producto_interes_id uuid REFERENCES productos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resultado_cierre text,
  ADD COLUMN IF NOT EXISTS prioridad      text CHECK (prioridad IN ('alta','media','baja') OR prioridad IS NULL);

-- --- Triggers de actualizado_en -------------------------------------
CREATE TRIGGER personas_equipo_act BEFORE UPDATE ON personas_equipo
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER productos_act BEFORE UPDATE ON productos
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER llamadas_act BEFORE UPDATE ON llamadas
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
CREATE TRIGGER ventas_act BEFORE UPDATE ON ventas
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
