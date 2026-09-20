export interface AssemblyCandidate {
  id: string;
  nombre: string;
  etiqueta: string;
  faltantes_pedidos: number;
  stock_minimo: number;
  libres: number;
  receta: Array<{ component_id: string; cantidad: number }>;
}

export interface AssemblySuggestion {
  variant_id: string;
  nombre: string;
  etiqueta: string;
  cantidad: number;
  motivo: string;
}

/** Cuántas unidades permiten armar las piezas que hay (mínimo sobre la receta).
 *  Es por variante: no reparte piezas compartidas, eso lo hace
 *  `allocateAssemblySuggestions`. */
export function armablesPorReceta(
  receta: ReadonlyArray<{ component_id: string; cantidad: number }>,
  stockPieza: ReadonlyMap<string, number>,
): number {
  if (!receta.length) return 0;
  return Math.max(
    0,
    Math.min(
      ...receta.map((linea) =>
        Math.floor(
          (stockPieza.get(linea.component_id) ?? 0) / Math.max(1, linea.cantidad),
        ),
      ),
    ),
  );
}

/** Lo que se puede prometer hoy de una variante: terminados libres de reservas
 *  más lo armable con las piezas disponibles, menos lo ya comprometido en
 *  pedidos que todavía no tiene terminado. Sobre este número se calcula el
 *  colchón que se publica en Mercado Libre. */
export function disponibleComercial(input: {
  terminados: number;
  reservados: number;
  armables: number;
  faltantes: number;
}): number {
  const libres = Math.max(0, input.terminados - input.reservados);
  return Math.max(0, libres + input.armables - input.faltantes);
}

/** Distribuye componentes compartidos en orden de prioridad sin contarlos dos veces. */
export function allocateAssemblySuggestions(
  variants: AssemblyCandidate[],
  componentStock: ReadonlyMap<string, number>,
): AssemblySuggestion[] {
  const simulated = new Map(componentStock);
  const suggestions: AssemblySuggestion[] = [];
  for (const variant of variants) {
    const desired = Math.max(
      variant.faltantes_pedidos,
      variant.stock_minimo - variant.libres,
      0,
    );
    if (!desired || !variant.receta.length) continue;
    const possible = Math.min(
      desired,
      ...variant.receta.map((line) =>
        Math.floor((simulated.get(line.component_id) ?? 0) / line.cantidad),
      ),
    );
    if (possible <= 0) continue;
    for (const line of variant.receta)
      simulated.set(
        line.component_id,
        (simulated.get(line.component_id) ?? 0) - line.cantidad * possible,
      );
    suggestions.push({
      variant_id: variant.id,
      nombre: variant.nombre,
      etiqueta: variant.etiqueta,
      cantidad: possible,
      motivo: variant.faltantes_pedidos
        ? `${variant.faltantes_pedidos} comprometido(s) en pedidos`
        : "reponer el mínimo sugerido",
    });
  }
  return suggestions;
}

export interface PiezaInventario {
  id: string;
  nombre: string;
  unidad: string;
  origen: string;
  stock_real: number;
  stock_minimo: number;
  rinde_por_placa: number | null;
  minutos_placa: number | null;
  minutos_produccion: number | null;
}

export interface TrabajoPieza {
  component_id: string;
  nombre: string;
  unidad: string;
  origen: string;
  stock_real: number;
  faltan: number;
  sugerido: number;
  placas: number | null;
  placas_label: string;
  minutos: number | null;
  para_pedidos: boolean;
}

/** Qué piezas hay que reponer: lo que piden los armados pendientes (pedidos y
 *  mínimos) más lo que falta para el mínimo de la propia pieza. La cantidad
 *  sugerida se redondea a fracciones de placa, que es como se imprime. */
export function planPiezas(
  variants: AssemblyCandidate[],
  piezas: PiezaInventario[],
  redondear: (
    neto: number,
    rinde: number | null,
    minutosPlaca: number | null,
    minutosUnidad: number,
  ) => { cantidad: number; minutos: number; placas: number | null; label: string },
): TrabajoPieza[] {
  const demanda = new Map<string, number>();
  const porPedido = new Set<string>();
  for (const variant of variants) {
    const pendiente = Math.max(
      variant.faltantes_pedidos,
      variant.stock_minimo - variant.libres,
      0,
    );
    if (!pendiente) continue;
    for (const linea of variant.receta) {
      demanda.set(
        linea.component_id,
        (demanda.get(linea.component_id) ?? 0) + linea.cantidad * pendiente,
      );
      if (variant.faltantes_pedidos > 0) porPedido.add(linea.component_id);
    }
  }

  const trabajos: TrabajoPieza[] = [];
  for (const pieza of piezas) {
    const faltan = Math.max(
      (demanda.get(pieza.id) ?? 0) - pieza.stock_real,
      pieza.stock_minimo - pieza.stock_real,
      0,
    );
    if (faltan <= 0) continue;
    const r = redondear(
      faltan,
      pieza.rinde_por_placa,
      pieza.minutos_placa,
      pieza.minutos_produccion ?? 0,
    );
    trabajos.push({
      component_id: pieza.id,
      nombre: pieza.nombre,
      unidad: pieza.unidad,
      origen: pieza.origen,
      stock_real: pieza.stock_real,
      faltan,
      sugerido: Math.max(r.cantidad, faltan),
      placas: r.placas,
      placas_label: r.label,
      minutos: r.minutos || null,
      para_pedidos: porPedido.has(pieza.id),
    });
  }
  return trabajos.sort(
    (a, b) =>
      Number(b.para_pedidos) - Number(a.para_pedidos) || b.faltan - a.faltan,
  );
}

/** Tope de una variante "a elección" (Random / PC a elección): el comprador no
 *  elige el integrante, pero igual se despacha uno. Su receta no incluye la
 *  pieza que cambia (la photocard), así que se limita por el total de esas
 *  piezas específicas entre las variantes reales del producto. Sin piezas
 *  específicas no hay tope. */
export function topeEleccion(
  recetaEleccion: ReadonlyArray<{ component_id: string }>,
  recetasHermanas: ReadonlyArray<ReadonlyArray<{ component_id: string }>>,
  stockPieza: ReadonlyMap<string, number>,
): number | null {
  const comunes = new Set(recetaEleccion.map((l) => l.component_id));
  const especificas = new Set<string>();
  for (const receta of recetasHermanas)
    for (const linea of receta)
      if (!comunes.has(linea.component_id)) especificas.add(linea.component_id);
  if (!especificas.size) return null;
  let total = 0;
  for (const id of especificas) total += Math.max(0, stockPieza.get(id) ?? 0);
  return total;
}
