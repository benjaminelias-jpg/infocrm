-- Automensajes al nivel de ManyChat: campos personalizados del lead,
-- pausa cuando responde una persona y «respuesta por defecto».
ALTER TABLE leads ADD COLUMN IF NOT EXISTS campos jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS automensajes_pausados_hasta timestamptz;

ALTER TABLE flujos DROP CONSTRAINT IF EXISTS flujos_disparo_check;
ALTER TABLE flujos ADD CONSTRAINT flujos_disparo_check
  CHECK (disparo IN ('comentario','dm','historia','mencion','reaccion','boton','anuncio','por_defecto'));

-- Horas que se pausan los automensajes de un lead cuando le responde alguien del equipo.
ALTER TABLE cuentas ADD COLUMN IF NOT EXISTS pausa_humana_horas integer NOT NULL DEFAULT 12;
