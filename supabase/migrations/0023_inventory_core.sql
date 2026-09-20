-- Inventario transaccional: separa terminados, reservas y piezas compartidas.
-- La migración es aditiva y guarda una foto previa para poder auditar el cambio.

alter table products
  add column if not exists nombre_interno text,
  add column if not exists catalog_locked boolean not null default false;

update products
set nombre_interno = coalesce(nombre_interno, nombre),
    catalog_locked = true
where activo = true;

alter table ml_listings
  add column if not exists product_variant_id uuid references product_variants(id) on delete set null;
create index if not exists ml_listings_product_variant_idx on ml_listings(product_variant_id);

alter table components
  add column if not exists codigo text,
  add column if not exists unidad text not null default 'unidad',
  add column if not exists equivalencia text,
  add column if not exists color text,
  add column if not exists activo boolean not null default true;
create unique index if not exists components_codigo_unique
  on components(codigo) where codigo is not null;

alter table variant_components
  add column if not exists notas text,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists inventory_legacy_snapshot (
  id uuid primary key default gen_random_uuid(),
  captured_at timestamptz not null default now(),
  payload jsonb not null
);

insert into inventory_legacy_snapshot(payload)
select jsonb_build_object(
  'products', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from products p),
  'variants', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) from product_variants v),
  'components', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from components c),
  'recipes', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from variant_components r)
)
where not exists (select 1 from inventory_legacy_snapshot);

create table if not exists inventory_operations (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  tipo text not null check (tipo in (
    'ajuste','impresion','armado','reserva','liberacion','despacho','devolucion','migracion'
  )),
  order_id uuid references ml_orders(id) on delete set null,
  nota text,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists inventory_operations_created_idx
  on inventory_operations(created_at desc);

create table if not exists inventory_movement_lines (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references inventory_operations(id) on delete cascade,
  entity_type text not null check (entity_type in ('variant','component')),
  product_variant_id uuid references product_variants(id) on delete set null,
  component_id uuid references components(id) on delete set null,
  delta integer not null,
  quantity_before integer not null,
  quantity_after integer not null,
  snapshot jsonb,
  created_at timestamptz not null default now(),
  check (
    (entity_type = 'variant' and product_variant_id is not null and component_id is null) or
    (entity_type = 'component' and component_id is not null and product_variant_id is null)
  )
);
create index if not exists inventory_lines_operation_idx on inventory_movement_lines(operation_id);
create index if not exists inventory_lines_variant_idx on inventory_movement_lines(product_variant_id);
create index if not exists inventory_lines_component_idx on inventory_movement_lines(component_id);

create table if not exists inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references ml_orders(id) on delete cascade,
  order_item_id uuid not null references ml_order_items(id) on delete cascade,
  product_variant_id uuid not null references product_variants(id) on delete restrict,
  requested_qty integer not null check (requested_qty > 0),
  reserved_qty integer not null default 0 check (reserved_qty >= 0),
  missing_qty integer generated always as (greatest(requested_qty - reserved_qty, 0)) stored,
  estado text not null default 'activa' check (estado in ('activa','liberada','consumida')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_item_id)
);
create index if not exists inventory_reservations_order_idx on inventory_reservations(order_id);
create index if not exists inventory_reservations_active_idx
  on inventory_reservations(product_variant_id) where estado = 'activa';

