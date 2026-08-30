// Cliente de MercadoLibre (site MLA): OAuth2 + PKCE y fetch autenticado con
// refresco automático del access_token.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type { Env } from "../env";

const AUTH_BASE = "https://auth.mercadolibre.com.ar/authorization";
const TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
export const ML_API = "https://api.mercadolibre.com";

type DB = SupabaseClient<Database>;

export interface MlTokenRow {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  meta: { user_id?: number; nickname?: string; last_sync_at?: string } & Record<
    string,
    unknown
  >;
}

// ---------- PKCE ----------
function b64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function randomVerifier(): string {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return b64url(a.buffer);
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return b64url(digest);
}

export function redirectUri(env: Env, origin: string): string {
  return env.ML_REDIRECT_URI?.startsWith("http")
    ? env.ML_REDIRECT_URI
    : `${origin}/api/ml/callback`;
}

export function authUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const u = new URL(AUTH_BASE);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("state", opts.state);
  u.searchParams.set("code_challenge", opts.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

// ---------- token exchange / refresh ----------
interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: number;
  token_type: string;
  scope: string;
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });
  const json = (await res.json()) as TokenResponse & {
    message?: string;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(
      `ML token ${res.status}: ${json.error ?? json.message ?? "error"}`,
    );
  }
  return json;
}

function expiresAt(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export async function exchangeCode(
  env: Env,
  db: DB,
  code: string,
  codeVerifier: string,
  redirect: string,
): Promise<MlTokenRow> {
  const t = await postToken({
    grant_type: "authorization_code",
    client_id: env.ML_CLIENT_ID,
    client_secret: env.ML_CLIENT_SECRET,
    code,
    redirect_uri: redirect,
    code_verifier: codeVerifier,
  });
  const row: MlTokenRow = {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: expiresAt(t.expires_in),
    meta: { user_id: t.user_id },
  };
  const { error } = await db.from("integrations").upsert({
    provider: "mercadolibre",
    ...row,
    meta: row.meta as Json,
  });
  if (error) throw new Error(`guardar token: ${error.message}`);
  return row;
}

async function refresh(env: Env, db: DB, current: MlTokenRow): Promise<MlTokenRow> {
  const t = await postToken({
    grant_type: "refresh_token",
    client_id: env.ML_CLIENT_ID,
    client_secret: env.ML_CLIENT_SECRET,
    refresh_token: current.refresh_token,
  });
  const next: MlTokenRow = {
    access_token: t.access_token,
    refresh_token: t.refresh_token, // ML rota el refresh_token en cada uso
    expires_at: expiresAt(t.expires_in),
    meta: { ...current.meta, user_id: t.user_id ?? current.meta.user_id },
  };
  const { error } = await db
    .from("integrations")
    .update({ ...next, meta: next.meta as Json })
    .eq("provider", "mercadolibre");
  if (error) throw new Error(`actualizar token: ${error.message}`);
  return next;
}

export async function getToken(db: DB): Promise<MlTokenRow | null> {
  const { data } = await db
    .from("integrations")
    .select("access_token, refresh_token, expires_at, meta")
    .eq("provider", "mercadolibre")
    .maybeSingle();
  return (data as MlTokenRow | null) ?? null;
}

/** access_token válido, refrescando si vence en < 10 min. */
export async function validToken(env: Env, db: DB): Promise<MlTokenRow> {
  const row = await getToken(db);
  if (!row) throw new Error("MercadoLibre no está conectado");
  const margen = Date.now() + 10 * 60 * 1000;
  if (new Date(row.expires_at).getTime() <= margen) {
    return refresh(env, db, row);
  }
  return row;
}

/** fetch a la API de ML con Bearer y 1 reintento tras refrescar en 401. */
export async function mlFetch(
  env: Env,
  db: DB,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  let token = await validToken(env, db);
  const doFetch = (t: string) =>
    fetch(`${ML_API}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${t}` },
    });

  let res = await doFetch(token.access_token);
  if (res.status === 401) {
    const cur = await getToken(db);
    if (cur) {
      token = await refresh(env, db, cur);
      res = await doFetch(token.access_token);
    }
  }
  return res;
}
