import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Json } from "@/lib/database.types";
import type { Env } from "../env";
import { supa } from "../lib/supabase";
import {
  authUrl,
  challengeFor,
  exchangeCode,
  getToken,
  randomVerifier,
  redirectUri,
} from "../lib/ml";
import { syncAll, syncOneItem, syncOneOrder } from "../lib/sync";
import { processQuestion, syncQuestion } from "../lib/questions";
import {
  estadoEnvio,
  garantizarMercadoEnviosSinFlex,
  politicaFlexOculta,
} from "../lib/shipping";

export const ml = new Hono<{ Bindings: Env }>();

const PKCE_COOKIE = "ml_pkce";
const STATE_COOKIE = "ml_state";

// Paso 1: arranca el OAuth. Abrir esta URL en el browser.
ml.get("/connect", async (c) => {
  const verifier = randomVerifier();
  const challenge = await challengeFor(verifier);
  const state = randomVerifier().slice(0, 24);
  const origin = new URL(c.req.url).origin;

  const opts = {
    httpOnly: true,
    secure: true,
    sameSite: "Lax" as const,
    path: "/api/ml",
    maxAge: 600,
  };
  setCookie(c, PKCE_COOKIE, verifier, opts);
  setCookie(c, STATE_COOKIE, state, opts);

  return c.redirect(
    authUrl({
      clientId: c.env.ML_CLIENT_ID,
      redirectUri: redirectUri(c.env, origin),
      state,
      codeChallenge: challenge,
    }),
  );
});

// Paso 2: ML vuelve acá con ?code=&state=
ml.get("/callback", async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  if (err) return c.redirect(`/configuracion?ml=error&motivo=${err}`);

  const verifier = getCookie(c, PKCE_COOKIE);
  const savedState = getCookie(c, STATE_COOKIE);
  deleteCookie(c, PKCE_COOKIE, { path: "/api/ml" });
  deleteCookie(c, STATE_COOKIE, { path: "/api/ml" });

  if (!code || !verifier || !state || state !== savedState) {
    return c.redirect("/configuracion?ml=error&motivo=estado_invalido");
  }

  const db = supa(c.env);
  try {
    await exchangeCode(
      c.env,
      db,
      code,
      verifier,
      redirectUri(c.env, url.origin),
    );
  } catch (e) {
    return c.redirect(
      `/configuracion?ml=error&motivo=${encodeURIComponent((e as Error).message)}`,
    );
  }

  // Primera sincronización completa en segundo plano.
  c.executionCtx.waitUntil(
    syncAll(c.env, db).catch((e) =>
      console.error("[ml] sync inicial falló", e),
    ),
  );
  return c.redirect("/configuracion?ml=conectado");
});

// Estado de la conexión para el panel.
ml.get("/estado", async (c) => {
  const db = supa(c.env);
  const row = await getToken(db);
  if (!row) return c.json({ conectado: false });

  const [{ count: publicaciones }, { count: pedidos }, { count: variantes }] =
    await Promise.all([
      db.from("ml_listings").select("id", { count: "exact", head: true }),
      db.from("ml_orders").select("id", { count: "exact", head: true }),
      db
        .from("ml_listing_variations")
        .select("id", { count: "exact", head: true }),
    ]);

  return c.json({
    conectado: true,
    vendedor: row.meta.nickname ?? null,
    user_id: row.meta.user_id ?? null,
    ultimo_sync: row.meta.last_sync_at ?? null,
    token_vence: row.expires_at,
    publicaciones: publicaciones ?? 0,
    variantes: variantes ?? 0,
    pedidos: pedidos ?? 0,
  });
});

// Re-sincronizar a demanda.
ml.post("/sync", async (c) => {
  const db = supa(c.env);
  if (!(await getToken(db))) {
    return c.json({ error: "MercadoLibre no está conectado" }, 409);
  }
  const res = await syncAll(c.env, db);
  return c.json(res);
});

// --- Política fija: todas las publicaciones usan Mercado Envíos sin Flex ---

ml.get("/flex", async (c) => {
  const db = supa(c.env);
  const { data: listings } = await db
    .from("ml_listings")
    .select("raw")
    .eq("estado", "active");
  const conFlex = (listings ?? []).filter((l) => estadoEnvio(l.raw as never).flex).length;
  const meta = ((await getToken(db))?.meta ?? {}) as Record<string, unknown>;
  return c.json({
    oculto: meta.flex_oculto === true,
    desde: (meta.flex_oculto_at as string | null) ?? null,
    con_flex: conFlex,
    activas: listings?.length ?? 0,
  });
});

