-- =====================================================================
-- Migración 015: integraciones confiables y simples
-- =====================================================================
-- 1) Direcciones de entrada (webhooks):
--    · secreto_firma: el secreto con el que Stripe / Calendly firman cada
--      aviso. Si está, la entrada VERIFICA la firma (sin él, como siempre).
--    · configurado_en: el usuario terminó los pasos (o se conectó pegando
--      una clave) pero todavía no llegó nada → "Esperando el primer dato".
-- 2) Lo que llega: un código de error para traducirlo según la app
--    (sin_identidad, firma_invalida…), además del detalle técnico.
-- 3) Instagram: cuándo llegó el último aviso de Meta (paso "Activá los
--    avisos de Meta" con app propia).
-- 4) Claves de API: de qué son ("claude" = las crea la guía de Tu Claude)
--    y si solo pueden leer (Claude que mira pero no toca).
-- 5) Cuenta: comisiones por defecto (antes fijas en el código: 20 % / 5 %).
-- =====================================================================

ALTER TABLE webhook_endpoints
  ADD COLUMN IF NOT EXISTS secreto_firma  text,
  ADD COLUMN IF NOT EXISTS configurado_en timestamptz;

ALTER TABLE webhook_eventos
  ADD COLUMN IF NOT EXISTS codigo_error text;

CREATE INDEX IF NOT EXISTS webhook_eventos_endpoint_idx
  ON webhook_eventos (endpoint_id, recibido_en DESC);

ALTER TABLE integraciones
  ADD COLUMN IF NOT EXISTS ultimo_aviso_en timestamptz;

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS tipo         text,
  ADD COLUMN IF NOT EXISTS solo_lectura boolean NOT NULL DEFAULT false;

-- Las que ya creó la guía de Claude se llamaban "Claude".
UPDATE api_keys SET tipo = 'claude'
 WHERE tipo IS NULL AND lower(nombre) LIKE 'claude%';

ALTER TABLE cuentas
  ADD COLUMN IF NOT EXISTS comision_closer_def numeric(5,2) NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS comision_setter_def numeric(5,2) NOT NULL DEFAULT 5;
