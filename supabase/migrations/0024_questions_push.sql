-- Preguntas, conocimiento reutilizable, trabajos persistentes y Web Push.

create table if not exists ml_questions (
  id text primary key,
  ml_item_id text not null,
  product_id uuid references products(id) on delete set null,
  buyer_id text,
  pregunta text not null,
  respuesta text,
  estado_ml text not null,
  estado_panel text not null default 'pendiente' check (estado_panel in (
    'pendiente','procesando','necesita_respuesta','sugerida','respondida_auto','respondida_manual','ignorada','error'
  )),
  sugerencia text,
  motivo_revision text,
  respuesta_usuario text,
  automatico boolean not null default false,
  raw jsonb,
  preguntada_at timestamptz not null,
  respondida_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists ml_questions_pending_idx on ml_questions(estado_panel, preguntada_at desc);
create index if not exists ml_questions_product_idx on ml_questions(product_id, preguntada_at desc);

create table if not exists question_knowledge (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete cascade,
  pregunta text not null,
  respuesta text not null,
  fuente text not null default 'respuesta_manual' check (fuente in ('respuesta_manual','historial','regla')),
  vigente boolean not null default true,
  temporal boolean not null default false,
  source_question_id text references ml_questions(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists question_knowledge_product_idx on question_knowledge(product_id, vigente);

create table if not exists business_facts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete cascade,
  clave text not null,
  valor text not null,
  temporal boolean not null default false,
  vigente boolean not null default true,
  verified_at timestamptz not null default now(),
  unique(product_id, clave)
);

create table if not exists question_jobs (
  id uuid primary key default gen_random_uuid(),
  question_id text not null references ml_questions(id) on delete cascade,
  estado text not null default 'pendiente' check (estado in ('pendiente','procesando','terminado','error')),
  intentos integer not null default 0,
  run_after timestamptz not null default now(),
  ultimo_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(question_id)
);
create index if not exists question_jobs_ready_idx on question_jobs(estado, run_after);

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_error text
);

create table if not exists push_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references push_subscriptions(id) on delete cascade,
  dedupe_key text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente','enviado','error')),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique(subscription_id,dedupe_key)
);

