-- Un pedido ya despachado no vuelve a reservar stock.
--
-- Mercado Libre deja los pedidos en estado "paid" para siempre, así que cada
-- resincronización volvía a crear la reserva de ventas viejas y el stock libre
-- quedaba artificialmente en cero. La regla vive en la función para que valga
-- aunque la llame el webhook, el cron o el panel.

create or replace function inventory_reserve_order(p_order_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_stock integer; v_other integer; v_reserved integer; v_count integer := 0;
begin
  if not exists (
    select 1 from ml_orders o
    where o.id = p_order_id
      and o.stock_descontado_at is null
      and coalesce(o.estado, '') = 'paid'
  ) then
    return 0;
  end if;

  insert into inventory_operations(idempotency_key,tipo,order_id)
  values('reserva:' || p_order_id::text,'reserva',p_order_id)
  on conflict(idempotency_key) do nothing;
  for r in
    select oi.id item_id, oi.product_variant_id variant_id, greatest(oi.cantidad,1) qty
    from ml_order_items oi where oi.ml_order_id=p_order_id and oi.product_variant_id is not null
    order by oi.id
  loop
    select stock_real into v_stock from product_variants where id=r.variant_id for update;
    select coalesce(sum(reserved_qty),0) into v_other from inventory_reservations
      where product_variant_id=r.variant_id and estado='activa' and order_item_id<>r.item_id;
    v_reserved := least(r.qty, greatest(v_stock-v_other,0));
    insert into inventory_reservations(order_id,order_item_id,product_variant_id,requested_qty,reserved_qty,estado)
    values(p_order_id,r.item_id,r.variant_id,r.qty,v_reserved,'activa')
    on conflict(order_item_id) do update set
      product_variant_id=excluded.product_variant_id, requested_qty=excluded.requested_qty,
      reserved_qty=excluded.reserved_qty, estado='activa', updated_at=now();
    v_count := v_count + 1;
  end loop;
  for r in
    select distinct oi.product_variant_id variant_id from ml_order_items oi
    where oi.ml_order_id=p_order_id and oi.product_variant_id is not null
  loop
    perform inventory_rebalance_variant(r.variant_id);
  end loop;
  return v_count;
end $$;

revoke execute on function public.inventory_reserve_order(uuid) from anon, authenticated, public;

-- Libera las reservas que se habían creado sobre ventas ya despachadas.
update inventory_reservations r
set estado = 'liberada', updated_at = now()
from ml_orders o
where o.id = r.order_id
  and r.estado = 'activa'
  and (o.stock_descontado_at is not null or coalesce(o.estado, '') <> 'paid');

do $$ declare v record; begin
  for v in select distinct product_variant_id id from inventory_reservations
  loop perform inventory_rebalance_variant(v.id); end loop;
end $$;
