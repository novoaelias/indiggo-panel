// Lista de materiales (BOM) y planificador de producción.
//
// Modelo: un holder con variante por integrante consume, al armarse, 1 "cuerpo"
// (frente + dorso del holder) impreso en 3D + 1 llavero impreso en 3D (propio de
// ese holder, el de BTS ≠ el de Stray Kids) + 1 photocard (imprenta) del
// integrante elegido. Los packs de mostacillas / letras tienen receta fija
// (RECETAS_SIMPLES): consumen piezas 3D (logos arirang, sets de nombres, letras
// BTS) pero su stock de "packs armados" lo lleva Elias a mano. El resto de los
// productos simples (clickers, stickers, fundas…) se producen directo, sin BOM.
//
// Tiempos de impresión: se cargan POR PLACA completa (PLACA) y el planificador
// redondea la producción a fracciones de placa (¼ / ½ / ¾ / placa), que es como
// Elias manda a imprimir.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type DB = SupabaseClient<Database>;

const rec = (s: string) => s.slice(0, 120);

// ---------- datos de impresión POR PLACA completa (Bambu Lab A1) ----------
// Elias imprime de a placas enteras (o fracciones para lo que rota poco). Guarda
// el rinde y el tiempo de UNA placa; el resto se deriva. Fuente: Elias 2026-08-31.
// La clave es el nombre exacto del componente (ver derivarBOM).
const PLACA: Record<string, { rinde: number; minutos: number }> = {
  "Cuerpo · Holder Arirang": { rinde: 3, minutos: 135 },
  "Cuerpo · Holder Straykids": { rinde: 3, minutos: 135 },
  "Llavero · Holder Arirang": { rinde: 23, minutos: 540 },
  "Llavero · Holder Straykids": { rinde: 17, minutos: 250 },
  "Logo Arirang completo": { rinde: 94, minutos: 495 },
  "Logo Arirang completo negro": { rinde: 94, minutos: 495 },
  "Juego de logo Arirang desglosado": { rinde: 64, minutos: 430 },
  "Juego de nombres BTS": { rinde: 13, minutos: 550 },
  "Juego BTS": { rinde: 85, minutos: 570 },
};

// ---------- rinde/tiempo por placa de productos 3D que se imprimen DIRECTO ----------
// (clickers, llavero suelto… no tienen receta de piezas). La clave es el nombre
// EXACTO del producto. Sin entrada acá, el plan sólo dice "N u.". Fuente: Elias.
const PLACA_PRODUCTO: Record<string, { rinde: number; minutos: number }> = {
  // clicker BT21: 14 por placa, 7 h 10 min
  "Fidget Clicker Bt21 Bts Juguete Antiestres Llavero": { rinde: 14, minutos: 430 },
  // clicker Arirang: 26 por placa, 23 h
  "Llavero Fidget Clicker Bts Arirang - Fidget Toy": { rinde: 26, minutos: 1380 },
};

/** true si el BOM de la variante es "una sola pieza ×1": el producto ES esa
 *  pieza (ej. el llavero suelto = el mismo llavero que va con el holder). Su
 *  stock se deriva de la pieza y Elias carga el número una sola vez, en la pieza. */
export function esVariantePieza(
  lines: ReadonlyArray<{ cantidad: number }> | undefined | null,
): boolean {
  return !!lines && lines.length === 1 && (lines[0].cantidad || 1) === 1;
}

// ---------- recetas de productos 3D que NO son holders ----------
// packs de mostacillas / letras: se venden armados pero consumen piezas impresas
// en 3D. nombre de producto (exacto) -> líneas, o por etiqueta de variante.
interface LineaReceta {
  comp: string;
  cantidad: number;
}
const RECETAS_SIMPLES: Record<
  string,
  LineaReceta[] | Record<string, LineaReceta[]>
