-- =====================================================================
-- Migración 011: Flujos v2 (árboles con ramas, esperas reales, todos los
-- disparadores de Instagram) + orden de recursos + inbox real
-- =====================================================================
-- - Un flujo ya no es una lista: puede tener nodos "pregunta" (botones, una
--   rama por botón) y "condición" (rama sí / no). Los pasos siguen en
--   flujos.pasos (jsonb); cada nodo lleva un id estable.
-- - Una ejecución puede quedar EN PAUSA esperando que el lead responda o
--   esperando un tiempo, y se reanuda donde quedó (nodo_id).
-- - Nuevos disparadores: reacción, botón, anuncio.
-- - Recursos ordenables (los atajos del Chat salen en ese orden).
-- - Mensajes de Instagram sin duplicados (externo_id = mid de Meta) y con el
--   motivo cuando un mensaje no llegó a Instagram.
-- Todo aditivo e idempotente.
-- =====================================================================

ALTER TABLE flujos DROP CONSTRAINT IF EXISTS flujos_disparo_check;
ALTER TABLE flujos ADD CONSTRAINT flujos_disparo_check
  CHECK (disparo IN ('comentario','dm','historia','mencion','reaccion','boton','anuncio'));

ALTER TABLE flujo_ejecuciones DROP CONSTRAINT IF EXISTS flujo_ejecuciones_estado_check;
ALTER TABLE flujo_ejecuciones ADD CONSTRAINT flujo_ejecuciones_estado_check
  CHECK (estado IN ('ok','error','simulado','pendiente_envio','esperando','cancelado'));

ALTER TABLE flujo_ejecuciones
  ADD COLUMN IF NOT EXISTS esperando      text,          -- 'respuesta' | 'tiempo'
  ADD COLUMN IF NOT EXISTS nodo_id        text,          -- nodo donde quedó en pausa
  ADD COLUMN IF NOT EXISTS reanudar_en    timestamptz,   -- para las esperas por tiempo
  ADD COLUMN IF NOT EXISTS contexto       jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS actualizado_en timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS flujo_ejec_esperando_idx
  ON flujo_ejecuciones (cuenta_id, lead_id, ejecutado_en DESC) WHERE estado = 'esperando';
CREATE INDEX IF NOT EXISTS flujo_ejec_reanudar_idx
  ON flujo_ejecuciones (reanudar_en) WHERE estado = 'esperando' AND esperando = 'tiempo';
CREATE INDEX IF NOT EXISTS flujo_ejec_lead_idx
  ON flujo_ejecuciones (flujo_id, lead_id, ejecutado_en DESC);

ALTER TABLE recursos ADD COLUMN IF NOT EXISTS orden integer;

ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS error text;
CREATE UNIQUE INDEX IF NOT EXISTS mensajes_externo_uniq
  ON mensajes (cuenta_id, externo_id) WHERE externo_id IS NOT NULL;
