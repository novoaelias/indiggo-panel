-- El despacho nunca falla: cuando Mercado Libre dice que el paquete salió, salió.
--
-- Antes `inventory_fulfill_order` cortaba con una excepción si no alcanzaban los
-- terminados libres ni las piezas ("faltan piezas para completar el pedido",
-- "el producto no tiene receta"). Como la transacción se deshacía, la reserva de
-- esa venta quedaba activa para siempre y el sync la reintentaba cada hora sin
-- éxito. Las reservas viejas se reparten primero (`inventory_rebalance_variant`
-- ordena por fecha), así que se comían cualquier conteo nuevo: cargabas 3
-- terminados y el panel seguía diciendo que faltaban para pedidos que ya se
-- habían entregado.
--
-- Ahora, en este orden: terminados libres, armado con las piezas que haya,
-- terminados que estaban reservados para otra venta (salieron físicamente) y,
-- si aun así falta, se registra como "salió sin stock cargado" en `meta` de la
-- operación para recontar ese producto. La reserva se consume siempre.

create or replace function inventory_fulfill_order(p_order_id uuid, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_op uuid; r record; c record;
  v_stock integer; v_other integer; v_finished integer; v_missing integer;
  v_extra integer; v_armables integer; v_piezas integer;
  v_sin_stock jsonb := '[]'::jsonb;
begin
  select id into v_op from inventory_operations where idempotency_key=p_idempotency_key;
  if v_op is not null then return v_op; end if;
  insert into inventory_operations(idempotency_key,tipo,order_id)
  values(p_idempotency_key,'despacho',p_order_id)
  on conflict(idempotency_key) do nothing returning id into v_op;
  if v_op is null then
    select id into v_op from inventory_operations where idempotency_key=p_idempotency_key;
    return v_op;
  end if;

  for r in
    select oi.id item_id, oi.product_variant_id variant_id, greatest(oi.cantidad,1) qty
    from ml_order_items oi
    where oi.ml_order_id=p_order_id and oi.product_variant_id is not null order by oi.id
  loop
    select stock_real into v_stock from product_variants where id=r.variant_id for update;
    select coalesce(sum(reserved_qty),0) into v_other from inventory_reservations
      where product_variant_id=r.variant_id and estado='activa' and order_item_id<>r.item_id;

    -- 1) terminados libres
    v_finished := least(r.qty, greatest(v_stock-v_other,0));
    v_missing := r.qty-v_finished;

    -- 2) lo que falta se armó con las piezas que haya
    if v_missing > 0 then
      perform c2.id from components c2 join variant_components vc2 on vc2.component_id=c2.id
        where vc2.variant_id=r.variant_id order by c2.id for update;
      select min(floor(cx.stock_real::numeric / greatest(vc.cantidad,1)))::integer into v_armables
        from variant_components vc join components cx on cx.id=vc.component_id
        where vc.variant_id=r.variant_id;
      v_piezas := least(v_missing, greatest(coalesce(v_armables,0),0));
      if v_piezas > 0 then
        for c in select cx.id,cx.stock_real,cx.nombre,vc.cantidad
          from variant_components vc join components cx on cx.id=vc.component_id
          where vc.variant_id=r.variant_id order by cx.id
        loop
          update components set stock_real=c.stock_real-c.cantidad*v_piezas where id=c.id;
          insert into inventory_movement_lines(operation_id,entity_type,component_id,delta,quantity_before,quantity_after,snapshot)
          values(v_op,'component',c.id,-c.cantidad*v_piezas,c.stock_real,c.stock_real-c.cantidad*v_piezas,
            jsonb_build_object('nombre',c.nombre,'cantidad_por_producto',c.cantidad,'armado_en_despacho',true));
        end loop;
        v_missing := v_missing-v_piezas;
      end if;
    end if;

    -- 3) salió un terminado que estaba apartado para otra venta: esa otra
    --    venta pasa a faltante en el rebalanceo de abajo
    if v_missing > 0 then
      v_extra := least(v_missing, greatest(v_stock-v_finished,0));
      v_finished := v_finished+v_extra;
      v_missing := v_missing-v_extra;
    end if;

    if v_finished > 0 then
      update product_variants set stock_real=v_stock-v_finished where id=r.variant_id;
      insert into inventory_movement_lines(operation_id,entity_type,product_variant_id,delta,quantity_before,quantity_after)
      values(v_op,'variant',r.variant_id,-v_finished,v_stock,v_stock-v_finished);
    end if;

    -- 4) no estaba cargado en ningún lado: se anota para recontar
    if v_missing > 0 then
      v_sin_stock := v_sin_stock || jsonb_build_object('product_variant_id',r.variant_id,'cantidad',v_missing);
    end if;

    update inventory_reservations set estado='consumida',updated_at=now() where order_item_id=r.item_id;
    perform inventory_rebalance_variant(r.variant_id);
  end loop;

  if jsonb_array_length(v_sin_stock) > 0 then
    update inventory_operations
    set meta=coalesce(meta,'{}'::jsonb) || jsonb_build_object('sin_stock',v_sin_stock),
        nota='Salió sin stock cargado: recontá este producto'
    where id=v_op;
  end if;
  return v_op;
