-- Agrupar publicaciones de ML que son el mismo producto físico.
-- Elias tiene varias publicaciones por producto (planes de cuotas con precio
-- distinto, títulos reescritos). El stock real es uno solo; el buffer de ML se
-- publica a todas las publicaciones del grupo.
--
-- Modelo: una publicación "canónica" por grupo. `derivarCatalogo` crea 1 product
-- por grupo (sku_base = ml_item_id de la canónica) y matchea las variantes por
-- integrante entre todas las publicaciones del grupo.

create table listing_groups (
  id                   uuid primary key default gen_random_uuid(),
  nombre               text,
  canonical_listing_id uuid not null references ml_listings(id) on delete cascade,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger trg_listing_groups_updated before update on listing_groups
  for each row execute function set_updated_at();

alter table ml_listings
  add column grupo_id uuid references listing_groups(id) on delete set null;
create index on ml_listings (grupo_id);

alter table listing_groups enable row level security;
