-- Métricas: lo que queda de cada venta después de Mercado Libre.
--
-- `total` es el bruto que pagó el comprador. El neto lo informa Mercado Pago en
-- cada pago (`transaction_details.net_received_amount`) y lo guarda el sync
-- (`worker/lib/neto.ts`) junto con el desglose: comisión de ML (porcentaje,
-- cargo por cuotas y costo fijo), retenciones de impuestos y envío a cargo del
-- vendedor. Mientras un pedido no tiene neto (recién cobrado, ML todavía no
-- cargó la comisión), las métricas lo estiman con `sale_fee` del pedido.

alter table public.ml_orders
  add column if not exists neto numeric(12,2),
  add column if not exists comision_ml numeric(12,2),
  add column if not exists impuestos numeric(12,2),
  add column if not exists envio_vendedor numeric(12,2),
  add column if not exists neto_sync_at timestamptz;

comment on column public.ml_orders.neto is
  'Lo que acredita Mercado Pago: total menos comisión de ML, retenciones y envío del vendedor.';

create or replace function public.panel_metricas(p_dias integer default 7)
returns json language sql stable set search_path to '' as $function$
  with rango as (
    select (timezone('America/Argentina/Buenos_Aires', now())::date - (p_dias - 1)) as desde,
           timezone('America/Argentina/Buenos_Aires', now())::date as hasta,
           (timezone('America/Argentina/Buenos_Aires', now())::date - (2 * p_dias - 1)) as desde_prev,
           (timezone('America/Argentina/Buenos_Aires', now())::date - p_dias) as hasta_prev
  ),
  base as (
    -- sale_fee es la comisión por unidad que informa el pedido: sirve de
    -- estimación hasta que el sync guarda el neto real del pago.
    select o.id,
           timezone('America/Argentina/Buenos_Aires', o.fecha)::date as dia,
           o.total,
           coalesce(o.neto, o.total - coalesce(f.sale_fee, 0)) as neto,
           coalesce(o.comision_ml, coalesce(f.sale_fee, 0)) as comision,
           coalesce(o.impuestos, 0) as impuestos,
           coalesce(o.envio_vendedor, 0) as envio,
           o.neto is null as estimado
    from public.ml_orders o
    left join lateral (
      select sum(coalesce((li->>'sale_fee')::numeric, 0)
                 * coalesce((li->>'quantity')::numeric, 1)) as sale_fee
      from jsonb_array_elements(coalesce(o.raw->'order_items', '[]'::jsonb)) li
    ) f on true
    where o.estado = 'paid'
  ),
  pedidos as (
    select b.* from base b, rango r where b.dia >= r.desde
  ),
  pedidos_prev as (
    select b.* from base b, rango r where b.dia >= r.desde_prev and b.dia < r.desde
  ),
  serie as (
    select gs::date as dia,
           coalesce(sum(p.total), 0) as monto,
           coalesce(sum(p.neto), 0) as neto,
           count(p.id) as pedidos
    from rango r
    cross join generate_series(r.desde, r.hasta, interval '1 day') gs
    left join pedidos p on p.dia = gs::date
    group by gs::date
  ),
  top as (
    select coalesce(pr.nombre_interno, pr.nombre, li.titulo) as nombre,
           sum(li.cantidad) as unidades,
           sum(li.cantidad * coalesce(li.precio_unitario, 0)) as ingreso
    from public.ml_order_items li
    join pedidos p on p.id = li.ml_order_id
    left join public.product_variants v on v.id = li.product_variant_id
    left join public.products pr on pr.id = v.product_id
    group by coalesce(pr.nombre_interno, pr.nombre, li.titulo)
    order by ingreso desc
    limit 5
  )
  select json_build_object(
    'dias', p_dias,
    'ventas_totales', (select coalesce(sum(total), 0) from pedidos),
    'ventas_netas', (select coalesce(round(sum(neto)), 0) from pedidos),
    'comisiones', (select coalesce(round(sum(comision)), 0) from pedidos),
    'impuestos', (select coalesce(round(sum(impuestos)), 0) from pedidos),
    'envios', (select coalesce(round(sum(envio)), 0) from pedidos),
    'pedidos_estimados', (select count(*) from pedidos where estimado),
    'pedidos', (select count(*) from pedidos),
    'ticket_promedio',
      (select case when count(*) > 0 then round(sum(total) / count(*)) else 0 end from pedidos),
    'ventas_prev', (select coalesce(sum(total), 0) from pedidos_prev),
    'ventas_netas_prev', (select coalesce(round(sum(neto)), 0) from pedidos_prev),
    'pedidos_prev', (select count(*) from pedidos_prev),
    'por_dia',
      (select coalesce(json_agg(json_build_object(
         'dia', dia, 'monto', monto, 'neto', round(neto), 'pedidos', pedidos) order by dia), '[]') from serie),
    'top',
      (select coalesce(json_agg(json_build_object(
         'nombre', nombre, 'unidades', unidades, 'ingreso', ingreso) order by ingreso desc), '[]') from top)
  );
$function$;
