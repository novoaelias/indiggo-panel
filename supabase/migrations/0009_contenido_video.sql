-- Soporte de video (Veo3) en Contenido: estado "generando" y el id de tarea de kie.
alter table content_pieces drop constraint if exists content_pieces_estado_check;
alter table content_pieces
  add constraint content_pieces_estado_check
  check (estado in ('generando', 'borrador', 'listo', 'publicado', 'error'));
alter table content_pieces add column if not exists kie_task_id text;
alter table content_pieces add column if not exists error text;
