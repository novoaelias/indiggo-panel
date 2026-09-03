// Trae a Supabase toda la información de la cuenta de MercadoLibre:
// datos del vendedor, publicaciones (con variantes) y pedidos recientes.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type { Env } from "../env";
import { getToken, mlFetch } from "./ml";
import { regenerarAlertas } from "./alertas";
import { derivarCatalogo } from "./derivar";
import { derivarBOM } from "./bom";
import { appendEnvioFlex, sheetsConfigurado } from "./sheets";
import { envioTerminado } from "./envios";
import { fechaRepartoAR } from "./fecha";
import {
  ajustarStockPorPedido,
  avisarStockManual,
  recalcularDerivado,
} from "./stock";

type DB = SupabaseClient<Database>;

export interface SyncResult {
  vendedor?: string;
  publicaciones: number;
  variantes: number;
  pedidos: number;
  errores: string[];
}

async function mlJson<T>(
  env: Env,
  db: DB,
  path: string,
): Promise<T> {
  const res = await mlFetch(env, db, path);
  if (!res.ok) {
    throw new Error(`GET ${path} → ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

async function seguro<T>(
  errores: string[],
  etiqueta: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    errores.push(`${etiqueta}: ${(e as Error).message}`);
    return undefined;
  }
}

// ---------- vendedor ----------
async function syncVendedor(env: Env, db: DB) {
  const me = await mlJson<{ id: number; nickname: string }>(
    env,
    db,
    "/users/me",
  );
  const row = await getToken(db);
  const meta = {
    ...(typeof row?.meta === "object" && row?.meta ? row.meta : {}),
    user_id: me.id,
    nickname: me.nickname,
  };
  await db
    .from("integrations")
    .update({ meta: meta as Json })
    .eq("provider", "mercadolibre");
  return me;
}

// ---------- publicaciones ----------
interface MlItem {
  id: string;
  title: string;
  status: string;
  price: number | null;
  currency_id: string;
  available_quantity: number | null;
  permalink: string | null;
  thumbnail: string | null;
  secure_thumbnail: string | null;
  last_updated: string | null;
  variations?: Array<{
    id: number | string;
    price: number | null;
    available_quantity: number | null;
    attribute_combinations?: unknown;
  }>;
}

async function upsertItem(db: DB, it: MlItem): Promise<void> {
  const { data: listing, error } = await db
    .from("ml_listings")
    .upsert(
      {
        ml_item_id: it.id,
        titulo: it.title,
        estado: it.status,
        precio: it.price,
        moneda: it.currency_id ?? "ARS",
        cantidad_ml: it.available_quantity,
        permalink: it.permalink,
        thumbnail: (it.secure_thumbnail ?? it.thumbnail)?.replace(
          /^http:/,
          "https:",
        ),
        tiene_variantes: (it.variations?.length ?? 0) > 0,
        ml_actualizado_at: it.last_updated,
        sincronizado_at: new Date().toISOString(),
        raw: it as unknown as Database["public"]["Tables"]["ml_listings"]["Insert"]["raw"],
      },
      { onConflict: "ml_item_id" },
    )
    .select("id")
    .single();
  if (error || !listing) throw new Error(`listing ${it.id}: ${error?.message}`);

  const vigentes: string[] = [];
  for (const v of it.variations ?? []) {
    vigentes.push(String(v.id));
    await db.from("ml_listing_variations").upsert(
      {
        ml_listing_id: listing.id,
        ml_variation_id: String(v.id),
        combinacion:
          v.attribute_combinations as Database["public"]["Tables"]["ml_listing_variations"]["Insert"]["combinacion"],
        cantidad_ml: v.available_quantity,
        precio: v.price,
      },
      { onConflict: "ml_listing_id,ml_variation_id" },
    );
  }
  // borrar variaciones que ML ya no reporta (evita empujar buffer a un
  // ml_variation_id inexistente en cada sync)
  let stale = db
    .from("ml_listing_variations")
    .delete()
    .eq("ml_listing_id", listing.id);
  if (vigentes.length) stale = stale.not("ml_variation_id", "in", `(${vigentes.join(",")})`);
  await stale;
}

/** Sincroniza una sola publicación (usado por el webhook de notificaciones). */
export async function syncOneItem(
  env: Env,
  db: DB,
  itemId: string,
): Promise<void> {
  const res = await mlFetch(env, db, `/items/${itemId}?include_attributes=all`);
  if (!res.ok) throw new Error(`GET /items/${itemId} → ${res.status}`);
  await upsertItem(db, (await res.json()) as MlItem);
}

async function scanItemIds(
  env: Env,
  db: DB,
  userId: number,
): Promise<string[]> {
  const ids: string[] = [];
  let scroll: string | undefined;
  for (let i = 0; i < 200; i++) {
    const qs = new URLSearchParams({ search_type: "scan", limit: "100" });
    if (scroll) qs.set("scroll_id", scroll);
    const page = await mlJson<{ results: string[]; scroll_id?: string }>(
      env,
      db,
      `/users/${userId}/items/search?${qs}`,
    );
    ids.push(...(page.results ?? []));
    if (!page.results?.length || !page.scroll_id) break;
    scroll = page.scroll_id;
  }
  return ids;
}

async function syncPublicaciones(
  env: Env,
  db: DB,
  userId: number,
  errores: string[],
): Promise<{ publicaciones: number; variantes: number }> {
  const ids = await scanItemIds(env, db, userId);
  let publicaciones = 0;
  let variantes = 0;

  for (let i = 0; i < ids.length; i += 20) {
    const lote = ids.slice(i, i + 20);
    const multi = await seguro(errores, `items ${i}`, () =>
      mlJson<Array<{ code: number; body: MlItem }>>(
        env,
        db,
        `/items?ids=${lote.join(",")}&include_attributes=all`,
      ),
    );
    if (!multi) continue;

    for (const entry of multi) {
      if (entry.code !== 200 || !entry.body?.id) continue;
      try {
        await upsertItem(db, entry.body);
        publicaciones++;
        variantes += entry.body.variations?.length ?? 0;
      } catch (e) {
        errores.push((e as Error).message);
      }
    }
  }
  return { publicaciones, variantes };
}

// ---------- pedidos ----------
interface MlOrder {
  id: number;
  status: string;
  date_created: string;
  total_amount: number | null;
  buyer?: { nickname?: string };
  shipping?: { id?: number | string; status?: string };
  tags?: string[];
  order_items?: Array<{
    item?: { id?: string; variation_id?: number | string; title?: string };
    quantity?: number;
    unit_price?: number;
  }>;
}

interface MlShipment {
  id: number;
  status?: string;
  substatus?: string | null;
  logistic_type?: string | null;
  shipping_option?: { name?: string };
  receiver_address?: {
    address_line?: string | null;
    street_name?: string | null;
    street_number?: string | null;
    city?: { name?: string | null } | null;
    state?: { name?: string | null } | null;
    municipality?: { name?: string | null } | null;
    neighborhood?: { name?: string | null } | null;
    comment?: string | null;
    zip_code?: string | null;
  } | null;
}

async function upsertOrder(
  db: DB,
  o: MlOrder,
): Promise<{ id: string; shippingId: string | null }> {
  const { data: order, error } = await db
    .from("ml_orders")
    .upsert(
      {
        ml_order_id: String(o.id),
        estado: o.status,
        estado_envio: o.shipping?.status ?? null,
        fecha: o.date_created,
        total: o.total_amount,
        comprador: o.buyer?.nickname ?? null,
        raw: o as unknown as Database["public"]["Tables"]["ml_orders"]["Insert"]["raw"],
      },
      { onConflict: "ml_order_id" },
    )
    .select("id")
    .single();
  if (error || !order) throw new Error(`order ${o.id}: ${error?.message}`);

  await db.from("ml_order_items").delete().eq("ml_order_id", order.id);
  const items = (o.order_items ?? []).map((li) => ({
    ml_order_id: order.id,
    ml_item_id: li.item?.id ?? null,
    ml_variation_id:
      li.item?.variation_id != null ? String(li.item.variation_id) : null,
    titulo: li.item?.title ?? null,
    cantidad: li.quantity ?? 1,
    precio_unitario: li.unit_price ?? null,
  }));
  if (items.length) await db.from("ml_order_items").insert(items);

  const shippingId = o.shipping?.id != null ? String(o.shipping.id) : null;
  return { id: order.id, shippingId };
}

// El tipo de logística (Flex / Mercado Envíos / Full) y el estado real del envío
// no vienen en el pedido: hay que pedir el shipment aparte.
export async function syncEnvio(
  env: Env,
  db: DB,
  ref: { id: string; shippingId: string | null; status: string },
): Promise<void> {
  if (!ref.shippingId || ref.status !== "paid") return;
  const res = await mlFetch(env, db, `/shipments/${ref.shippingId}`);
  if (!res.ok) return; // envíos Full o sin permiso: se ignora en silencio
  const s = (await res.json()) as MlShipment;
  await db
    .from("ml_orders")
    .update({
      logistic_type: s.logistic_type ?? null,
      estado_envio: s.status ?? null,
      envio_substatus: s.substatus ?? null,
      envio_sync_at: new Date().toISOString(),
    } as Database["public"]["Tables"]["ml_orders"]["Update"])
    .eq("id", ref.id);

  // Flex: al pedido nuevo se le agrega una fila en la planilla de reparto.
  if (s.logistic_type === "self_service") {
    await registrarEnvioFlex(env, db, ref.id, s).catch((e) =>
      console.error("[sheets] flex", (e as Error).message),
    );
  }

  // Al despachar (envío shipped/delivered) se descuenta el stock de la venta,
  // una sola vez. Full no: ese stock lo tiene ML, no Elias.
  if (
    (s.status === "shipped" || s.status === "delivered") &&
    s.logistic_type !== "fulfillment"
  ) {
    await descontarPorDespacho(db, ref.id).catch((e) =>
      console.error("[stock] despacho", (e as Error).message),
    );
  }
}

/**
 * Descuenta el stock de una venta al despachar, **una sola vez**. Sirve tanto al
 * sync automático (webhook/cron) como al botón "despachar" del panel.
 * `ya: true` = otra ejecución ya lo había descontado.
 */
export async function descontarPorDespacho(
  db: DB,
  orderId: string,
): Promise<{ ya: boolean; aplicados: number; avisos: string[] }> {
  const { data: o } = await db
    .from("ml_orders")
    .select("comprador")
    .eq("id", orderId)
    .maybeSingle();
  if (!o) return { ya: true, aplicados: 0, avisos: [] };

  // Claim atómico: ML manda varias notificaciones de "shipped", el cron corre en
  // paralelo y Elias puede tocar "despachar" a mano al mismo tiempo. El
  // UPDATE ... WHERE stock_descontado_at IS NULL lo serializa Postgres: solo una
  // ejecución se lleva la fila, las demás salen. Sin esto se descontaba el stock
  // dos (o más) veces por la misma venta.
  const { data: claim } = await db
    .from("ml_orders")
    .update({
      stock_descontado_at: new Date().toISOString(),
    } as Database["public"]["Tables"]["ml_orders"]["Update"])
    .eq("id", orderId)
    .is("stock_descontado_at", null)
    .select("id");
  if (!claim || claim.length === 0) return { ya: true, aplicados: 0, avisos: [] };

  let aplicados = 0;
  let avisos: string[] = [];
  try {
    ({ aplicados, avisos } = await ajustarStockPorPedido(db, orderId, -1));
  } catch (e) {
    // no se pudo tocar el stock: soltar el claim para reintentar en el próximo sync
    await db
      .from("ml_orders")
      .update({
        stock_descontado_at: null,
      } as Database["public"]["Tables"]["ml_orders"]["Update"])
      .eq("id", orderId);
    throw e;
  }
  await avisarStockManual(
    db,
    orderId,
    (o as { comprador?: string | null }).comprador ?? null,
    avisos,
  );
  return { ya: false, aplicados, avisos };
}

/** Si un pedido ya despachado se cancela, se devuelve el stock. */
async function restaurarSiCancelado(
  db: DB,
  orderId: string,
  estado: string,
): Promise<void> {
  if (estado !== "cancelled") return;

  // Claim atómico a la inversa: pasar stock_descontado_at de "no null" a null.
  // Solo una ejecución se lleva la fila → el stock se devuelve una sola vez.
  const { data: claim } = await db
    .from("ml_orders")
    .update({
      stock_descontado_at: null,
    } as Database["public"]["Tables"]["ml_orders"]["Update"])
    .eq("id", orderId)
    .not("stock_descontado_at", "is", null)
    .select("id");
  if (!claim || claim.length === 0) return;

  try {
    await ajustarStockPorPedido(db, orderId, 1);
  } catch (e) {
    // no se pudo devolver: re-marcar para reintentar en el próximo sync
    await db
      .from("ml_orders")
      .update({
        stock_descontado_at: new Date().toISOString(),
      } as Database["public"]["Tables"]["ml_orders"]["Update"])
      .eq("id", orderId);
    throw e;
  }
}

// Agrega el envío Flex a la planilla "INDIGGO" (una sola vez). El bloque del día
// sale de fechaRepartoAR: lo vendido a partir de las 10:00 AR va al día siguiente.
// Un mismo envío (pack con varios pedidos) = una sola fila. Si ya salió, no se agrega.
async function registrarEnvioFlex(
  env: Env,
  db: DB,
  orderId: string,
  s: MlShipment,
): Promise<void> {
  if (!sheetsConfigurado(env)) return;
  if (envioTerminado(s.status)) return; // despachado / entregado: no es reparto pendiente

  const { data: row } = await db
    .from("ml_orders")
    .select("sheet_synced_at, fecha, raw")
    .eq("id", orderId)
    .maybeSingle();
  if (!row || (row as { sheet_synced_at?: string }).sheet_synced_at) return;

  const envioId = String(s.id);

  // ¿Otro pedido del mismo envío ya está en la planilla? Entonces solo marcar
  // este pedido (los packs se arman de a un pedido por vez) y no escribir otra fila.
  const { data: hermano } = await db
    .from("ml_orders")
    .select("id")
    .filter("raw->shipping->>id", "eq", envioId)
    .not("sheet_synced_at", "is", null)
    .limit(1)
    .maybeSingle();
  if (hermano) {
    await db
      .from("ml_orders")
      .update({
        sheet_synced_at: new Date().toISOString(),
      } as Database["public"]["Tables"]["ml_orders"]["Update"])
      .eq("id", orderId);
    return;
  }

  // Claim atómico: ML manda varias notificaciones por venta (orders, orders_v2,
  // shipments) y el cron corre en paralelo. Sin esto, dos ejecuciones pasaban el
  // chequeo de arriba a la vez y escribían la misma dirección dos veces.
  // El UPDATE ... WHERE sheet_synced_at IS NULL lo serializa Postgres: solo una
  // ejecución se lleva filas; las demás reciben [] y salen.
  const marcado = new Date().toISOString();
  const { data: claim } = await db
    .from("ml_orders")
    .update({
      sheet_synced_at: marcado,
    } as Database["public"]["Tables"]["ml_orders"]["Update"])
    .filter("raw->shipping->>id", "eq", envioId)
    .is("sheet_synced_at", null)
    .select("id");
  const ids = (claim ?? []).map((c) => (c as { id: string }).id);
  if (ids.length === 0) return; // otra ejecución ya tomó este envío

  const soltarClaim = () =>
    db
      .from("ml_orders")
      .update({
        sheet_synced_at: null,
      } as Database["public"]["Tables"]["ml_orders"]["Update"])
      .in("id", ids);

  const a = s.receiver_address ?? {};
  const direccion = (
    a.address_line ||
    [a.street_name, a.street_number].filter((x) => x && x !== "SN").join(" ")
  )?.trim();
  const localidad = (
    a.city?.name ||
    a.municipality?.name ||
    a.neighborhood?.name ||
    a.state?.name ||
    ""
  )?.trim();
  // sin datos de dirección todavía: se suelta el claim y se reintenta en el próximo sync
  if (!direccion && !localidad) {
    await soltarClaim();
    return;
  }

  try {
    await appendEnvioFlex(env, {
      direccion: direccion || "",
      localidad: localidad || "",
      fechaAR: fechaRepartoAR((row as { fecha: string }).fecha),
    });
  } catch (e) {
    await soltarClaim();
    throw e;
  }
}

/** Sincroniza un solo pedido (usado por el webhook de notificaciones). */
export async function syncOneOrder(
  env: Env,
  db: DB,
  orderId: string,
): Promise<void> {
  const res = await mlFetch(env, db, `/orders/${orderId}`);
  if (!res.ok) throw new Error(`GET /orders/${orderId} → ${res.status}`);
  const o = (await res.json()) as MlOrder;
  const { id, shippingId } = await upsertOrder(db, o);
  await syncEnvio(env, db, { id, shippingId, status: o.status }).catch(() => {});
  await restaurarSiCancelado(db, id, o.status).catch(() => {});
  await recalcularDerivado(db).catch(() => {});
}

async function syncPedidos(
  env: Env,
  db: DB,
  userId: number,
  errores: string[],
  desdeDias = 60,
): Promise<number> {
  const desde = new Date(
    Date.now() - desdeDias * 24 * 3600 * 1000,
  ).toISOString();
  let total = 0;
  const activos: Array<{ id: string; shippingId: string | null; status: string }> = [];
  for (let offset = 0; offset < 2000; offset += 50) {
    const qs = new URLSearchParams({
      seller: String(userId),
      sort: "date_desc",
      "order.date_created.from": desde,
      offset: String(offset),
      limit: "50",
    });
    const page = await seguro(errores, `orders ${offset}`, () =>
      mlJson<{ results: MlOrder[]; paging: { total: number } }>(
        env,
        db,
        `/orders/search?${qs}`,
      ),
    );
    if (!page || !page.results?.length) break;

    for (const o of page.results) {
      try {
        const { id, shippingId } = await upsertOrder(db, o);
        total++;
        const entregado = (o.tags ?? []).includes("delivered");
        if (o.status === "paid" && shippingId && !entregado)
          activos.push({ id, shippingId, status: o.status });
        else if (o.status === "cancelled")
          await restaurarSiCancelado(db, id, o.status).catch(() => {});
      } catch (e) {
        errores.push((e as Error).message);
      }
    }
    if (offset + 50 >= (page.paging?.total ?? 0)) break;
  }

  // Estado y logística del envío para los pedidos que siguen vivos (de a 5).
  for (let i = 0; i < activos.length; i += 5) {
    await Promise.all(
      activos.slice(i, i + 5).map((ref) =>
        seguro(errores, `envio ${ref.shippingId}`, () => syncEnvio(env, db, ref)),
      ),
    );
  }
  return total;
}

// ---------- orquestador ----------
export async function syncAll(env: Env, db: DB): Promise<SyncResult> {
  const errores: string[] = [];
  const out: SyncResult = { publicaciones: 0, variantes: 0, pedidos: 0, errores };

  const me = await seguro(errores, "vendedor", () => syncVendedor(env, db));
  const userId =
    me?.id ?? ((await getToken(db))?.meta.user_id as number | undefined);
  if (me) out.vendedor = me.nickname;
  if (!userId) {
    errores.push("sin user_id: no se puede sincronizar publicaciones/pedidos");
    return out;
  }

  const pubs = await seguro(errores, "publicaciones", () =>
    syncPublicaciones(env, db, userId, errores),
  );
  if (pubs) {
    out.publicaciones = pubs.publicaciones;
    out.variantes = pubs.variantes;
  }

  const pedidos = await seguro(errores, "pedidos", () =>
    syncPedidos(env, db, userId, errores),
  );
  if (pedidos != null) out.pedidos = pedidos;

  const row = await getToken(db);
  const meta = {
    ...(typeof row?.meta === "object" && row?.meta ? row.meta : {}),
    last_sync_at: new Date().toISOString(),
  };
  await db
    .from("integrations")
    .update({ meta: meta as Json })
    .eq("provider", "mercadolibre");

  // Mantener el catálogo interno + la lista de materiales al día con ML (nuevos
  // productos/variantes, publicaciones agrupadas, tiempos de placa). Idempotente.
  await seguro(errores, "catálogo", async () => {
    await derivarCatalogo(db);
    await derivarBOM(db);
  });

  // Stock derivado (vendible de holders, buffer de ML, mínimos por ventas) +
  // los descuentos por despacho que hayan quedado marcados en syncEnvio.
  await seguro(errores, "stock", () => recalcularDerivado(db));

  await regenerarAlertas(db).catch((e) =>
    errores.push(`alertas: ${(e as Error).message}`),
  );

  return out;
}