> = {
  "Pack 100 Mostacillas Mixtas Arirang - Especial Pulseras Rojo": [
    { comp: "Logo Arirang completo", cantidad: 38 },
    { comp: "Juego de logo Arirang desglosado", cantidad: 6 },
    { comp: "Juego de nombres BTS", cantidad: 2 },
  ],
  "Pack 50 Mostacillas Surtidas Insumos Freebies Bts Arirang Rojo": [
    { comp: "Logo Arirang completo", cantidad: 19 },
    { comp: "Juego de logo Arirang desglosado", cantidad: 3 },
    { comp: "Juego de nombres BTS", cantidad: 1 },
  ],
  "Pack 50 Mostacillas Logo Arirang Bts - Especial Freebies": {
    Rojo: [{ comp: "Logo Arirang completo", cantidad: 50 }],
    Negro: [{ comp: "Logo Arirang completo negro", cantidad: 50 }],
  },
  "Mostacillas integrantes bts 110": [
    { comp: "Juego de nombres BTS", cantidad: 5 },
  ],
  "Pack 30 Letras  Bts  - Insumos Para Freebies": [
    { comp: "Juego BTS", cantidad: 10 },
  ],
  // llavero suelto = 1 llavero del holder Arirang (la misma pieza / el mismo stock)
  "Llavero Exclusivo Bts - Logo Nuevo Álbum - Accesorio Arirang Rojo": [
    { comp: "Llavero · Holder Arirang", cantidad: 1 },
  ],
};

function lineasReceta(
  receta: LineaReceta[] | Record<string, LineaReceta[]>,
  etiqueta: string,
): LineaReceta[] {
  return Array.isArray(receta) ? receta : (receta[etiqueta] ?? []);
}

