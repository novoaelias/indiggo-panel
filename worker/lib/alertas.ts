// Regenera las alertas automáticas del panel (pantalla Inicio).
// Las alertas manuales (tipo sin prefijo "auto:") no se tocan.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { planificar } from "./bom";
import { inicioDiaAR } from "./fecha";

type DB = SupabaseClient<Database>;
type AlertaIns = Database["public"]["Tables"]["alerts"]["Insert"];

export async function regenerarAlertas(db: DB): Promise<number> {
  await db
    .from("alerts")
    .delete()
    .is("resuelta_at", null)
    .like("tipo", "auto:%");

  const filas: AlertaIns[] = [];

  // --- stock crítico (a nivel PRODUCTO, no variante) ---
  // Un producto simple está "sin stock" sólo si TODAS sus variantes reales están
  // en 0. Los holders (stock derivado de piezas) y los packs con receta (se
  // arman por pedido) no cuentan acá — su faltante sale por el plan de producción.
  const [{ data: vars }, { data: vcRows }] = await Promise.all([
    db
      .from("product_variants")
      .select(
        "id, product_id, stock_real, es_eleccion, products(nombre, descontinuado)",
      )
      .eq("activo", true),
    db.from("variant_components").select("variant_id"),
  ]);
  const conBom = new Set((vcRows ?? []).map((r) => r.variant_id));
  const porProducto = new Map<
    string,
    { nombre: string; total: number; conReceta: boolean }
  >();
  for (const v of vars ?? []) {
    if (v.es_eleccion) continue;
    // productos que Elias marcó como descontinuados: no van a "sin stock" (no
    // los repone a propósito; ML no deja borrar la publicación).
    if ((v.products as { descontinuado?: boolean } | null)?.descontinuado)
      continue;
    const cur = porProducto.get(v.product_id) ?? {
      nombre: (v.products as { nombre?: string } | null)?.nombre ?? "?",
      total: 0,
      conReceta: false,
    };
    cur.total += Math.max(0, v.stock_real);
    if (conBom.has(v.id)) cur.conReceta = true;
    porProducto.set(v.product_id, cur);
  }
  const sinStock = [...porProducto.values()].filter(
    (p) => !p.conReceta && p.total <= 0,
  );
  if (sinStock.length) {
    filas.push({
      tipo: "auto:stock_critico",
      severidad: "danger",
      titulo: `${sinStock.length} producto(s) sin stock`,
      detalle: sinStock.slice(0, 4).map((p) => p.nombre).join(" · "),
    });
  }

  // --- publicaciones no activas ---
  // (las de un producto descontinuado no cuentan: Elias ya sabe que están
  // pausadas a propósito y no quiere que se lo sigan recordando)
  const { data: listings } = await db
    .from("ml_listings")
    .select("titulo, estado, products(descontinuado)")
    .neq("estado", "active");
  const vigentes = (listings ?? []).filter(
    (l) => !(l.products as { descontinuado?: boolean } | null)?.descontinuado,
  );
  const enRevision = vigentes.filter((l) => l.estado === "under_review");
  const pausadas = vigentes.filter((l) => l.estado !== "under_review");
  if (enRevision.length)
    filas.push({
      tipo: "auto:en_revision",
      severidad: "warn",
      titulo: `${enRevision.length} publicación(es) en revisión de ML`,
      detalle: enRevision.slice(0, 3).map((l) => l.titulo).join(" · "),
    });
  if (pausadas.length)
    filas.push({
      tipo: "auto:pausadas",
      severidad: "danger",
      titulo: `${pausadas.length} publicación(es) pausadas o cerradas`,
      detalle: pausadas.slice(0, 3).map((l) => l.titulo).join(" · "),
    });

  // --- ventas que salieron sin stock cargado ---
  // El despacho nunca falla (si ML dice que salió, salió), pero cuando no había
  // terminados ni piezas cargados lo anota en `meta.sin_stock`. El número de ese
  // producto ya no es confiable hasta que Elias lo recuente: la alerta se va
  // sola con el primer ajuste manual posterior al despacho.
  const desde = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
  const [{ data: sinCargar }, { data: ajustes }] = await Promise.all([
    db
      .from("inventory_operations")
      .select("created_at, meta")
      .eq("tipo", "despacho")
      .not("meta->sin_stock", "is", null)
      .gte("created_at", desde),
    db
      .from("inventory_operations")
      .select("created_at, inventory_movement_lines(product_variant_id)")
      .eq("tipo", "ajuste")
      .gte("created_at", desde),
  ]);
  const ultimoAjuste = new Map<string, string>();
  for (const a of ajustes ?? [])
    for (const l of a.inventory_movement_lines ?? [])
      if (l.product_variant_id && a.created_at > (ultimoAjuste.get(l.product_variant_id) ?? ""))
        ultimoAjuste.set(l.product_variant_id, a.created_at);
  const aRecontar = new Map<string, number>();
  for (const op of sinCargar ?? []) {
    const lineas = (op.meta as { sin_stock?: Array<{ product_variant_id: string; cantidad: number }> } | null)
      ?.sin_stock ?? [];
    for (const l of lineas)
      if ((ultimoAjuste.get(l.product_variant_id) ?? "") < op.created_at)
        aRecontar.set(l.product_variant_id, (aRecontar.get(l.product_variant_id) ?? 0) + l.cantidad);
  }
  if (aRecontar.size) {
    const { data: nombres } = await db
      .from("product_variants")
      .select("id, etiqueta, products(nombre, nombre_interno)")
      .in("id", [...aRecontar.keys()]);
    filas.push({
      tipo: "auto:salio_sin_stock",
      severidad: "warn",
      titulo: `${aRecontar.size} producto(s) salieron sin stock cargado: recontalos`,
      detalle: (nombres ?? [])
        .slice(0, 4)
        .map((v) => {
          const p = v.products as { nombre?: string; nombre_interno?: string | null } | null;
          const nombre = p?.nombre_interno || p?.nombre || "?";
          const etiqueta = v.etiqueta && v.etiqueta !== "Único" ? ` (${v.etiqueta})` : "";
          return `${nombre}${etiqueta}: ${aRecontar.get(v.id)} u.`;
        })
        .join(" · "),
    });
  }

  // --- producción pendiente ---
  try {
    const plan = await planificar(db);
    const t3d = plan.imprimir_3d.length;
    const timp = plan.imprenta.length;
    if (t3d || timp) {
      filas.push({
        tipo: "auto:produccion",
        severidad: "info",
        titulo: "Producción pendiente",
        detalle:
          [
            t3d ? `${t3d} para imprimir en 3D` : "",
            timp ? `${timp} para pedir a imprenta` : "",
          ]
            .filter(Boolean)
            .join(" · ") || "Ver plan en Stock",
      });
    }
  } catch {
    /* si el BOM aún no está, no pasa nada */
  }

  // --- ventas del día (positiva) ---
  const { data: pedidosHoy } = await db
    .from("ml_orders")
    .select("total")
    .eq("estado", "paid")
    .gte("fecha", inicioDiaAR());
  if (pedidosHoy && pedidosHoy.length >= 3) {
    filas.push({
      tipo: "auto:ventas_dia",
      severidad: "ok",
      titulo: `${pedidosHoy.length} ventas hoy`,
      detalle: "Buen ritmo. Revisá que haya stock para reponer.",
    });
  }

  if (!filas.length)
    filas.push({
      tipo: "auto:ok",
      severidad: "ok",
      titulo: "Todo en orden",
      detalle: "Sin stock crítico ni publicaciones pausadas.",
    });

  await db.from("alerts").insert(filas);
  return filas.length;
}
