-- Variantes "Random / a elección / sorpresa" (sin integrante fijo): el comprador
-- no elige, se cumple con cualquier variante real. No deben tener stock ni
-- producción propia; su colchón de ML se deriva de las variantes reales del
-- producto. (Los holders ya lo resolvían para las photocards; esto lo generaliza
-- a clickers, packs, etc.) Lo marca worker/lib/derivar.ts.
alter table product_variants
  add column if not exists es_eleccion boolean not null default false;

comment on column product_variants.es_eleccion is
  'true = variante random / a elección sin integrante: sin stock ni producción propia; su stock_ml se deriva de las variantes reales';
