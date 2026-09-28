-- Editor de fotos: la edición con Nano Banana Pro puede quedar varios minutos
-- en la cola de kie.ai, demasiado para esperarla dentro de un request. Se
-- encarga, se guarda el id de la tarea y el panel la consulta hasta que
-- termina; si se cierra la pestaña, al volver se retoma la misma tarea.
alter table public.photo_edit_items add column if not exists kie_task_id text;
