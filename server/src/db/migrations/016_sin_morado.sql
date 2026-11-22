-- El dueño pidió nada de morado: los colores violeta/índigo de la paleta
-- por defecto pasan a azul y turquesa (solo los que venían de fábrica).
UPDATE etapas SET color = '#0891b2' WHERE lower(color) IN ('#8b5cf6', '#a855f7', '#7c3aed');
UPDATE etapas SET color = '#2563eb' WHERE lower(color) = '#6366f1';
ALTER TABLE etapas ALTER COLUMN color SET DEFAULT '#2563eb';
