-- Grupos que ya aparecen en las publicaciones de INDIGGOSTORE, con nombres
-- canónicos de integrantes. Se usan para mapear las variantes de ML.
insert into groups (nombre) values
  ('Stray Kids'), ('Twice'), ('Katseye')
on conflict (nombre) do nothing;

insert into group_members (group_id, nombre, orden)
select g.id, m.nombre, m.orden from groups g
join (values
  ('Stray Kids','Bang Chan',0), ('Stray Kids','Lee Know',1), ('Stray Kids','Changbin',2),
  ('Stray Kids','Hyunjin',3), ('Stray Kids','Han',4), ('Stray Kids','Felix',5),
  ('Stray Kids','Seungmin',6), ('Stray Kids','I.N',7),
  ('Twice','Nayeon',0), ('Twice','Jeongyeon',1), ('Twice','Momo',2), ('Twice','Sana',3),
  ('Twice','Jihyo',4), ('Twice','Mina',5), ('Twice','Dahyun',6), ('Twice','Chaeyoung',7),
  ('Twice','Tzuyu',8),
  ('Katseye','Lara',0), ('Katseye','Sophia',1), ('Katseye','Daniela',2),
  ('Katseye','Manon',3), ('Katseye','Megan',4), ('Katseye','Yoonchae',5)
) as m(grupo, nombre, orden) on m.grupo = g.nombre
on conflict (group_id, nombre) do nothing;
