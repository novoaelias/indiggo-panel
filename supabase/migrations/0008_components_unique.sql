-- La derivación de BOM identifica los insumos por nombre.
alter table components
  add constraint components_nombre_key unique (nombre);