// ---------- derivación automática del BOM ----------
export async function derivarBOM(db: DB): Promise<{
  cuerpos: number;
  llaveros: number;
  photocards: number;
  packs: number;
  vinculos: number;
}> {
  const { data: prods } = await db
    .from("products")
    .select("id, nombre, variantes_por_integrante, categories(origen)")
    .eq("variantes_por_integrante", true)
    .eq("activo", true);

  // productos 3D no-holder con receta fija (packs de mostacillas / letras)
  const { data: prodsSimples } = await db
    .from("products")
    .select("id, nombre")
    .eq("activo", true)
    .in("nombre", Object.keys(RECETAS_SIMPLES));

  const { data: variants } = await db
    .from("product_variants")
    .select("id, product_id, group_member_id, etiqueta")
    .eq("activo", true);

  const { data: gm } = await db
    .from("group_members")
    .select("id, nombre, groups(nombre)");
  const memberLabel = new Map(
    (gm ?? []).map((m) => [
      m.id,
      `${m.nombre} · ${(m.groups as { nombre?: string } | null)?.nombre ?? ""}`.trim(),
    ]),
  );

  const varsPorProducto = new Map<string, typeof variants>();
  for (const v of variants ?? []) {
    if (!varsPorProducto.has(v.product_id))
      varsPorProducto.set(v.product_id, []);
    varsPorProducto.get(v.product_id)!.push(v);
  }

  // componentes a asegurar (por nombre único)
  const compNuevos = new Map<
    string,
    Database["public"]["Tables"]["components"]["Insert"]
  >();
  // vínculos: variantId -> componente (con cantidad, 1 por defecto)
  const vinculos: Array<{
    variantId: string;
    compNombre: string;
    cantidad?: number;
  }> = [];

  for (const p of prods ?? []) {
    const cuerpoNombre = rec(`Cuerpo · ${p.nombre}`);
    compNuevos.set(cuerpoNombre, {
      nombre: cuerpoNombre,
      origen: "impresora3d",
    });
    const llaveroNombre = rec(`Llavero · ${p.nombre}`);
    compNuevos.set(llaveroNombre, {
      nombre: llaveroNombre,
      origen: "impresora3d",
    });

    for (const v of varsPorProducto.get(p.id) ?? []) {
      vinculos.push({ variantId: v.id, compNombre: cuerpoNombre });
      vinculos.push({ variantId: v.id, compNombre: llaveroNombre });
      if (v.group_member_id) {
        const pcNombre = rec(
          `Photocard · ${memberLabel.get(v.group_member_id) ?? v.etiqueta}`,
        );
        compNuevos.set(pcNombre, {
          nombre: pcNombre,
          origen: "imprenta",
          group_member_id: v.group_member_id,
        });
        vinculos.push({ variantId: v.id, compNombre: pcNombre });
      }
    }
  }

  // --- packs de mostacillas / letras (receta fija en RECETAS_SIMPLES) ---
  for (const p of prodsSimples ?? []) {
    const receta = RECETAS_SIMPLES[p.nombre];
    if (!receta) continue;
    for (const v of varsPorProducto.get(p.id) ?? []) {
      for (const ln of lineasReceta(receta, v.etiqueta)) {
        const compNombre = rec(ln.comp);
        compNuevos.set(compNombre, {
          nombre: compNombre,
          origen: "impresora3d",
        });
        vinculos.push({
          variantId: v.id,
          compNombre,
          cantidad: ln.cantidad,
        });
      }
    }
  }

  // --- si un Cuerpo/Llavero cambió de nombre (ej. merge de publicaciones que
  //     renombra el producto), renombrar el componente existente en vez de
  //     crear uno nuevo y perder el stock que cargó Elias ---
  const { data: compsPre } = await db
    .from("components")
    .select("id, nombre, origen, stock_real");
  const { data: vcPre } = await db
    .from("variant_components")
    .select("variant_id, component_id");
  const compByIdPre = new Map((compsPre ?? []).map((c) => [c.id, c]));
  const nombreExistePre = new Set((compsPre ?? []).map((c) => c.nombre));
  const prodPorVariant = new Map(
    (variants ?? []).map((v) => [v.id, v.product_id]),
  );
  const auto3dPorProd = new Map<string, Set<string>>();
  for (const r of vcPre ?? []) {
    const c = compByIdPre.get(r.component_id);
    const pid = prodPorVariant.get(r.variant_id);
    if (
      !c ||
      !pid ||
      c.origen !== "impresora3d" ||
      !(c.nombre.startsWith("Cuerpo · ") || c.nombre.startsWith("Llavero · "))
    )
      continue;
    if (!auto3dPorProd.has(pid)) auto3dPorProd.set(pid, new Set());
    auto3dPorProd.get(pid)!.add(r.component_id);
  }
  for (const p of prods ?? []) {
    const usados = [...(auto3dPorProd.get(p.id) ?? [])]
      .map((id) => compByIdPre.get(id))
      .filter(Boolean) as Array<{ id: string; nombre: string }>;
    for (const rol of ["Cuerpo", "Llavero"] as const) {
      const deseado = rec(`${rol} · ${p.nombre}`);
      const actual = usados.find((c) => c.nombre.startsWith(`${rol} · `));
      if (actual && actual.nombre !== deseado && !nombreExistePre.has(deseado)) {
        await db
          .from("components")
          .update({ nombre: deseado })
          .eq("id", actual.id);
        nombreExistePre.add(deseado);
      }
    }
  }

  if (compNuevos.size) {
    await db
      .from("components")
      .upsert([...compNuevos.values()], {
        onConflict: "nombre",
        ignoreDuplicates: true,
      });
  }

  const { data: comps } = await db.from("components").select("id, nombre");
  const idPorNombre = new Map((comps ?? []).map((c) => [c.nombre, c.id]));
  const nombresValidos = new Set(compNuevos.keys());

  // tiempos de impresión por placa (idempotente, fuente = PLACA en este archivo)
  for (const [nombre, { rinde, minutos }] of Object.entries(PLACA)) {
    if (!idPorNombre.has(nombre)) continue;
    await db
      .from("components")
      .update({
        rinde_por_placa: rinde,
        minutos_placa: minutos,
        minutos_produccion: Math.round(minutos / rinde),
      })
      .eq("nombre", nombre);
  }

  const vcRows = vinculos
    .map((v) => ({
      variant_id: v.variantId,
      component_id: idPorNombre.get(v.compNombre),
      cantidad: v.cantidad ?? 1,
    }))
    .filter(
      (r): r is { variant_id: string; component_id: string; cantidad: number } =>
        Boolean(r.component_id),
    );

  // --- limpieza de BOM viejo (idempotencia) ---
  const paresValidos = new Set(
    vcRows.map((r) => `${r.variant_id}:${r.component_id}`),
  );
  const { data: vcExist } = await db
    .from("variant_components")
    .select("variant_id, component_id");
  for (const r of vcExist ?? []) {
    if (!paresValidos.has(`${r.variant_id}:${r.component_id}`)) {
      await db
        .from("variant_components")
        .delete()
        .eq("variant_id", r.variant_id)
        .eq("component_id", r.component_id);
    }
  }
  // borrar componentes auto-generados que ya no aplican (nombre "Cuerpo · " o
  // "Photocard · " y no están en el set válido)
  for (const c of comps ?? []) {
    const esAuto =
      c.nombre.startsWith("Cuerpo · ") ||
      c.nombre.startsWith("Llavero · ") ||
      c.nombre.startsWith("Photocard · ");
    if (esAuto && !nombresValidos.has(c.nombre)) {
      await db.from("components").delete().eq("id", c.id);
    }
  }

  if (vcRows.length) {
    await db
      .from("variant_components")
      .upsert(vcRows, { onConflict: "variant_id,component_id" });
  }

  const nombres = [...compNuevos.keys()];
  const cuerpos = nombres.filter((n) => n.startsWith("Cuerpo · ")).length;
  const llaveros = nombres.filter((n) => n.startsWith("Llavero · ")).length;
  const photocards = nombres.filter((n) => n.startsWith("Photocard · ")).length;
  return {
    cuerpos,
    llaveros,
    photocards,
    packs: (prodsSimples ?? []).length,
    vinculos: vcRows.length,
  };
}

