// El shape base se genera desde wrangler.jsonc con `wrangler types`
// (archivo worker-configuration.d.ts → global `Cloudflare.Env`): ASSETS y los
// secretos de .env.example. `PANEL_TOKEN` es opcional (gate simple del panel).
export type Env = Cloudflare.Env & {
  PANEL_TOKEN?: string;
  VAPID_SUBJECT?: string;
  VAPID_SERVER_PUBLIC_KEY?: string;
  VAPID_SERVER_PRIVATE_KEY?: string;
};
