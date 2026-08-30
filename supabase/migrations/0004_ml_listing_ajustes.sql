-- ML reporta más estados que los del CHECK inicial (inactive, etc.); guardamos
-- el string tal cual. Y agregamos la cantidad publicada a nivel item.
alter table ml_listings drop constraint if exists ml_listings_estado_check;
alter table ml_listings add column if not exists cantidad_ml int;
