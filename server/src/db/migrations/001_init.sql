-- =====================================================================
-- CRM de infoproducción conectado a Instagram
-- Migración 001: esquema inicial
-- =====================================================================
-- Nota de diseño: TODAS las tablas de negocio llevan cuenta_id desde el
-- día uno. Hoy existe una sola cuenta, pero esto permite abrir el CRM a
-- otros infoproductores sin reescribir el backend.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------
-- Cuentas y usuarios
-- ---------------------------------------------------------------------

CREATE TABLE cuentas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          text        NOT NULL,
  slug            text        NOT NULL UNIQUE,
  zona_horaria    text        NOT NULL DEFAULT 'Europe/Madrid',
  moneda          text        NOT NULL DEFAULT 'EUR',
  ig_username     text,
  plan            text        NOT NULL DEFAULT 'interno',
  activo          boolean     NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usuarios (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id       uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  email           text        NOT NULL,
  nombre          text        NOT NULL,
  password_hash   text        NOT NULL,
  rol             text        NOT NULL DEFAULT 'closer'
                  CHECK (rol IN ('owner','admin','closer','setter','solo_lectura')),
  avatar_url      text,
  activo          boolean     NOT NULL DEFAULT true,
  ultimo_acceso_en timestamptz,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cuenta_id, email)
);

CREATE INDEX usuarios_cuenta_idx ON usuarios (cuenta_id) WHERE activo;

-- Claves de API para integraciones salientes / clientes externos
CREATE TABLE api_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id       uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  nombre          text        NOT NULL,
  prefijo         text        NOT NULL,
  hash            text        NOT NULL,
  creado_por      uuid        REFERENCES usuarios(id) ON DELETE SET NULL,
  ultimo_uso_en   timestamptz,
  revocado_en     timestamptz,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cuenta_id, prefijo)
);

-- ---------------------------------------------------------------------
-- Integraciones (credenciales por cuenta, nunca en variables de entorno)
-- ---------------------------------------------------------------------

CREATE TABLE integraciones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id       uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  tipo            text        NOT NULL
                  CHECK (tipo IN ('instagram','manychat','calendly','stripe','hotmart','generico')),
  nombre          text        NOT NULL,
  credenciales    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  config          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  estado          text        NOT NULL DEFAULT 'sin_configurar'
                  CHECK (estado IN ('sin_configurar','conectado','error','expirado')),
  ultimo_error    text,
  ultimo_sync_en  timestamptz,
  activo          boolean     NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cuenta_id, tipo, nombre)
);

-- ---------------------------------------------------------------------
-- Contenido de Instagram: el origen de todo
-- ---------------------------------------------------------------------

CREATE TABLE contenidos (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id             uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  ig_media_id           text,
  tipo                  text        NOT NULL DEFAULT 'reel'
                        CHECK (tipo IN ('reel','post','carrusel','historia','live','anuncio','otro')),
  titulo                text        NOT NULL,
  caption               text,
  permalink             text,
  thumbnail_url         text,
  publicado_en          timestamptz,

  -- Métricas nativas de Instagram (se rellenan al sincronizar)
  ig_alcance            integer,
  ig_impresiones        integer,
  ig_reproducciones     integer,
  ig_likes              integer,
  ig_comentarios        integer,
  ig_guardados          integer,
  ig_compartidos        integer,
  ig_metricas_en        timestamptz,

  etiquetas             text[]      NOT NULL DEFAULT '{}',
  notas                 text,
  activo                boolean     NOT NULL DEFAULT true,
  creado_en             timestamptz NOT NULL DEFAULT now(),
  actualizado_en        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX contenidos_ig_media_uniq
  ON contenidos (cuenta_id, ig_media_id) WHERE ig_media_id IS NOT NULL;
CREATE INDEX contenidos_cuenta_publicado_idx ON contenidos (cuenta_id, publicado_en DESC);
CREATE INDEX contenidos_titulo_trgm_idx ON contenidos USING gin (titulo gin_trgm_ops);

-- ---------------------------------------------------------------------
-- Automatizaciones de ManyChat: el puente contenido <-> lead
-- ---------------------------------------------------------------------
-- Una automatización es "si comentan PALABRA en este reel, mando RECURSO".
-- contenido_id puede ser NULL cuando la misma palabra clave se usa en
-- varios contenidos: en ese caso la atribución cae al ig_media_id que
-- venga en el payload, y si no hay, queda sin atribuir (y se avisa).

CREATE TABLE automatizaciones (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id         uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  nombre            text        NOT NULL,
  palabra_clave     text,
  recurso           text,
  contenido_id      uuid        REFERENCES contenidos(id) ON DELETE SET NULL,
  manychat_flow_id  text,
  tipo_disparo      text        NOT NULL DEFAULT 'comentario'
                    CHECK (tipo_disparo IN ('comentario','dm','historia','bio_link','anuncio','otro')),
  activo            boolean     NOT NULL DEFAULT true,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX automatizaciones_palabra_idx
  ON automatizaciones (cuenta_id, lower(palabra_clave)) WHERE activo;
CREATE INDEX automatizaciones_contenido_idx ON automatizaciones (contenido_id);

-- ---------------------------------------------------------------------
-- Pipelines y etapas
-- ---------------------------------------------------------------------

CREATE TABLE pipelines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id         uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  nombre            text        NOT NULL,
  slug              text        NOT NULL,
  descripcion       text,
  es_predeterminado boolean     NOT NULL DEFAULT false,
  orden             integer     NOT NULL DEFAULT 0,
  activo            boolean     NOT NULL DEFAULT true,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cuenta_id, slug)
);

