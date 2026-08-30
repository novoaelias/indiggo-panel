import { Hono } from "hono";
import type { Env } from "../env";
import { catalogo } from "./catalogo";
import { ml } from "./ml";

export const api = new Hono<{ Bindings: Env }>();

api.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));

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
api.route("/ml", ml);

api.all("*", (c) => c.json({ error: "not_found" }, 404));