create or replace function inventory_rebalance_variant(p_variant_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_available integer;
begin
  select stock_real into v_available from product_variants
  where id=p_variant_id for update;
  if not found then return; end if;
  for r in
    select id,requested_qty from inventory_reservations
    where product_variant_id=p_variant_id and estado='activa'
    order by created_at,id for update
  loop
    update inventory_reservations
    set reserved_qty=least(r.requested_qty,greatest(v_available,0)),updated_at=now()
    where id=r.id;
    v_available := greatest(v_available-r.requested_qty,0);
  end loop;
end $$;

create table if not exists production_runs (
  id uuid primary key default gen_random_uuid(),
  component_id uuid references components(id) on delete set null,
  product_variant_id uuid references product_variants(id) on delete set null,
  tipo text not null check (tipo in ('impresion','armado','compra')),
  cantidad integer not null check (cantidad > 0),
  placas numeric(8,2),
  estado text not null default 'pendiente' check (estado in ('pendiente','en_proceso','terminada','cancelada')),
  nota text,
  operation_id uuid references inventory_operations(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists production_runs_state_idx on production_runs(estado, created_at);

create table if not exists inventory_returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references ml_orders(id) on delete restrict,
  operation_id uuid not null references inventory_operations(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- Unidades claras para las piezas verificadas con las publicaciones reales.
update components set
  nombre = 'Juego BTS', codigo = 'BTS-JUEGO', unidad = 'juego',
  equivalencia = 'B + T + S (3 letras)'
where nombre = 'Letras BTS';
update components set
  nombre = 'Juego de nombres BTS', codigo = 'BTS-NOMBRES-JUEGO', unidad = 'juego',
  equivalencia = '22 letras: RM, Jin, SUGA, j-hope, Jimin, V y Jung Kook'
where nombre = 'Set nombres BTS';
update components set
  nombre = 'Logo Arirang completo', codigo = 'ARIRANG-LOGO-COMPLETO', unidad = 'mostacilla',
  equivalencia = 'Logo completo de tres círculos'
where nombre = 'Logo arirang triple';
update components set
  nombre = 'Logo Arirang completo negro', codigo = 'ARIRANG-LOGO-COMPLETO-NEGRO', unidad = 'mostacilla',
  equivalencia = 'Logo completo de tres círculos'
where nombre = 'Logo arirang triple negro';
update components set
  nombre = 'Juego de logo Arirang desglosado', codigo = 'ARIRANG-LOGO-DESGLOSADO', unidad = 'juego',
  equivalencia = 'Tres piezas sueltas que forman un logo'
where nombre = 'Logo arirang suelto';

-- Lo que antes aparecía como stock de holders era capacidad derivada de piezas.
-- Se conserva en el snapshot y el nuevo contador de terminados empieza en cero.
update product_variants v
set stock_real = 0
from products p
where p.id = v.product_id and p.variantes_por_integrante = true;

-- Agrupa los colores del pack de 110 en un solo producto con una variante por
-- color. Las publicaciones se reconocen por el SKU estable de Mercado Libre; la
-- lila no tiene SKU cargado en ML y se nombra por su ml_item_id (verificado a
-- mano: es el mismo pack en otro color).
drop table if exists pack110;
create temp table pack110 as
select
  l.id as listing_id,
  l.product_id,
  l.ml_item_id,
  l.grupo_id,
  l.estado,
  coalesce(nullif(trim((
    select a->>'value_name' from jsonb_array_elements(coalesce(l.raw->'attributes','[]'::jsonb)) a
    where a->>'id' = 'COLOR' limit 1
  )), ''), 'Sin color') as color,
  -- La variante se resuelve ANTES de mover nada: si se resolviera dentro del
  -- bucle, una publicación podría tomar la variante de otro color ya mudada.
  (select v.id from product_variants v
    where v.product_id = l.product_id and v.activo
    order by (v.sku = l.ml_item_id) desc, v.created_at, v.id
    limit 1) as variant_id
from ml_listings l
where coalesce((
        select a->>'value_name' from jsonb_array_elements(coalesce(l.raw->'attributes','[]'::jsonb)) a
        where a->>'id' = 'SELLER_SKU' limit 1
      ), '') like 'BTS-ARI-NAME-110%'
   or l.ml_item_id = 'MLA2086465417';

do $$
declare
  v_group uuid;
  v_canonical_listing uuid;
  v_canonical_item text;
  v_canonical_product uuid;
  r record;
begin
  if not exists (select 1 from pack110) then return; end if;

  -- Se respeta el grupo y la publicación canónica que ya existan: el sku_base
  -- del producto y la derivación posterior dependen de ese ml_item_id.
  select p.grupo_id into v_group
  from pack110 p where p.grupo_id is not null
  group by p.grupo_id order by count(*) desc, p.grupo_id limit 1;

  if v_group is null then
    select p.listing_id into v_canonical_listing from pack110 p
    order by (p.estado = 'active') desc, (p.color = 'Rojo') desc, p.ml_item_id limit 1;
    insert into listing_groups(nombre, canonical_listing_id)
    values ('Pack 110 letras BTS + nombres', v_canonical_listing)
    returning id into v_group;
  else
    select canonical_listing_id into v_canonical_listing from listing_groups where id = v_group;
  end if;
  if v_canonical_listing is null then return; end if;

  select ml_item_id into v_canonical_item from ml_listings where id = v_canonical_listing;
  select id into v_canonical_product from products where sku_base = v_canonical_item;
  if v_canonical_product is null then
    select product_id into v_canonical_product from ml_listings where id = v_canonical_listing;
  end if;
  if v_canonical_product is null then return; end if;

  -- Una variante por color, conservando la que ya tenía stock y receta.
  for r in
    select distinct on (p.color) p.color, p.variant_id
    from pack110 p where p.variant_id is not null
    order by p.color, (p.product_id = v_canonical_product) desc, p.listing_id
  loop
    update product_variants
    set product_id = v_canonical_product,
        etiqueta = r.color,
        sku = v_canonical_item || '#COLOR:' || upper(regexp_replace(r.color, '[^A-Za-z0-9]+', '', 'g')),
        activo = true
    where id = r.variant_id;
  end loop;

  -- Todas las publicaciones del pack quedan en el mismo grupo, producto y color.
  update ml_listings l
  set grupo_id = v_group,
      product_id = v_canonical_product,
      product_variant_id = (
        select v.id from product_variants v
        where v.product_id = v_canonical_product
          and v.sku = v_canonical_item || '#COLOR:' || upper(regexp_replace(p.color, '[^A-Za-z0-9]+', '', 'g'))
        limit 1)
  from pack110 p
  where p.listing_id = l.id;

  update products set nombre_interno = coalesce(nombre_interno, 'Pack 110 letras BTS + nombres')
  where id = v_canonical_product;

  -- Los productos que quedaron sin publicaciones dejan de estar activos.
  update products p set activo = false
  where p.id <> v_canonical_product
    and p.id in (select product_id from pack110 where product_id is not null)
    and not exists (select 1 from ml_listings l where l.product_id = p.id);
end $$;

drop table if exists pack110;

-- En publicaciones simples ya consolidadas, vincula la única variante existente.
update ml_listings l
set product_variant_id = v.id
from product_variants v
where l.product_id = v.product_id
  and l.product_variant_id is null
  and v.activo = true
  and 1 = (select count(*) from product_variants vx where vx.product_id = l.product_id and vx.activo = true);

create or replace function inventory_adjust(
  p_entity_type text,
  p_entity_id uuid,
  p_new_qty integer,
  p_reason text,
  p_idempotency_key text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_op uuid; v_before integer;
begin
  if p_new_qty < 0 or p_entity_type not in ('variant','component') then
    raise exception 'ajuste inválido';
  end if;
  select id into v_op from inventory_operations where idempotency_key = p_idempotency_key;
  if v_op is not null then return v_op; end if;

  insert into inventory_operations(idempotency_key, tipo, nota)
  values (p_idempotency_key, 'ajuste', nullif(trim(p_reason), ''))
  on conflict(idempotency_key) do nothing returning id into v_op;
  if v_op is null then
    select id into v_op from inventory_operations where idempotency_key=p_idempotency_key;
    return v_op;
  end if;

  if p_entity_type = 'variant' then
    select stock_real into v_before from product_variants where id = p_entity_id for update;
    if not found then raise exception 'variante inexistente'; end if;
    update product_variants set stock_real = p_new_qty where id = p_entity_id;
    perform inventory_rebalance_variant(p_entity_id);
    insert into inventory_movement_lines(operation_id,entity_type,product_variant_id,delta,quantity_before,quantity_after)
    values(v_op,'variant',p_entity_id,p_new_qty-v_before,v_before,p_new_qty);
  else
    select stock_real into v_before from components where id = p_entity_id for update;
    if not found then raise exception 'pieza inexistente'; end if;
    update components set stock_real = p_new_qty where id = p_entity_id;
    insert into inventory_movement_lines(operation_id,entity_type,component_id,delta,quantity_before,quantity_after)
    values(v_op,'component',p_entity_id,p_new_qty-v_before,v_before,p_new_qty);
  end if;
  return v_op;
end $$;

create or replace function inventory_register_print(
  p_component_id uuid,
  p_quantity integer,
  p_plates numeric,
  p_note text,
  p_idempotency_key text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_op uuid; v_before integer;
begin
  if p_quantity <= 0 then raise exception 'la cantidad debe ser positiva'; end if;
  select id into v_op from inventory_operations where idempotency_key = p_idempotency_key;
  if v_op is not null then return v_op; end if;
  select stock_real into v_before from components where id = p_component_id and activo = true for update;
  if not found then raise exception 'pieza inexistente'; end if;
  insert into inventory_operations(idempotency_key,tipo,nota,meta)
  values(p_idempotency_key,'impresion',nullif(trim(p_note),''),jsonb_build_object('placas',p_plates))
  on conflict(idempotency_key) do nothing returning id into v_op;
  if v_op is null then
    select id into v_op from inventory_operations where idempotency_key=p_idempotency_key;
    return v_op;
  end if;
  update components set stock_real = v_before + p_quantity where id = p_component_id;
  insert into inventory_movement_lines(operation_id,entity_type,component_id,delta,quantity_before,quantity_after)
  values(v_op,'component',p_component_id,p_quantity,v_before,v_before+p_quantity);
  insert into production_runs(component_id,tipo,cantidad,placas,estado,nota,operation_id,completed_at)
  values(p_component_id,'impresion',p_quantity,p_plates,'terminada',nullif(trim(p_note),''),v_op,now());
  return v_op;
end $$;

create or replace function inventory_assemble(
  p_variant_id uuid,
  p_quantity integer,
  p_note text,
  p_idempotency_key text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_op uuid; v_before integer; r record;
begin
  if p_quantity <= 0 then raise exception 'la cantidad debe ser positiva'; end if;
  select id into v_op from inventory_operations where idempotency_key = p_idempotency_key;
  if v_op is not null then return v_op; end if;

  select stock_real into v_before from product_variants where id = p_variant_id and activo = true for update;
  if not found then raise exception 'variante inexistente'; end if;
  perform c.id from components c join variant_components vc on vc.component_id=c.id
    where vc.variant_id=p_variant_id order by c.id for update;
  if not exists(select 1 from variant_components where variant_id=p_variant_id) then
    raise exception 'el producto no tiene receta';
  end if;
  if exists(
    select 1 from variant_components vc join components c on c.id=vc.component_id
    where vc.variant_id=p_variant_id and c.stock_real < vc.cantidad*p_quantity
  ) then raise exception 'no hay piezas suficientes para este armado'; end if;

  insert into inventory_operations(idempotency_key,tipo,nota)
  values(p_idempotency_key,'armado',nullif(trim(p_note),''))
  on conflict(idempotency_key) do nothing returning id into v_op;
  if v_op is null then
    select id into v_op from inventory_operations where idempotency_key=p_idempotency_key;
    return v_op;
  end if;
  for r in select c.id, c.stock_real, c.nombre, vc.cantidad
    from variant_components vc join components c on c.id=vc.component_id
    where vc.variant_id=p_variant_id order by c.id
  loop
    update components set stock_real=r.stock_real-r.cantidad*p_quantity where id=r.id;
    insert into inventory_movement_lines(operation_id,entity_type,component_id,delta,quantity_before,quantity_after,snapshot)
    values(v_op,'component',r.id,-r.cantidad*p_quantity,r.stock_real,r.stock_real-r.cantidad*p_quantity,
      jsonb_build_object('nombre',r.nombre,'cantidad_por_producto',r.cantidad));
  end loop;
  update product_variants set stock_real=v_before+p_quantity where id=p_variant_id;
  perform inventory_rebalance_variant(p_variant_id);
  insert into inventory_movement_lines(operation_id,entity_type,product_variant_id,delta,quantity_before,quantity_after)
  values(v_op,'variant',p_variant_id,p_quantity,v_before,v_before+p_quantity);
  insert into production_runs(product_variant_id,tipo,cantidad,estado,nota,operation_id,completed_at)
  values(p_variant_id,'armado',p_quantity,'terminada',nullif(trim(p_note),''),v_op,now());
  return v_op;
end $$;

create or replace function inventory_reserve_order(p_order_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_stock integer; v_other integer; v_reserved integer; v_count integer := 0;
begin
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

create or replace function inventory_release_order(p_order_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer; r record;
begin
  insert into inventory_operations(idempotency_key,tipo,order_id)
  values('liberacion:' || p_order_id::text,'liberacion',p_order_id)
  on conflict(idempotency_key) do nothing;
  update inventory_reservations set estado='liberada', updated_at=now()
  where order_id=p_order_id and estado='activa';
  get diagnostics v_count = row_count;
  for r in
    select distinct product_variant_id variant_id from inventory_reservations
    where order_id=p_order_id
  loop
    perform inventory_rebalance_variant(r.variant_id);
  end loop;
  return v_count;
end $$;

create or replace function inventory_fulfill_order(p_order_id uuid, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_op uuid; r record; c record; v_stock integer; v_other integer; v_finished integer; v_missing integer;
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
    select oi.id item_id, oi.product_variant_id variant_id, greatest(oi.cantidad,1) qty,
      coalesce(ir.reserved_qty,0) reserved_qty
    from ml_order_items oi
    left join inventory_reservations ir on ir.order_item_id=oi.id and ir.estado='activa'
    where oi.ml_order_id=p_order_id and oi.product_variant_id is not null order by oi.id
  loop
    select stock_real into v_stock from product_variants where id=r.variant_id for update;
    select coalesce(sum(reserved_qty),0) into v_other from inventory_reservations
      where product_variant_id=r.variant_id and estado='activa' and order_item_id<>r.item_id;
    v_finished := least(r.qty, greatest(v_stock-v_other,0));
    v_missing := r.qty-v_finished;
    if v_finished > 0 then
      update product_variants set stock_real=v_stock-v_finished where id=r.variant_id;
      insert into inventory_movement_lines(operation_id,entity_type,product_variant_id,delta,quantity_before,quantity_after)
      values(v_op,'variant',r.variant_id,-v_finished,v_stock,v_stock-v_finished);
    end if;
    if v_missing > 0 then
      perform c2.id from components c2 join variant_components vc2 on vc2.component_id=c2.id
        where vc2.variant_id=r.variant_id order by c2.id for update;
      if not exists(select 1 from variant_components where variant_id=r.variant_id) then
        raise exception 'faltan % terminado(s) y el producto no tiene receta', v_missing;
      end if;
      if exists(select 1 from variant_components vc join components cx on cx.id=vc.component_id
        where vc.variant_id=r.variant_id and cx.stock_real < vc.cantidad*v_missing) then
        raise exception 'faltan piezas para completar el pedido';
      end if;
      for c in select cx.id,cx.stock_real,cx.nombre,vc.cantidad
        from variant_components vc join components cx on cx.id=vc.component_id
        where vc.variant_id=r.variant_id order by cx.id
      loop
        update components set stock_real=c.stock_real-c.cantidad*v_missing where id=c.id;
        insert into inventory_movement_lines(operation_id,entity_type,component_id,delta,quantity_before,quantity_after,snapshot)
        values(v_op,'component',c.id,-c.cantidad*v_missing,c.stock_real,c.stock_real-c.cantidad*v_missing,
          jsonb_build_object('nombre',c.nombre,'cantidad_por_producto',c.cantidad,'armado_en_despacho',true));
      end loop;
    end if;
    update inventory_reservations set estado='consumida',updated_at=now() where order_item_id=r.item_id;
  end loop;
  return v_op;
end $$;

create or replace function inventory_return_order(
  p_order_id uuid,
  p_note text,
  p_idempotency_key text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_op uuid; r record; v_before integer;
begin
  select operation_id into v_op from inventory_returns where order_id=p_order_id;
  if v_op is not null then return v_op; end if;
  if not exists(select 1 from inventory_operations where order_id=p_order_id and tipo='despacho') then
    raise exception 'el pedido no tiene un despacho registrado';
  end if;
  insert into inventory_operations(idempotency_key,tipo,order_id,nota)
  values(p_idempotency_key,'devolucion',p_order_id,nullif(trim(p_note),''))
  on conflict(idempotency_key) do nothing returning id into v_op;
  if v_op is null then
    select id into v_op from inventory_operations where idempotency_key=p_idempotency_key;
    return v_op;
  end if;
  insert into inventory_returns(order_id,operation_id) values(p_order_id,v_op);
  for r in
    select oi.product_variant_id variant_id, sum(greatest(oi.cantidad,1))::integer qty
    from ml_order_items oi
    where oi.ml_order_id=p_order_id and oi.product_variant_id is not null
    group by oi.product_variant_id order by oi.product_variant_id
  loop
    select stock_real into v_before from product_variants where id=r.variant_id for update;
    update product_variants set stock_real=v_before+r.qty where id=r.variant_id;
    perform inventory_rebalance_variant(r.variant_id);
    insert into inventory_movement_lines(
      operation_id,entity_type,product_variant_id,delta,quantity_before,quantity_after,snapshot
    ) values(
      v_op,'variant',r.variant_id,r.qty,v_before,v_before+r.qty,
      jsonb_build_object('devolucion_fisica',true)
    );
  end loop;
  return v_op;
end $$;

create or replace function inventory_set_recipe(p_variant_id uuid, p_lines jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_count integer := 0;
begin
  if not exists(select 1 from product_variants where id=p_variant_id) then
    raise exception 'variante inexistente';
  end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'receta inválida'; end if;
  delete from variant_components where variant_id=p_variant_id;
  for r in select * from jsonb_to_recordset(p_lines) as x(component_id uuid, cantidad integer, notas text)
  loop
    if r.cantidad <= 0 or not exists(select 1 from components where id=r.component_id and activo=true) then
      raise exception 'línea de receta inválida';
    end if;
    insert into variant_components(variant_id,component_id,cantidad,notas,updated_at)
    values(p_variant_id,r.component_id,r.cantidad,r.notas,now());
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Vincula pedidos existentes y crea sus reservas iniciales sin tocar stock.
update ml_order_items oi set product_variant_id=mv.product_variant_id
from ml_listings l join ml_listing_variations mv on mv.ml_listing_id=l.id
where oi.ml_item_id=l.ml_item_id and oi.ml_variation_id=mv.ml_variation_id
  and oi.product_variant_id is null and mv.product_variant_id is not null;
update ml_order_items oi set product_variant_id=l.product_variant_id
from ml_listings l
where oi.ml_item_id=l.ml_item_id and oi.ml_variation_id is null
  and oi.product_variant_id is null and l.product_variant_id is not null;
do $$ declare r record; begin
  for r in select id from ml_orders where estado='paid' and stock_descontado_at is null
  loop perform inventory_reserve_order(r.id); end loop;
end $$;
