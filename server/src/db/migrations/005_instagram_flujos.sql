-- =====================================================================
-- Migración 005: Instagram OAuth + flujos de DM ("ManyChat propio")
-- =====================================================================
-- - Guarda la App de Meta (App ID/Secret) y el token de Instagram por
--   cuenta en `integraciones` (ya existe; aquí solo se documenta el uso).
-- - `flujos`: automatizaciones de DM propias del CRM. Un flujo se dispara
--   por un comentario (palabra clave) o un DM y ejecuta una secuencia de
--   pasos (enviar DM, entregar recurso, etiquetar, mover etapa, esperar).
-- - `flujo_ejecuciones`: traza de cada disparo.
-- Todo aditivo.
-- =====================================================================

CREATE TABLE flujos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id       uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  nombre          text        NOT NULL,
  descripcion     text,
  -- Qué lo dispara
  disparo         text        NOT NULL DEFAULT 'comentario'
                  CHECK (disparo IN ('comentario','dm','historia','mencion')),
  palabra_clave   text,
  -- Contenido al que está asociado (para la atribución), opcional
  contenido_id    uuid        REFERENCES contenidos(id) ON DELETE SET NULL,
  -- La secuencia de pasos: [{"tipo":"enviar_dm","texto":"..."},
  --   {"tipo":"entregar_recurso","recurso":"..."},
  --   {"tipo":"etiquetar","etiqueta":"..."}, {"tipo":"mover_etapa","etapa_slug":"..."},
  --   {"tipo":"esperar","minutos":120}]
  pasos           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  activo          boolean     NOT NULL DEFAULT true,
  total_disparos  bigint      NOT NULL DEFAULT 0,
  ultimo_disparo_en timestamptz,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX flujos_cuenta_activo_idx ON flujos (cuenta_id) WHERE activo;
CREATE INDEX flujos_palabra_idx ON flujos (cuenta_id, lower(palabra_clave)) WHERE activo;

CREATE TABLE flujo_ejecuciones (
  id              bigserial PRIMARY KEY,
  cuenta_id       uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  flujo_id        uuid        NOT NULL REFERENCES flujos(id) ON DELETE CASCADE,
  lead_id         uuid        REFERENCES leads(id) ON DELETE SET NULL,
  estado          text        NOT NULL DEFAULT 'ok' CHECK (estado IN ('ok','error','simulado','pendiente_envio')),
  resultado       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  error           text,
  ejecutado_en    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX flujo_ejecuciones_flujo_idx ON flujo_ejecuciones (flujo_id, ejecutado_en DESC);

CREATE TRIGGER flujos_actualizado
  BEFORE UPDATE ON flujos
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
