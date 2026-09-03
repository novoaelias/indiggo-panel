-- Descuento de stock al despachar una venta. worker/lib/sync.ts -> syncEnvio
-- marca esta columna cuando el envío pasa a shipped/delivered y descuenta el
-- stock de los ítems del pedido (ver worker/lib/stock.ts ajustarStockPorPedido).
-- NULL = todavía no se descontó.
alter table ml_orders
  add column if not exists stock_descontado_at timestamptz;

comment on column ml_orders.stock_descontado_at is
  'cuándo se descontó del stock esta venta (al despachar); NULL = pendiente';

-- Los pedidos que ya existen se marcan como "ya contados": el stock físico
-- actual que cargó Elias ya los refleja (o los revisará a mano). El descuento
-- automático arranca sólo para despachos nuevos.
update ml_orders set stock_descontado_at = coalesce(fecha, now())
where stock_descontado_at is null;
