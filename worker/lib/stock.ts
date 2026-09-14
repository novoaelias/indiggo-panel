// Stock derivado + descuento de stock al despachar una venta.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { Env } from "../env";
import { mlFetch } from "./ml";
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

/** Para poder verificar más tarde si un aviso de stock manual ya se corrigió:
 *  qué variante quedó mal y en qué valor quedó (`trasIncidente`) — si ahora
 *  tiene más que eso, es que Elias ya la ajustó. */
export interface ChequeoStock {
  variantId: string;
  trasIncidente: number;
}

export interface ResultadoDescuento {
  aplicados: number;
  avisos: string[];
  chequeos: ChequeoStock[];
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
  const chequeos: ChequeoStock[] = [];
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
    if (signo < 0 && antes < qty) {
      avisos.push(
        `${nombre}: la venta dice ${qty} y figuraba ${antes} — quedó en ${despues}`,
      );
      chequeos.push({ variantId, trasIncidente: despues });
    }
    aplicados++;
  }

  return { aplicados, avisos, chequeos };
}

/** Deja un aviso en Inicio para que Elias ajuste stock a mano por un pedido.
 *  `chequeos` (si hay) queda guardado en la alerta para poder verificar más
 *  tarde, con datos reales, si ya se corrigió — ver resolverAlertaManual. */
export async function avisarStockManual(
  db: DB,
  orderId: string,
  comprador: string | null,
  avisos: string[],
  chequeos: ChequeoStock[] = [],
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
    meta: chequeos.length
      ? ({ chequeos } as unknown as Database["public"]["Tables"]["alerts"]["Insert"]["meta"])
      : null,
    entidad_tipo: "ml_order",
    entidad_id: orderId,
  } as Database["public"]["Tables"]["alerts"]["Insert"]);
}

export interface ResultadoResolverAlerta {
  resuelta: boolean;
  motivo?: string;
}

/**
 * Borra una alerta "venta_stock_manual" SOLO si se verifica que ya se
 * corrigió: para cada variante que quedó mal (guardada en `meta.chequeos` al
 * crear la alerta), el stock real actual tiene que ser mayor al que quedó
 * justo después del incidente — señal de que Elias ya lo contó/ajustó. Si
 * alguna variante sigue igual (o la alerta es de antes de este chequeo y no
 * tiene `meta`), no se borra: se devuelve el motivo para mostrarlo en el panel.
 */
export async function resolverAlertaManual(
  db: DB,
  alertaId: string,
): Promise<ResultadoResolverAlerta> {
  const { data: alerta } = await db
    .from("alerts")
    .select("id, tipo, meta, resuelta_at")
    .eq("id", alertaId)
    .maybeSingle();
  if (!alerta || alerta.tipo !== "venta_stock_manual")
    return { resuelta: false, motivo: "esta alerta no se puede verificar así" };
  if (alerta.resuelta_at) return { resuelta: true };

  const chequeos = (alerta.meta as { chequeos?: ChequeoStock[] } | null)
    ?.chequeos;
  if (!chequeos?.length)
    return {
      resuelta: false,
      motivo:
        "esta alerta es de antes de este chequeo automático — no puedo verificarla sola, revisá el stock a mano",
    };

  const { data: vars } = await db
    .from("product_variants")
    .select("id, etiqueta, stock_real, products(nombre)")
    .in(
      "id",
      chequeos.map((c) => c.variantId),
    );
  const porId = new Map((vars ?? []).map((v) => [v.id, v]));

  const sinCorregir = chequeos.filter((c) => {
    const v = porId.get(c.variantId);
    // si ya no existe la variante, no hay nada que verificar en contra
    return v ? v.stock_real <= c.trasIncidente : false;
  });

  if (sinCorregir.length) {
    const nombres = sinCorregir
      .map((c) => {
        const v = porId.get(c.variantId);
        const prod = v?.products as { nombre?: string } | null;
        return `${prod?.nombre ?? "?"}${v?.etiqueta && v.etiqueta !== "Único" ? ` (${v.etiqueta})` : ""}`;
      })
      .join(" · ");
    return {
      resuelta: false,
      motivo: `todavía no ajustaste el stock de: ${nombres}`,
    };
  }

  await db
    .from("alerts")
    .update({ resuelta_at: new Date().toISOString() })
    .eq("id", alertaId);
  return { resuelta: true };
}

// ---------- push automático del buffer de ML (nunca dejar una publicación en 0) ----------

/** Cantidad publicada AHORA en ML (mirror), por variante y por producto simple sin
 *  variantes — sólo de publicaciones activas. Se compara contra `stock_ml` para
 *  saber qué hay que empujar. */
export async function publicadoEnML(db: DB) {
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

/** Resuelve una variante interna a TODAS sus publicaciones/variaciones de ML
 *  ACTIVAS. Una variante puede corresponder a varias publicaciones (grupo de
 *  publicaciones duplicadas por cuotas): el buffer se publica a todas. */
async function resolverMLTodas(
  db: DB,
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

export interface ResultadoSincronizacionML {
  pendientes: number;
  publicados: number;
  errores: string[];
  items_tocados: string[];
}

/**
 * Recalcula el buffer automático (`recalcularDerivado`) y empuja a Mercado
 * Libre el `available_quantity` de toda variante desincronizada, para que
 * ninguna publicación quede publicada en 0 (lo que hace que ML deje de
 * recomendarla) mientras Elias repone stock real. Se llama sola en cada sync
 * (cron horario + webhook de pedidos) además del botón manual en Stock — así
 * Elias no tiene que entrar al panel para que el buffer se aplique.
 * Los productos `descontinuado` se excluyen: no se les empuja stock porque
 * Elias ya no los repone (la publicación puede seguir viva porque ML no la
 * deja borrar, pero no hay que simular que tiene stock).
 */
export async function sincronizarStockML(
  env: Env,
  db: DB,
  opts?: { onItemTocado?: (itemId: string) => Promise<void> },
): Promise<ResultadoSincronizacionML> {
  await recalcularDerivado(db);

  const { data: vars } = await db
    .from("product_variants")
    .select("id, stock_ml, product_id, products(descontinuado)")
    .eq("activo", true);

  const { porVar: mlPorVar, porProd: mlPorProd } = await publicadoEnML(db);

  const pendientes = (vars ?? []).filter((v) => {
    if ((v.products as { descontinuado?: boolean } | null)?.descontinuado)
      return false;
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
      const r = await mlFetch(env, db, path, {
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

  if (opts?.onItemTocado) {
    for (const it of itemsTocados) {
      await opts.onItemTocado(it).catch(() => {});
    }
  }

  return {
    pendientes: pendientes.length,
    publicados: ok,
    errores,
    items_tocados: [...itemsTocados],
  };
}
