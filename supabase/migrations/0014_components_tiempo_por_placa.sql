-- Tiempos de impresión POR PLACA completa (Bambu Lab A1). Elias manda a imprimir
-- de a placas (o media / cuarto de placa para productos que rotan poco), así que
-- el planificador guarda el rinde y el tiempo de una placa entera y después:
--   min/unidad         = minutos_placa / rinde_por_placa
--   producción sugerida = redondeada a ¼ / ½ / ¾ / placa entera
-- `minutos_produccion` (min/unidad) se sigue usando como fallback y lo rellena
-- derivarBOM a partir de estos dos valores. Datos: Elias, 2026-08-31.
alter table components
  add column if not exists rinde_por_placa int
    check (rinde_por_placa is null or rinde_por_placa > 0),
  add column if not exists minutos_placa int
    check (minutos_placa is null or minutos_placa > 0);

comment on column components.rinde_por_placa is
  'unidades que salen de una placa de impresión completa';
comment on column components.minutos_placa is
  'minutos que tarda una placa completa';
