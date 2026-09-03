// Stock derivado + descuento de stock al despachar una venta.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  calcBuffer,
  calcMinimo,
  esVariantePieza,
  ventasMulti,
} from "./bom";

type DB = SupabaseClient<Database>;

// Recalcula todo lo derivado:
//  1. product_variants.stock_real de los holders = mín sobre el BOM (Elias carga
//     las piezas, no el "vendible"). Las variantes "random/elección" se topean
//     por el total de photocards del producto.
//  2. product_variants.stock_ml (buffer publicado en ML) = calcBuffer(stock_real),
//     para TODAS las variantes. El buffer nunca se edita a mano.
export async function recalcularDerivado(db: DB) {
  const { data: vc } = await db
    .from("variant_components")
    .select("variant_id, component_id, cantidad");

  if (vc?.length) {
    const { data: comps } = await db
      .from("components")
      .select("id, stock_real, origen");
    const stockComp = new Map((comps ?? []).map((x) => [x.id, x.stock_real]));
    const origenComp = new Map((comps ?? []).map((x) => [x.id, x.origen]));
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
      .select("id, stock_real, product_id")
      .in("id", [...porVar.keys()]);
    const { data: prods } = await db
      .from("products")
      .select("id, variantes_por_integrante");
    const esHolderProd = new Map(
      (prods ?? []).map((p) => [p.id, p.variantes_por_integrante]),
    );

    const pcCompsPorProd = new Map<string, Set<string>>();
    for (const v of vars ?? []) {
      for (const l of porVar.get(v.id) ?? []) {
        if (origenComp.get(l.component_id) !== "imprenta") continue;
        if (!pcCompsPorProd.has(v.product_id))
          pcCompsPorProd.set(v.product_id, new Set());
        pcCompsPorProd.get(v.product_id)!.add(l.component_id);
      }
    }
    const totalPcPorProd = new Map<string, number>();
    for (const [pid, set] of pcCompsPorProd) {
      let s = 0;
      for (const cid of set) s += stockComp.get(cid) ?? 0;
      totalPcPorProd.set(pid, s);
    }

    for (const v of vars ?? []) {
      const lines = porVar.get(v.id)!;
      // "producto = pieza" (ej. llavero suelto): stock = el de la pieza, se
      // carga una sola vez en la pieza.
      if (!esHolderProd.get(v.product_id)) {
        if (esVariantePieza(lines)) {
          const real = stockComp.get(lines[0].component_id) ?? 0;
          if (real !== v.stock_real)
            await db
              .from("product_variants")
              .update({ stock_real: real })
              .eq("id", v.id);
        }
        // los packs de mostacillas tienen BOM pero su stock (packs ya armados)
        // lo lleva Elias a mano; el BOM sólo alimenta el planificador.
        continue;
      }
      let real = Math.min(
        ...lines.map((l) =>
          Math.floor((stockComp.get(l.component_id) ?? 0) / (l.cantidad || 1)),
        ),
      );
      const tienePc = lines.some(
        (l) => origenComp.get(l.component_id) === "imprenta",
      );
      if (esHolderProd.get(v.product_id) && !tienePc)
        real = Math.min(real, totalPcPorProd.get(v.product_id) ?? 0);
      if (real !== v.stock_real)
        await db
          .from("product_variants")
          .update({ stock_real: real })
          .eq("id", v.id);
    }
  }

  const [{ data: allVars }, { data: prodsPI }, ventas] = await Promise.all([
    db
      .from("product_variants")
      .select(
        "id, stock_real, stock_ml, stock_minimo, product_id, group_member_id, etiqueta, es_eleccion",
      )
      .eq("activo", true),
    db.from("products").select("id, variantes_por_integrante"),
    ventasMulti(db, [7, 30]),
  ]);
  const esHolder = new Map(
    (prodsPI ?? []).map((p) => [p.id, p.variantes_por_integrante]),
  );
  const v7 = ventas.get(7)!;
  const v30 = ventas.get(30)!;

  const bomLinesVar = new Map<string, Array<{ component_id: string; cantidad: number }>>();
  for (const r of vc ?? []) {
    if (!bomLinesVar.has(r.variant_id)) bomLinesVar.set(r.variant_id, []);
    bomLinesVar.get(r.variant_id)!.push(r);
  }
  // "producto = pieza": su stock/mínimo lo lleva la pieza, no la variante.
  const esPieza = (vid: string, pid: string) =>
    !esHolder.get(pid) && esVariantePieza(bomLinesVar.get(vid));

  // "Qué se puede vender" de las variantes reales (no elección) de cada producto
  // simple → de ahí sale el stock que se le muestra a la variante "Random".
  const realPorProd = new Map<string, number>();
  for (const v of allVars ?? []) {
    if (v.es_eleccion || esHolder.get(v.product_id)) continue;
    realPorProd.set(
      v.product_id,
      (realPorProd.get(v.product_id) ?? 0) + Math.max(0, v.stock_real),
    );
  }

  const minimoVar = new Map<string, number>();
  for (const v of allVars ?? []) {
    const patch: Record<string, number> = {};

    // stock_real de la variante "Random" de un producto simple = suma de las
    // reales (no se edita a mano; los holders siguen su propio camino).
    const realEfectivo =
      v.es_eleccion && !esHolder.get(v.product_id)
        ? (realPorProd.get(v.product_id) ?? 0)
        : v.stock_real;
    if (v.es_eleccion && !esHolder.get(v.product_id) && realEfectivo !== v.stock_real)
      patch.stock_real = realEfectivo;

    // mínimo automático por ventas (las de elección no tienen mínimo propio).
    if (!v.es_eleccion) {
      const min = calcMinimo(
        v7.porVariante.get(v.id) ?? 0,
        v30.porVariante.get(v.id) ?? 0,
        v30.porProducto.get(v.product_id) ?? 0,
      );
      minimoVar.set(v.id, min);
      // Se persiste sólo en variantes de productos simples "de verdad". En
      // holders y en "producto = pieza" el mínimo lo lleva la pieza (ver abajo).
      if (
        !esHolder.get(v.product_id) &&
        !esPieza(v.id, v.product_id) &&
        min !== v.stock_minimo
      )
        patch.stock_minimo = min;
    }

    // buffer publicado en ML
    const buf = calcBuffer(realEfectivo);
    if (buf !== v.stock_ml) patch.stock_ml = buf;

    if (Object.keys(patch).length)
      await db
        .from("product_variants")
        .update(patch as Database["public"]["Tables"]["product_variants"]["Update"])
        .eq("id", v.id);
  }

  // mínimo de las piezas (cuerpos / llaveros / photocards) = demanda mínima que
  // arrastran las variantes que las consumen SIN armado (holders + "producto =
  // pieza"). Las piezas de packs (logos, letras, nombres) NO llevan mínimo:
  // Elias las imprime por pedido — el planificador ya calcula cuánto hace falta.
  const prodDeVar = new Map((allVars ?? []).map((v) => [v.id, v.product_id]));
  const arrastraMinimo = (vid: string) => {
    const pid = prodDeVar.get(vid);
    return !!pid && (esHolder.get(pid) || esPieza(vid, pid));
  };
  const { data: compsMin } = await db
    .from("components")
    .select("id, stock_minimo");
  const minimoComp = new Map<string, number>();
  for (const r of vc ?? []) {
    if (!arrastraMinimo(r.variant_id)) continue;
    const add = (minimoVar.get(r.variant_id) ?? 0) * (r.cantidad || 1);
    if (add) minimoComp.set(r.component_id, (minimoComp.get(r.component_id) ?? 0) + add);
  }
  for (const comp of compsMin ?? []) {
    const min = minimoComp.get(comp.id) ?? 0;
    if (min !== comp.stock_minimo)
      await db.from("components").update({ stock_minimo: min }).eq("id", comp.id);
  }
}

