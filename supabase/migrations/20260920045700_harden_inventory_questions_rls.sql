-- Las tablas 0023/0024 se crearon después del bloque inicial que activaba RLS
-- para el esquema existente. El panel es privado y sólo accede desde el Worker
-- con service_role: no debe existir acceso directo desde anon/authenticated.

alter table public.inventory_legacy_snapshot enable row level security;
alter table public.inventory_operations enable row level security;
alter table public.inventory_movement_lines enable row level security;
alter table public.inventory_reservations enable row level security;
alter table public.production_runs enable row level security;
alter table public.inventory_returns enable row level security;
alter table public.ml_questions enable row level security;
alter table public.question_knowledge enable row level security;
alter table public.business_facts enable row level security;
alter table public.question_jobs enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_deliveries enable row level security;

revoke all on table
  public.inventory_legacy_snapshot,
  public.inventory_operations,
  public.inventory_movement_lines,
  public.inventory_reservations,
  public.production_runs,
  public.inventory_returns,
  public.ml_questions,
  public.question_knowledge,
  public.business_facts,
  public.question_jobs,
  public.push_subscriptions,
  public.push_deliveries
from anon, authenticated, public;

grant all on table
  public.inventory_legacy_snapshot,
  public.inventory_operations,
  public.inventory_movement_lines,
  public.inventory_reservations,
  public.production_runs,
  public.inventory_returns,
  public.ml_questions,
  public.question_knowledge,
  public.business_facts,
  public.question_jobs,
  public.push_subscriptions,
  public.push_deliveries
to service_role;

-- 0028 agregó p_kind a inventory_register_print. La firma nueva es otra
-- función para PostgreSQL y no heredó el REVOKE hecho en 0025.
revoke execute on function public.inventory_register_print(
  uuid, integer, numeric, text, text, text
) from anon, authenticated, public;
grant execute on function public.inventory_register_print(
  uuid, integer, numeric, text, text, text
) to service_role;
