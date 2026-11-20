-- =====================================================================
-- Ventas unificadas: el Panel (eventos "venta") y Finanzas (tabla ventas)
-- cuentan lo mismo.
--
-- Antes eran dos mundos: lo que llegaba por Stripe/Hotmart/ManyChat era un
-- evento y no aparecía en Finanzas; lo que se cargaba a mano en Finanzas no
-- generaba el evento y no lo veía el Panel. Desde ahora cada venta tiene su
-- fila en `ventas` y su evento, unidos por ventas.evento_id.
--
-- Esta migración une lo que ya existe SIN duplicar:
--   1) Venta de Finanzas + evento del mismo lead, ±3 días, mismo importe → se vinculan.
--   2) Evento "venta" sin fila en Finanzas → se crea la venta (pagada) y su cobro.
--   3) Venta de Finanzas (con lead) sin evento → se crea el evento.
--   4) Devoluciones totales ya registradas como evento → la venta queda "reembolsada".
-- =====================================================================

ALTER TABLE ventas ADD COLUMN IF NOT EXISTS evento_id bigint REFERENCES eventos(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ventas_evento_uniq ON ventas (evento_id) WHERE evento_id IS NOT NULL;

DO $$
DECLARE
  v record;
  e record;
  nueva uuid;
  ev_id bigint;
  opp uuid;
BEGIN
  -- 1) Vincular ventas cargadas a mano con el evento equivalente.
  FOR v IN SELECT * FROM ventas WHERE evento_id IS NULL AND lead_id IS NOT NULL ORDER BY creado_en LOOP
    SELECT ev.id INTO ev_id
      FROM eventos ev
     WHERE ev.cuenta_id = v.cuenta_id AND ev.lead_id = v.lead_id AND ev.tipo = 'venta'
       AND abs(ev.ocurrido_en::date - v.fecha) <= 3
       AND abs(COALESCE(ev.valor, 0) - v.precio_acordado) < 1
       AND NOT EXISTS (SELECT 1 FROM ventas v2 WHERE v2.evento_id = ev.id)
     ORDER BY abs(ev.ocurrido_en::date - v.fecha), ev.id
     LIMIT 1;
    IF ev_id IS NOT NULL THEN
      UPDATE ventas SET evento_id = ev_id WHERE id = v.id;
    END IF;
  END LOOP;

  -- 2) Eventos de venta sin fila en Finanzas → venta pagada + su cobro.
  FOR e IN
    SELECT ev.*, c.moneda AS moneda_cuenta
      FROM eventos ev JOIN cuentas c ON c.id = ev.cuenta_id
     WHERE ev.tipo = 'venta'
       AND NOT EXISTS (SELECT 1 FROM ventas v2 WHERE v2.evento_id = ev.id)
     ORDER BY ev.id
  LOOP
    INSERT INTO ventas (cuenta_id, lead_id, fecha, tipo_cobro, precio_acordado, moneda, num_cuotas,
                        pasarela, estado, notas, evento_id)
    VALUES (e.cuenta_id, e.lead_id, e.ocurrido_en::date, 'unico', COALESCE(e.valor, 0),
            COALESCE(NULLIF(upper(e.moneda), ''), e.moneda_cuenta, 'EUR'), 1,
            CASE e.fuente WHEN 'stripe' THEN 'Stripe' WHEN 'hotmart' THEN 'Hotmart' ELSE NULL END,
            'completada', 'Registrada sola: llegó como venta al CRM.', e.id)
    RETURNING id INTO nueva;
    INSERT INTO pagos (cuenta_id, venta_id, num_cuota, monto, vence_en, cobrado_en, estado, pasarela)
    VALUES (e.cuenta_id, nueva, 1, COALESCE(e.valor, 0), e.ocurrido_en::date, e.ocurrido_en::date, 'pagado',
            CASE e.fuente WHEN 'stripe' THEN 'Stripe' WHEN 'hotmart' THEN 'Hotmart' ELSE NULL END);
  END LOOP;

  -- 3) Ventas de Finanzas (con lead) que no tienen evento → crear el evento.
  FOR v IN SELECT * FROM ventas WHERE evento_id IS NULL AND lead_id IS NOT NULL ORDER BY creado_en LOOP
    SELECT o.id INTO opp FROM oportunidades o
     WHERE o.cuenta_id = v.cuenta_id AND o.lead_id = v.lead_id
     ORDER BY (o.estado = 'abierta') DESC, o.abierta_en DESC LIMIT 1;
    INSERT INTO eventos (cuenta_id, lead_id, oportunidad_id, tipo, valor, moneda, fuente, payload,
                         idempotency_key, ocurrido_en)
    VALUES (v.cuenta_id, v.lead_id, opp, 'venta', v.precio_acordado, v.moneda, 'manual',
            jsonb_build_object('venta_id', v.id, 'origen', 'finanzas'),
            'venta_' || v.id, v.fecha::timestamp + interval '12 hours')
    ON CONFLICT DO NOTHING
    RETURNING id INTO ev_id;
    IF ev_id IS NOT NULL THEN
      UPDATE ventas SET evento_id = ev_id WHERE id = v.id;
    END IF;
  END LOOP;

  -- 4) Devoluciones totales ya registradas → la venta queda devuelta.
  FOR e IN SELECT * FROM eventos WHERE tipo = 'reembolso' AND lead_id IS NOT NULL ORDER BY ocurrido_en LOOP
    UPDATE ventas SET estado = 'reembolsada', actualizado_en = now()
     WHERE id = (
       SELECT v3.id FROM ventas v3
        WHERE v3.cuenta_id = e.cuenta_id AND v3.lead_id = e.lead_id
          AND v3.estado NOT IN ('reembolsada', 'cancelada')
          AND v3.fecha <= e.ocurrido_en::date
          AND (e.valor IS NULL OR e.valor >= v3.precio_acordado * 0.99)
        ORDER BY v3.fecha DESC LIMIT 1);
  END LOOP;
  UPDATE pagos p SET estado = 'reembolsado'
    FROM ventas v4
   WHERE p.venta_id = v4.id AND v4.estado = 'reembolsada' AND p.estado = 'pagado';
END $$;
