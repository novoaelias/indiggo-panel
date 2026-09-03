-- panel_metricas contaba los días en UTC: de noche en Argentina (UTC−3) "hoy" ya
-- era mañana, y las ventas de la tarde/noche caían en el día equivocado (o se
-- perdían del rango). Se pasa todo el bucketing a horario de Buenos Aires.
create or replace function panel_metricas(p_dias int default 7)
returns json
language sql
stable
security invoker
set search_path = ''
as $$
  with rango as (
    select (timezone('America/Argentina/Buenos_Aires', now())::date - (p_dias - 1)) as desde,
           timezone('America/Argentina/Buenos_Aires', now())::date as hasta,
           (timezone('America/Argentina/Buenos_Aires', now())::date - (2 * p_dias - 1)) as desde_prev,
           (timezone('America/Argentina/Buenos_Aires', now())::date - p_dias) as hasta_prev
  ),
  pedidos as (
    select o.id,
           timezone('America/Argentina/Buenos_Aires', o.fecha)::date as dia,
           o.total
    from public.ml_orders o, rango r
    where o.estado = 'paid'
      and timezone('America/Argentina/Buenos_Aires', o.fecha)::date >= r.desde
  ),
  pedidos_prev as (
    select o.total
    from public.ml_orders o, rango r
    where o.estado = 'paid'
      and timezone('America/Argentina/Buenos_Aires', o.fecha)::date >= r.desde_prev
      and timezone('America/Argentina/Buenos_Aires', o.fecha)::date < r.desde
  ),
  serie as (
    select gs::date as dia,
           coalesce(sum(p.total), 0) as monto,
           count(p.id) as pedidos
    from rango r
    cross join generate_series(r.desde, r.hasta, interval '1 day') gs
    left join pedidos p on p.dia = gs::date
    group by gs::date
  ),
  top as (
    select li.titulo,
           sum(li.cantidad) as unidades,
           sum(li.cantidad * coalesce(li.precio_unitario, 0)) as ingreso
    from public.ml_order_items li
    join pedidos p on p.id = li.ml_order_id
    group by li.titulo
    order by ingreso desc
    limit 5
  )
  select json_build_object(
    'dias', p_dias,
    'ventas_totales', (select coalesce(sum(total), 0) from pedidos),
    'pedidos', (select count(*) from pedidos),
    'ticket_promedio',
      (select case when count(*) > 0 then round(sum(total) / count(*)) else 0 end from pedidos),
    'ventas_prev', (select coalesce(sum(total), 0) from pedidos_prev),
    'pedidos_prev', (select count(*) from pedidos_prev),
    'por_dia',
      (select coalesce(json_agg(json_build_object(
         'dia', dia, 'monto', monto, 'pedidos', pedidos) order by dia), '[]') from serie),
    'top',
      (select coalesce(json_agg(json_build_object(
         'nombre', titulo, 'unidades', unidades, 'ingreso', ingreso) order by ingreso desc), '[]') from top)
  );
$$;

revoke execute on function panel_metricas(int) from anon, authenticated, public;
