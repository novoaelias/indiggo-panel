// El shape real se genera desde wrangler.jsonc con `wrangler types`
// (archivo worker-configuration.d.ts → global `Cloudflare.Env`).
// Incluye ASSETS, ENVIRONMENT y todos los secretos de .env.example.
export type Env = Cloudflare.Env;
