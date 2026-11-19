-- =====================================================================
-- Migración 008: Chat del setter — reutiliza la tabla `mensajes` existente
-- =====================================================================
-- La tabla `mensajes` ya existe (001) con cuerpo/canal/direccion/estado/
-- ocurrido_en. Aquí solo añadimos poder adjuntar un recurso guardado (audio
-- del founder, PDF) y las marcas de lectura por lead para la bandeja.
-- =====================================================================

ALTER TABLE mensajes
  ADD COLUMN IF NOT EXISTS recurso_id uuid REFERENCES recursos(id) ON DELETE SET NULL;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS ultimo_mensaje_en timestamptz,
  ADD COLUMN IF NOT EXISTS mensajes_sin_leer integer NOT NULL DEFAULT 0;
