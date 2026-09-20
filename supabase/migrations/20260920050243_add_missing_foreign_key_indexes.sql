-- Índices de cobertura para las claves foráneas informadas por el asesor de
-- rendimiento de Supabase. Reducen scans al borrar/actualizar padres y aceleran
-- los joins usados por inventario, producción, preguntas y contenido.
create index if not exists content_pieces_product_id_idx
  on public.content_pieces (product_id);
create index if not exists inventory_operations_order_id_idx
  on public.inventory_operations (order_id);
create index if not exists inventory_returns_operation_id_idx
  on public.inventory_returns (operation_id);
create index if not exists listing_groups_canonical_listing_id_idx
  on public.listing_groups (canonical_listing_id);
create index if not exists media_generations_content_piece_id_idx
  on public.media_generations (content_piece_id);
create index if not exists media_generations_product_id_idx
  on public.media_generations (product_id);
create index if not exists product_variants_group_member_id_idx
  on public.product_variants (group_member_id);
create index if not exists production_runs_component_id_idx
  on public.production_runs (component_id);
create index if not exists production_runs_operation_id_idx
  on public.production_runs (operation_id);
create index if not exists production_runs_product_variant_id_idx
  on public.production_runs (product_variant_id);
create index if not exists production_tasks_component_id_idx
  on public.production_tasks (component_id);
create index if not exists production_tasks_product_variant_id_idx
  on public.production_tasks (product_variant_id);
create index if not exists question_knowledge_source_question_id_idx
  on public.question_knowledge (source_question_id);
create index if not exists variant_components_component_id_idx
  on public.variant_components (component_id);
