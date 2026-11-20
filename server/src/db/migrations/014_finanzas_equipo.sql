-- =====================================================================
-- Migración 014: Finanzas — un solo equipo y números que no mienten
-- =====================================================================
-- 1) Un solo equipo: cada persona de Finanzas (comisiones) puede estar
--    enlazada con su usuario del CRM (el que se asigna en el Pipeline y el
--    Chat). Así quien atiende al lead es el mismo que cobra la comisión.
-- 2) Setter "fantasma": el formulario viejo de Finanzas guardaba 5 % de
--    setter (y 20 % de closer) aunque la venta no tuviera setter ni closer.
--    Sin persona no hay a quién pagarle: esa comisión pasa a 0.
-- 3) Comisión de cobro: las ventas que entraron solas (Stripe, Hotmart)
--    se guardaban sin la comisión de la pasarela. Se completa con el % del
--    método de cobro del mismo nombre, solo donde estaba en 0.
-- =====================================================================

ALTER TABLE personas_equipo
  ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id) ON DELETE SET NULL;

-- Una ficha por usuario del CRM.
CREATE UNIQUE INDEX IF NOT EXISTS personas_equipo_usuario_uniq
  ON personas_equipo (usuario_id) WHERE usuario_id IS NOT NULL;

-- 2) Sin setter / sin closer → sin comisión.
UPDATE ventas SET comision_setter_pct = 0
 WHERE setter_id IS NULL AND comision_setter_pct <> 0;
UPDATE ventas SET comision_closer_pct = 0
 WHERE closer_id IS NULL AND comision_closer_pct <> 0;

-- 3) Comisión de la pasarela en los cobros que la tenían en 0.
UPDATE pagos p
   SET comision_pasarela = round(p.monto * (
         SELECT mp.comision_pct FROM metodos_pago mp
          WHERE mp.cuenta_id = p.cuenta_id AND lower(mp.nombre) = lower(p.pasarela)
          ORDER BY mp.activo DESC, mp.creado_en ASC LIMIT 1) / 100, 2)
 WHERE p.pasarela IS NOT NULL
   AND p.comision_pasarela = 0
   AND EXISTS (
         SELECT 1 FROM metodos_pago mp
          WHERE mp.cuenta_id = p.cuenta_id AND lower(mp.nombre) = lower(p.pasarela)
            AND mp.comision_pct > 0);
