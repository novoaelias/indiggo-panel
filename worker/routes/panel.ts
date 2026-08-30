import { Hono } from "hono";
import type { Env } from "../env";
import { supa } from "../lib/supabase";

export const panel = new Hono<{ Bindings: Env }>();

// --- Publicaciones (espejo de ML) ---
panel.get("/publicaciones", async (c) => {
  const db = supa(c.env);
  const estado = c.req.query("estado");
  const q = c.req.query("q");

  let query = db
    .from("ml_listings")
    .select(
      "id, ml_item_id, titulo, estado, precio, moneda, cantidad_ml, tiene_variantes, permalink, thumbnail",
    )
    .order("titulo");
  if (estado && estado !== "todas") query = query.eq("estado", estado);
  if (q) query = query.ilike("titulo", `%${q}%`);

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);

  const { data: vars } = await db
    .from("ml_listing_variations")
    .select("ml_listing_id, cantidad_ml");
  const porListing = new Map<string, { n: number; stock: number }>();
  for (const v of vars ?? []) {
    const cur = porListing.get(v.ml_listing_id) ?? { n: 0, stock: 0 };
    cur.n += 1;
    cur.stock += v.cantidad_ml ?? 0;
    porListing.set(v.ml_listing_id, cur);
  }

  const publicaciones = (data ?? []).map((l) => {
    const agg = porListing.get(l.id) ?? { n: 0, stock: 0 };
    return {
      id: l.id,
      ml_item_id: l.ml_item_id,
      titulo: l.titulo,
      estado: l.estado,
      precio: l.precio,
      moneda: l.moneda,
      permalink: l.permalink,
      thumbnail: l.thumbnail?.replace(/^http:/, "https:") ?? null,
      variantes: agg.n,
      stock_ml: l.tiene_variantes ? agg.stock : (l.cantidad_ml ?? 0),
    };
  });

  const { data: todos } = await db.from("ml_listings").select("estado");
  const conteo: Record<string, number> = { todas: todos?.length ?? 0 };
  for (const r of todos ?? []) conteo[r.estado] = (conteo[r.estado] ?? 0) + 1;

  return c.json({ publicaciones, conteo });
});

// --- Métricas ---
interface MetricasResumen {
  dias: number;
  ventas_totales: number;
  pedidos: number;
  ticket_promedio: number;
  por_dia: Array<{ dia: string; monto: number; pedidos: number }>;
  top: Array<{ nombre: string; unidades: number; ingreso: number }>;
}

panel.get("/metricas", async (c) => {
  const dias = Math.min(Math.max(Number(c.req.query("dias") ?? 7), 1), 90);
  const db = supa(c.env);
  const { data, error } = await db.rpc("panel_metricas", { p_dias: dias });
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data as unknown as MetricasResumen);
});

// --- Inicio (resumen del día + alertas) ---
panel.get("/inicio", async (c) => {
  const db = supa(c.env);
  const hoy = new Date().toISOString().slice(0, 10);
  const hace7 = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);

  const [ventasHoy, ventasSemana, listings, ultimosPedidos, revisiones] =
    await Promise.all([
      db
        .from("ml_orders")
        .select("total")
        .eq("estado", "paid")
        .gte("fecha", hoy),
      db
        .from("ml_orders")
        .select("total")
        .eq("estado", "paid")
        .gte("fecha", hace7),
      db.from("ml_listings").select("estado"),
      db
        .from("ml_orders")
        .select("id, fecha, total, comprador, estado")
        .order("fecha", { ascending: false })
        .limit(5),
      db
        .from("ml_listings")
        .select("titulo, estado")
        .neq("estado", "active")
        .limit(20),
    ]);

  const sum = (rows: { total: number | null }[] | null) =>
    (rows ?? []).reduce((s, r) => s + (r.total ?? 0), 0);

  const activas =
    listings.data?.filter((l) => l.estado === "active").length ?? 0;
  const pausadas = (listings.data?.length ?? 0) - activas;

  const alertas: Array<{
    tono: "ok" | "warn" | "danger" | "info";
    titulo: string;
    texto: string;
  }> = [];

  const enRevision =
    revisiones.data?.filter((l) => l.estado === "under_review") ?? [];
  const otrasPausadas =
    revisiones.data?.filter((l) => l.estado !== "under_review") ?? [];

  if (enRevision.length)
    alertas.push({
      tono: "warn",
      titulo: `${enRevision.length} publicación(es) en revisión`,
      texto: enRevision
        .slice(0, 3)
        .map((l) => l.titulo)
        .join(" · "),
    });
  if (otrasPausadas.length)
    alertas.push({
      tono: "danger",
      titulo: `${otrasPausadas.length} publicación(es) pausadas o cerradas`,
      texto: otrasPausadas
        .slice(0, 3)
        .map((l) => l.titulo)
        .join(" · "),
    });
  if (!alertas.length)
    alertas.push({
      tono: "ok",
      titulo: "Todo en orden",
      texto: "No hay publicaciones pausadas ni en revisión.",
    });

  return c.json({
    ventas_hoy: sum(ventasHoy.data),
    pedidos_hoy: ventasHoy.data?.length ?? 0,
    ventas_semana: sum(ventasSemana.data),
    publicaciones_activas: activas,
    publicaciones_pausadas: pausadas,
    ultimos_pedidos: ultimosPedidos.data ?? [],
    alertas,
  });
});
