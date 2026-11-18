-- =====================================================================
-- Migración 002: lógica de infoproducción
-- =====================================================================
-- Destila el método de captación orgánica por Instagram (ángulos de
-- contenido, posición en el embudo, roles de rendimiento) y la
-- cualificación de leads ("filtro antipodridos": separar al lead
-- calificado del cazador de recursos gratis).
--
-- Todo es ADITIVO: columnas nuevas con valor por defecto, ninguna tabla
-- ni columna existente cambia de forma. Lo ya construido sigue igual.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Clasificación del contenido
-- ---------------------------------------------------------------------
-- angulo: el tipo de mensaje y su papel en el embudo (método Cubria).
--   video_abierto → TOFU (alcance)   problema → MOFU (filtro)
--   solucion → MOFU (autoridad)      producto → BOFU (prueba)
--   mentalidad / narrativa → transversal
-- etapa_embudo se deriva del ángulo, pero se guarda para poder filtrar
-- y agrupar sin recalcular.
-- rol_manual: override de persona sobre el rol que el sistema calcula
--   solo (prospector / closer / caballo / calificador / lastre).
-- gancho: tipo de gancho del primer segundo (taxonomía de guiones),
--   campo libre de momento para no cerrar la lista antes de tiempo.

ALTER TABLE contenidos
  ADD COLUMN angulo         text,
  ADD COLUMN etapa_embudo   text,
  ADD COLUMN rol_manual     text,
  ADD COLUMN gancho         text;

ALTER TABLE contenidos
  ADD CONSTRAINT contenidos_angulo_chk CHECK (
    angulo IS NULL OR angulo IN
    ('video_abierto','problema','solucion','producto','mentalidad','narrativa','otro')
  );

ALTER TABLE contenidos
  ADD CONSTRAINT contenidos_etapa_embudo_chk CHECK (
    etapa_embudo IS NULL OR etapa_embudo IN ('TOFU','MOFU','BOFU','transversal')
  );

ALTER TABLE contenidos
  ADD CONSTRAINT contenidos_rol_manual_chk CHECK (
    rol_manual IS NULL OR rol_manual IN
    ('prospector','closer','caballo','calificador','abridor','lastre','explorador')
  );

CREATE INDEX contenidos_angulo_idx ON contenidos (cuenta_id, angulo);
CREATE INDEX contenidos_etapa_embudo_idx ON contenidos (cuenta_id, etapa_embudo);

-- ---------------------------------------------------------------------
-- Cualificación del lead (filtro antipodridos + datos de descubrimiento)
-- ---------------------------------------------------------------------
-- Lo que el flujo de DM descubre en la fase de calificación: modelo de
-- negocio, ingresos aproximados y cuello de botella. Más una señal de
-- calidad explícita y un score transparente 0-100.

ALTER TABLE leads
  ADD COLUMN modelo_negocio   text,
  ADD COLUMN ingresos_aprox   text,
  ADD COLUMN cuello_botella   text,
  ADD COLUMN calificacion     text NOT NULL DEFAULT 'sin_calificar',
  ADD COLUMN motivo_descarte  text,
  ADD COLUMN score            integer NOT NULL DEFAULT 0,
  ADD COLUMN score_detalle    jsonb   NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE leads
  ADD CONSTRAINT leads_calificacion_chk CHECK (
    calificacion IN ('sin_calificar','calificado','no_calificado')
  );

ALTER TABLE leads
  ADD CONSTRAINT leads_score_chk CHECK (score BETWEEN 0 AND 100);

CREATE INDEX leads_score_idx ON leads (cuenta_id, score DESC);
CREATE INDEX leads_calificacion_idx ON leads (cuenta_id, calificacion);

-- ---------------------------------------------------------------------
-- Paso del flujo de DM en la oportunidad
-- ---------------------------------------------------------------------
-- El método Cubria estructura la conversación de DM en cinco pasos:
-- apertura → calificación → dolor → solución → cierre, más seguimientos.
-- Esto es más fino que la etapa "En conversación" del pipeline de llamada
-- y convive con ella: la etapa dice "dónde está en el embudo", el dm_paso
-- dice "por dónde va la conversación".

ALTER TABLE oportunidades
  ADD COLUMN dm_paso           text,
  ADD COLUMN seguimientos      integer NOT NULL DEFAULT 0,
  ADD COLUMN proximo_seguimiento_en timestamptz;

ALTER TABLE oportunidades
  ADD CONSTRAINT oportunidades_dm_paso_chk CHECK (
    dm_paso IS NULL OR dm_paso IN
    ('apertura','calificacion','dolor','solucion','cierre','seguimiento')
  );