// ---------- buffer de Mercado Libre (automático) ----------
// Cantidad que se publica en ML. El listing nunca cae a 0 (ML no lo pausa) pero
// el margen es chico para no vender lo que no se puede reponer rápido.
// TUNEABLE — Elias puede pedir otra regla.
export function calcBuffer(vendible: number): number {
  return vendible <= 0 ? 2 : vendible + 3;
}

// ---------- planificador (mira las ventas de los últimos días) ----------
const DIAS_VENTAS = 14;
const DIAS_COBERTURA = 21; // querer 3 semanas de stock por delante

export interface TareaPlan {
  nombre: string;
  contexto: string | null;
  origen: string;
  cantidad: number; // unidades sugeridas (redondeadas a placa si hay datos)
  ya_tengo?: number;
  necesito?: number;
  cobertura_dias: number; // días de stock que quedan al ritmo de venta actual
  minutos: number; // tiempo estimado de producción (0 si no está cargado)
  placas?: number | null; // fracción de placa (0.25 / 0.5 / 1 / 2…) si aplica
  placas_label?: string; // "½ placa", "1 placa", "2 placas", "×7"
  tipo: "insumo" | "directo";
}

// Redondea las unidades a producir a un múltiplo de ¼ de placa (mínimo ¼), que
// es como Elias manda a imprimir. Sin datos de placa devuelve las unidades tal
// cual. Elias eligió "siempre redondear a placa / media / cuarto".
export function redondearPlaca(
  neto: number,
  rinde: number | null,
  minutosPlaca: number | null,
  minutosUnidad: number,
): {
  cantidad: number;
  minutos: number;
  placas: number | null;
  label: string;
} {
  if (!rinde || rinde <= 0 || !minutosPlaca) {
    return {
      cantidad: neto,
      minutos: Math.round(minutosUnidad * neto),
      placas: null,
      label: `×${neto}`,
    };
  }
  const cuartos = Math.max(1, Math.ceil((neto / rinde) * 4));
  const placas = cuartos / 4;
  const enteras = Math.floor(cuartos / 4);
  const fr = ["", "¼", "½", "¾"][cuartos % 4];
  const label =
    enteras === 0
      ? `${fr} placa`
      : cuartos % 4 === 0
        ? `${enteras} placa${enteras > 1 ? "s" : ""}`
        : `${enteras}${fr} placas`;
  return {
    cantidad: Math.round(placas * rinde),
    minutos: Math.round(placas * minutosPlaca),
    placas,
    label,
  };
}

