-- Freno del «reloj» externo (cron-job.org / GitHub): aunque lo llamen seguido,
-- procesa como mucho cada 20 s y renueva tokens de Instagram una vez por hora.
CREATE TABLE IF NOT EXISTS cron_estado (
  id            integer PRIMARY KEY CHECK (id = 1),
  ultimo        timestamptz NOT NULL DEFAULT 'epoch',
  ultimo_tokens timestamptz NOT NULL DEFAULT 'epoch',
  vueltas       bigint NOT NULL DEFAULT 0
);
INSERT INTO cron_estado (id) VALUES (1) ON CONFLICT DO NOTHING;
