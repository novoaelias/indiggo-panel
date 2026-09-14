-- Marca manual e inmune a derivarCatalogo: producto que Elias ya no vende más
-- (la publicación de ML puede seguir viva porque ML no deja borrarla). Oculta
-- el producto de las alertas y del resumen de stock, y lo saca del push
-- automático de buffer a ML.
alter table products
  add column descontinuado boolean not null default false;