// nombre de componente "Photocard · j-hope · BTS" → { nombre:"Photocard j-hope", contexto:"BTS" }
function partirNombreComp(raw: string): { nombre: string; contexto: string | null } {
  const p = raw.split(" · ").map((s) => s.trim());
  if (p[0] === "Photocard")
    return { nombre: `Photocard ${p[1] ?? ""}`.trim(), contexto: p[2] ?? null };
  if (p[0] === "Cuerpo" || p[0] === "Llavero")
    return { nombre: p[0], contexto: p.slice(1).join(" · ") || null };
  return { nombre: raw, contexto: null };
}

export interface VentanaVentas {
  porProducto: Map<string, number>;
  porVariante: Map<string, number>;
}

/**
 * Unidades pagas por producto y por variante en varias ventanas de días a la vez
 * (una sola pasada por las tablas). `ventanas` en días; devuelve un mapa
 * días -> conteos.
 */
export async function ventasMulti(
  db: DB,
  ventanas: number[],
): Promise<Map<number, VentanaVentas>> {
  const maxDias = Math.max(...ventanas);
  const desde = new Date(Date.now() - maxDias * 864e5).toISOString();
  const [{ data: orders }, { data: items }, { data: listings }, { data: lvars }] =
    await Promise.all([
      db
        .from("ml_orders")
        .select("id, fecha")
        .in("estado", ["paid", "shipped", "delivered"])
        .gte("fecha", desde),
      db
        .from("ml_order_items")
        .select("ml_order_id, ml_item_id, ml_variation_id, cantidad"),
      db.from("ml_listings").select("id, ml_item_id, product_id"),
      db
        .from("ml_listing_variations")
        .select("ml_listing_id, ml_variation_id, product_variant_id"),
    ]);

  const ahora = Date.now();
  const antiguedadDias = new Map(
    (orders ?? []).map((o) => [
      o.id,
      (ahora - new Date(o.fecha).getTime()) / 864e5,
    ]),
  );
  const listingByItem = new Map((listings ?? []).map((l) => [l.ml_item_id, l]));
  const varKey = new Map<string, string>();
  for (const v of lvars ?? [])
    if (v.product_variant_id)
      varKey.set(`${v.ml_listing_id}|${v.ml_variation_id}`, v.product_variant_id);

  const out = new Map<number, VentanaVentas>(
    ventanas.map((d) => [
      d,
      { porProducto: new Map(), porVariante: new Map() },
    ]),
  );

  for (const it of items ?? []) {
    const edad = antiguedadDias.get(it.ml_order_id);
    if (edad == null || !it.ml_item_id) continue;
    const l = listingByItem.get(it.ml_item_id);
    if (!l) continue;
    const qty = it.cantidad ?? 1;
    const pv = it.ml_variation_id
      ? varKey.get(`${l.id}|${it.ml_variation_id}`)
      : undefined;
    for (const d of ventanas) {
      if (edad > d) continue;
      const w = out.get(d)!;
      if (l.product_id)
        w.porProducto.set(l.product_id, (w.porProducto.get(l.product_id) ?? 0) + qty);
      if (pv) w.porVariante.set(pv, (w.porVariante.get(pv) ?? 0) + qty);
    }
  }
  return out;
}