// ---------- descuento de stock al despachar / restaurar al cancelar ----------

interface ItemPedido {
  id: string;
  ml_item_id: string | null;
  ml_variation_id: string | null;
  titulo: string | null;
  cantidad: number;
  product_variant_id: string | null;
}

/** Resuelve la variante de catálogo de un ítem de pedido. */
async function resolverVariante(
  db: DB,
  it: ItemPedido,
): Promise<string | null> {
  if (it.product_variant_id) return it.product_variant_id;
  if (!it.ml_item_id) return null;

  const { data: listing } = await db
    .from("ml_listings")
    .select("id, product_id")
    .eq("ml_item_id", it.ml_item_id)
    .maybeSingle();
  if (!listing) return null;

  if (it.ml_variation_id) {
    const { data: lv } = await db
      .from("ml_listing_variations")
      .select("product_variant_id")
      .eq("ml_listing_id", listing.id)
      .eq("ml_variation_id", it.ml_variation_id)
      .maybeSingle();
    if (lv?.product_variant_id) return lv.product_variant_id;
  }

  // sin variación: variante única del producto ("Único" si existe)
  if (!listing.product_id) return null;
  const { data: vars } = await db
    .from("product_variants")
    .select("id, etiqueta, es_eleccion")
    .eq("product_id", listing.product_id)
    .eq("activo", true);
  if (!vars?.length) return null;
  if (vars.length === 1) return vars[0].id;
  const unico = vars.find((v) => v.etiqueta === "Único");
  if (unico) return unico.id;
  const noEleccion = vars.filter((v) => !v.es_eleccion);
  return noEleccion.length === 1 ? noEleccion[0].id : null;
}

