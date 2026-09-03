-- Marca de cuándo se registró un pedido Flex en la planilla de reparto
-- ("INDIGGO" en Google Sheets). Lo escribe worker/lib/sync.ts -> registrarEnvioFlex
-- cuando el shipment es self_service (Flex). NULL = todavía no se escribió.
alter table ml_orders
  add column if not exists sheet_synced_at timestamptz;

comment on column ml_orders.sheet_synced_at is
  'cuándo se agregó este pedido Flex a la planilla de reparto (Google Sheets); NULL = pendiente';
