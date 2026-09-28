-- Editor de fotos en lote: borrar o agregar un objeto en las fotos ya
-- publicadas, con IA y siempre con revisión antes de tocar Mercado Libre.
--
-- Un lote = una instrucción ("borrar el charm de cuentas", con foto de
-- referencia) sobre un conjunto de publicaciones. Cada foto distinta de esas
-- publicaciones es un ítem: la misma foto compartida por varias publicaciones
-- o variantes se edita y se sube una sola vez. Lo aplicado se guarda por
-- publicación (qué foto se cambió por cuál) para poder deshacerlo.

create table public.photo_edit_batches (
  id          uuid primary key default gen_random_uuid(),
  modo        text not null check (modo in ('borrar', 'agregar')),
  descripcion text not null,
  -- Sólo para agregar: dónde va el objeto en el producto.
  ubicacion   text,
  -- Fotos de referencia (Storage público): la foto marcada o el objeto nuevo.
  referencias jsonb not null default '[]'::jsonb,
  ml_item_ids text[] not null,
  modelo      text not null,
  created_at  timestamptz not null default now()
);

create table public.photo_edit_items (
  id                  uuid primary key default gen_random_uuid(),
  batch_id            uuid not null references public.photo_edit_batches(id) on delete cascade,
  ml_picture_id       text not null,
  original_url        text not null,
  aspect_ratio        text,
  -- Publicaciones del lote que usan esta foto.
  ml_item_ids         text[] not null,
  orden               integer not null default 0,
  estado              text not null default 'pendiente' check (estado in (
                        'pendiente', 'descartada', 'para_editar', 'editando',
                        'revisar', 'aprobada', 'rechazada', 'error')),
  -- Resultado de la detección: { aplica, donde, motivo }.
  deteccion           jsonb,
  -- Corrección que escribe Elias para reintentar la edición.
  nota                text,
  editada_url         text,
  intentos            integer not null default 0,
  nuevo_ml_picture_id text,
  error               text,
  updated_at          timestamptz not null default now(),
  unique (batch_id, ml_picture_id)
);
create index on public.photo_edit_items (batch_id, orden);

create table public.photo_edit_applies (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references public.photo_edit_batches(id) on delete cascade,
  ml_item_id  text not null,
  -- { "<id viejo>": "<id nuevo>" } tal como quedó en la publicación.
  reemplazos  jsonb not null default '{}'::jsonb,
  estado      text not null check (estado in ('aplicada', 'deshecha', 'error')),
  error       text,
  aplicada_at timestamptz,
  deshecha_at timestamptz,
  unique (batch_id, ml_item_id)
);

-- Igual que el resto del esquema: sólo el Worker (service_role) accede.
alter table public.photo_edit_batches enable row level security;
alter table public.photo_edit_items enable row level security;
alter table public.photo_edit_applies enable row level security;

revoke all on table
  public.photo_edit_batches,
  public.photo_edit_items,
  public.photo_edit_applies
from anon, authenticated, public;

grant all on table
  public.photo_edit_batches,
  public.photo_edit_items,
  public.photo_edit_applies
to service_role;
