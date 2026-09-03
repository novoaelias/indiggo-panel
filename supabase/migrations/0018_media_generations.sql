-- Registro append-only de cada imagen/video generado con IA (kie.ai: nano-banana,
-- Veo3). Sirve para auditar el gasto: content_pieces se puede borrar desde el
-- panel, esto NO. El costo es una ESTIMACIÓN (mapa en worker/lib/kie.ts); la
-- verdad está en el dashboard de kie.ai.
create table media_generations (
  id               uuid primary key default gen_random_uuid(),
  content_piece_id uuid references content_pieces(id) on delete set null,
  tipo             text not null check (tipo in ('imagen','video')),
  proveedor        text not null default 'kie',
  modelo           text not null,
  costo_usd        numeric(10,4) not null default 0,
  prompt           text,
  ref_urls         jsonb,
  media_url        text,        -- copia guardada en Storage (bucket "contenido")
  storage_path     text,        -- ruta dentro del bucket (carpeta por mes)
  product_id       uuid references products(id) on delete set null,
  ok               boolean not null default true,
  error            text,
  created_at       timestamptz not null default now()
);
create index on media_generations (created_at desc);
create index on media_generations (modelo);

alter table media_generations enable row level security;
