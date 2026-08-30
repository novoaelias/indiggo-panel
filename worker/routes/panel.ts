import { Hono } from "hono";
import type { Database } from "@/lib/database.types";
import type { Env } from "../env";
import { supa } from "../lib/supabase";
import { mlFetch } from "../lib/ml";
import { syncOneItem } from "../lib/sync";
import { planificar } from "../lib/bom";

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

// --- Stock y producción ---
interface VarRow {
  id: string;
  product_id: string;
  etiqueta: string;
  stock_real: number;
  stock_ml: number;
  stock_minimo: number;
  activo: boolean;
  products: {
    nombre: string;
    categories: { nombre: string; origen: string } | null;
    groups: { nombre: string } | null;
  } | null;
  group_members: { nombre: string } | null;
}

function evaluarStock(real: number, minimo: number) {
  if (real <= 0) return { tono: "danger", label: "Sin stock" };
  if (real <= Math.ceil(minimo * 0.4)) return { tono: "danger", label: "Crítico" };
  if (real < minimo) return { tono: "warn", label: "Bajo" };
  return { tono: "ok", label: "OK" };
}

panel.get("/stock", async (c) => {
  const db = supa(c.env);
  const { data, error } = await db
    .from("product_variants")
    .select(
      "id, product_id, etiqueta, stock_real, stock_ml, stock_minimo, activo, products(nombre, categories(nombre, origen), groups(nombre)), group_members(nombre)",
    )
    .eq("activo", true);
  if (error) return c.json({ error: error.message }, 500);

  // valor de stock realmente publicado hoy en ML
  const [{ data: mlvs }, { data: mls }] = await Promise.all([
    db.from("ml_listing_variations").select("product_variant_id, cantidad_ml"),
    db.from("ml_listings").select("product_id, cantidad_ml, tiene_variantes"),
  ]);
  const mlPorVariante = new Map(
    (mlvs ?? [])
      .filter((v) => v.product_variant_id)
      .map((v) => [v.product_variant_id as string, v.cantidad_ml]),
  );
  const mlPorProducto = new Map(
    (mls ?? [])
      .filter((m) => m.product_id && !m.tiene_variantes)
      .map((m) => [m.product_id as string, m.cantidad_ml]),
  );

  const rows = (data ?? []) as unknown as VarRow[];
  const items = rows.map((r) => {
    const prodNombre = r.products?.nombre ?? "—";
    const esUnico = r.etiqueta === "Único";
    const nombre = esUnico
      ? prodNombre
      : `${prodNombre} — ${r.group_members?.nombre ?? r.etiqueta}`;
    const ev = evaluarStock(r.stock_real, r.stock_minimo);
    const publicadoMl =
      mlPorVariante.get(r.id) ?? mlPorProducto.get(r.product_id) ?? null;
    return {
      id: r.id,
      nombre,
      categoria: r.products?.categories?.nombre ?? "Sin categoría",
      origen: r.products?.categories?.origen ?? "impresora3d",
      grupo: r.products?.groups?.nombre ?? null,
      stock_real: r.stock_real,
      stock_ml: r.stock_ml,
      publicado_ml: publicadoMl,
      stock_minimo: r.stock_minimo,
      estado_tono: ev.tono,
      estado_label: ev.label,
    };
  });
  items.sort((a, b) => a.stock_real - a.stock_minimo - (b.stock_real - b.stock_minimo));

  const cola = items
    .filter((i) => i.stock_real < i.stock_minimo)
    .map((i) => ({
      id: i.id,
      nombre: i.nombre,
      origen: i.origen,
      cantidad: Math.max(i.stock_minimo * 2 - i.stock_real, i.stock_minimo),
    }));

  return c.json({
    items,
    cola,
    bajo_minimo: items.filter((i) => i.stock_real < i.stock_minimo).length,
    sin_catalogo: items.length === 0,
  });
});

// Editar stock de una variante (Elias carga el stock físico acá).
panel.patch("/stock/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    stock_real?: number;
    stock_minimo?: number;
    stock_ml?: number;
  }>();
  const patch: Record<string, number> = {};
  for (const k of ["stock_real", "stock_minimo", "stock_ml"] as const) {
    const v = body[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0)
      patch[k] = Math.round(v);
  }
  if (!Object.keys(patch).length)
    return c.json({ error: "nada para actualizar" }, 400);

  const db = supa(c.env);
  const { error } = await db
    .from("product_variants")
    .update(patch as Database["public"]["Tables"]["product_variants"]["Update"])
    .eq("id", id);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

// Resuelve una variante interna a su item/variación de ML.
async function resolverML(
  db: ReturnType<typeof supa>,
  variantId: string,
): Promise<{ itemId: string; variationId: string | null } | null> {
  const { data: pv } = await db
    .from("product_variants")
    .select("product_id")
    .eq("id", variantId)
    .single();
  if (!pv) return null;

  const { data: mlv } = await db
    .from("ml_listing_variations")
    .select("ml_variation_id, ml_listing_id")
    .eq("product_variant_id", variantId)
    .maybeSingle();

  if (mlv) {
    const { data: ml } = await db
      .from("ml_listings")
      .select("ml_item_id")
      .eq("id", mlv.ml_listing_id)
      .single();
    return ml
      ? { itemId: ml.ml_item_id, variationId: mlv.ml_variation_id }
      : null;
  }

  const { data: ml } = await db
    .from("ml_listings")
    .select("ml_item_id")
    .eq("product_id", pv.product_id)
    .limit(1)
    .maybeSingle();
  return ml ? { itemId: ml.ml_item_id, variationId: null } : null;
}

// Publica el stock ML (buffer) de una variante en Mercado Libre.
panel.post("/stock/:id/publicar", async (c) => {
  const id = c.req.param("id");
  const db = supa(c.env);

  const { data: pv } = await db
    .from("product_variants")
    .select("stock_ml")
    .eq("id", id)
    .single();
  if (!pv) return c.json({ error: "variante no encontrada" }, 404);

  const ref = await resolverML(db, id);
  if (!ref)
    return c.json({ error: "no se pudo mapear a una publicación de ML" }, 409);

  const path = ref.variationId
    ? `/items/${ref.itemId}/variations/${ref.variationId}`
    : `/items/${ref.itemId}`;
  const r = await mlFetch(c.env, db, path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ available_quantity: pv.stock_ml }),
  });
  if (!r.ok)
    return c.json({ error: (await r.text()).slice(0, 250) }, 502);

  try {
    await syncOneItem(c.env, db, ref.itemId);
  } catch {
    /* el push ya se hizo */
  }
  return c.json({ ok: true, publicado: pv.stock_ml });
});

// --- Planificador de producción (explota el BOM) ---
panel.get("/produccion", async (c) => {
  const db = supa(c.env);
  return c.json(await planificar(db));
});

// --- Insumos (componentes: cuerpos 3D, photocards) ---
panel.get("/componentes", async (c) => {
  const db = supa(c.env);
  const { data, error } = await db
    .from("components")
    .select("id, nombre, origen, stock_real, stock_minimo")
    .order("origen")
    .order("nombre");
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ componentes: data });
});

panel.patch("/componentes/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ stock_real?: number; stock_minimo?: number }>();
  const patch: Record<string, number> = {};
  for (const k of ["stock_real", "stock_minimo"] as const) {
    const v = body[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0)
      patch[k] = Math.round(v);
  }
  if (!Object.keys(patch).length)
    return c.json({ error: "nada para actualizar" }, 400);
  const db = supa(c.env);
  const { error } = await db
    .from("components")
    .update(patch as Database["public"]["Tables"]["components"]["Update"])
    .eq("id", id);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
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
