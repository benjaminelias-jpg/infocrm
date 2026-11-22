-- Datos de prueba que el dueño carga con un botón para ver el CRM andando;
-- quedan marcados para poder borrarlos todos juntos después.
ALTER TABLE leads           ADD COLUMN IF NOT EXISTS de_prueba boolean NOT NULL DEFAULT false;
ALTER TABLE contenidos      ADD COLUMN IF NOT EXISTS de_prueba boolean NOT NULL DEFAULT false;
ALTER TABLE personas_equipo ADD COLUMN IF NOT EXISTS de_prueba boolean NOT NULL DEFAULT false;
ALTER TABLE productos       ADD COLUMN IF NOT EXISTS de_prueba boolean NOT NULL DEFAULT false;
ALTER TABLE gastos          ADD COLUMN IF NOT EXISTS de_prueba boolean NOT NULL DEFAULT false;
