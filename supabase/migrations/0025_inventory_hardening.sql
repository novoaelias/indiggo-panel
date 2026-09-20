-- Cierra los avisos del linter tras 0023 y completa las piezas por color.

-- Las operaciones de inventario son SECURITY DEFINER para poder bloquear filas
-- y escribir el historial. Sólo las llama el Worker con la service role: los
-- roles públicos de PostgREST no deben poder tocar stock por /rest/v1/rpc.
revoke execute on function public.inventory_rebalance_variant(uuid) from anon, authenticated, public;
revoke execute on function public.inventory_adjust(text, uuid, integer, text, text) from anon, authenticated, public;
revoke execute on function public.inventory_register_print(uuid, integer, numeric, text, text) from anon, authenticated, public;
revoke execute on function public.inventory_assemble(uuid, integer, text, text) from anon, authenticated, public;
revoke execute on function public.inventory_reserve_order(uuid) from anon, authenticated, public;
revoke execute on function public.inventory_release_order(uuid) from anon, authenticated, public;
revoke execute on function public.inventory_fulfill_order(uuid, text) from anon, authenticated, public;
revoke execute on function public.inventory_return_order(uuid, text, text) from anon, authenticated, public;
revoke execute on function public.inventory_set_recipe(uuid, jsonb) from anon, authenticated, public;

-- Color de las piezas que ya estaban cargadas (las que no se verificaron quedan
-- sin color hasta confirmarlo desde el panel).
update components set color = 'Rojo'
where codigo in ('ARIRANG-LOGO-COMPLETO', 'ARIRANG-LOGO-DESGLOSADO', 'BTS-NOMBRES-JUEGO')
  and color is null;
update components set color = 'Negro'
where codigo = 'ARIRANG-LOGO-COMPLETO-NEGRO' and color is null;

-- El pack de 110 se publica en rojo, negro y lila, y cada color se imprime con
-- su propio filamento: son piezas distintas con su propio conteo. El rinde y el
-- tiempo por placa se copian del juego rojo (misma placa, mismo modelo).
insert into components (nombre, codigo, origen, unidad, equivalencia, color, stock_real, stock_minimo, rinde_por_placa, minutos_placa)
select
  'Juego de nombres BTS ' || lower(c.color_nuevo),
  'BTS-NOMBRES-JUEGO-' || upper(c.color_nuevo),
  base.origen,
  base.unidad,
  base.equivalencia,
  c.color_nuevo,
  0,
  0,
  base.rinde_por_placa,
  base.minutos_placa
from (values ('Negro'), ('Lila')) as c(color_nuevo)
cross join components base
where base.codigo = 'BTS-NOMBRES-JUEGO'
  and not exists (
    select 1 from components x where x.codigo = 'BTS-NOMBRES-JUEGO-' || upper(c.color_nuevo)
  );

-- Receta de cada color del pack de 110: 5 juegos de nombres de ese color.
insert into variant_components (variant_id, component_id, cantidad, notas, updated_at)
select v.id, c.id, 5, 'Un pack arma una vez los siete nombres, cinco veces', now()
from product_variants v
join components c
  on c.codigo = 'BTS-NOMBRES-JUEGO-' || upper(v.etiqueta)
where v.sku in ('MLA1831637567#COLOR:NEGRO', 'MLA1831637567#COLOR:LILA')
  and not exists (
    select 1 from variant_components vc where vc.variant_id = v.id and vc.component_id = c.id
  );
