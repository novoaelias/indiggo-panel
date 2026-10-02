-- Fecha límite de despacho de cada envío, para separar en Pedidos lo que hay
-- que despachar hoy sí o sí (si no, ML penaliza la reputación) de lo que puede
-- esperar al próximo día hábil.
--
-- La informa ML en GET /shipments/{id}/sla (`expected_date`, ej.
-- 2026-10-05T23:59:59-03:00: lo pagado un viernes después del corte vence el
-- lunes). La guarda worker/lib/sync.ts `syncEnvio` mientras el envío no salió.
alter table public.ml_orders
  add column if not exists envio_limite_despacho timestamptz;

comment on column public.ml_orders.envio_limite_despacho is
  'expected_date de /shipments/{id}/sla: hasta cuándo hay que despachar sin que ML lo cuente como demorado.';
