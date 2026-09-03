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
      .select("id, product_id, stock_real, es_eleccion, products(nombre)")
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
  const { data: listings } = await db
    .from("ml_listings")
    .select("titulo, estado")
    .neq("estado", "active");
  const enRevision = (listings ?? []).filter(
    (l) => l.estado === "under_review",
  );
  const pausadas = (listings ?? []).filter((l) => l.estado !== "under_review");
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