/** Unidades pagas de los últimos DIAS_VENTAS días, por producto y por variante. */
export async function ventasRecientes(db: DB): Promise<VentanaVentas> {
  return (await ventasMulti(db, [DIAS_VENTAS])).get(DIAS_VENTAS)!;
}

// ---------- mínimo de stock automático (punto de reposición) ----------
// El mínimo por variante ya no se carga a mano: se calcula con las ventas. Cubre
// LEAD_DIAS de venta al ritmo reciente (se toma el mayor entre el ritmo de los
// últimos 7 y los últimos 30 días, para reaccionar rápido a un pico) y suma un
// piso si el PRODUCTO vende aunque esa variante puntual no haya rotado.
// TUNEABLE — Elias puede pedir otra regla.
export const LEAD_DIAS = 14;

export function calcMinimo(
  unidades7Variante: number,
  unidades30Variante: number,
  unidades30Producto: number,
): number {
  const diaria = Math.max(unidades7Variante / 7, unidades30Variante / 30);
  const piso = unidades30Producto >= 12 ? 2 : unidades30Producto >= 3 ? 1 : 0;
  return Math.max(Math.ceil(diaria * LEAD_DIAS), piso);
}

export interface PlanResultado {
  imprimir_3d: TareaPlan[];
  imprenta: TareaPlan[];
  otros: TareaPlan[];
  variantes_criticas: number;
  sin_bom: boolean;
  minutos: { impresora3d: number; imprenta: number; otros: number };
  producir_componente: Record<string, number>;
  producir_variante: Record<string, number>;
}

