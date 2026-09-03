// Escribe en la planilla de reparto ("INDIGGO", Google Sheets) usando un Service
// Account. El Worker corre sin nadie adelante: firma un JWT con la clave del SA
// (RS256 vía WebCrypto, sin dependencias) y lo canjea por un access_token.
//
// La planilla tiene los días EN HORIZONTAL: cada día es un bloque de 6 columnas
//   [ fecha | DIRECCIÓN | LOCALIDAD | CHICO/MEDIANO | GRANDE | (espaciador) ]
// Día 1 en la col A, día 2 en la G, día N en la columna 1 + 6·(N-1).
// Cada envío Flex del día es una fila nueva; CHICO/MEDIANO siempre TRUE.
import type { Env } from "../env";

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URI = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const BLOQUE = 6; // columnas por día (5 + espaciador)

export function sheetsConfigurado(env: Env): boolean {
  return Boolean(
    env.GOOGLE_SA_EMAIL && env.GOOGLE_SA_PRIVATE_KEY && env.SHEETS_ID,
  );
}

// ---------- auth ----------
let tokenCache: { token: string; exp: number } | null = null;

function b64url(input: ArrayBuffer | Uint8Array | string): string {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function accessToken(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp - 60 > now) return tokenCache.token;

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: env.GOOGLE_SA_EMAIL,
      scope: SCOPE,
      aud: TOKEN_URI,
      iat: now,
      exp: now + 3600,
    }),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(env.GOOGLE_SA_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claim}`),
  );
  const jwt = `${header}.${claim}.${b64url(sig)}`;

  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok)
    throw new Error(`google token → ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: j.access_token, exp: now + j.expires_in };
  return j.access_token;
}

async function apiGet<T>(env: Env, path: string): Promise<T> {
  const token = await accessToken(env);
  const res = await fetch(`${SHEETS_API}/${env.SHEETS_ID}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok)
    throw new Error(`sheets GET ${path} → ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function apiPut(env: Env, path: string, body: unknown): Promise<void> {
  const token = await accessToken(env);
  const res = await fetch(`${SHEETS_API}/${env.SHEETS_ID}${path}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(`sheets PUT ${path} → ${res.status} ${await res.text()}`);
}

// ---------- grilla ----------
function colLetter(i: number): string {
  // 0 -> A, 25 -> Z, 26 -> AA
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

let hojaCache: string | null = null;
async function nombreHoja(env: Env): Promise<string> {
  if (hojaCache) return hojaCache;
  const j = await apiGet<{
    sheets: Array<{ properties: { title: string; index: number } }>;
  }>(env, "?fields=sheets.properties.title,sheets.properties.index");
  const first = [...(j.sheets ?? [])].sort(
    (a, b) => a.properties.index - b.properties.index,
  )[0];
  hojaCache = first?.properties.title ?? "Hoja 1";
  return hojaCache;
}

/** "31/8/2026" | "1/9" -> {d, m} */
function parseFechaHeader(v: unknown): { d: number; m: number } | null {
  const mm = String(v ?? "")
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})/);
  return mm ? { d: Number(mm[1]), m: Number(mm[2]) } : null;
}

export interface EnvioFlex {
  direccion: string;
  localidad: string;
  /** "YYYY-MM-DD" del día (hora AR) en cuyo bloque va la fila */
  fechaAR: string;
}

/**
 * Agrega una fila al bloque del día indicado, creando el bloque si no existe.
 * Devuelve la celda inicial escrita (ej. "Hoja 1!H4").
 */
export async function appendEnvioFlex(
  env: Env,
  e: EnvioFlex,
): Promise<string> {
  const hoja = await nombreHoja(env);
  const rng = (r: string) =>
    encodeURIComponent(`'${hoja.replace(/'/g, "''")}'!${r}`);

  const [yy, mo, dd] = e.fechaAR.split("-").map(Number);

  const head = await apiGet<{ values?: string[][] }>(
    env,
    `/values/${rng("1:1")}`,
  );
  const fila1 = head.values?.[0] ?? [];

  // buscar el bloque del día (las fechas caen en columnas 0, 6, 12, ...)
  let col = -1;
  let ultimo = -BLOQUE;
  for (let c = 0; c < fila1.length; c += BLOQUE) {
    const f = parseFechaHeader(fila1[c]);
    if (!f) continue;
    ultimo = c;
    if (f.d === dd && f.m === mo) col = c;
  }

  // no existe: crear a la derecha del último bloque con fecha
  if (col < 0) {
    col = ultimo + BLOQUE;
    await apiPut(
      env,
      `/values/${rng(`${colLetter(col)}1`)}?valueInputOption=USER_ENTERED`,
      {
        values: [
          [`${dd}/${mo}/${yy}`, "DIRECCIÓN", "LOCALIDAD", "CHICO/MEDIANO", "GRANDE"],
        ],
      },
    );
  }

  // primera fila libre del bloque (miramos DIRECCIÓN + LOCALIDAD)
  const dirCol = colLetter(col + 1);
  const locCol = colLetter(col + 2);
  const cuerpo = await apiGet<{ values?: string[][] }>(
    env,
    `/values/${rng(`${dirCol}2:${locCol}2000`)}`,
  );
  const rows = cuerpo.values ?? [];
  let fila = rows.length + 2;
  for (let i = 0; i < rows.length; i++) {
    const [d, l] = rows[i] ?? [];
    if (!d && !l) {
      fila = i + 2;
      break;
    }
  }

  await apiPut(
    env,
    `/values/${rng(`${dirCol}${fila}:${colLetter(col + 4)}${fila}`)}?valueInputOption=USER_ENTERED`,
    { values: [[e.direccion, e.localidad, true, false]] },
  );
  return `${hoja}!${dirCol}${fila}`;
}
