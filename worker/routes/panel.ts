import { Hono } from "hono";
import type { Database } from "@/lib/database.types";
import type { Env } from "../env";
import { supa } from "../lib/supabase";
import { mlFetch } from "../lib/ml";
import { syncEnvio, syncOneItem } from "../lib/sync";
import { sheetsConfigurado } from "../lib/sheets";
import { esVariantePieza, planificar, ventasRecientes } from "../lib/bom";
import {
  ajustarStockPorPedido,
  avisarStockManual,
  recalcularDerivado,
} from "../lib/stock";
import { regenerarAlertas } from "../lib/alertas";
import { inicioDiaAR, inicioDiaARHace } from "../lib/fecha";
import { etiquetaLogistica, pedidoActivo } from "../lib/envios";

export const panel = new Hono<{ Bindings: Env }>();

// --- Publicaciones (espejo de ML) ---
panel.get("/publicaciones", async (c) => {
  const db = supa(c.env);
  const estado = c.req.query("estado");
  const q = c.req.query("q");

  let query = db
    .from("ml_listings")
    .select(
      "id, ml_item_id, titulo, estado, precio, moneda, cantidad_ml, tiene_variantes, permalink, thumbnail, categoria_sugerida, categoria_analisis, reemplazada_por",
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
      categoria_sugerida: l.categoria_sugerida,
      categoria_analisis: l.categoria_analisis,
      reemplazada_por: l.reemplazada_por,
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

// Cantidades publicadas hoy en ML por variante — SÓLO publicaciones activas
// (las pausadas/finalizadas/en revisión no se pueden actualizar).
async function publicadoEnML(db: ReturnType<typeof supa>) {
  const [{ data: mlvs }, { data: mls }] = await Promise.all([
    db
      .from("ml_listing_variations")
      .select("ml_listing_id, product_variant_id, cantidad_ml"),
    db
      .from("ml_listings")
      .select("id, product_id, cantidad_ml, tiene_variantes, estado"),
  ]);
  const activas = new Set(
    (mls ?? []).filter((m) => m.estado === "active").map((m) => m.id),
  );
  const porVar = new Map<string, number[]>();
  for (const v of mlvs ?? []) {
    if (!v.product_variant_id || !activas.has(v.ml_listing_id)) continue;
    const arr = porVar.get(v.product_variant_id) ?? [];
    arr.push(v.cantidad_ml ?? 0);
    porVar.set(v.product_variant_id, arr);
  }
  const porProd = new Map<string, number[]>();
  for (const m of mls ?? []) {
    if (!m.product_id || m.tiene_variantes || m.estado !== "active") continue;
    const arr = porProd.get(m.product_id) ?? [];
    arr.push(m.cantidad_ml ?? 0);
    porProd.set(m.product_id, arr);
  }
  return { porVar, porProd };
}

const GRUPO_TIPO: Record<string, string> = {
  photocard: "Photocards",
  cuerpo: "Cuerpos 3D",
  llavero: "Llaveros 3D",
  mostacilla: "Mostacillas",
  producto: "Otros",
};

panel.get("/stock", async (c) => {
  const db = supa(c.env);
  await recalcularDerivado(db);

  const [
    { data: variants, error },
    { data: prods },
    { data: vc },
    { data: comps },
    plan,
    ventas,
    ml,
  ] = await Promise.all([
    db
      .from("product_variants")
      .select(
        "id, product_id, etiqueta, stock_real, stock_ml, stock_minimo, es_eleccion, group_member_id, group_members(nombre)",
      )
      .eq("activo", true),
    db
      .from("products")
      .select(
        "id, nombre, variantes_por_integrante, categories(nombre, slug), groups(nombre)",
      ),
    db.from("variant_components").select("variant_id, component_id, cantidad"),
    db
      .from("components")
      .select("id, nombre, origen, stock_real, stock_minimo, group_member_id"),
    planificar(db),
    ventasRecientes(db),
    publicadoEnML(db),
  ]);
  if (error) return c.json({ error: error.message }, 500);

  type Prod = NonNullable<typeof prods>[number];
  const prodById = new Map((prods ?? []).map((p) => [p.id, p as Prod]));
  const compById = new Map((comps ?? []).map((x) => [x.id, x]));
  const nombreGrp = (p?: Prod) =>
    (p?.groups as { nombre?: string } | null)?.nombre ?? null;
  const slugCat = (p?: Prod) =>
    (p?.categories as { slug?: string } | null)?.slug ?? null;
  const nombreCat = (p?: Prod) =>
    (p?.categories as { nombre?: string } | null)?.nombre ?? null;

  const bomPorVar = new Map<string, string[]>();
  const bomLinesPorVar = new Map<string, Array<{ cid: string; qty: number }>>();
  for (const r of vc ?? []) {
    if (!bomPorVar.has(r.variant_id)) bomPorVar.set(r.variant_id, []);
    bomPorVar.get(r.variant_id)!.push(r.component_id);
    if (!bomLinesPorVar.has(r.variant_id)) bomLinesPorVar.set(r.variant_id, []);
    bomLinesPorVar.get(r.variant_id)!.push({ cid: r.component_id, qty: r.cantidad || 1 });
  }
  // "producto = pieza" (llavero suelto): 1 sola pieza ×1
  const esVarPieza = (vid: string) =>
    esVariantePieza((bomLinesPorVar.get(vid) ?? []).map((l) => ({ cantidad: l.qty })));
  // cuántos packs se pueden armar YA con las piezas en stock
  const armablesDeVariante = (vid: string): number => {
    const lines = bomLinesPorVar.get(vid);
    if (!lines?.length) return 0;
    return Math.min(
      ...lines.map((l) =>
        Math.floor((compById.get(l.cid)?.stock_real ?? 0) / l.qty),
      ),
    );
  };
  const esHolderVar = (vid: string, pid: string) =>
    !!prodById.get(pid)?.variantes_por_integrante &&
    (bomPorVar.get(vid)?.length ?? 0) > 0;

  // ---- piezas (lo único editable) ----
  interface Pieza {
    kind: "componente" | "variante";
    id: string;
    tipo: string;
    grupo: string;
    nombre: string;
    contexto: string | null;
    stock_real: number;
    stock_minimo: number;
    producir: number;
    estado_tono: "ok" | "warn" | "danger";
  }
  const piezas: Pieza[] = [];

  const partir = (raw: string) => {
    const p = raw.split(" · ").map((s) => s.trim());
    if (p[0] === "Photocard")
      return {
        tipo: "photocard",
        nombre: p[1] ?? "Photocard",
        contexto: p[2] ?? null,
      };
    if (p[0] === "Cuerpo")
      return { tipo: "cuerpo", nombre: "Cuerpo", contexto: p.slice(1).join(" · ") || null };
    if (p[0] === "Llavero")
      return { tipo: "llavero", nombre: "Llavero", contexto: p.slice(1).join(" · ") || null };
    // piezas 3D de packs (logos arirang, sets de nombres, letras BTS)
    if (/^(Logo |Set nombres|Letras )/.test(raw))
      return { tipo: "mostacilla", nombre: raw, contexto: null };
    return { tipo: "producto", nombre: raw, contexto: null };
  };
  const mkPieza = (
    kind: Pieza["kind"],
    id: string,
    tipo: string,
    nombre: string,
    contexto: string | null,
    real: number,
    minimo: number,
    producir: number,
  ): Pieza => ({
    kind,
    id,
    tipo,
    grupo: GRUPO_TIPO[tipo] ?? "Otros",
    nombre,
    contexto,
    stock_real: real,
    stock_minimo: minimo,
    producir,
    estado_tono: real <= 0 ? "danger" : producir > 0 ? "warn" : "ok",
  });

  // componentes = piezas de holders (cuerpo / llavero / photocard por integrante)
  for (const comp of comps ?? []) {
    const { tipo, nombre, contexto } = partir(comp.nombre);
    piezas.push(
      mkPieza(
        "componente",
        comp.id,
        tipo,
        nombre,
        contexto,
        comp.stock_real,
        comp.stock_minimo,
        plan.producir_componente[comp.id] ?? 0,
      ),
    );
  }

  // variantes de productos simples (mostacillas, clickers, stickers, llaveros…)
  for (const v of variants ?? []) {
    if (esHolderVar(v.id, v.product_id)) continue;
    // "Random / a elección": no es una pieza con stock propio.
    if (v.es_eleccion) continue;
    // "producto = pieza": Elias edita la pieza (aparece en "Llaveros 3D").
    if (esVarPieza(v.id)) continue;
    const p = prodById.get(v.product_id);
    const member =
      (v.group_members as { nombre?: string } | null)?.nombre ?? null;
    const slug = slugCat(p);
    const tipo = slug === "mostacillas" ? "mostacilla" : "producto";
    const variante = member ?? (v.etiqueta !== "Único" ? v.etiqueta : null);
    piezas.push(
      mkPieza(
        "variante",
        v.id,
        tipo,
        p?.nombre ?? "—",
        variante ?? nombreCat(p) ?? nombreGrp(p),
        v.stock_real,
        v.stock_minimo,
        plan.producir_variante[v.id] ?? 0,
      ),
    );
  }

  piezas.sort(
    (a, b) =>
      (b.producir > 0 || a.stock_real <= 0 ? 0 : 1) -
        (a.producir > 0 || b.stock_real <= 0 ? 0 : 1) ||
      b.producir - a.producir ||
      a.nombre.localeCompare(b.nombre),
  );

  // ---- productos (sólo lectura: "qué puedo despachar hoy") ----
  // Un renglón por producto activo, con las unidades que se pueden vender ya:
  //  · holder  → derivado de las piezas (cuerpo/llavero/photocard)
  //  · simple  → suma del stock real de sus variantes
  interface ProdResumen {
    product_id: string;
    nombre: string;
    grupo: string | null;
    vendibles: number;
    sin_stock_de: string[];
    estado_tono: "ok" | "warn" | "danger";
  }
  const gmNombre = new Map(
    (comps ?? [])
      .filter((c) => c.group_member_id)
      .map((c) => [c.id, partir(c.nombre).nombre]),
  );

  const holderAgg = new Map<
    string,
    { nombre: string; grupo: string | null; pc: Set<string>; d3: number[] }
  >();
  const simpleAgg = new Map<
    string,
    { nombre: string; grupo: string | null; total: number; sin: string[] }
  >();

  for (const v of variants ?? []) {
    if (v.es_eleccion) continue;
    const p = prodById.get(v.product_id);
    if (esHolderVar(v.id, v.product_id)) {
      let h = holderAgg.get(v.product_id);
      if (!h) {
        h = { nombre: p?.nombre ?? "—", grupo: nombreGrp(p), pc: new Set(), d3: [] };
        holderAgg.set(v.product_id, h);
      }
      for (const cid of bomPorVar.get(v.id) ?? []) {
        const comp = compById.get(cid);
        if (!comp) continue;
        if (comp.origen === "imprenta") h.pc.add(cid);
        else if (!h.d3.includes(comp.stock_real)) h.d3.push(comp.stock_real);
      }
    } else {
      let s = simpleAgg.get(v.product_id);
      if (!s) {
        s = { nombre: p?.nombre ?? "—", grupo: nombreGrp(p) ?? nombreCat(p), total: 0, sin: [] };
        simpleAgg.set(v.product_id, s);
      }
      // packs con receta: lo armado a mano + lo que se puede armar ya con piezas.
      // "producto = pieza" (llavero suelto): su stock_real ya ES el de la pieza.
      const disponible = esVarPieza(v.id)
        ? Math.max(0, v.stock_real)
        : Math.max(0, v.stock_real) + armablesDeVariante(v.id);
      s.total += disponible;
      if (disponible <= 0) {
        const member = (v.group_members as { nombre?: string } | null)?.nombre ?? null;
        const etq = member ?? (v.etiqueta !== "Único" ? v.etiqueta : null);
        if (etq) s.sin.push(etq);
      }
    }
  }

  const productos: ProdResumen[] = [];
  for (const [pid, h] of holderAgg) {
    const pcStock = [...h.pc].map((cid) => compById.get(cid)?.stock_real ?? 0);
    const totalPc = pcStock.reduce((s, n) => s + n, 0);
    const min3d = h.d3.length ? Math.min(...h.d3) : Infinity;
    const vendibles = Math.max(0, Math.min(min3d === Infinity ? totalPc : min3d, totalPc));
    const ventas14 = ventas.porProducto.get(pid) ?? 0;
    const sin = [...h.pc]
      .filter((cid) => (compById.get(cid)?.stock_real ?? 0) <= 0)
      .map((cid) => gmNombre.get(cid) ?? "")
      .filter(Boolean);
    productos.push({
      product_id: pid,
      nombre: h.nombre,
      grupo: h.grupo,
      vendibles,
      sin_stock_de: sin,
      estado_tono:
        vendibles <= 0 ? "danger" : vendibles < (ventas14 / 14) * 7 ? "warn" : "ok",
    });
  }
  for (const [pid, s] of simpleAgg) {
    const ventas14 = ventas.porProducto.get(pid) ?? 0;
    productos.push({
      product_id: pid,
      nombre: s.nombre,
      grupo: s.grupo,
      vendibles: s.total,
      sin_stock_de: s.sin,
      estado_tono:
        s.total <= 0 ? "danger" : s.total < (ventas14 / 14) * 7 ? "warn" : "ok",
    });
  }
  const tonoRank = { danger: 0, warn: 1, ok: 2 } as const;
  productos.sort(
    (a, b) =>
      tonoRank[a.estado_tono] - tonoRank[b.estado_tono] ||
      a.nombre.localeCompare(b.nombre),
  );

  // ---- resumen ----
  let desync = 0;
  for (const v of variants ?? []) {
    const live = ml.porVar.get(v.id) ?? ml.porProd.get(v.product_id) ?? [];
    if (live.some((n) => n !== v.stock_ml)) desync++;
  }

  return c.json({
    piezas,
    productos,
    resumen: {
      piezas_a_producir: piezas.filter((p) => p.producir > 0).length,
      ml_desincronizado: desync,
      sin_catalogo: (variants?.length ?? 0) === 0,
    },
  });
});

// Editar el stock físico de una variante simple. El buffer de ML (calcBuffer) y
// el mínimo (calcMinimo, por ventas) son automáticos — no se aceptan acá.
panel.patch("/stock/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ stock_real?: number }>();
  const patch: Record<string, number> = {};
  const v = body.stock_real;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0)
    patch.stock_real = Math.round(v);
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
    .select("ml_variation_id, ml_listings(ml_item_id, estado)")
    .eq("product_variant_id", variantId);

  const refs = (mlvs ?? [])
    .map((v) => {
      const l = v.ml_listings as
        | { ml_item_id?: string; estado?: string }
        | null;
      return l?.ml_item_id && l.estado === "active"
        ? { itemId: l.ml_item_id, variationId: v.ml_variation_id }
        : null;
    })
    .filter((x): x is { itemId: string; variationId: string } => x != null);
  if (refs.length) return refs;

  // sin variaciones: publicación(es) activas sin variantes a nivel item
  const { data: pv } = await db
    .from("product_variants")
    .select("product_id")
    .eq("id", variantId)
    .single();
  if (!pv) return [];
  const { data: mls } = await db
    .from("ml_listings")
    .select("ml_item_id")
    .eq("product_id", pv.product_id)
    .eq("estado", "active");
  return (mls ?? []).map((m) => ({ itemId: m.ml_item_id, variationId: null }));
}

// Sincroniza Mercado Libre: recalcula los buffers automáticos y publica los que
// quedaron desincronizados. El front lo llama solo (con debounce) tras cada
// edición de stock, y también hay un botón manual.
panel.post("/stock/sincronizar-ml", async (c) => {
  const db = supa(c.env);
  await recalcularDerivado(db);

  const { data: vars } = await db
    .from("product_variants")
    .select("id, stock_ml, product_id")
    .eq("activo", true);

  const { porVar: mlPorVar, porProd: mlPorProd } = await publicadoEnML(db);

  const pendientes = (vars ?? []).filter((v) => {
    const live = mlPorVar.get(v.id) ?? mlPorProd.get(v.product_id) ?? [];
    return live.some((n) => n !== v.stock_ml);
  });

  let ok = 0;
  const errores: string[] = [];
  const itemsTocados = new Set<string>();

  const empujar = async (v: { id: string; stock_ml: number }) => {
    const refs = await resolverMLTodas(db, v.id);
    if (!refs.length) return;
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
  };

  const lote = pendientes.slice(0, 80);
  for (let i = 0; i < lote.length; i += 5)
    await Promise.all(lote.slice(i, i + 5).map(empujar));

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
  const body = await c.req.json<{ stock_real?: number }>();
  const patch: Record<string, number> = {};
  const v = body.stock_real;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0)
    patch.stock_real = Math.round(v);
  if (!Object.keys(patch).length)
    return c.json({ error: "nada para actualizar" }, 400);
  const db = supa(c.env);
  const { error } = await db
    .from("components")
    .update(patch as Database["public"]["Tables"]["components"]["Update"])
    .eq("id", id);
  if (error) return c.json({ error: error.message }, 500);
  // lo derivado (vendible + buffer) se recalcula en GET /stock y en
  // POST /stock/sincronizar-ml — no bloqueamos el guardado acá.
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
  // "hoy" y "hace 7 días" en horario de Argentina (el Worker corre en UTC).
  const hoy = inicioDiaAR();
  const hace7 = inicioDiaAR(new Date(Date.now() - 6 * 864e5));

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

// --- Pedidos activos (pagados y sin despachar), separados por logística ---
panel.get("/pedidos-activos", async (c) => {
  const db = supa(c.env);

  const { data: orders, error } = await db
    .from("ml_orders")
    .select(
      "id, ml_order_id, comprador, fecha, total, estado, estado_envio, envio_substatus, logistic_type, raw",
    )
    .eq("estado", "paid")
    .gte("fecha", inicioDiaARHace(45))
    .order("fecha", { ascending: true });
  if (error) return c.json({ error: error.message }, 500);

  const activos = (orders ?? []).filter((o) =>
    pedidoActivo({ estado: o.estado, estado_envio: o.estado_envio, raw: o.raw }),
  );

  const { data: items } = await db
    .from("ml_order_items")
    .select("ml_order_id, titulo, cantidad")
    .in(
      "ml_order_id",
      activos.map((o) => o.id),
    );
  const itemsPorPedido = new Map<string, Array<{ titulo: string; cantidad: number }>>();
  for (const it of items ?? []) {
    const arr = itemsPorPedido.get(it.ml_order_id) ?? [];
    arr.push({ titulo: it.titulo ?? "—", cantidad: it.cantidad ?? 1 });
    itemsPorPedido.set(it.ml_order_id, arr);
  }

  // Agrupar por envío/pack: ML puede juntar varios pedidos del mismo comprador
  // en un solo paquete.
  const shipId = (o: (typeof activos)[number]) => {
    const raw = o.raw as { shipping?: { id?: unknown }; pack_id?: unknown } | null;
    return (
      (raw?.shipping?.id != null && String(raw.shipping.id)) ||
      (raw?.pack_id != null && `pack:${raw.pack_id}`) ||
      `order:${o.ml_order_id}`
    );
  };

  interface Paquete {
    key: string;
    comprador: string | null;
    fecha: string;
    total: number;
    items: Array<{ titulo: string; cantidad: number }>;
    estado_envio: string | null;
    envio_substatus: string | null;
    etiqueta_logistica: string;
    a_imprimir: boolean;
  }
  const paquetes = new Map<string, Paquete>();
  for (const o of activos) {
    const key = shipId(o);
    const eti = etiquetaLogistica(o.logistic_type);
    const cur = paquetes.get(key);
    const its = itemsPorPedido.get(o.id) ?? [];
    if (cur) {
      cur.total += o.total ?? 0;
      cur.items.push(...its);
      if (o.fecha < cur.fecha) cur.fecha = o.fecha;
    } else {
      paquetes.set(key, {
        key,
        comprador: o.comprador,
        fecha: o.fecha,
        total: o.total ?? 0,
        items: its,
        estado_envio: o.estado_envio,
        envio_substatus: o.envio_substatus,
        etiqueta_logistica: eti,
        a_imprimir:
          o.envio_substatus === "ready_to_print" ||
          o.estado_envio === "ready_to_ship",
      });
    }
  }

  const ORDEN = ["Flex", "Mercado Envíos", "Full", "Otro"];
  const lista = [...paquetes.values()].sort(
    (a, b) =>
      ORDEN.indexOf(a.etiqueta_logistica) - ORDEN.indexOf(b.etiqueta_logistica) ||
      a.fecha.localeCompare(b.fecha),
  );
  const conteos: Record<string, number> = {};
  for (const p of lista)
    conteos[p.etiqueta_logistica] = (conteos[p.etiqueta_logistica] ?? 0) + 1;

  return c.json({ paquetes: lista, conteos, total: lista.length });
});

// --- Planilla de reparto (Google Sheets): pedidos Flex → filas por día ---
panel.get("/pedidos/planilla", async (c) => {
  const db = supa(c.env);
  const desde = inicioDiaARHace(2);

  const [{ count: escritos }, { data: pend }, { data: ult }] = await Promise.all([
    db
      .from("ml_orders")
      .select("id", { count: "exact", head: true })
      .not("sheet_synced_at", "is", null),
    db
      .from("ml_orders")
      .select("id")
      .eq("estado", "paid")
      .eq("logistic_type", "self_service")
      .is("sheet_synced_at", null)
      .gte("fecha", desde),
    db
      .from("ml_orders")
      .select("sheet_synced_at")
      .not("sheet_synced_at", "is", null)
      .order("sheet_synced_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return c.json({
    configurado: sheetsConfigurado(c.env),
    sheet_id: c.env.SHEETS_ID ?? null,
    sheet_url: c.env.SHEETS_ID
      ? `https://docs.google.com/spreadsheets/d/${c.env.SHEETS_ID}/edit`
      : null,
    escritos_total: escritos ?? 0,
    pendientes: pend?.length ?? 0,
    ultimo: (ult as { sheet_synced_at?: string } | null)?.sheet_synced_at ?? null,
  });
});

// Rellena la planilla con los pedidos Flex recientes que todavía no se escribieron
// (ej. si Sheets estuvo caído). Cada uno va al bloque de su día de reparto.
panel.post("/pedidos/planilla/sync", async (c) => {
  const db = supa(c.env);
  if (!sheetsConfigurado(c.env))
    return c.json(
      { error: "Falta el Service Account de Google (GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY)." },
      409,
    );

  const { data: orders } = await db
    .from("ml_orders")
    .select("id, ml_order_id, raw, sheet_synced_at")
    .eq("estado", "paid")
    .is("sheet_synced_at", null)
    .gte("fecha", inicioDiaARHace(2))
    .order("fecha", { ascending: true });

  let escritos = 0;
  const errores: string[] = [];
  for (const o of orders ?? []) {
    const raw = o.raw as { shipping?: { id?: unknown } } | null;
    const shippingId =
      raw?.shipping?.id != null ? String(raw.shipping.id) : null;
    if (!shippingId) continue;
    try {
      await syncEnvio(c.env, db, { id: o.id, shippingId, status: "paid" });
      const { data: after } = await db
        .from("ml_orders")
        .select("sheet_synced_at")
        .eq("id", o.id)
        .maybeSingle();
      if ((after as { sheet_synced_at?: string } | null)?.sheet_synced_at)
        escritos++;
    } catch (e) {
      errores.push(`${o.ml_order_id}: ${(e as Error).message}`);
    }
  }
  return c.json({ escritos, revisados: orders?.length ?? 0, errores });
});

// Marcar un pedido como despachado a mano (si ML tarda en actualizar el envío):
// descuenta el stock de la venta, una sola vez.
panel.post("/pedidos/:id/despachar", async (c) => {
  const db = supa(c.env);
  const id = c.req.param("id");
  const { data: o } = await db
    .from("ml_orders")
    .select("id, comprador, stock_descontado_at")
    .eq("ml_order_id", id)
    .maybeSingle();
  if (!o) return c.json({ error: "pedido no encontrado" }, 404);
  if (o.stock_descontado_at)
    return c.json({ ok: true, ya: true, aplicados: 0, avisos: [] });

  const { aplicados, avisos } = await ajustarStockPorPedido(db, o.id, -1);
  await db
    .from("ml_orders")
    .update({
      stock_descontado_at: new Date().toISOString(),
    } as Database["public"]["Tables"]["ml_orders"]["Update"])
    .eq("id", o.id);
  await avisarStockManual(db, o.id, o.comprador, avisos);
  await recalcularDerivado(db);
  return c.json({ ok: true, aplicados, avisos });
});

panel.post("/alertas/regenerar", async (c) => {
  const db = supa(c.env);
  const n = await regenerarAlertas(db);
  return c.json({ ok: true, alertas: n });
});
