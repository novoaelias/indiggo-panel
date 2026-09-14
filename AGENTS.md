# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

Private single-user admin panel for **Indiggo Store** (a one-person business selling 3D-printed
kpop merch on MercadoLibre Argentina, site `MLA`). Automates listings, stock/production planning,
metrics and social content, all AI-assisted with a human-review step before anything is pushed
to MercadoLibre. Codebase, comments and UI copy are in **rioplatense Spanish** — keep it that way.

## Commands

```bash
npm run dev        # Vite + @cloudflare/vite-plugin: SPA (HMR) + the real Worker at /api/* on
                   # workerd + cron, all on http://localhost:5173
npx tsc -b         # typecheck only (fast). 3 project refs: app / node / worker
npm run build      # wrangler types && tsc -b && vite build  ->  dist/
npm run deploy     # build + wrangler deploy
npm run db:types   # regenerate src/lib/database.types.ts from the REMOTE Supabase schema
```

- **No test suite and no linter.** `tsc -b` is the only gate; it runs with `noUnusedLocals` /
  `noUnusedParameters`, so an unused import or var fails the build.
- Local secrets live in `.dev.vars` (git-ignored; copy from `.env.example`). Production secrets:
  `npx wrangler secret bulk .dev.vars` (or `wrangler secret put NAME`). `SHEETS_ID` is the only
  non-secret var, in `wrangler.jsonc`.
- **DB migrations**: SQL files in `supabase/migrations/` (`NNNN_name.sql`). There is no local
  Supabase stack — apply to the remote project with the Supabase MCP (`apply_migration`), then
  run `npm run db:types`. Storage buckets are created the same way (migration SQL or MCP).
- After a batch of code changes, deploy (`npm run deploy`) — the owner never deploys by hand.

## Architecture

One Cloudflare Worker serves **both** the React SPA (Workers Static Assets, SPA fallback) and the
JSON API. `wrangler.jsonc` `run_worker_first: ["/api/*"]` routes API calls to the Worker; every
other path serves the SPA. Entry point `worker/index.ts` = `fetch` (Hono app, `worker/routes/`)
+ `scheduled` (`worker/cron.ts`, two cron triggers).

### The data model has three layers

1. **ML mirror** (`ml_listings`, `ml_listing_variations`, `ml_orders`, `ml_order_items`,
   `integrations`) — a faithful copy of the MercadoLibre account. Written only by
   `worker/lib/sync.ts` (`syncAll` from hourly cron + manual `POST /api/ml/sync`; `syncOneItem` /
   `syncOneOrder` from the real-time webhook `POST /api/ml/notifications`). Raw ML JSON is kept in
   the `raw` jsonb column and queried with `raw->...->>...` filters.

2. **Internal catalog** (`products`, `product_variants`, `components`, `variant_components`,
   `listing_groups`, `groups`, `group_members`) — **derived** from the mirror and rebuilt at the
   end of every sync:
   - `worker/lib/derivar.ts` `derivarCatalogo` — collapses the several `ml_listings` that are the
     same physical product (installment-plan dupes, reworded titles) into one `product` via
     `listing_groups` + a canonical listing; matches variants by kpop group member.
   - `worker/lib/bom.ts` `derivarBOM` — builds the bill of materials: a holder unit = 3D body +
     holder-specific 3D keychain + print-shop photocard; mostacilla/letter packs have fixed
     recipes; other simple products have no BOM. Also holds per-print-plate yields/times for the
     production planner.
   - These are **idempotent** and must **not** overwrite `stock_real` / `stock_minimo` on rows
     that already exist — those are the owner's manual input.

3. **Computed fields** — `worker/lib/stock.ts` `recalcularDerivado` (also run every sync):
   `stock_ml` (the inflated buffer published to ML so listings never auto-pause on stock-out),
   automatic `stock_minimo` from sales velocity, and holders' sellable `stock_real` rolled up
   from component stock. `es_eleccion` "random / a elección" variants carry no stock/production;
   their numbers are derived from the product's real variants.

### Sale → stock discount

At dispatch (`shipment` → `shipped`/`delivered`, non-`fulfillment`), `descontarPorDespacho` →
`ajustarStockPorPedido(db, orderId, -1)` decrements stock once per order, guarded by
`ml_orders.stock_descontado_at`. Cancellation restores it. The guard uses an **atomic claim**
(`UPDATE ... WHERE <marker> IS NULL RETURNING id`) because ML fires several notifications per
sale and the cron runs in parallel — a plain check-then-write double-counts. The same pattern
guards the (currently suspended) Flex sheet write via `ml_orders.sheet_synced_at`.

### AI is always propose-then-confirm

`worker/lib/Codex.ts` is a tiny raw-HTTP wrapper over the Anthropic Messages API (default
`Codex-sonnet-5`; `mensajeConImagenes` for vision by public URL). `worker/lib/kie.ts` = kie.ai
for image/video. Every AI route returns a **proposal** for review; a separate endpoint, called
only on explicit confirmation in the UI, applies it to MercadoLibre. New listings
(`POST /api/ia/publicar`) and SEO re-publications are always created **`paused`**.

### Other cross-cutting things

- **Auth**: `worker/routes/api.ts` middleware gates everything behind the `PANEL_TOKEN` shared
  secret (header `x-panel-token` or cookie); **fail-open if the secret is unset**. Cloudflare
  Access sits on top in production. `/api/ml/callback` and `/api/ml/notifications` are public
  (ML can't send the token). The SPA gate lives in `src/components/Gate.tsx` + `src/lib/auth.ts`.
- **MercadoLibre client**: `worker/lib/ml.ts` — OAuth2 + PKCE, `access_token` (6 h) auto-refreshed
  by the 4-hourly cron, `mlFetch(env, db, path, init)` retries once on 401.
- **Supabase client**: `worker/lib/supabase.ts` `supa(env)` — service-role, server-only, bypasses
  RLS. Never instantiate a Supabase client in the browser.
- **Timezone**: the Worker runs in UTC. Always compute "today" / day buckets in Argentina time
  (fixed UTC−3) via `worker/lib/fecha.ts` (`hoyAR`, `inicioDiaAR`, …), never `toISOString()`.
- **`@/*` alias → `src/*`** in the frontend *and* the worker tsconfig; the Worker imports shared
  DB types from `src/lib/database.types.ts`.
- **Alerts** (Inicio screen): `worker/lib/alertas.ts` `regenerarAlertas` fully rebuilds the
  auto-generated `alerts` rows at the end of each sync; rows with `resuelta_at` set are kept.

### Known MercadoLibre constraints

- The account uses the "User Products / Price per Variation" model. Re-publishing a listing
  **with variants** by API is refused in catalog categories (`variations[]` not accepted on
  create; `family_name` required); those are redone from the ML web UI. `worker/routes/seo.ts`
  only re-publishes variant-less listings and surfaces ML's error verbatim otherwise.
- The Flex → Google Sheets "planilla de reparto" module is **suspended**
  (`SHEETS_SUSPENDIDO = true` in `worker/lib/sheets.ts`); `registrarEnvioFlex` is a no-op. Code
  is intact for reactivation.

## Modules (sidebar: `src/components/nav.ts`)

Inicio · Publicaciones · Pedidos · Stock y producción · Métricas · Contenido · Configuración.
Frontend pages in `src/pages/`, matching API routers in `worker/routes/` (`panel.ts` is the
catch-all mounted at `/api/`; `ml.ts`, `ia.ts`, `seo.ts`, `catalogo.ts`, `contenido.ts` are
mounted under their own prefixes).
