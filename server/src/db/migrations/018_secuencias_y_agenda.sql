-- Secuencias de atajos (ej. «Secuencia A»: 3 audios con una espera entre
-- cada uno) y marca de «link de agenda» en un atajo.
ALTER TABLE recursos DROP CONSTRAINT IF EXISTS recursos_tipo_check;
ALTER TABLE recursos ADD CONSTRAINT recursos_tipo_check
  CHECK (tipo IN ('audio','pdf','imagen','video','texto','link','secuencia'));
ALTER TABLE recursos ADD COLUMN IF NOT EXISTS pasos jsonb;             -- [{recurso_id, espera_seg}]
ALTER TABLE recursos ADD COLUMN IF NOT EXISTS es_agenda boolean NOT NULL DEFAULT false;

-- Envíos que salen más tarde (los pasos 2, 3… de una secuencia).
CREATE TABLE IF NOT EXISTS envios_programados (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id     uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  lead_id       uuid        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  recurso_id    uuid        NOT NULL REFERENCES recursos(id) ON DELETE CASCADE,
  secuencia_id  uuid        REFERENCES recursos(id) ON DELETE CASCADE,
  enviar_en     timestamptz NOT NULL,
  estado        text        NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','enviado','cancelado','error')),
  enviado_por   uuid        REFERENCES usuarios(id) ON DELETE SET NULL,
  error         text,
  creado_en     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS envios_programados_pend_idx ON envios_programados (enviar_en) WHERE estado = 'pendiente';
CREATE INDEX IF NOT EXISTS envios_programados_lead_idx ON envios_programados (lead_id);
