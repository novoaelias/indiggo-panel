// Colchón publicado en ML + alta de alertas de stock manual heredadas.
// Los movimientos físicos viven en las operaciones de inventario (Postgres).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { Env } from "../env";
import { mlFetch } from "./ml";
import { calcBuffer, calcMinimo, ventasMulti } from "./bom";
import { estadoEnvio } from "./shipping";
import {
  armablesPorReceta,
  disponibleComercial,
  topeEleccion,
} from "./inventory-logic";

type DB = SupabaseClient<Database>;

// Recalcula lo único que sigue siendo derivado: `product_variants.stock_ml`, el
// colchón que se publica en Mercado Libre. `stock_real` ya no se deriva de nada
// (es la cantidad terminada y sólo la mueven las operaciones de inventario).
export async function recalcularDerivado(db: DB) {
  // El colchón es comercial, no físico: se calcula sobre lo que se puede
  // entregar de esa variante = terminados libres de reservas + lo que se puede
  // armar con las piezas que hay, menos lo ya comprometido en pedidos sin
  // terminado. El reparto de piezas compartidas sin contarlas dos veces vive en
  // las sugerencias de armado, no acá.
  const [{ data: vars }, { data: recetas }, { data: piezas }, { data: reservas }, ventas] =
    await Promise.all([
      db
        .from("product_variants")
        .select("id, product_id, stock_real, stock_ml, stock_minimo, es_eleccion")
        .eq("activo", true),
      db.from("variant_components").select("variant_id, component_id, cantidad"),
      db.from("components").select("id, stock_real"),
      db
        .from("inventory_reservations")
        .select("product_variant_id, reserved_qty, missing_qty")
        .eq("estado", "activa"),
      ventasMulti(db, [7, 30]),
    ]);

  const stockPieza = new Map((piezas ?? []).map((p) => [p.id, p.stock_real]));
  const recetaPorVariante = new Map<
    string,
    Array<{ component_id: string; cantidad: number }>
  >();
  for (const r of recetas ?? []) {
    const lineas = recetaPorVariante.get(r.variant_id) ?? [];
    lineas.push({ component_id: r.component_id, cantidad: r.cantidad });
    recetaPorVariante.set(r.variant_id, lineas);
  }
  const reservadas = new Map<string, number>();
  const faltantes = new Map<string, number>();
  for (const r of reservas ?? []) {
    reservadas.set(
      r.product_variant_id,
      (reservadas.get(r.product_variant_id) ?? 0) + r.reserved_qty,
    );
    faltantes.set(
      r.product_variant_id,
      (faltantes.get(r.product_variant_id) ?? 0) + (r.missing_qty ?? 0),
    );
  }

  // Mínimo sugerido por ventas: ordena qué conviene reponer primero. Es una
  // señal comercial, no una cantidad física: no toca terminados ni piezas.
  const v7 = ventas.get(7);
  const v30 = ventas.get(30);
  if (v7 && v30)
    for (const v of vars ?? []) {
      if (v.es_eleccion) continue;
      const min = calcMinimo(
        v7.porVariante.get(v.id) ?? 0,
        v30.porVariante.get(v.id) ?? 0,
        v30.porProducto.get(v.product_id) ?? 0,
      );
      if (min !== v.stock_minimo)
        await db
          .from("product_variants")
          .update({ stock_minimo: min })
          .eq("id", v.id);
    }

  const variantesPorProducto = new Map<string, typeof vars>();
  for (const v of vars ?? []) {
    const arr = variantesPorProducto.get(v.product_id) ?? [];
    arr.push(v);
    variantesPorProducto.set(v.product_id, arr);
  }

  for (const v of vars ?? []) {
    const receta = recetaPorVariante.get(v.id) ?? [];
    let armables = armablesPorReceta(receta, stockPieza);
    if (v.es_eleccion && receta.length) {
      const hermanas = (variantesPorProducto.get(v.product_id) ?? [])
        .filter((x) => x.id !== v.id && !x.es_eleccion)
        .map((x) => recetaPorVariante.get(x.id) ?? []);
      const tope = topeEleccion(receta, hermanas, stockPieza);
      if (tope != null) armables = Math.min(armables, tope);
    }
    const disponible = disponibleComercial({
      terminados: v.stock_real,
      reservados: reservadas.get(v.id) ?? 0,
      armables,
      faltantes: faltantes.get(v.id) ?? 0,
    });
    const buffer = calcBuffer(disponible);
    if (buffer !== v.stock_ml)
      await db.from("product_variants").update({ stock_ml: buffer }).eq("id", v.id);
  }
}


