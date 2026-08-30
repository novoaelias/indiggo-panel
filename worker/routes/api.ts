import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { Env } from "../env";
import { catalogo } from "./catalogo";
import { contenido } from "./contenido";
import { ia } from "./ia";
import { ml } from "./ml";
import { panel } from "./panel";

export const api = new Hono<{ Bindings: Env }>();

// Rutas que ML invoca sin poder mandar el token del panel.
const PUBLICAS = ["/api/ml/callback", "/api/ml/notifications"];

// Gate simple por token compartido (secreto PANEL_TOKEN). Si no está seteado,
// el gate queda desactivado (fail-open) — pensado para completar con Cloudflare
// Access por encima. El token viaja por header (fetch) o cookie (navegación).
api.use("*", async (c, next) => {
  const token = c.env.PANEL_TOKEN;
  if (!token) return next();

  const path = new URL(c.req.url).pathname;
  if (PUBLICAS.some((p) => path.startsWith(p))) return next();
  if (path === "/api/health") return next();

  const dado =
    c.req.header("x-panel-token") ?? getCookie(c, "panel_token") ?? "";
  if (dado && timingSafeEqual(dado, token)) return next();
  return c.json({ error: "no_autorizado" }, 401);
});

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

api.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));

// El panel llama esto al arrancar: valida el token y dice si el gate está activo.
api.get("/session", (c) => {
  const gate = Boolean(c.env.PANEL_TOKEN);
  return c.json({ gate, ok: true });
});

// Estado de las integraciones — el panel lo usa en Configuración.
// Sólo reporta si el secreto está presente (no lo expone).
api.get("/status", (c) => {
  const has = (v: string | undefined) => Boolean(v && v.length > 0);
  return c.json({
    mercadolibre: has(c.env.ML_CLIENT_ID) && has(c.env.ML_CLIENT_SECRET),
    supabase: has(c.env.SUPABASE_URL) && has(c.env.SUPABASE_SERVICE_ROLE_KEY),
    claude: has(c.env.ANTHROPIC_API_KEY),
    kie: has(c.env.KIE_API_KEY),
  });
});

api.route("/catalogo", catalogo);
api.route("/contenido", contenido);
api.route("/ml", ml);
api.route("/ia", ia);
api.route("/", panel);

api.all("*", (c) => c.json({ error: "not_found" }, 404));