async function sumarStockVariante(db: DB, variantId: string, delta: number) {
  const { data: v } = await db
    .from("product_variants")
    .select("stock_real")
    .eq("id", variantId)
    .maybeSingle();
  if (!v) return { antes: 0, despues: 0 };
  const despues = Math.max(0, v.stock_real + delta);
  await db
    .from("product_variants")
    .update({ stock_real: despues })
    .eq("id", variantId);
  return { antes: v.stock_real, despues };
}

async function sumarStockComponente(db: DB, componentId: string, delta: number) {
  const { data: c } = await db
    .from("components")
    .select("stock_real")
    .eq("id", componentId)
    .maybeSingle();
  if (!c) return;
  await db
    .from("components")
    .update({ stock_real: Math.max(0, c.stock_real + delta) })
    .eq("id", componentId);
}

export interface ResultadoDescuento {
  aplicados: number;
  avisos: string[];
}

/**
 * Ajusta el stock por un pedido: `signo = -1` descuenta (al despachar),
 * `signo = +1` devuelve (al cancelar). No toca Full (ML tiene ese stock).
 * Las ventas Random / sin mapear no se tocan: se devuelven como `avisos`.
 */
export async function ajustarStockPorPedido(
  db: DB,
  orderId: string,
  signo: -1 | 1,
): Promise<ResultadoDescuento> {
  const { data: items } = await db
    .from("ml_order_items")
    .select(
      "id, ml_item_id, ml_variation_id, titulo, cantidad, product_variant_id",
    )
    .eq("ml_order_id", orderId);

  const avisos: string[] = [];
  let aplicados = 0;

  for (const it of (items ?? []) as ItemPedido[]) {
    const qty = it.cantidad || 1;
    const variantId = await resolverVariante(db, it);
    if (!variantId) {
      avisos.push(`No pude identificar el producto de "${it.titulo ?? "?"}"`);
      continue;
    }
    if (!it.product_variant_id)
      await db
        .from("ml_order_items")
        .update({ product_variant_id: variantId })
        .eq("id", it.id);

    const { data: v } = await db
      .from("product_variants")
      .select("id, etiqueta, es_eleccion, product_id, products(nombre, variantes_por_integrante)")
      .eq("id", variantId)
      .maybeSingle();
    if (!v) {
      avisos.push(`No encontré la variante de "${it.titulo ?? "?"}"`);
      continue;
    }
    const prod = v.products as
      | { nombre?: string; variantes_por_integrante?: boolean }
      | null;
    const nombre = `${prod?.nombre ?? it.titulo ?? "?"}${v.etiqueta && v.etiqueta !== "Único" ? ` (${v.etiqueta})` : ""}`;

    if (v.es_eleccion) {
      avisos.push(
        `Venta "a elección" de ${nombre}: descontá a mano el que hayas mandado`,
      );
      continue;
    }

    const { data: lines } = await db
      .from("variant_components")
      .select("component_id, cantidad")
      .eq("variant_id", variantId);

    if (prod?.variantes_por_integrante) {
      if (!lines?.length) {
        avisos.push(`${nombre}: no tiene lista de materiales, descontá a mano`);
        continue;
      }
      for (const l of lines)
        await sumarStockComponente(
          db,
          l.component_id,
          signo * (l.cantidad || 1) * qty,
        );
      aplicados++;
      continue;
    }

    // "producto = pieza" (llavero suelto): el stock lo lleva la pieza
    if (lines && esVariantePieza(lines)) {
      await sumarStockComponente(db, lines[0].component_id, signo * qty);
      aplicados++;
      continue;
    }

    // variante simple / pack: se descuenta su propio stock_real
    const { antes, despues } = await sumarStockVariante(db, variantId, signo * qty);
    if (signo < 0 && antes < qty)
      avisos.push(
        `${nombre}: la venta dice ${qty} y figuraba ${antes} — quedó en ${despues}`,
      );
    aplicados++;
  }

  return { aplicados, avisos };
}

/** Deja un aviso en Inicio para que Elias ajuste stock a mano por un pedido. */
export async function avisarStockManual(
  db: DB,
  orderId: string,
  comprador: string | null,
  avisos: string[],
) {
  if (!avisos.length) return;
  await db
    .from("alerts")
    .delete()
    .eq("tipo", "venta_stock_manual")
    .eq("entidad_id", orderId)
    .is("resuelta_at", null);
  await db.from("alerts").insert({
    tipo: "venta_stock_manual",
    severidad: "warn",
    titulo: `Ajustá stock a mano por la venta de ${comprador ?? "un comprador"}`,
    detalle: avisos.slice(0, 3).join(" · "),
    entidad_tipo: "ml_order",
    entidad_id: orderId,
  } as Database["public"]["Tables"]["alerts"]["Insert"]);
}
