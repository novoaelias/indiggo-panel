-- Registrar también las piezas que no se imprimen: las photocards llegan de la
-- imprenta y entran al inventario igual que una impresión, pero el historial
-- tiene que decir que fue una compra.

drop function if exists public.inventory_register_print(uuid, integer, numeric, text, text);

create or replace function inventory_register_print(
  p_component_id uuid,
  p_quantity integer,
  p_plates numeric,
  p_note text,
  p_idempotency_key text,
  p_kind text default 'impresion'
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_op uuid; v_before integer; v_kind text;
begin
  if p_quantity <= 0 then raise exception 'la cantidad debe ser positiva'; end if;
  v_kind := case when p_kind = 'compra' then 'compra' else 'impresion' end;
  select id into v_op from inventory_operations where idempotency_key = p_idempotency_key;
  if v_op is not null then return v_op; end if;
  select stock_real into v_before from components where id = p_component_id and activo = true for update;
  if not found then raise exception 'pieza inexistente'; end if;
  insert into inventory_operations(idempotency_key,tipo,nota,meta)
  values(p_idempotency_key,'impresion',nullif(trim(p_note),''),
         jsonb_build_object('placas',p_plates,'origen',v_kind))
  on conflict(idempotency_key) do nothing returning id into v_op;
  if v_op is null then
    select id into v_op from inventory_operations where idempotency_key=p_idempotency_key;
    return v_op;
  end if;
  update components set stock_real = v_before + p_quantity where id = p_component_id;
  insert into inventory_movement_lines(operation_id,entity_type,component_id,delta,quantity_before,quantity_after)
  values(v_op,'component',p_component_id,p_quantity,v_before,v_before+p_quantity);
  insert into production_runs(component_id,tipo,cantidad,placas,estado,nota,operation_id,completed_at)
  values(p_component_id,v_kind,p_quantity,p_plates,'terminada',nullif(trim(p_note),''),v_op,now());
  return v_op;
end $$;

revoke execute on function public.inventory_register_print(uuid, integer, numeric, text, text, text)
  from anon, authenticated, public;
