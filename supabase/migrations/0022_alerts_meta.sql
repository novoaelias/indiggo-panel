-- Datos estructurados opcionales por alerta (ej. qué variante y en qué valor
-- quedó el stock, para poder verificar solo si ya se corrigió antes de dejar
-- que Elias la borre). Ver worker/lib/stock.ts resolverAlertaManual.
alter table alerts
  add column meta jsonb;
