-- Datos del envío para la pantalla "Pedidos activos". El tipo de logística
-- (Flex = self_service, Mercado Envíos = cross_docking/drop_off, Full =
-- fulfillment) y el estado real del envío no vienen en el pedido: los trae
-- worker/lib/sync.ts pidiendo GET /shipments/{id}. `estado_envio` (ya existía)
-- pasa a guardar el status del shipment.
alter table ml_orders
  add column if not exists logistic_type   text,
  add column if not exists envio_substatus text,
  add column if not exists envio_sync_at   timestamptz;

create index if not exists ml_orders_estado_envio_idx on ml_orders (estado_envio);

comment on column ml_orders.logistic_type is
  'logistic_type del shipment: self_service | cross_docking | drop_off | xd_drop_off | fulfillment';
comment on column ml_orders.estado_envio is 'status del shipment de ML';
comment on column ml_orders.envio_substatus is 'substatus del shipment (ej. ready_to_print, printed)';