CREATE TABLE etapas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id         uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  pipeline_id       uuid        NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  nombre            text        NOT NULL,
  slug              text        NOT NULL,
  orden             integer     NOT NULL DEFAULT 0,
  tipo              text        NOT NULL DEFAULT 'abierta'
                    CHECK (tipo IN ('abierta','ganada','perdida')),
  color             text        NOT NULL DEFAULT '#6366f1',
  -- Semántica de negocio: qué significa llegar aquí
  marca_reunion     boolean     NOT NULL DEFAULT false,
  marca_venta       boolean     NOT NULL DEFAULT false,
  -- Qué tipo de evento mueve una oportunidad a esta etapa. Hace que el
  -- mapeo evento -> etapa sea un dato editable y no código.
  evento_asociado   text,
  probabilidad      integer     NOT NULL DEFAULT 0 CHECK (probabilidad BETWEEN 0 AND 100),
  creado_en         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_id, slug)
);

CREATE INDEX etapas_pipeline_orden_idx ON etapas (pipeline_id, orden);

-- ---------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------

CREATE TABLE leads (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id               uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,

  -- Identidad en Instagram / ManyChat
  ig_username             text,
  ig_user_id              text,
  manychat_subscriber_id  text,

  nombre                  text,
  apellido                text,
  email                   text,
  telefono                text,
  pais                    text,
  zona_horaria            text,
  idioma                  text,
  avatar_url              text,

  estado                  text        NOT NULL DEFAULT 'activo'
                          CHECK (estado IN ('activo','ganado','perdido','descartado')),
  etiquetas               text[]      NOT NULL DEFAULT '{}',
  consentimiento          boolean     NOT NULL DEFAULT false,
  propietario_id          uuid        REFERENCES usuarios(id) ON DELETE SET NULL,
  campos_extra            jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Atribución desnormalizada (se mantiene con el motor de atribución)
  primer_contenido_id     uuid        REFERENCES contenidos(id) ON DELETE SET NULL,
  primer_automatizacion_id uuid       REFERENCES automatizaciones(id) ON DELETE SET NULL,
  ultimo_contenido_id     uuid        REFERENCES contenidos(id) ON DELETE SET NULL,
  ultimo_automatizacion_id uuid       REFERENCES automatizaciones(id) ON DELETE SET NULL,

  valor_total             numeric(14,2) NOT NULL DEFAULT 0,
  primer_contacto_en      timestamptz NOT NULL DEFAULT now(),
  ultimo_contacto_en      timestamptz NOT NULL DEFAULT now(),
  creado_en               timestamptz NOT NULL DEFAULT now(),
  actualizado_en          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX leads_ig_user_uniq
  ON leads (cuenta_id, ig_user_id) WHERE ig_user_id IS NOT NULL;
CREATE UNIQUE INDEX leads_manychat_uniq
  ON leads (cuenta_id, manychat_subscriber_id) WHERE manychat_subscriber_id IS NOT NULL;
CREATE UNIQUE INDEX leads_ig_username_uniq
  ON leads (cuenta_id, lower(ig_username)) WHERE ig_username IS NOT NULL;
CREATE INDEX leads_email_idx ON leads (cuenta_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX leads_cuenta_creado_idx ON leads (cuenta_id, creado_en DESC);
CREATE INDEX leads_primer_contenido_idx ON leads (cuenta_id, primer_contenido_id);
CREATE INDEX leads_propietario_idx ON leads (cuenta_id, propietario_id);
CREATE INDEX leads_etiquetas_idx ON leads USING gin (etiquetas);

-- ---------------------------------------------------------------------
-- Oportunidades: el recorrido del lead por un pipeline
-- ---------------------------------------------------------------------

CREATE TABLE oportunidades (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id             uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  lead_id               uuid        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  pipeline_id           uuid        NOT NULL REFERENCES pipelines(id) ON DELETE RESTRICT,
  etapa_id              uuid        NOT NULL REFERENCES etapas(id) ON DELETE RESTRICT,

  titulo                text,
  valor                 numeric(14,2) NOT NULL DEFAULT 0,
  moneda                text        NOT NULL DEFAULT 'EUR',
  estado                text        NOT NULL DEFAULT 'abierta'
                        CHECK (estado IN ('abierta','ganada','perdida')),
  motivo_perdida        text,
  propietario_id        uuid        REFERENCES usuarios(id) ON DELETE SET NULL,

  -- Atribución propia de la oportunidad
  contenido_id          uuid        REFERENCES contenidos(id) ON DELETE SET NULL,
  automatizacion_id     uuid        REFERENCES automatizaciones(id) ON DELETE SET NULL,
  contenido_ultimo_id   uuid        REFERENCES contenidos(id) ON DELETE SET NULL,

  -- Hitos del embudo de infoproducto
  reunion_agendada_en   timestamptz,
  reunion_realizada_en  timestamptz,
  reunion_no_asistio    boolean     NOT NULL DEFAULT false,
  abierta_en            timestamptz NOT NULL DEFAULT now(),
  cerrada_en            timestamptz,

  creado_en             timestamptz NOT NULL DEFAULT now(),
  actualizado_en        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oportunidades_lead_idx ON oportunidades (lead_id);
CREATE INDEX oportunidades_etapa_idx ON oportunidades (cuenta_id, etapa_id);
CREATE INDEX oportunidades_pipeline_estado_idx ON oportunidades (cuenta_id, pipeline_id, estado);
CREATE INDEX oportunidades_contenido_idx ON oportunidades (cuenta_id, contenido_id);
CREATE INDEX oportunidades_abierta_idx ON oportunidades (cuenta_id, abierta_en DESC);

-- Historial de movimientos entre etapas (para tiempos de ciclo)
CREATE TABLE etapa_historial (
  id                bigserial PRIMARY KEY,
  cuenta_id         uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  oportunidad_id    uuid        NOT NULL REFERENCES oportunidades(id) ON DELETE CASCADE,
  etapa_desde_id    uuid        REFERENCES etapas(id) ON DELETE SET NULL,
  etapa_hasta_id    uuid        NOT NULL REFERENCES etapas(id) ON DELETE CASCADE,
  origen            text        NOT NULL DEFAULT 'manual'
                    CHECK (origen IN ('manual','webhook','regla','api','seed')),
  usuario_id        uuid        REFERENCES usuarios(id) ON DELETE SET NULL,
  regla_id          uuid,
  cambiado_en       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX etapa_historial_oportunidad_idx ON etapa_historial (oportunidad_id, cambiado_en);
CREATE INDEX etapa_historial_cuenta_idx ON etapa_historial (cuenta_id, cambiado_en DESC);

-- ---------------------------------------------------------------------
-- Eventos: el log de todo, con atribución de contenido en cada fila
-- ---------------------------------------------------------------------

CREATE TABLE eventos (
  id                bigserial PRIMARY KEY,
  cuenta_id         uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  lead_id           uuid        REFERENCES leads(id) ON DELETE CASCADE,
  oportunidad_id    uuid        REFERENCES oportunidades(id) ON DELETE SET NULL,
  tipo              text        NOT NULL
                    CHECK (tipo IN (
                      'lead_creado','recurso_entregado','respondio_dm','comentario',
                      'reunion_agendada','reunion_realizada','reunion_no_asistio',
                      'reunion_cancelada','venta','reembolso','etapa_cambiada',
                      'etiqueta','nota','mensaje_enviado','mensaje_recibido','otro'
                    )),
  -- Atribución del evento concreto
  contenido_id      uuid        REFERENCES contenidos(id) ON DELETE SET NULL,
  automatizacion_id uuid        REFERENCES automatizaciones(id) ON DELETE SET NULL,

  valor             numeric(14,2),
  moneda            text,
  titulo            text,
  fuente            text        NOT NULL DEFAULT 'api'
                    CHECK (fuente IN ('manychat','instagram','calendly','stripe','hotmart','manual','api','regla','seed','generico')),
  payload           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key   text,
  ocurrido_en       timestamptz NOT NULL DEFAULT now(),
  creado_en         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX eventos_idempotency_uniq
  ON eventos (cuenta_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX eventos_lead_idx ON eventos (lead_id, ocurrido_en DESC);
CREATE INDEX eventos_cuenta_tipo_idx ON eventos (cuenta_id, tipo, ocurrido_en DESC);
CREATE INDEX eventos_contenido_idx ON eventos (cuenta_id, contenido_id, tipo);
CREATE INDEX eventos_ocurrido_idx ON eventos (cuenta_id, ocurrido_en DESC);

-- ---------------------------------------------------------------------
-- Toques de atribución (multi-touch: todo contacto lead <-> contenido)
-- ---------------------------------------------------------------------

CREATE TABLE toques (
  id                bigserial PRIMARY KEY,
  cuenta_id         uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  lead_id           uuid        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  contenido_id      uuid        REFERENCES contenidos(id) ON DELETE SET NULL,
  automatizacion_id uuid        REFERENCES automatizaciones(id) ON DELETE SET NULL,
  evento_id         bigint      REFERENCES eventos(id) ON DELETE SET NULL,
  origen            text        NOT NULL DEFAULT 'comentario'
                    CHECK (origen IN ('comentario','dm','historia','bio_link','anuncio','directo','otro')),
  -- Cómo se resolvió la atribución (para poder auditarla)
  metodo            text        NOT NULL DEFAULT 'automatizacion'
                    CHECK (metodo IN ('ig_media_id','automatizacion','palabra_clave','campania','manual','sin_atribuir')),
  confianza         text        NOT NULL DEFAULT 'alta'
                    CHECK (confianza IN ('alta','media','baja','ninguna')),
  ocurrido_en       timestamptz NOT NULL DEFAULT now(),
  creado_en         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX toques_lead_idx ON toques (lead_id, ocurrido_en);
CREATE INDEX toques_contenido_idx ON toques (cuenta_id, contenido_id, ocurrido_en DESC);

-- ---------------------------------------------------------------------
-- Webhooks entrantes: nada se pierde, el payload crudo se guarda siempre
-- ---------------------------------------------------------------------

CREATE TABLE webhook_endpoints (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id       uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  nombre          text        NOT NULL,
  slug            text        NOT NULL,
  token           text        NOT NULL,
  fuente          text        NOT NULL DEFAULT 'manychat'
                  CHECK (fuente IN ('manychat','calendly','stripe','hotmart','instagram','generico')),
  -- Mapeo de campos del payload a campos del CRM
  mapeo           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Qué evento genera por defecto este endpoint
  evento_defecto  text        NOT NULL DEFAULT 'lead_creado',
  activo          boolean     NOT NULL DEFAULT true,
  total_recibidos bigint      NOT NULL DEFAULT 0,
  total_errores   bigint      NOT NULL DEFAULT 0,
  ultimo_evento_en timestamptz,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cuenta_id, slug)
);

CREATE UNIQUE INDEX webhook_endpoints_token_uniq ON webhook_endpoints (token);

CREATE TABLE webhook_eventos (
  id              bigserial PRIMARY KEY,
  cuenta_id       uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  endpoint_id     uuid        REFERENCES webhook_endpoints(id) ON DELETE SET NULL,
  fuente          text        NOT NULL DEFAULT 'generico',
  payload         jsonb       NOT NULL,
  headers         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ip              text,
  estado          text        NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente','procesado','error','ignorado','duplicado')),
  error           text,
  intentos        integer     NOT NULL DEFAULT 0,
  idempotency_key text,
  lead_id         uuid        REFERENCES leads(id) ON DELETE SET NULL,
  evento_id       bigint      REFERENCES eventos(id) ON DELETE SET NULL,
  recibido_en     timestamptz NOT NULL DEFAULT now(),
  procesado_en    timestamptz
);

CREATE UNIQUE INDEX webhook_eventos_idem_uniq
  ON webhook_eventos (cuenta_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX webhook_eventos_estado_idx ON webhook_eventos (cuenta_id, estado, recibido_en DESC);
CREATE INDEX webhook_eventos_recibido_idx ON webhook_eventos (cuenta_id, recibido_en DESC);

-- ---------------------------------------------------------------------
-- Motor de reglas: la semilla del "ManyChat propio"
-- ---------------------------------------------------------------------

CREATE TABLE reglas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id         uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  nombre            text        NOT NULL,
  descripcion       text,
  -- {"evento": "reunion_agendada"}
  disparador        jsonb       NOT NULL,
  -- [{"campo":"lead.pais","operador":"igual","valor":"ES"}]
  condiciones       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- [{"tipo":"mover_etapa","etapa_slug":"reunion-agendada"}]
  acciones          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  orden             integer     NOT NULL DEFAULT 0,
  activo            boolean     NOT NULL DEFAULT true,
  total_ejecuciones bigint      NOT NULL DEFAULT 0,
  ultima_ejecucion_en timestamptz,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reglas_cuenta_activo_idx ON reglas (cuenta_id, orden) WHERE activo;

CREATE TABLE regla_ejecuciones (
  id              bigserial PRIMARY KEY,
  cuenta_id       uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  regla_id        uuid        NOT NULL REFERENCES reglas(id) ON DELETE CASCADE,
  lead_id         uuid        REFERENCES leads(id) ON DELETE CASCADE,
  evento_id       bigint      REFERENCES eventos(id) ON DELETE SET NULL,
  estado          text        NOT NULL CHECK (estado IN ('ok','error','omitida')),
  resultado       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  error           text,
  ejecutado_en    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX regla_ejecuciones_regla_idx ON regla_ejecuciones (regla_id, ejecutado_en DESC);

-- ---------------------------------------------------------------------
-- Notas y mensajes
-- ---------------------------------------------------------------------

CREATE TABLE notas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id       uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  lead_id         uuid        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  oportunidad_id  uuid        REFERENCES oportunidades(id) ON DELETE SET NULL,
  usuario_id      uuid        REFERENCES usuarios(id) ON DELETE SET NULL,
  cuerpo          text        NOT NULL,
  creado_en       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notas_lead_idx ON notas (lead_id, creado_en DESC);

-- Base para el inbox propio (fase 2): conversaciones de DM
CREATE TABLE mensajes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id         uuid        NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  lead_id           uuid        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  direccion         text        NOT NULL CHECK (direccion IN ('entrante','saliente')),
  canal             text        NOT NULL DEFAULT 'instagram_dm'
                    CHECK (canal IN ('instagram_dm','email','whatsapp','otro')),
  cuerpo            text,
  adjuntos          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  externo_id        text,
  estado            text        NOT NULL DEFAULT 'entregado',
  enviado_por       uuid        REFERENCES usuarios(id) ON DELETE SET NULL,
  ocurrido_en       timestamptz NOT NULL DEFAULT now(),
  creado_en         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mensajes_lead_idx ON mensajes (lead_id, ocurrido_en DESC);

-- ---------------------------------------------------------------------
-- Disparador genérico para mantener actualizado_en
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_actualizado_en() RETURNS trigger AS $fn$
BEGIN
  NEW.actualizado_en = now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cuentas','usuarios','integraciones','contenidos',
                           'automatizaciones','leads','oportunidades','reglas']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_actualizado BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_actualizado_en()', t, t);
  END LOOP;
END
$do$;
