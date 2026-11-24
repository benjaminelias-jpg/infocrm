-- Calendario propio del CRM (alternativa a Calendly): huecos, reservas y
-- links personales por lead (al agendar, el lead queda marcado solo).
CREATE TABLE IF NOT EXISTS calendarios (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id       uuid NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  nombre          text NOT NULL,
  slug            text NOT NULL UNIQUE,
  descripcion     text,
  duracion_min    integer NOT NULL DEFAULT 30 CHECK (duracion_min BETWEEN 5 AND 480),
  intervalo_min   integer NOT NULL DEFAULT 30 CHECK (intervalo_min BETWEEN 5 AND 240),
  zona_horaria    text NOT NULL DEFAULT 'Europe/Madrid',
  -- {"1":[["09:00","18:00"]], ...} 0=domingo … 6=sábado
  horario         jsonb NOT NULL DEFAULT '{"1":[["09:00","18:00"]],"2":[["09:00","18:00"]],"3":[["09:00","18:00"]],"4":[["09:00","18:00"]],"5":[["09:00","18:00"]]}'::jsonb,
  antelacion_min  integer NOT NULL DEFAULT 60,     -- aviso mínimo (minutos)
  dias_max        integer NOT NULL DEFAULT 60,     -- hasta cuántos días hacia adelante
  fecha_fin       date,                            -- o hasta una fecha fija
  buffer_antes    integer NOT NULL DEFAULT 0,
  buffer_despues  integer NOT NULL DEFAULT 0,
  max_por_dia     integer,
  preguntas       jsonb NOT NULL DEFAULT '[]'::jsonb,
  color           text NOT NULL DEFAULT '#2563eb',
  ubicacion       text,
  ics_ocupado     text,                            -- iCal secreto (Google/Outlook) para no pisar lo que ya tenés
  feed_token      text NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
  origen          jsonb,
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calendarios_cuenta ON calendarios (cuenta_id);

CREATE TABLE IF NOT EXISTS reservas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id     uuid NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  calendario_id uuid NOT NULL REFERENCES calendarios(id) ON DELETE CASCADE,
  lead_id       uuid REFERENCES leads(id) ON DELETE SET NULL,
  inicio        timestamptz NOT NULL,
  fin           timestamptz NOT NULL,
  nombre        text,
  email         text,
  telefono      text,
  ig_username   text,
  respuestas    jsonb NOT NULL DEFAULT '{}'::jsonb,
  estado        text NOT NULL DEFAULT 'confirmada' CHECK (estado IN ('confirmada','cancelada')),
  token         text NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
  creado_en     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reservas_cal_inicio ON reservas (calendario_id, inicio);
CREATE UNIQUE INDEX IF NOT EXISTS reservas_hueco_unico ON reservas (calendario_id, inicio) WHERE estado = 'confirmada';

CREATE TABLE IF NOT EXISTS invitaciones_agenda (
  token         text PRIMARY KEY DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 20),
  cuenta_id     uuid NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  calendario_id uuid NOT NULL REFERENCES calendarios(id) ON DELETE CASCADE,
  lead_id       uuid REFERENCES leads(id) ON DELETE CASCADE,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  usado_en      timestamptz
);

ALTER TABLE eventos DROP CONSTRAINT IF EXISTS eventos_fuente_check;
ALTER TABLE eventos ADD CONSTRAINT eventos_fuente_check
  CHECK (fuente IN ('manychat','instagram','calendly','stripe','hotmart','manual','api','regla','seed','generico','agenda'));
