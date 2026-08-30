import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
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
import { syncAll } from "../lib/sync";

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

// Desconectar (borra el token; los datos ya sincronizados quedan).
ml.post("/desconectar", async (c) => {
  const db = supa(c.env);
  await db.from("integrations").delete().eq("provider", "mercadolibre");
  return c.json({ ok: true });
});
