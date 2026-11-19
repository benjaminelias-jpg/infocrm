-- =====================================================================
-- Migración 007: Recursos (biblioteca de audios del founder, PDFs, etc.)
-- =====================================================================
-- El founder graba/sube audios una vez; los setters los mandan en los DMs
-- (o los flujos los envían solos). El lead siente que habla con el founder.
-- Un audio se guarda en la BD (datos) o como URL externa, y se sirve en una
-- URL pública con token secreto (Meta necesita una URL pública para adjuntar
-- audio en un DM).
-- =====================================================================

CREATE TABLE recursos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id       uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  nombre          text        NOT NULL,
  tipo            text        NOT NULL DEFAULT 'audio'
                  CHECK (tipo IN ('audio','pdf','imagen','video','texto','link')),
  descripcion     text,
  -- Contenido: o bien el binario (datos+mime), o una URL externa, o texto.
  mime            text,
  datos           bytea,
  url             text,
  texto           text,
  -- Token para servir el binario en una URL pública (Meta lo descarga).
  token           text        NOT NULL DEFAULT (md5(random()::text || clock_timestamp()::text) || md5(random()::text)),
  etiquetas       text[]      NOT NULL DEFAULT '{}',
  veces_usado     bigint      NOT NULL DEFAULT 0,
  creado_por      uuid        REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX recursos_cuenta_idx ON recursos (cuenta_id, creado_en DESC);
CREATE UNIQUE INDEX recursos_token_uniq ON recursos (token);