/** Para poder verificar más tarde si un aviso de stock manual ya se corrigió:
 *  qué variante quedó mal y en qué valor quedó (`trasIncidente`) — si ahora
 *  tiene más que eso, es que Elias ya la ajustó. */
export interface ChequeoStock {
  variantId: string;
  trasIncidente: number;
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

/**
 * Publicaciones a las que el panel les mantiene el stock: las activas y las que
 * ML pausó SÓLO porque se quedaron en 0 (`out_of_stock`). Esas últimas son
 * justamente las que hay que reponer: si se las ignora, una venta que vacía la
 * publicación la deja pausada para siempre (le pasó al holder de Katseye y al
 * pack de 110 lila). Una pausada por Elias o por otro motivo de ML no se toca.
 */
export function recibeStock(estado: string | null, subStatus: unknown): boolean {
  if (estado === "active") return true;
  if (estado !== "paused") return false;
  const subs = Array.isArray(subStatus) ? subStatus : [];
  return subs.length > 0 && subs.every((s) => s === "out_of_stock");
}

/** Cantidad publicada AHORA en ML (mirror), por variante y por producto simple sin
 *  variantes — de las publicaciones que reciben stock (`recibeStock`). Se compara contra `stock_ml` para
 *  saber qué hay que empujar. */
export async function publicadoEnML(db: DB) {
  const [{ data: mlvs }, { data: mls }] = await Promise.all([
    db
      .from("ml_listing_variations")
      .select("ml_listing_id, product_variant_id, cantidad_ml"),
    db
      .from("ml_listings")
      .select(
        "id, product_id, product_variant_id, cantidad_ml, tiene_variantes, estado, sub_status:raw->sub_status",
      ),
  ]);
  const activas = new Set(
    (mls ?? []).filter((m) => recibeStock(m.estado, m.sub_status)).map((m) => m.id),
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
    if (m.tiene_variantes || !activas.has(m.id)) continue;
    // Una publicación simple ya ligada a su variante se compara contra esa
    // variante: dentro de un producto puede haber un color por publicación.
    if (m.product_variant_id) {
      const arr = porVar.get(m.product_variant_id) ?? [];
      arr.push(m.cantidad_ml ?? 0);
      porVar.set(m.product_variant_id, arr);
      continue;
    }
    if (!m.product_id) continue;
    const arr = porProd.get(m.product_id) ?? [];
    arr.push(m.cantidad_ml ?? 0);
    porProd.set(m.product_id, arr);
  }
  return { porVar, porProd };
}

/** Una publicación (o variación) de ML a la que se le empuja el stock. */
interface RefML {
  itemId: string;
  variationId: string | null;
  userProductId: string | null;
  /** ML la pausó por quedar en 0: después de reponer hay que verificar que
   *  vuelva a estar activa. */
  pausadaSinStock: boolean;
}

function refDesde(
  l: { ml_item_id?: string | null; estado?: string | null; raw?: unknown } | null,
  variationId: string | null,
): RefML | null {
  if (!l?.ml_item_id) return null;
  const raw = (l.raw && typeof l.raw === "object" ? l.raw : {}) as {
    user_product_id?: unknown;
    inventory_id?: unknown;
    sub_status?: unknown;
  };
  const estado = l.estado ?? null;
  if (!recibeStock(estado, raw.sub_status)) return null;
  const userProductId = raw.user_product_id ?? raw.inventory_id;
  return {
    itemId: l.ml_item_id,
    variationId,
    userProductId: userProductId ? String(userProductId) : null,
    pausadaSinStock: estado !== "active",
  };
}

/** Resuelve una variante interna a TODAS sus publicaciones/variaciones de ML
 *  que reciben stock (`recibeStock`). Una variante puede corresponder a varias
 *  publicaciones (grupo de publicaciones duplicadas por cuotas): el buffer se
 *  publica a todas. */
async function resolverMLTodas(db: DB, variantId: string): Promise<RefML[]> {
  const { data: mlvs } = await db
    .from("ml_listing_variations")
    .select("ml_variation_id, ml_listings(ml_item_id, estado, raw)")
    .eq("product_variant_id", variantId);

  const refs = (mlvs ?? [])
    .map((v) =>
      refDesde(
        v.ml_listings as { ml_item_id?: string; estado?: string; raw?: unknown } | null,
        v.ml_variation_id,
      ),
    )
    .filter((x): x is RefML => x != null);
  if (refs.length) return refs;

  // Publicaciones sin variaciones ligadas a ESTA variante. Un producto puede
  // tener una publicación por color (el pack de 110 en rojo, negro y lila), así
  // que empujar por producto haría que un color pisara el stock del otro.
  const { data: propias } = await db
    .from("ml_listings")
    .select("ml_item_id,estado,raw")
    .eq("product_variant_id", variantId)
    .in("estado", ["active", "paused"]);

  let mls = propias ?? [];
  if (!mls.length) {
    // Compatibilidad: publicaciones del producto que todavía no tienen variante
    // asignada (recién sincronizadas, antes de derivar el catálogo).
    const { data: pv } = await db
      .from("product_variants")
      .select("product_id")
      .eq("id", variantId)
      .single();
    if (!pv) return [];
    const { data: sueltas } = await db
      .from("ml_listings")
      .select("ml_item_id,estado,raw")
      .eq("product_id", pv.product_id)
      .in("estado", ["active", "paused"])
      .is("product_variant_id", null);
    mls = sueltas ?? [];
  }
  return mls.map((m) => refDesde(m, null)).filter((x): x is RefML => x != null);
}

/**
 * ML suele reactivar sola una publicación pausada por falta de stock cuando
 * vuelve a tener cantidad, pero no siempre lo hace al instante (y con User
 * Products a veces no lo hace). Si sigue pausada SÓLO por `out_of_stock`, se
 * reactiva explícitamente, siempre que siga en Mercado Envíos sin Flex.
 * Devuelve un error legible o null.
 */
async function reactivarSiPausadaSinStock(
  env: Env,
  db: DB,
  itemId: string,
): Promise<string | null> {
  const r = await mlFetch(
    env,
    db,
    `/items/${itemId}?attributes=id,status,sub_status,shipping`,
  );
  if (!r.ok) return `${itemId}: no se pudo leer para reactivar (${r.status})`;
  const item = (await r.json()) as Parameters<typeof estadoEnvio>[0] & {
    status?: string;
    sub_status?: unknown;
  };
  if (item?.status === "active") return null;
  if (!recibeStock(item?.status ?? null, item?.sub_status)) return null;
  const envio = estadoEnvio(item);
  if (!envio.ok) return `${itemId}: no se reactiva, ${envio.detalle ?? "envío sin verificar"}`;
  const put = await mlFetch(env, db, `/items/${itemId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "active" }),
  });
  if (put.ok) return null;
  const error = (await put.text()).slice(0, 100);
  // ML reactiva sola en segundo plano: si ganó la carrera, el PUT rebota con
  // item.status.invalid pero la publicación ya está activa.
  const despues = await mlFetch(env, db, `/items/${itemId}?attributes=id,status`);
  if (despues.ok && ((await despues.json()) as { status?: string }).status === "active")
    return null;
  return `${itemId}: no se pudo reactivar: ${error}`;
}

interface StockLocation {
  type: "seller_warehouse" | "selling_address" | "meli_facility" | string;
  store_id?: string | number;
  network_node_id?: string | number;
  quantity?: number;
}

export function distribuirStock(total: number, locations: StockLocation[]): StockLocation[] {
  if (!locations.length) return [];
  const actual = locations.reduce((sum, location) => sum + Math.max(0, Number(location.quantity || 0)), 0);
  let asignado = 0;
  return locations.map((location, index) => {
    const quantity =
      index === locations.length - 1
        ? Math.max(0, total - asignado)
        : actual > 0
          ? Math.floor((Math.max(0, Number(location.quantity || 0)) / actual) * total)
          : index === 0
            ? total
            : 0;
    asignado += quantity;
    return {
      store_id: location.store_id,
      network_node_id: location.network_node_id,
      quantity,
      type: location.type,
    };
  });
}

async function actualizarStockUserProduct(
  env: Env,
  db: DB,
  userProductId: string,
  cantidad: number,
): Promise<{ handled: boolean; ok: boolean; error?: string }> {
  for (let intento = 0; intento < 2; intento++) {
    const current = await mlFetch(env, db, `/user-products/${userProductId}/stock`);
    if (!current.ok) return { handled: false, ok: false };
    const version = current.headers.get("x-version");
    const body = (await current.json()) as { locations?: StockLocation[] };
    const locations = body.locations ?? [];
    const warehouses = locations.filter((location) => location.type === "seller_warehouse");
    const sellingAddress = locations.find((location) => location.type === "selling_address");
    if (!version) return { handled: true, ok: false, error: "Mercado Libre no informó x-version" };

    const tipo = warehouses.length ? "seller_warehouse" : sellingAddress ? "selling_address" : null;
    if (!tipo)
      return {
        handled: true,
        ok: false,
        error: "el User Product sólo tiene stock administrado por Mercado Libre",
      };
    const payload =
      tipo === "seller_warehouse"
        ? {
            locations: distribuirStock(cantidad, warehouses).map(({ store_id, network_node_id, quantity }) => ({
              store_id,
              network_node_id,
              quantity,
            })),
          }
        : { quantity: cantidad };
    const update = await mlFetch(
      env,
      db,
      `/user-products/${userProductId}/stock/type/${tipo}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", "x-version": version },
        body: JSON.stringify(payload),
      },
    );
    if (update.ok) return { handled: true, ok: true };
    if (update.status === 409 && intento === 0) continue;
    return { handled: true, ok: false, error: (await update.text()).slice(0, 120) };
  }
  return { handled: true, ok: false, error: "conflicto de versión al actualizar stock" };
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
  const aReactivar = new Set<string>();
  const userProductsEnCurso = new Map<
    string,
    Promise<{ handled: boolean; ok: boolean; error?: string }>
  >();

  const empujar = async (v: { id: string; stock_ml: number }) => {
    const refs = await resolverMLTodas(db, v.id);
    if (!refs.length) return;
    let algunoOk = false;
    for (const ref of refs) {
      if (ref.userProductId) {
        let promesa = userProductsEnCurso.get(ref.userProductId);
        if (!promesa) {
          promesa = actualizarStockUserProduct(env, db, ref.userProductId, v.stock_ml);
          userProductsEnCurso.set(ref.userProductId, promesa);
        }
        const up = await promesa;
        if (up.handled) {
          if (up.ok) {
            algunoOk = true;
            itemsTocados.add(ref.itemId);
            if (ref.pausadaSinStock && v.stock_ml > 0) aReactivar.add(ref.itemId);
          } else {
            errores.push(`${ref.userProductId}: ${up.error ?? "no se pudo actualizar"}`);
          }
          continue;
        }
      }
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
        if (ref.pausadaSinStock && v.stock_ml > 0) aReactivar.add(ref.itemId);
      } else {
        errores.push(`${ref.itemId}: ${(await r.text()).slice(0, 100)}`);
      }
    }
    if (algunoOk) ok++;
  };

  const lote = pendientes.slice(0, 80);
  for (let i = 0; i < lote.length; i += 5)
    await Promise.all(lote.slice(i, i + 5).map(empujar));

  // Recién después de reponer: ML no reactiva una publicación que sigue en 0.
  for (const itemId of aReactivar) {
    const error = await reactivarSiPausadaSinStock(env, db, itemId).catch(
      (e) => `${itemId}: ${(e as Error).message}`,
    );
    if (error) errores.push(error);
  }

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
