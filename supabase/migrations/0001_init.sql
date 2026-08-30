-- Indiggo panel — schema inicial
-- Modelo: catálogo con variantes por integrante de kpop, doble stock (real vs ML),
-- lista de materiales (BOM) para separar producción 3D vs. imprenta, y espejo de
-- publicaciones/pedidos de Mercado Libre.
-- Sólo el Worker (service_role) accede: RLS activo sin policies = deny-all para anon.

-- ---------- helpers ----------
create extension if not exists "pgcrypto";

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- catálogo base ----------
create table categories (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null unique,
  slug         text not null unique,
  -- origen de producción por defecto para productos de esta categoría
  origen       text not null default 'impresora3d'
               check (origen in ('impresora3d','imprenta','mixto','externo')),
  created_at   timestamptz not null default now()
);

create table groups (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null unique,
  created_at   timestamptz not null default now()
);

create table group_members (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references groups(id) on delete cascade,
  nombre       text not null,
  orden        int  not null default 0,
  activo       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (group_id, nombre)
);
create index on group_members (group_id);

-- ---------- productos y variantes ----------
create table products (
  id                 uuid primary key default gen_random_uuid(),
  nombre             text not null,
  category_id        uuid references categories(id) on delete set null,
  group_id           uuid references groups(id) on delete set null,
  -- si true, se generan variantes por cada integrante de group_id
  variantes_por_integrante boolean not null default false,
  sku_base           text,
  notas              text,
  activo             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index on products (category_id);
create index on products (group_id);
create trigger trg_products_updated before update on products
  for each row execute function set_updated_at();

-- unidad vendible: para productos simples hay 1 fila (group_member_id null)
create table product_variants (
  id                 uuid primary key default gen_random_uuid(),
  product_id         uuid not null references products(id) on delete cascade,
  group_member_id    uuid references group_members(id) on delete set null,
  etiqueta           text not null default 'Único',
  sku                text unique,
  stock_real         int  not null default 0,   -- lo que existe físicamente
  stock_ml           int  not null default 0,   -- colchón publicado en ML
  stock_minimo       int  not null default 3,   -- gatillo de producción
  activo             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (product_id, group_member_id)
);
create index on product_variants (product_id);
create trigger trg_variants_updated before update on product_variants
  for each row execute function set_updated_at();

-- ---------- insumos / lista de materiales ----------
-- componentes = cosas que se fabrican o compran y se consumen al armar una variante
-- (cuerpo de holder impreso en 3D, photocard de un integrante hecha en imprenta, etc.)
create table components (
  id                 uuid primary key default gen_random_uuid(),
  nombre             text not null,
  origen             text not null default 'impresora3d'
                     check (origen in ('impresora3d','imprenta','externo')),
  group_member_id    uuid references group_members(id) on delete set null,
  stock_real         int  not null default 0,
  stock_minimo       int  not null default 0,
  -- minutos de impresora por unidad (para estimar la cola de producción 3D)
  minutos_produccion int,
  notas              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index on components (group_member_id);
create trigger trg_components_updated before update on components
  for each row execute function set_updated_at();

create table variant_components (
  variant_id         uuid not null references product_variants(id) on delete cascade,
  component_id       uuid not null references components(id) on delete cascade,
  cantidad           int  not null default 1 check (cantidad > 0),
  primary key (variant_id, component_id)
);

-- ---------- Mercado Libre: publicaciones ----------
create table ml_listings (
  id                 uuid primary key default gen_random_uuid(),
  product_id         uuid references products(id) on delete set null,
  ml_item_id         text not null unique,          -- MLA...
  titulo             text not null,
  estado             text not null default 'active'
                     check (estado in ('active','paused','closed','under_review','payment_required')),
  precio             numeric(12,2),
  moneda             text not null default 'ARS',
  permalink          text,
  thumbnail          text,
  tiene_variantes    boolean not null default false,
  ml_actualizado_at  timestamptz,                    -- last_updated que reporta ML
  sincronizado_at    timestamptz,                    -- última vez que lo trajimos
  raw                jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index on ml_listings (product_id);
create index on ml_listings (estado);
create trigger trg_ml_listings_updated before update on ml_listings
  for each row execute function set_updated_at();

create table ml_listing_variations (
  id                 uuid primary key default gen_random_uuid(),
  ml_listing_id      uuid not null references ml_listings(id) on delete cascade,
  product_variant_id uuid references product_variants(id) on delete set null,
  ml_variation_id    text not null,
  combinacion        jsonb,        -- attribute_combinations de ML (ej. integrante)
  cantidad_ml        int,
  precio             numeric(12,2),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (ml_listing_id, ml_variation_id)
);
create index on ml_listing_variations (product_variant_id);
create trigger trg_ml_variations_updated before update on ml_listing_variations
  for each row execute function set_updated_at();

-- ---------- Mercado Libre: pedidos ----------
create table ml_orders (
  id                 uuid primary key default gen_random_uuid(),
  ml_order_id        text not null unique,
  estado             text,           -- paid, cancelled, etc.
  estado_envio       text,
  fecha              timestamptz not null,
  total              numeric(12,2),
  comprador          text,
  raw                jsonb,
  created_at         timestamptz not null default now()
);
create index on ml_orders (fecha desc);

create table ml_order_items (
  id                 uuid primary key default gen_random_uuid(),
  ml_order_id        uuid not null references ml_orders(id) on delete cascade,
  ml_item_id         text,
  ml_variation_id    text,
  product_variant_id uuid references product_variants(id) on delete set null,
  titulo             text,
  cantidad           int not null default 1,
  precio_unitario    numeric(12,2)
);
create index on ml_order_items (ml_order_id);
create index on ml_order_items (product_variant_id);

-- ---------- producción ----------
create table production_tasks (
  id                 uuid primary key default gen_random_uuid(),
  product_variant_id uuid references product_variants(id) on delete set null,
  component_id       uuid references components(id) on delete set null,
  nombre             text not null,
  origen             text not null default 'impresora3d'
                     check (origen in ('impresora3d','imprenta','externo')),
  cantidad           int  not null default 1,
  estado             text not null default 'pendiente'
                     check (estado in ('pendiente','en_proceso','hecho','descartado')),
  fuente             text not null default 'auto' check (fuente in ('auto','manual')),
  para_fecha         date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  hecho_at           timestamptz
);
create index on production_tasks (estado);
create trigger trg_production_updated before update on production_tasks
  for each row execute function set_updated_at();

-- ---------- alertas del panel (pantalla Inicio) ----------
create table alerts (
  id                 uuid primary key default gen_random_uuid(),
  tipo               text not null,   -- stock_critico, publicacion_pausada, produccion, info...
  severidad          text not null default 'info'
                     check (severidad in ('info','ok','warn','danger')),
  titulo             text not null,
  detalle            text,
  entidad_tipo       text,
  entidad_id         uuid,
  resuelta_at        timestamptz,
  created_at         timestamptz not null default now()
);
create index on alerts (resuelta_at);

-- ---------- contenido para redes ----------
create table content_pieces (
  id                 uuid primary key default gen_random_uuid(),
  plataforma         text not null check (plataforma in ('instagram','tiktok')),
  formato            text not null default 'imagen' check (formato in ('imagen','video','carrusel')),
  caption            text,
  hashtags           text,
  media_url          text,
  product_id         uuid references products(id) on delete set null,
  estado             text not null default 'borrador'
                     check (estado in ('borrador','listo','publicado')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger trg_content_updated before update on content_pieces
  for each row execute function set_updated_at();

-- ---------- integraciones (tokens OAuth, etc.) ----------
create table integrations (
  provider           text primary key,   -- 'mercadolibre'
  access_token       text,
  refresh_token      text,
  expires_at         timestamptz,
  meta               jsonb not null default '{}'::jsonb,  -- ej. { "user_id": 123456 }
  updated_at         timestamptz not null default now()
);
create trigger trg_integrations_updated before update on integrations
  for each row execute function set_updated_at();

-- ---------- RLS: sólo service_role (Worker). anon/authenticated = sin acceso ----------
do $$
declare t text;
begin
  foreach t in array array[
    'categories','groups','group_members','products','product_variants',
    'components','variant_components','ml_listings','ml_listing_variations',
    'ml_orders','ml_order_items','production_tasks','alerts','content_pieces',
    'integrations'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