end $$;

revoke execute on function public.inventory_fulfill_order(uuid, text) from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- Regularización de las 13 ventas que quedaron trabadas (25/09 a 05/10).
-- Las fechas de salida son las de /shipments/{id}/history de Mercado Libre.
--
-- a) Salieron ANTES del último conteo manual de su producto (el 05/10 a las
--    12:41 AR): ese conteo ya no las incluía, así que se cierra la reserva sin
--    tocar cantidades. Misma clave de idempotencia que usa el Worker
--    (`despacho:<id>`), para que un reintento posterior sea un no-op.
with ventas as (
  select id from ml_orders
  where ml_order_id in (
    '2000000000000000', -- Pack 100 mixtas, salió 25/09
    '2000000000000000', -- Pack 100 mixtas, salió 02/10
    '2000000000000000', -- Pack 50 logo rojo x2, salió 29/09
    '2000000000000000', -- Pack 50 logo rojo, salió 29/09
    '2000000000000000', -- Pack 50 logo rojo, salió 30/09
    '2000000000000000', -- Pack 50 logo rojo x2, salió 01/10
    '2000000000000000'  -- Pack 110 integrantes rojo, salió 30/09
  )
  and stock_descontado_at is null
),
ops as (
  insert into inventory_operations(idempotency_key,tipo,order_id,nota)
  select 'despacho:' || id::text, 'despacho', id,
    'Regularizado: salió antes del último conteo manual'
  from ventas
  on conflict(idempotency_key) do nothing
  returning order_id
),
reservas as (
  update inventory_reservations set estado='consumida', updated_at=now()
  where estado='activa' and order_id in (select id from ventas)
  returning order_id
)
update ml_orders set stock_descontado_at=now()
where id in (select id from ventas);

-- b) Salieron DESPUÉS de ese conteo (05/10 17:34 AR) o son del holder de
--    Katseye, que no tenía stock ni receta cargados: se descuentan con la
--    función nueva, que deja anotado lo que faltaba.
do $$ declare v record; begin
  for v in
    select id from ml_orders
    where ml_order_id in (
      '2000000000000000', -- Pack 100 mixtas
      '2000000000000000', -- Pack 50 logo rojo
      '2000000000000000', -- Pack 50 logo rojo
      '2000000000000000', -- Pack 50 logo rojo x2
      '2000000000000000', -- Holder Katseye
      '2000000000000000'  -- Holder Katseye x2
    )
    and stock_descontado_at is null
    order by fecha
  loop
    update ml_orders set stock_descontado_at=now() where id=v.id;
    perform inventory_fulfill_order(v.id, 'despacho:' || v.id::text);
  end loop;
end $$;

-- Las reservas que quedan (ventas que todavía no salieron) se reparten de
-- nuevo sobre el stock real.
do $$ declare v record; begin
  for v in select distinct product_variant_id id from inventory_reservations where estado='activa'
  loop perform inventory_rebalance_variant(v.id); end loop;
end $$;
