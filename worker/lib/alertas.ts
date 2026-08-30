// Regenera las alertas automáticas del panel (pantalla Inicio).
// Las alertas manuales (tipo sin prefijo "auto:") no se tocan.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { planificar } from "./bom";

type DB = SupabaseClient<Database>;
type AlertaIns = Database["public"]["Tables"]["alerts"]["Insert"];

export async function regenerarAlertas(db: DB): Promise<number> {
  await db
    .from("alerts")
    .delete()
    .is("resuelta_at", null)
    .like("tipo", "auto:%");

  const filas: AlertaIns[] = [];

  // --- stock crítico (variantes activas sin stock real) ---
  const { data: vars } = await db
    .from("product_variants")
    .select("stock_real, stock_minimo, etiqueta, products(nombre)")
    .eq("activo", true);
  const sinStock = (vars ?? []).filter((v) => v.stock_real <= 0);
  const bajos = (vars ?? []).filter(
    (v) => v.stock_real > 0 && v.stock_real < v.stock_minimo,
  );
  if (sinStock.length) {
    filas.push({
      tipo: "auto:stock_critico",
      severidad: "danger",
      titulo: `${sinStock.length} variante(s) sin stock`,
      detalle: sinStock
        .slice(0, 4)
        .map(
          (v) =>
            `${(v.products as { nombre?: string } | null)?.nombre ?? "?"} (${v.etiqueta})`,
        )
        .join(" · "),
    });
  }
  if (bajos.length) {
    filas.push({
      tipo: "auto:stock_bajo",
      severidad: "warn",
      titulo: `${bajos.length} variante(s) por debajo del mínimo`,
      detalle: "Revisá Stock y el plan de producción.",
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
  const hoy = new Date().toISOString().slice(0, 10);
  const { data: pedidosHoy } = await db
    .from("ml_orders")
    .select("total")
    .eq("estado", "paid")
    .gte("fecha", hoy);
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
