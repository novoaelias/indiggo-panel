import { Hono } from "hono";
import type { Env } from "../env";
import { supa } from "../lib/supabase";
import { publicadoEnML, sincronizarStockML } from "../lib/stock";
import { syncOneItem } from "../lib/sync";
import {
  allocateAssemblySuggestions,
  armablesPorReceta,
  planPiezas,
} from "../lib/inventory-logic";
import { redondearPlaca } from "../lib/bom";

export const inventario = new Hono<{ Bindings: Env }>();

type LooseDb = {
  from: (name: string) => any;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

const loose = (env: Env) => supa(env) as unknown as LooseDb;
const key = (prefix: string) =>
  `${prefix}:${Date.now()}:${crypto.randomUUID()}`;

inventario.get("/", async (c) => {
  const db = loose(c.env);
  const [variantsR, componentsR, recipesR, reservationsR, movementsR, runsR, ml] =
    await Promise.all([
      db
        .from("product_variants")
        .select(
          "id,product_id,etiqueta,stock_real,stock_ml,stock_minimo,es_eleccion,products(id,nombre,nombre_interno,descontinuado,categories(nombre),groups(nombre))",
        )
        .eq("activo", true),
      db
        .from("components")
        .select(
          "id,codigo,nombre,unidad,equivalencia,color,origen,stock_real,stock_minimo,rinde_por_placa,minutos_placa,activo",
        )
        .eq("activo", true)
        .order("nombre"),
      db
        .from("variant_components")
        .select("variant_id,component_id,cantidad,notas"),
      db
        .from("inventory_reservations")
        .select("product_variant_id,reserved_qty,missing_qty,estado")
        .eq("estado", "activa"),
      db
        .from("inventory_operations")
        .select(
          "id,tipo,nota,meta,created_at,inventory_movement_lines(entity_type,delta,quantity_before,quantity_after,product_variants(etiqueta,products(nombre,nombre_interno)),components(nombre,unidad))",
        )
        .order("created_at", { ascending: false })
        .limit(50),
      db
        .from("production_runs")
        .select(
          "id,component_id,product_variant_id,tipo,cantidad,placas,estado,nota,created_at,components(nombre,unidad,origen),product_variants(etiqueta,products(nombre,nombre_interno))",
        )
        .in("estado", ["pendiente", "en_proceso"])
        .order("created_at"),
      publicadoEnML(supa(c.env)),
    ]);

  for (const r of [
    variantsR,
    componentsR,
    recipesR,
    reservationsR,
    movementsR,
    runsR,
  ])
    if (r.error) return c.json({ error: r.error.message }, 500);

  const components = componentsR.data ?? [];
  const componentById = new Map<string, any>(
    components.map((x: any) => [x.id, x]),
  );
  const stockPorPieza = new Map<string, number>(
    components.map((x: any) => [x.id, x.stock_real as number]),
  );
  const recipeByVariant = new Map<string, any[]>();
  for (const row of recipesR.data ?? []) {
    const lines = recipeByVariant.get(row.variant_id) ?? [];
    lines.push({
      component_id: row.component_id,
      cantidad: row.cantidad,
      notas: row.notas,
      component: componentById.get(row.component_id) ?? null,
    });
    recipeByVariant.set(row.variant_id, lines);
  }
  const reservedByVariant = new Map<string, number>();
  const missingByVariant = new Map<string, number>();
  for (const row of reservationsR.data ?? []) {
    reservedByVariant.set(
      row.product_variant_id,
      (reservedByVariant.get(row.product_variant_id) ?? 0) + row.reserved_qty,
    );
    missingByVariant.set(
      row.product_variant_id,
      (missingByVariant.get(row.product_variant_id) ?? 0) + row.missing_qty,
    );
  }

  const variants = (variantsR.data ?? [])
    .filter((v: any) => !v.products?.descontinuado && !v.es_eleccion)
    .map((v: any) => {
      const recipe = recipeByVariant.get(v.id) ?? [];
      const armable = armablesPorReceta(recipe, stockPorPieza);
      const reserved = reservedByVariant.get(v.id) ?? 0;
      const published = ml.porVar.get(v.id) ?? ml.porProd.get(v.product_id) ?? [];
      return {
        id: v.id,
        product_id: v.product_id,
        nombre: v.products?.nombre_interno || v.products?.nombre || "Producto",
        etiqueta: v.etiqueta,
        categoria: v.products?.categories?.nombre ?? null,
        grupo: v.products?.groups?.nombre ?? null,
        terminados: v.stock_real,
        reservados: reserved,
        libres: Math.max(0, v.stock_real - reserved),
        faltantes_pedidos: missingByVariant.get(v.id) ?? 0,
        armables: armable,
        stock_ml_objetivo: v.stock_ml,
        stock_ml_publicado: published.length ? Math.max(...published) : null,
        stock_minimo: v.stock_minimo,
        receta: recipe,
      };
    })
    .sort((a: any, b: any) =>
      b.faltantes_pedidos - a.faltantes_pedidos ||
      a.libres - b.libres ||
      a.nombre.localeCompare(b.nombre),
    );

  // Distribución secuencial: una pieza compartida se asigna una sola vez.
  const suggestions = allocateAssemblySuggestions(variants, stockPorPieza);

  // Qué reponer: impresiones 3D por un lado, encargos a la imprenta por otro.
  const enCursoPorPieza = new Map<string, number>();
  for (const run of runsR.data ?? [])
    if (run.component_id)
      enCursoPorPieza.set(
        run.component_id,
        (enCursoPorPieza.get(run.component_id) ?? 0) + run.cantidad,
      );
  const trabajos = planPiezas(
    variants,
    components.map((x: any) => ({
      id: x.id,
      nombre: x.nombre,
      unidad: x.unidad,
      origen: x.origen,
      // Para planificar, lo iniciado cuenta como reposición comprometida, pero
      // no como stock físico: sólo se suma al inventario al completar el trabajo.
      stock_real: x.stock_real + (enCursoPorPieza.get(x.id) ?? 0),
      stock_minimo: x.stock_minimo,
      rinde_por_placa: x.rinde_por_placa,
      minutos_placa: x.minutos_placa,
      minutos_produccion: null,
    })),
    redondearPlaca,
  );

  const conEnCurso = (t: any) => ({
    ...t,
    stock_real: componentById.get(t.component_id)?.stock_real ?? t.stock_real,
    en_curso: enCursoPorPieza.get(t.component_id) ?? 0,
  });

  return c.json({
    variants,
    components,
    suggestions,
    imprimir: trabajos.filter((t) => t.origen === "impresora3d").map(conEnCurso),
    encargar: trabajos.filter((t) => t.origen !== "impresora3d").map(conEnCurso),
    production_runs: runsR.data ?? [],
    movements: movementsR.data ?? [],
    summary: {
      productos: variants.length,
      faltantes_pedidos: variants.reduce(
        (sum: number, v: any) => sum + v.faltantes_pedidos,
        0,
      ),
      piezas_bajas: components.filter(
        (x: any) => x.stock_minimo > 0 && x.stock_real < x.stock_minimo,
      ).length,
      ml_desincronizado: variants.filter(
        (v: any) =>
          v.stock_ml_publicado != null &&
          v.stock_ml_publicado !== v.stock_ml_objetivo,
      ).length,
    },
  });
});

inventario.post("/adjust", async (c) => {
  const body = await c.req.json<{
    entity_type?: "variant" | "component";
    entity_id?: string;
    quantity?: number;
    reason?: string;
    idempotency_key?: string;
  }>();
  if (
    !body.entity_id ||
    !body.entity_type ||
    !Number.isInteger(body.quantity) ||
    (body.quantity ?? -1) < 0
  )
    return c.json({ error: "ajuste inválido" }, 400);
  const db = loose(c.env);
  const { data, error } = await db.rpc("inventory_adjust", {
    p_entity_type: body.entity_type,
    p_entity_id: body.entity_id,
    p_new_qty: body.quantity,
    p_reason: body.reason ?? "Conteo manual",
    p_idempotency_key: body.idempotency_key ?? key("ajuste"),
  });
  if (error) return c.json({ error: error.message }, 409);
  return c.json({ ok: true, operation_id: data });
});

inventario.post("/print", async (c) => {
  const body = await c.req.json<{
    component_id?: string;
    quantity?: number;
    plates?: number;
    note?: string;
    idempotency_key?: string;
    kind?: "impresion" | "compra";
  }>();
  if (!body.component_id || !Number.isInteger(body.quantity) || (body.quantity ?? 0) <= 0)
    return c.json({ error: "impresión inválida" }, 400);
  const kind = body.kind === "compra" ? "compra" : "impresion";
  const { data, error } = await loose(c.env).rpc("inventory_register_print", {
    p_component_id: body.component_id,
    p_quantity: body.quantity,
    p_plates: body.plates ?? null,
    p_note: body.note ?? "",
    p_idempotency_key: body.idempotency_key ?? key(kind),
    p_kind: kind,
  });
  if (error) return c.json({ error: error.message }, 409);
  return c.json({ ok: true, operation_id: data });
});

inventario.post("/runs", async (c) => {
  const body = await c.req.json<{
    component_id?: string;
    quantity?: number;
    plates?: number | null;
    kind?: "impresion" | "compra";
    note?: string;
  }>();
  if (
    !body.component_id ||
    !Number.isInteger(body.quantity) ||
    (body.quantity ?? 0) <= 0
  )
    return c.json({ error: "trabajo de producción inválido" }, 400);
  const tipo = body.kind === "compra" ? "compra" : "impresion";
  const { data, error } = await loose(c.env)
    .from("production_runs")
    .insert({
      component_id: body.component_id,
      tipo,
      cantidad: body.quantity,
      placas: body.plates ?? null,
      estado: "en_proceso",
      nota: body.note?.trim() || null,
    })
    .select("id")
    .single();
  if (error) return c.json({ error: error.message }, 409);
  return c.json({ ok: true, run_id: data?.id });
});

inventario.post("/runs/:id/complete", async (c) => {
  const db = loose(c.env);
  const id = c.req.param("id");
  const { data: run, error: readError } = await db
    .from("production_runs")
    .select("id,component_id,tipo,cantidad,placas,estado,nota,operation_id")
    .eq("id", id)
    .maybeSingle();
  if (readError) return c.json({ error: readError.message }, 500);
  if (!run) return c.json({ error: "trabajo inexistente" }, 404);
  if (run.estado === "terminada")
    return c.json({ ok: true, operation_id: run.operation_id, ya: true });
  if (!run.component_id || !["impresion", "compra"].includes(run.tipo))
    return c.json({ error: "este trabajo no se puede completar así" }, 409);

  const { data: operationId, error } = await db.rpc("inventory_register_print", {
    p_component_id: run.component_id,
    p_quantity: run.cantidad,
    p_plates: run.placas ?? null,
    p_note: run.nota ?? "",
    p_idempotency_key: `produccion:${id}`,
    p_kind: run.tipo,
  });
  if (error) return c.json({ error: error.message }, 409);

  // El RPC conserva compatibilidad creando su propia fila terminada. Unificamos
  // esa fila con el trabajo iniciado; si la petición se repite, la operación es
  // idempotente y este bloque deja el mismo resultado.
  await db
    .from("production_runs")
    .delete()
    .eq("operation_id", operationId)
    .neq("id", id);
  const { error: updateError } = await db
    .from("production_runs")
    .update({
      estado: "terminada",
      operation_id: operationId,
      completed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (updateError) return c.json({ error: updateError.message }, 500);
  return c.json({ ok: true, operation_id: operationId });
});

inventario.post("/runs/:id/cancel", async (c) => {
  const { error } = await loose(c.env)
    .from("production_runs")
    .update({ estado: "cancelada", completed_at: new Date().toISOString() })
    .eq("id", c.req.param("id"))
    .in("estado", ["pendiente", "en_proceso"]);
  if (error) return c.json({ error: error.message }, 409);
  return c.json({ ok: true });
});

inventario.post("/assemble", async (c) => {
  const body = await c.req.json<{
    variant_id?: string;
    quantity?: number;
    note?: string;
    idempotency_key?: string;
  }>();
  if (!body.variant_id || !Number.isInteger(body.quantity) || (body.quantity ?? 0) <= 0)
    return c.json({ error: "armado inválido" }, 400);
  const { data, error } = await loose(c.env).rpc("inventory_assemble", {
    p_variant_id: body.variant_id,
    p_quantity: body.quantity,
    p_note: body.note ?? "",
    p_idempotency_key: body.idempotency_key ?? key("armado"),
  });
  if (error) return c.json({ error: error.message }, 409);
  return c.json({ ok: true, operation_id: data });
});

inventario.post("/return", async (c) => {
  const body = await c.req.json<{
    order_id?: string;
    note?: string;
    idempotency_key?: string;
  }>();
  if (!body.order_id) return c.json({ error: "pedido requerido" }, 400);
  const { data, error } = await loose(c.env).rpc("inventory_return_order", {
    p_order_id: body.order_id,
    p_note: body.note ?? "Devolución física recibida",
    p_idempotency_key: body.idempotency_key ?? key(`devolucion:${body.order_id}`),
  });
  if (error) return c.json({ error: error.message }, 409);
  return c.json({ ok: true, operation_id: data });
});

inventario.put("/recipes/:variantId", async (c) => {
  const body = await c.req.json<{
    lines?: Array<{ component_id: string; cantidad: number; notas?: string }>;
  }>();
  const lines = (body.lines ?? []).filter(
    (x) => x.component_id && Number.isInteger(x.cantidad) && x.cantidad > 0,
  );
  const { data, error } = await loose(c.env).rpc("inventory_set_recipe", {
    p_variant_id: c.req.param("variantId"),
    p_lines: lines,
  });
  if (error) return c.json({ error: error.message }, 409);
  return c.json({ ok: true, lines: data });
});

inventario.patch("/components/:id", async (c) => {
  const body = await c.req.json<{
    nombre?: string;
    unidad?: string;
    equivalencia?: string | null;
    color?: string | null;
    rinde_por_placa?: number | null;
    minutos_placa?: number | null;
  }>();
  const patch: Record<string, unknown> = {};
  for (const field of [
    "nombre",
    "unidad",
    "equivalencia",
    "color",
    "rinde_por_placa",
    "minutos_placa",
  ] as const)
    if (body[field] !== undefined) patch[field] = body[field];
  const { error } = await loose(c.env)
    .from("components")
    .update(patch)
    .eq("id", c.req.param("id"));
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ ok: true });
});

inventario.post("/sync-ml", async (c) => {
  const db = supa(c.env);
  const result = await sincronizarStockML(c.env, db, {
    onItemTocado: (itemId) => syncOneItem(c.env, db, itemId).catch(() => {}),
  });
  return c.json(result);
});