ml.post("/flex", async (c) => {
  const { ocultar } = await c.req.json<{ ocultar?: boolean }>();
  if (ocultar !== true)
    return c.json(
      {
        error:
          "La política de Indiggo es Mercado Envíos sin Flex. El panel no permite volver a activarlo.",
      },
      400,
    );
  const db = supa(c.env);
  if (!(await getToken(db)))
    return c.json({ error: "MercadoLibre no está conectado" }, 409);

  const { data: listings } = await db
    .from("ml_listings")
    .select("ml_item_id, raw")
    .in("estado", ["active", "paused"]);

  // sólo tocar las que hace falta cambiar
  const pendientes = (listings ?? []).filter((l) => estadoEnvio(l.raw as never).flex);

  let ok = 0;
  const errores: string[] = [];
  const tocados = new Set<string>();
  // API de Flex por item: POST = activar, DELETE = desactivar la opción.
  // El helper usa el endpoint v2 actual, verifica el resultado y conserva el
  // endpoint anterior como fallback para cuentas todavía migrando.
  const empujar = async (l: { ml_item_id: string }) => {
    const resultado = await garantizarMercadoEnviosSinFlex(
      c.env,
      db,
      l.ml_item_id,
    );
    if (resultado.ok) {
      ok++;
      tocados.add(l.ml_item_id);
    } else {
      errores.push(
        `${l.ml_item_id}: ${resultado.detalle ?? "no se pudo verificar"}`,
      );
    }
  };

  const lote = pendientes.slice(0, 200);
  for (let i = 0; i < lote.length; i += 5)
    await Promise.all(lote.slice(i, i + 5).map(empujar));

  for (const it of tocados) {
    try {
      await syncOneItem(c.env, db, it);
    } catch {
      /* ignore */
    }
  }

  const row = await getToken(db);
  const meta = {
    ...(typeof row?.meta === "object" && row?.meta ? row.meta : {}),
    flex_oculto: ocultar === true,
    flex_oculto_at: ocultar ? new Date().toISOString() : null,
  };
  await db
    .from("integrations")
    .update({ meta: meta as Json })
    .eq("provider", "mercadolibre");

  return c.json({ tocados: ok, pendientes: pendientes.length, errores });
});

// Webhook de notificaciones de ML. Debe responder 200 en < 500 ms:
// se hace ACK inmediato y el trabajo va en waitUntil.
interface MlNotif {
  topic?: string;
  resource?: string;
  user_id?: number;
}

async function procesarNotif(
  env: Env,
  db: ReturnType<typeof supa>,
  n: MlNotif,
): Promise<void> {
  if (!n.resource) return;
  const token = await getToken(db);
  if (token?.meta.user_id && n.user_id && token.meta.user_id !== n.user_id) {
    console.warn("[ml] notif de otro user_id, ignorada", n.user_id);
    return;
  }

  const id = n.resource.split("/").filter(Boolean).pop();
  if (!id) return;

  switch (n.topic) {
    case "items":
    case "marketplace_items":
      await syncOneItem(env, db, id);
      if (await politicaFlexOculta(db)) {
        const envio = await garantizarMercadoEnviosSinFlex(env, db, id);
        if (!envio.ok)
          console.error(
            `[ml] no se pudo garantizar Mercado Envíos sin Flex en ${id}: ${envio.detalle}`,
          );
        else await syncOneItem(env, db, id);
      }
      break;
    case "orders":
    case "orders_v2":
    case "marketplace_orders":
      await syncOneOrder(env, db, id);
      break;
    case "shipments": {
      // cambió el estado de un envío → resincronizar el pedido dueño de ese
      // shipment (trae estado_envio, y descuenta stock si pasó a despachado).
      const { data: o } = await db
        .from("ml_orders")
        .select("ml_order_id")
        .filter("raw->shipping->>id", "eq", id)
        .limit(1)
        .maybeSingle();
      const oid = (o as { ml_order_id?: string } | null)?.ml_order_id;
      if (oid) await syncOneOrder(env, db, oid);
      break;
    }
    case "questions":
      await syncQuestion(env, db as never, id);
      await processQuestion(env, db as never, id);
      break;
    default:
      console.log(`[ml] notif topic sin manejar: ${n.topic}`);
  }
}

ml.post("/notifications", async (c) => {
  let body: MlNotif = {};
  try {
    body = await c.req.json<MlNotif>();
  } catch {
    return c.body(null, 200);
  }
  const db = supa(c.env);
  c.executionCtx.waitUntil(
    procesarNotif(c.env, db, body).catch((e) =>
      console.error("[ml] notif error", e),
    ),
  );
  return c.body(null, 200);
});

// La app de ML tiene cargada la misma URL para el redirect de OAuth y para las
// notificaciones (`notifications_callback_url`). El redirect llega por GET y la
// notificación por POST, así que acá se acepta el POST y se procesa igual: si
// algún día se corrige la URL en el devcenter, esto sigue siendo inofensivo.
ml.post("/callback", async (c) => {
  let body: MlNotif = {};
  try {
    body = await c.req.json<MlNotif>();
  } catch {
    return c.body(null, 200);
  }
  const db = supa(c.env);
  c.executionCtx.waitUntil(
    procesarNotif(c.env, db, body).catch((e) =>
      console.error("[ml] notif error", e),
    ),
  );
  return c.body(null, 200);
});

// Desconectar (borra el token; los datos ya sincronizados quedan).
ml.post("/desconectar", async (c) => {
  const db = supa(c.env);
  await db.from("integrations").delete().eq("provider", "mercadolibre");
  return c.json({ ok: true });
});
