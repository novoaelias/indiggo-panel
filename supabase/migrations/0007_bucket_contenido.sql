-- Bucket público para las imágenes generadas del módulo Contenido.
-- Las URLs de kie.ai expiran ~24 h; guardamos una copia acá.
insert into storage.buckets (id, name, public)
values ('contenido', 'contenido', true)
on conflict (id) do nothing;
