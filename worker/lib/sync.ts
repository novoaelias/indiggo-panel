// Trae a Supabase toda la información de la cuenta de MercadoLibre:
// datos del vendedor, publicaciones (con variantes) y pedidos recientes.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type { Env } from "../env";
import { getToken, mlFetch } from "./ml";

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

  for (const v of it.variations ?? []) {
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
  shipping?: { status?: string };
  order_items?: Array<{
    item?: { id?: string; variation_id?: number | string; title?: string };
    quantity?: number;
    unit_price?: number;
  }>;
}

async function upsertOrder(db: DB, o: MlOrder): Promise<void> {
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
}

/** Sincroniza un solo pedido (usado por el webhook de notificaciones). */
export async function syncOneOrder(
  env: Env,
  db: DB,
  orderId: string,
): Promise<void> {
  const res = await mlFetch(env, db, `/orders/${orderId}`);
  if (!res.ok) throw new Error(`GET /orders/${orderId} → ${res.status}`);
  await upsertOrder(db, (await res.json()) as MlOrder);
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
        await upsertOrder(db, o);
        total++;
      } catch (e) {
        errores.push((e as Error).message);
      }
    }
    if (offset + 50 >= (page.paging?.total ?? 0)) break;
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

  return out;
}