export async function planificar(db: DB): Promise<PlanResultado> {
  const { data: variants } = await db
    .from("product_variants")
    .select(
      "id, etiqueta, stock_real, stock_minimo, product_id, group_member_id, es_eleccion",
    )
    .eq("activo", true);

  const { data: prods } = await db
    .from("products")
    .select("id, nombre, categories(origen)");
  const prodInfo = new Map(
    (prods ?? []).map((p) => [
      p.id,
      {
        nombre: p.nombre,
        origen:
          (p.categories as { origen?: string } | null)?.origen ?? "impresora3d",
      },
    ]),
  );

  const { data: vc } = await db
    .from("variant_components")
    .select("variant_id, component_id, cantidad");
  const bomPorVariante = new Map<string, typeof vc>();
  for (const r of vc ?? []) {
    if (!bomPorVariante.has(r.variant_id)) bomPorVariante.set(r.variant_id, []);
    bomPorVariante.get(r.variant_id)!.push(r);
  }

  const { data: comps } = await db
    .from("components")
    .select(
      "id, nombre, origen, stock_real, minutos_produccion, rinde_por_placa, minutos_placa",
    );
  const compInfo = new Map(
    (comps ?? []).map((c) => [
      c.id,
      {
        nombre: c.nombre,
        origen: c.origen,
        stock: c.stock_real,
        minutos: c.minutos_produccion ?? 0,
        rinde: c.rinde_por_placa,
        minutosPlaca: c.minutos_placa,
      },
    ]),
  );

  const { porProducto, porVariante } = await ventasRecientes(db);

  const necesidad = new Map<string, number>(); // componentId -> unidades brutas
  const diariaComp = new Map<string, number>(); // componentId -> venta diaria agregada
  const directos: TareaPlan[] = [];
  const producir_variante: Record<string, number> = {};
  let criticas = 0;

  for (const v of variants ?? []) {
    // "Random / a elección": se cumple con cualquier variante real → no tiene
    // producción propia.
    if (v.es_eleccion) continue;
    const ventasVar = porVariante.get(v.id) ?? 0;
    const ventasProd = porProducto.get(v.product_id) ?? 0;
    const diaria = ventasVar / DIAS_VENTAS;
    // si el producto se vende bien, mantener un mínimo de cada integrante aunque
    // esa variante puntual no haya vendido
    const baseline = ventasProd >= 4 ? 2 : ventasProd >= 1 ? 1 : 0;
    const objetivo = Math.max(
      v.stock_minimo,
      Math.ceil(diaria * DIAS_COBERTURA),
      baseline,
    );
    if (objetivo <= 0 || v.stock_real >= objetivo) continue;
    criticas++;
    const faltan = objetivo - v.stock_real;
    const bom = bomPorVariante.get(v.id) ?? [];
    if (bom.length) {
      for (const b of bom) {
        necesidad.set(
          b.component_id,
          (necesidad.get(b.component_id) ?? 0) + faltan * b.cantidad,
        );
        diariaComp.set(
          b.component_id,
          (diariaComp.get(b.component_id) ?? 0) + diaria,
        );
      }
    } else {
      producir_variante[v.id] = faltan;
      const pi = prodInfo.get(v.product_id);
      directos.push({
        nombre: pi?.nombre ?? "—",
        contexto: null,
        origen: pi?.origen ?? "impresora3d",
        cantidad: faltan,
        ya_tengo: v.stock_real,
        cobertura_dias: diaria > 0 ? v.stock_real / diaria : 999,
        minutos: 0,
        tipo: "directo",
      });
    }
  }

  // consolidar las tareas directas por producto (ej. 8 colores de un clicker → 1)
  const directosMap = new Map<string, TareaPlan>();
  for (const t of directos) {
    const cur = directosMap.get(t.nombre);
    if (cur) {
      cur.cantidad += t.cantidad;
      cur.ya_tengo = (cur.ya_tengo ?? 0) + (t.ya_tengo ?? 0);
      cur.cobertura_dias = Math.min(cur.cobertura_dias, t.cobertura_dias);
    } else {
      directosMap.set(t.nombre, { ...t });
    }
  }
  const directosCons = [...directosMap.values()].map((t) => {
    const placa = PLACA_PRODUCTO[t.nombre];
    if (!placa) return t;
    const r = redondearPlaca(t.cantidad, placa.rinde, placa.minutos, 0);
    return {
      ...t,
      cantidad: r.cantidad,
      minutos: r.minutos,
      placas: r.placas,
      placas_label: r.label,
    };
  });

  const insumos: TareaPlan[] = [];
  const producir_componente: Record<string, number> = {};
  for (const [compId, nec] of necesidad) {
    const info = compInfo.get(compId);
    if (!info) continue;
    const neto = Math.max(nec - info.stock, 0);
    producir_componente[compId] = neto;
    if (neto <= 0) continue;
    const diaria = diariaComp.get(compId) ?? 0;
    const { nombre, contexto } = partirNombreComp(info.nombre);
    const r = redondearPlaca(
      neto,
      info.rinde,
      info.minutosPlaca,
      info.minutos,
    );
    insumos.push({
      nombre,
      contexto,
      origen: info.origen,
      cantidad: r.cantidad,
      ya_tengo: info.stock,
      necesito: nec,
      cobertura_dias: diaria > 0 ? info.stock / diaria : 999,
      minutos: r.minutos,
      placas: r.placas,
      placas_label: r.label,
      tipo: "insumo",
    });
  }

  const todo = [...insumos, ...directosCons].sort(
    (a, b) => a.cobertura_dias - b.cobertura_dias,
  );
  const por = (o: string) => todo.filter((t) => t.origen === o);
  const sumMin = (arr: TareaPlan[]) =>
    Math.round(arr.reduce((s, t) => s + t.minutos, 0));

  const i3d = por("impresora3d");
  const impr = por("imprenta");
  const otr = todo.filter(
    (t) => t.origen !== "impresora3d" && t.origen !== "imprenta",
  );

  return {
    imprimir_3d: i3d,
    imprenta: impr,
    otros: otr,
    variantes_criticas: criticas,
    sin_bom: (vc ?? []).length === 0,
    minutos: {
      impresora3d: sumMin(i3d),
      imprenta: sumMin(impr),
      otros: sumMin(otr),
    },
    producir_componente,
    producir_variante,
  };
}
