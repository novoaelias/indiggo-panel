// El shape base se genera desde wrangler.jsonc con `wrangler types`
// (archivo worker-configuration.d.ts → global `Cloudflare.Env`): ASSETS y los
// secretos de .env.example. `PANEL_TOKEN` es opcional (gate simple del panel).
export type Env = Cloudflare.Env & {
  PANEL_TOKEN?: string;
};
