-- =====================================================================
-- Migración 009: Acciones automáticas por etapa
-- =====================================================================
-- Cada etapa puede tener acciones que se disparan cuando un lead ENTRA a
-- ella: asignar una etiqueta, llamar a un webhook (para avisar a Meta, a tu
-- proveedor de correos, a Zapier/Make…), o dejar una nota. Así el "qué pasa
-- cuando muevo un lead de etapa" se configura en la propia etapa.
-- Formato: [{"tipo":"etiquetar","etiqueta":"..."},
--           {"tipo":"webhook","url":"https://..."},
--           {"tipo":"nota","texto":"..."}]
-- =====================================================================

ALTER TABLE etapas
  ADD COLUMN IF NOT EXISTS acciones jsonb NOT NULL DEFAULT '[]'::jsonb;
