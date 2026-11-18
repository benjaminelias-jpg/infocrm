-- =====================================================================
-- Migración 004: lo que añade el vídeo de Lautaro Barruffaldi
-- =====================================================================
-- El vídeo describe el mismo sistema ManyChat→webhook→CRM→atribución que
-- ya teníamos (ellos a mano con Airtable). Estas columnas recogen lo
-- distintivo que sí aporta:
--   · Calificación por GRADOS (su "DSBA"): 3 criterios → grado D/S/B/A.
--   · TIPO DE PAGO: de qué contenido viene quien paga completo vs en cuotas.
--   · OBJETIVO y ESTADO del contenido: venta/audiencia/alcance · comprobado.
--   · OBJETIVO DEL MES con progreso.
-- Todo aditivo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Calificación por grados (sistema "DSBA" del vídeo)
-- ---------------------------------------------------------------------
-- Tres criterios que el setter marca. El grado sale de cuántos se cumplen:
-- 0→D (malísimo), 1→S (aún no), 2→B (apto para venta), 3→A (perfecto).
-- Convive con el score (conductual): el grado es el juicio explícito.

ALTER TABLE leads
  ADD COLUMN calif_c1 boolean NOT NULL DEFAULT false,
  ADD COLUMN calif_c2 boolean NOT NULL DEFAULT false,
  ADD COLUMN calif_c3 boolean NOT NULL DEFAULT false,
  ADD COLUMN grado    text    NOT NULL DEFAULT 'D';

ALTER TABLE leads
  ADD CONSTRAINT leads_grado_chk CHECK (grado IN ('A', 'B', 'S', 'D'));

CREATE INDEX leads_grado_idx ON leads (cuenta_id, grado);

-- Nombres de los tres criterios, por cuenta (editables). Valores por defecto.
ALTER TABLE cuentas
  ADD COLUMN criterios_calif jsonb NOT NULL DEFAULT
    '["Tiene presupuesto","Es el decisor","Tiene el problema que resolvemos"]'::jsonb;

-- ---------------------------------------------------------------------
-- Tipo de pago en la venta
-- ---------------------------------------------------------------------
-- "de qué video viene quien paga pif (todo de una) vs en cuotas y nunca
-- termina de pagar". pago_completado = false marca al que dejó de pagar.

ALTER TABLE oportunidades
  ADD COLUMN tipo_pago       text,
  ADD COLUMN pago_completado boolean NOT NULL DEFAULT true;

ALTER TABLE oportunidades
  ADD CONSTRAINT oportunidades_tipo_pago_chk CHECK (
    tipo_pago IS NULL OR tipo_pago IN ('completo', 'cuotas')
  );

-- ---------------------------------------------------------------------
-- Objetivo y estado de validación del contenido
-- ---------------------------------------------------------------------
-- objetivo = para qué sirve esta pieza (intención declarada por el autor),
--   complementa el ROL (que es el resultado medido).
-- estado_validacion = dónde está en el ciclo de prueba del método.

ALTER TABLE contenidos
  ADD COLUMN objetivo          text,
  ADD COLUMN estado_validacion text NOT NULL DEFAULT 'probando';

ALTER TABLE contenidos
  ADD CONSTRAINT contenidos_objetivo_chk CHECK (
    objetivo IS NULL OR objetivo IN ('venta', 'audiencia', 'alcance')
  );
ALTER TABLE contenidos
  ADD CONSTRAINT contenidos_estado_val_chk CHECK (
    estado_validacion IN ('probando', 'posible', 'comprobado')
  );

-- ---------------------------------------------------------------------
-- Objetivo del mes
-- ---------------------------------------------------------------------

CREATE TABLE metas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id        uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  mes              date        NOT NULL,           -- primer día del mes
  leads_meta       integer     NOT NULL DEFAULT 0,
  calificados_meta integer     NOT NULL DEFAULT 0,
  ventas_meta      integer     NOT NULL DEFAULT 0,
  ingresos_meta    numeric(14,2) NOT NULL DEFAULT 0,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cuenta_id, mes)
);
