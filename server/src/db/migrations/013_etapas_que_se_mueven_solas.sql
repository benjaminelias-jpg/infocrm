-- =====================================================================
-- Migración 013: las etapas básicas de los pipelines creados con «+»
-- =====================================================================
-- Los pipelines creados desde el tablero nacían con 5 etapas pero SIN
-- "evento asociado", así que sus tarjetas no se movían solas cuando el lead
-- respondía el DM o agendaba (solo "Llamada agendada" y "Cliente" por un
-- respaldo interno). Ahora nacen con ese dato; esto se lo pone a los que ya
-- existen, solo si NINGUNA de sus etapas lo tiene (no pisa lo configurado).
-- =====================================================================

UPDATE etapas e
   SET evento_asociado = m.evento
  FROM (VALUES
          ('interesado',        'lead_creado'),
          ('en-conversacion',   'respondio_dm'),
          ('llamada-agendada',  'reunion_agendada'),
          ('cliente',           'venta')
       ) AS m(slug, evento)
 WHERE e.slug = m.slug
   AND e.evento_asociado IS NULL
   AND NOT EXISTS (
         SELECT 1 FROM etapas x
          WHERE x.pipeline_id = e.pipeline_id AND x.evento_asociado IS NOT NULL
       );
