-- El mínimo por variante arrancaba en 3 por defecto y nunca se personalizó
-- (las 126 variantes estaban en 3). Eso hacía que el planificador pidiera
-- producir de todo. Ahora el plan se guía por las VENTAS; el mínimo es un
-- "querer siempre tener N" opcional que Elias setea a mano cuando lo necesita.
alter table product_variants alter column stock_minimo set default 0;
update product_variants set stock_minimo = 0 where stock_minimo = 3;
