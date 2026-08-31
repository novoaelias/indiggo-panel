import { Hono } from "hono";
import type { Database } from "@/lib/database.types";
import type { Env } from "../env";
import { supa } from "../lib/supabase";
import { mlFetch } from "../lib/ml";
import { syncOneItem } from "../lib/sync";
import { planificar } from "../lib/bom";
import { regenerarAlertas } from "../lib/alertas";

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

// Actualiza precios en lote. body: { cambios: [{ id, precio }] } (id = ml_listings.id)
panel.post("/publicaciones/precios", async (c) => {
  const body = await c.req.json<{
    cambios?: Array<{ id: string; precio: number }>;
  }>();
  const cambios = (body.cambios ?? []).filter(
    (x) => x.id && Number.isFinite(x.precio) && x.precio > 0,
  );
  if (!cambios.length) return c.json({ error: "sin cambios" }, 400);

  const db = supa(c.env);
  const { data: listings } = await db
    .from("ml_listings")
    .select("id, ml_item_id")
    .in(
      "id",
      cambios.map((x) => x.id),
    );
  const itemPorId = new Map((listings ?? []).map((l) => [l.id, l.ml_item_id]));

  let ok = 0;
  const errores: string[] = [];
  const tocados = new Set<string>();
  for (const cambio of cambios.slice(0, 200)) {
    const itemId = itemPorId.get(cambio.id);
    if (!itemId) {
      errores.push(`${cambio.id}: no encontrado`);
      continue;
    }
    const r = await mlFetch(c.env, db, `/items/${itemId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ price: Math.round(cambio.precio) }),
    });
    if (r.ok) {
      ok++;
      tocados.add(itemId);
    } else {
      errores.push(`${itemId}: ${(await r.text()).slice(0, 120)}`);
    }
  }
  for (const it of tocados) {
    try {
      await syncOneItem(c.env, db, it);
    } catch {
      /* ignore */
    }
  }
  return c.json({ actualizados: ok, errores });
});

// --- Métricas ---
interface MetricasResumen {
  dias: number;
  ventas_totales: number;
  pedidos: number;
  ticket_promedio: number;
  ventas_prev: number;
  pedidos_prev: number;
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
function evaluarStock(real: number, minimo: number) {
  if (real <= 0) return { tono: "danger" as const, label: "Sin stock" };
  if (minimo > 0 && real <= Math.ceil(minimo * 0.4))
    return { tono: "danger" as const, label: "Crítico" };
  if (real < minimo) return { tono: "warn" as const, label: "Bajo" };
  return { tono: "ok" as const, label: "OK" };
}

const PEOR = (t: string[]): "danger" | "warn" | "ok" =>
  t.includes("danger") ? "danger" : t.includes("warn") ? "warn" : "ok";

// El "vendible" de un holder + integrante (product_variants.stock_real) se deriva
// de las piezas reales que carga Elias: mín sobre cada componente del BOM de
// floor(stock_componente / cantidad). Nunca se edita a mano.
async function recalcularDerivado(db: ReturnType<typeof supa>) {
  const { data: vc } = await db
    .from("variant_components")
    .select("variant_id, component_id, cantidad");
  if (!vc?.length) return;
  const { data: comps } = await db.from("components").select("id, stock_real");
  const stockComp = new Map((comps ?? []).map((x) => [x.id, x.stock_real]));
  const porVar = new Map<
    string,
    Array<{ component_id: string; cantidad: number }>
  >();
  for (const r of vc) {
    if (!porVar.has(r.variant_id)) porVar.set(r.variant_id, []);
    porVar.get(r.variant_id)!.push(r);
  }
  const { data: vars } = await db
    .from("product_variants")
    .select("id, stock_real")
    .in("id", [...porVar.keys()]);
  for (const v of vars ?? []) {
    const lines = porVar.get(v.id)!;
    const real = Math.min(
      ...lines.map((l) =>
        Math.floor((stockComp.get(l.component_id) ?? 0) / (l.cantidad || 1)),
      ),
    );
    if (real !== v.stock_real)
      await db
        .from("product_variants")
        .update({ stock_real: real })
        .eq("id", v.id);
  }
}

panel.get("/stock", async (c) => {
  const db = supa(c.env);
  await recalcularDerivado(db);

  const [
    { data: variants, error },
    { data: prods },
    { data: mlvs },
    { data: mls },
    { data: vc },
    { data: comps },
  ] = await Promise.all([
    db
      .from("product_variants")
      .select(
        "id, product_id, etiqueta, stock_real, stock_ml, stock_minimo, group_members(nombre)",
      )
      .eq("activo", true),
    db
      .from("products")
      .select(
        "id, nombre, variantes_por_integrante, categories(nombre, origen), groups(nombre)",
      ),
    db.from("ml_listing_variations").select("product_variant_id, cantidad_ml"),
    db.from("ml_listings").select("product_id, cantidad_ml, tiene_variantes"),
    db.from("variant_components").select("variant_id, component_id, cantidad"),
    db.from("components").select("id, nombre, origen, stock_real, stock_minimo"),
  ]);
  if (error) return c.json({ error: error.message }, 500);

  type Prod = NonNullable<typeof prods>[number];
  const prodById = new Map((prods ?? []).map((p) => [p.id, p as Prod]));
  const compById = new Map((comps ?? []).map((x) => [x.id, x]));
  // una variante puede estar en varias publicaciones (grupo): juntamos todas las
  // cantidades publicadas y marcamos desync si alguna difiere del buffer.
  const mlPorVariante = new Map<string, number[]>();
  for (const v of mlvs ?? []) {
    if (!v.product_variant_id) continue;
    const arr = mlPorVariante.get(v.product_variant_id) ?? [];
    arr.push(v.cantidad_ml ?? 0);
    mlPorVariante.set(v.product_variant_id, arr);
  }
  const mlPorProducto = new Map<string, number[]>();
  for (const m of mls ?? []) {
    if (!m.product_id || m.tiene_variantes) continue;
    const arr = mlPorProducto.get(m.product_id) ?? [];
    arr.push(m.cantidad_ml ?? 0);
    mlPorProducto.set(m.product_id, arr);
  }
  // devuelve el nº publicado para mostrar (o null); desync se calcula aparte
  const publicadoDe = (
    variantId: string,
    productId: string,
    bufferMl: number,
  ): number | null => {
    const arr =
      mlPorVariante.get(variantId) ?? mlPorProducto.get(productId) ?? [];
    if (!arr.length) return null;
    // si alguna difiere, devolvemos esa (para que el front marque desync)
    const distinta = arr.find((n) => n !== bufferMl);
    return distinta ?? arr[0];
  };
  const bomPorVar = new Map<
    string,
    Array<{ component_id: string; cantidad: number }>
  >();
  for (const r of vc ?? []) {
    if (!bomPorVar.has(r.variant_id)) bomPorVar.set(r.variant_id, []);
    bomPorVar.get(r.variant_id)!.push(r);
  }

  const nombreCat = (p?: Prod) =>
    (p?.categories as { nombre?: string } | null)?.nombre ?? null;
  const origenCat = (p?: Prod) =>
    (p?.categories as { origen?: string } | null)?.origen ?? "impresora3d";
  const nombreGrp = (p?: Prod) =>
    (p?.groups as { nombre?: string } | null)?.nombre ?? null;

  interface Holder {
    product_id: string;
    nombre: string;
    categoria: string | null;
    grupo: string | null;
    piezas: Array<{
      component_id: string;
      nombre: string;
      stock_real: number;
      stock_minimo: number;
    }>;
    photocards: Array<{
      variant_id: string;
      member: string;
      component_id: string | null;
      pc_stock_real: number | null;
      pc_stock_minimo: number | null;
      vendibles: number;
      stock_minimo: number;
      stock_ml: number;
      publicado_ml: number | null;
      estado_tono: string;
      estado_label: string;
    }>;
    _piezaIds: Set<string>;
  }

  const simples: Array<Record<string, unknown>> = [];
  const holdersMap = new Map<string, Holder>();
  let bajo = 0;

  for (const v of variants ?? []) {
    const p = prodById.get(v.product_id);
    const bom = bomPorVar.get(v.id) ?? [];
    const esHolder = !!p?.variantes_por_integrante && bom.length > 0;
    const publicadoMl = publicadoDe(v.id, v.product_id, v.stock_ml);
    const member =
      (v.group_members as { nombre?: string } | null)?.nombre ?? null;
    const ev = evaluarStock(v.stock_real, v.stock_minimo);
    if (v.stock_real < v.stock_minimo) bajo++;

    if (!esHolder) {
      const prodNombre = p?.nombre ?? "—";
      simples.push({
        id: v.id,
        nombre:
          v.etiqueta === "Único" || !member
            ? prodNombre
            : `${prodNombre} — ${member}`,
        categoria: nombreCat(p) ?? "Sin categoría",
        origen: origenCat(p),
        grupo: nombreGrp(p),
        stock_real: v.stock_real,
        stock_ml: v.stock_ml,
        publicado_ml: publicadoMl,
        stock_minimo: v.stock_minimo,
        estado_tono: ev.tono,
        estado_label: ev.label,
      });
      continue;
    }

    let h = holdersMap.get(v.product_id);
    if (!h) {
      h = {
        product_id: v.product_id,
        nombre: p!.nombre,
        categoria: nombreCat(p) ?? "Holders",
        grupo: nombreGrp(p),
        piezas: [],
        photocards: [],
        _piezaIds: new Set(),
      };
      holdersMap.set(v.product_id, h);
    }
    for (const line of bom) {
      const comp = compById.get(line.component_id);
      if (!comp || comp.origen === "imprenta" || h._piezaIds.has(comp.id))
        continue;
      h._piezaIds.add(comp.id);
      h.piezas.push({
        component_id: comp.id,
        nombre: comp.nombre.startsWith("Llavero · ") ? "Llavero" : "Cuerpo",
        stock_real: comp.stock_real,
        stock_minimo: comp.stock_minimo,
      });
    }
    const pcLine = bom.find(
      (l) => compById.get(l.component_id)?.origen === "imprenta",
    );
    const pc = pcLine ? compById.get(pcLine.component_id) : null;
    h.photocards.push({
      variant_id: v.id,
      member: member ?? v.etiqueta,
      component_id: pc?.id ?? null,
      pc_stock_real: pc?.stock_real ?? null,
      pc_stock_minimo: pc?.stock_minimo ?? null,
      vendibles: v.stock_real,
      stock_minimo: v.stock_minimo,
      stock_ml: v.stock_ml,
      publicado_ml: publicadoMl,
      estado_tono: ev.tono,
      estado_label: ev.label,
    });
  }

  const holders = [...holdersMap.values()].map((h) => {
    const { _piezaIds, ...rest } = h;
    void _piezaIds;
    rest.photocards.sort((a, b) => a.member.localeCompare(b.member));
    // vendible real del holder = mín(cuerpos, llaveros, Σ photocards)
    const min3d = rest.piezas.length
      ? Math.min(...rest.piezas.map((p) => p.stock_real))
      : Infinity;
    const totalPc = rest.photocards.reduce(
      (s, p) => s + (p.pc_stock_real ?? 0),
      0,
    );
    return {
      ...rest,
      vendibles_total: Math.max(
        0,
        Math.min(min3d === Infinity ? totalPc : min3d, totalPc),
      ),
      estado_tono: PEOR([
        ...rest.piezas.map(
          (p) => evaluarStock(p.stock_real, p.stock_minimo).tono,
        ),
        ...rest.photocards.map((p) => p.estado_tono),
      ]),
    };
  });
  holders.sort((a, b) => a.nombre.localeCompare(b.nombre));
  simples.sort(
    (a, b) =>
      (a.stock_real as number) -
      (a.stock_minimo as number) -
      ((b.stock_real as number) - (b.stock_minimo as number)),
  );

  return c.json({
    simples,
    holders,
    bajo_minimo: bajo,
    sin_catalogo: (variants?.length ?? 0) === 0,
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

// Resuelve una variante interna a TODAS sus publicaciones/variaciones de ML.
// Una variante puede corresponder a varias publicaciones (grupo de publicaciones
// duplicadas por cuotas): el buffer se publica a todas.
async function resolverMLTodas(
  db: ReturnType<typeof supa>,
  variantId: string,
): Promise<Array<{ itemId: string; variationId: string | null }>> {
  const { data: mlvs } = await db
    .from("ml_listing_variations")
    .select("ml_variation_id, ml_listings(ml_item_id)")
    .eq("product_variant_id", variantId);

  const refs = (mlvs ?? [])
    .map((v) => {
      const itemId = (v.ml_listings as { ml_item_id?: string } | null)
        ?.ml_item_id;
      return itemId ? { itemId, variationId: v.ml_variation_id } : null;
    })
    .filter((x): x is { itemId: string; variationId: string } => x != null);
  if (refs.length) return refs;

  // sin variaciones: publicación(es) sin variantes a nivel item
  const { data: pv } = await db
    .from("product_variants")
    .select("product_id")
    .eq("id", variantId)
    .single();
  if (!pv) return [];
  const { data: mls } = await db
    .from("ml_listings")
    .select("ml_item_id")
    .eq("product_id", pv.product_id);
  return (mls ?? []).map((m) => ({ itemId: m.ml_item_id, variationId: null }));
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

  const refs = await resolverMLTodas(db, id);
  if (!refs.length)
    return c.json({ error: "no se pudo mapear a una publicación de ML" }, 409);

  const errores: string[] = [];
  const items = new Set<string>();
  for (const ref of refs) {
    const path = ref.variationId
      ? `/items/${ref.itemId}/variations/${ref.variationId}`
      : `/items/${ref.itemId}`;
    const r = await mlFetch(c.env, db, path, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ available_quantity: pv.stock_ml }),
    });
    if (r.ok) items.add(ref.itemId);
    else errores.push(`${ref.itemId}: ${(await r.text()).slice(0, 150)}`);
  }
  if (!items.size)
    return c.json({ error: errores.join(" · ").slice(0, 300) }, 502);

  for (const it of items) {
    try {
      await syncOneItem(c.env, db, it);
    } catch {
      /* el push ya se hizo */
    }
  }
  return c.json({ ok: true, publicado: pv.stock_ml, publicaciones: items.size, errores });
});

// Publica en ML el buffer de todas las variantes que están desincronizadas.
panel.post("/stock/publicar-todo", async (c) => {
  const db = supa(c.env);

  const { data: vars } = await db
    .from("product_variants")
    .select("id, stock_ml, product_id")
    .eq("activo", true);

  const [{ data: mlvs }, { data: mls }] = await Promise.all([
    db.from("ml_listing_variations").select("product_variant_id, cantidad_ml"),
    db.from("ml_listings").select("product_id, cantidad_ml, tiene_variantes"),
  ]);
  const mlPorVar = new Map<string, number[]>();
  for (const v of mlvs ?? []) {
    if (!v.product_variant_id) continue;
    const arr = mlPorVar.get(v.product_variant_id) ?? [];
    arr.push(v.cantidad_ml ?? 0);
    mlPorVar.set(v.product_variant_id, arr);
  }
  const mlPorProd = new Map<string, number[]>();
  for (const m of mls ?? []) {
    if (!m.product_id || m.tiene_variantes) continue;
    const arr = mlPorProd.get(m.product_id) ?? [];
    arr.push(m.cantidad_ml ?? 0);
    mlPorProd.set(m.product_id, arr);
  }

  const pendientes = (vars ?? []).filter((v) => {
    const live = mlPorVar.get(v.id) ?? mlPorProd.get(v.product_id) ?? [];
    return live.some((n) => n !== v.stock_ml);
  });

  let ok = 0;
  const errores: string[] = [];
  const itemsTocados = new Set<string>();

  for (const v of pendientes.slice(0, 60)) {
    const refs = await resolverMLTodas(db, v.id);
    if (!refs.length) {
      errores.push(`${v.id}: sin mapeo`);
      continue;
    }
    let algunoOk = false;
    for (const ref of refs) {
      const path = ref.variationId
        ? `/items/${ref.itemId}/variations/${ref.variationId}`
        : `/items/${ref.itemId}`;
      const r = await mlFetch(c.env, db, path, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ available_quantity: v.stock_ml }),
      });
      if (r.ok) {
        algunoOk = true;
        itemsTocados.add(ref.itemId);
      } else {
        errores.push(`${ref.itemId}: ${(await r.text()).slice(0, 100)}`);
      }
    }
    if (algunoOk) ok++;
  }

  for (const it of itemsTocados) {
    try {
      await syncOneItem(c.env, db, it);
    } catch {
      /* ignore */
    }
  }

  return c.json({ pendientes: pendientes.length, publicados: ok, errores });
});

// --- Planificador de producción (explota el BOM) ---
panel.get("/produccion", async (c) => {
  const db = supa(c.env);
  await recalcularDerivado(db);
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
  await recalcularDerivado(db);
  return c.json({ ok: true });
});

// --- Inicio (resumen del día + alertas de la tabla) ---
const TONO_POR_SEV: Record<string, "ok" | "warn" | "danger" | "info"> = {
  ok: "ok",
  warn: "warn",
  danger: "danger",
  info: "info",
};

panel.get("/inicio", async (c) => {
  const db = supa(c.env);
  const hoy = new Date().toISOString().slice(0, 10);
  const hace7 = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);

  const [ventasHoy, ventasSemana, listings, ultimosPedidos, alertasRows] =
    await Promise.all([
      db.from("ml_orders").select("total").eq("estado", "paid").gte("fecha", hoy),
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
        .from("alerts")
        .select("tipo, severidad, titulo, detalle")
        .is("resuelta_at", null)
        .order("created_at", { ascending: false })
        .limit(12),
    ]);

  const sum = (rows: { total: number | null }[] | null) =>
    (rows ?? []).reduce((s, r) => s + (r.total ?? 0), 0);
  const activas =
    listings.data?.filter((l) => l.estado === "active").length ?? 0;

  const alertas = (alertasRows.data ?? []).map((a) => ({
    tono: TONO_POR_SEV[a.severidad] ?? "info",
    titulo: a.titulo,
    texto: a.detalle ?? "",
  }));

  return c.json({
    ventas_hoy: sum(ventasHoy.data),
    pedidos_hoy: ventasHoy.data?.length ?? 0,
    ventas_semana: sum(ventasSemana.data),
    publicaciones_activas: activas,
    publicaciones_pausadas: (listings.data?.length ?? 0) - activas,
    ultimos_pedidos: ultimosPedidos.data ?? [],
    alertas,
  });
});

panel.post("/alertas/regenerar", async (c) => {
  const db = supa(c.env);
  const n = await regenerarAlertas(db);
  return c.json({ ok: true, alertas: n });
});
