-- Analizador SEO de categorías de Mercado Libre.
-- ML no deja cambiar la categoría de una publicación: cuando está mal, hay que
-- cerrarla y volver a crearla en la correcta. Estas columnas guardan el
-- resultado del análisis y el vínculo con la publicación que la reemplazó.

alter table ml_listings
  add column categoria_sugerida text,
  add column categoria_analisis jsonb,
  add column reemplazada_por    text;

comment on column ml_listings.categoria_sugerida is 'category_id de ML recomendado por el analizador';
comment on column ml_listings.categoria_analisis is 'detalle del análisis: actual/sugerida (id, nombre, path), coincide, confianza, candidatas, motivo, chequeado_at';
comment on column ml_listings.reemplazada_por is 'ml_item_id de la publicación nueva que la reemplazó (re-publicación por categoría)';
