-- =====================================================================
-- Migración 010: Link de pago en los cursos/productos (venta directa)
-- =====================================================================
-- Muchas ventas de infoproducto no pasan por llamada: el lead comenta, el
-- setter le manda el link de pago (Stripe, Hotmart, Mercado Pago…) y listo.
-- Guardamos ese link en cada curso para mandarlo con un clic desde el Chat.
-- =====================================================================

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS link_pago text;
