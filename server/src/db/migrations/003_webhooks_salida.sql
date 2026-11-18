-- =====================================================================
-- Migración 003: webhooks de salida (conectar el CRM con otras apps)
-- =====================================================================
-- El CRM ya RECIBE webhooks. Esto le da la otra dirección: cuando pasa
-- algo (lead nuevo, reunión, venta…), avisa por POST a las URLs que
-- suscribas — Zapier, Make, n8n, Slack, tu propio backend. Firma cada
-- envío con HMAC y guarda el registro de cada entrega para poder
-- reintentar lo que falle.
-- =====================================================================

CREATE TABLE suscripciones_webhook (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id       uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  nombre          text        NOT NULL,
  url             text        NOT NULL,
  -- Qué eventos disparan el envío. '*' = todos.
  eventos         text[]      NOT NULL DEFAULT '{*}',
  -- Secreto para firmar (HMAC-SHA256) el cuerpo. El receptor lo verifica.
  secreto         text        NOT NULL,
  cabeceras       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  activo          boolean     NOT NULL DEFAULT true,
  total_enviados  bigint      NOT NULL DEFAULT 0,
  total_fallos    bigint      NOT NULL DEFAULT 0,
  ultimo_envio_en timestamptz,
  ultimo_error    text,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX suscripciones_webhook_cuenta_idx
  ON suscripciones_webhook (cuenta_id) WHERE activo;

CREATE TABLE entregas_webhook (
  id              bigserial PRIMARY KEY,
  cuenta_id       uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  suscripcion_id  uuid        NOT NULL REFERENCES suscripciones_webhook(id) ON DELETE CASCADE,
  evento_id       bigint      REFERENCES eventos(id) ON DELETE SET NULL,
  tipo_evento     text        NOT NULL,
  url             text        NOT NULL,
  payload         jsonb       NOT NULL,
  estado          text        NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente','entregado','error')),
  intentos        integer     NOT NULL DEFAULT 0,
  http_status     integer,
  respuesta       text,
  error           text,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  entregado_en    timestamptz
);

CREATE INDEX entregas_webhook_suscripcion_idx
  ON entregas_webhook (suscripcion_id, creado_en DESC);
CREATE INDEX entregas_webhook_estado_idx
  ON entregas_webhook (cuenta_id, estado, creado_en DESC);

CREATE TRIGGER suscripciones_webhook_actualizado
  BEFORE UPDATE ON suscripciones_webhook
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
