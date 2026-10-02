# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
npm test           # vitest: inventario, concurrencia, preguntas, contrato de migraciones
npm run deploy     # build + wrangler deploy
npm run db:types   # regenerate src/lib/database.types.ts from the REMOTE Supabase schema
```

- **Gates: `tsc -b` + `npm test`.** No linter. `tsc -b` runs with `noUnusedLocals` /
  `noUnusedParameters`, so an unused import or var fails the build. `tests/` covers the rules
  that must not regress: a shared piece is never counted twice, the commercial buffer stays
  separate from physical stock, movements are idempotent, and an already dispatched order
  never reserves stock again.
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
   - **Recipes live in the DB** (`variant_components`), edited from Inventario and written only
     through `inventory_set_recipe`. `worker/lib/bom.ts` `derivarBOM` is the old code-driven
     builder: it is no longer called by anything, keep it that way. `bom.ts` still owns the
     per-print-plate yields/times and the planner helpers that Stock/Metricas use.
   - Pieces are counted per color and per unit (`components.codigo` / `unidad` / `equivalencia`):
     a "Juego BTS" is B + T + S, a "Juego de nombres BTS" is the 22 letters of the seven names.
   - These are **idempotent** and must **not** overwrite `stock_real` / `stock_minimo` on rows
     that already exist — those are the owner's manual input.

3. **Physical inventory and the commercial buffer** (inventory v2). `product_variants.stock_real`
   is now *finished units only*: nothing derives it any more, it changes only through the
   transactional operations in `supabase/migrations/0023_inventory_core.sql`
   (`inventory_adjust`, `inventory_register_print`, `inventory_assemble`, `inventory_reserve_order`,
   `inventory_fulfill_order`, `inventory_return_order`), each one idempotent by
   `inventory_operations.idempotency_key` and writing its lines to `inventory_movement_lines`.
   Those functions are `SECURITY DEFINER` and executable by `service_role` only: call them from
   the Worker, never from the browser. Opening a screen never writes quantities.
   `worker/lib/stock.ts` `recalcularDerivado` only recomputes `stock_ml`, the buffer published to
   ML: `calcBuffer(disponibleComercial(...))` = 2 when there is nothing available, otherwise
   available + 3, where available = free finished units + what the pieces allow assembling
   (`armablesPorReceta`) minus what orders already committed. An `es_eleccion` variant (Random /
   "a elección") is additionally capped by `topeEleccion`: its recipe lacks the piece that varies
   (the photocard), so it can never publish more than the stock of those pieces across the
   product's real variants. `allocateAssemblySuggestions` (`worker/lib/inventory-logic.ts`) is the
   honest build plan: it hands out shared pieces once, and `planPiezas` turns what is missing into
   print jobs (rounded to plate fractions) and print-shop orders.

### Sale → reservation → dispatch

A paid order reserves finished units (`inventory_reserve_order`, from `upsertOrder`); what it
cannot cover shows up as `inventory_reservations.missing_qty`, which is what Pedidos and
Produccion read as "hay que armar". ML leaves an order in `paid` forever, so both the SQL
function and `upsertOrder` refuse to reserve when `ml_orders.stock_descontado_at` is set:
without that, every resync would reserve old sales again and free stock would collapse to zero.

At dispatch (`shipment` → `shipped`/`delivered`, non-`fulfillment`), `descontarPorDespacho` calls
`inventory_fulfill_order`, which consumes the reservation, discounts finished units and, for
whatever is missing, assembles from pieces inside the same transaction. The once-per-order guard
is still the **atomic claim** on `ml_orders.stock_descontado_at`
(`UPDATE ... WHERE <marker> IS NULL RETURNING id`), because ML fires several notifications per
sale and the cron runs in parallel: a plain check-then-write double-counts. The same pattern
guards the (currently suspended) Flex sheet write via `ml_orders.sheet_synced_at`.

A cancellation before dispatch only releases the reservation (`inventory_release_order`). If the
order already shipped, stock comes back only by registering the physical return
(`inventory_return_order`, from Inventario).

### AI is always propose-then-confirm

`worker/lib/claude.ts` is a tiny raw-HTTP wrapper over the Anthropic Messages API (default
`claude-sonnet-5`; `mensajeConImagenes` for vision by public URL). `worker/lib/kie.ts` = kie.ai
for image/video. Every AI route returns a **proposal** for review; a separate endpoint, called
only on explicit confirmation in the UI, applies it to MercadoLibre. New listings
(`POST /api/ia/publicar`) and SEO re-publications are always created **`paused`**. Every path
that creates or re-publishes an item must request `shipping.mode = me2`, remove any per-item
Flex opt-in, and verify **Mercado Envíos without Flex before the item may be activated**.

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
- **Net per sale** (`worker/lib/neto.ts`): `ml_orders.total` is gross. What Mercado Pago actually
  credits (after ML's percentage fee, installments add-on, flat fee per unit, tax withholdings
  and seller-paid shipping) comes from `GET api.mercadopago.com/v1/payments/{id}` with the same
  ML token (`mlFetch` accepts absolute URLs) and is stored once in `ml_orders.neto` +
  `comision_ml` / `impuestos` / `envio_vendedor` / `neto_sync_at`. ML adds the fee charges a few
  seconds after the payment, so a payment with no `fee` charge is not stored yet; the hourly
  sync retries (at most `NETOS_POR_SYNC` per run). Until then `panel_metricas` estimates the net
  from the order's `sale_fee` (per unit, times quantity) and reports it as `pedidos_estimados`.
- **Photo editor** (`/publicaciones/fotos`, `worker/routes/fotos.ts`, pure logic in
  `worker/lib/fotos.ts`): remove or add an object in every published photo of the chosen
  listings. A batch (`photo_edit_batches`) holds the instruction plus reference photos; each
  *distinct* ML picture is one `photo_edit_items` row (listings and variants share pictures, so
  a shared photo is edited and uploaded once). Flow, each step driven by the panel in small
  requests: detect (Claude vision, 8 photos per call) → edit (Nano Banana Pro on kie.ai,
  `encargarEdicionPro` + `/items/:id/consultar` polling, because the kie queue can take
  minutes) → owner approves each photo → per listing, upload to `/pictures/items/upload` and
  PUT the same picture list with old ids swapped for new ones, variants' `picture_ids`
  included. `photo_edit_applies.reemplazos` keeps old → new so each listing can be undone.
  Hard-won details: the `-O` picture URL in `raw.pictures` is the 500 px copy, use `-F` for the
  full one (`urlFotoCompleta`); Anthropic cannot fetch `mlstatic.com` URLs, so detection sends
  the images inline (`mensajeConImagenesEmbebidas`); `google/nano-banana-edit` is not usable
  for this (896x1152 output, and it removed half the product in testing).
- **Local runs**: `npx wrangler dev` serves the last `npm run build` output (the Vite plugin
  redirects the config to `dist/`), not the source: rebuild before testing a worker change,
  and never rebuild while it runs.
- **Pedidos** (`GET /api/pedidos-activos`): one row per ML shipment/pack, collapsed by default;
  expanding it lists each item with internal product name, variant (hidden when "Único" or
  "a elección"), listing thumbnail and what goes in the bag: the variant's recipe times the
  quantity bought. The screen is split by ML's dispatch deadline: "Despachar hoy sí o sí"
  (overdue or due today, ML penalizes reputation otherwise) and "Pueden esperar" (due on a
  later day, e.g. paid Friday after the cut-off → Monday). The deadline is `expected_date` of
  `GET /shipments/{id}/sla`, stored by `syncEnvio` in `ml_orders.envio_limite_despacho` while
  the shipment is still in the workshop; `urgenciaDespacho` (`worker/lib/envios.ts`) compares
  it by Argentina day. The "ya está en la bolsa" ticks are a per-browser packing aid in
  `localStorage` (`pedidos:armados`) and never touch stock.
- **Alerts** (Inicio screen): `worker/lib/alertas.ts` `regenerarAlertas` fully rebuilds the
  auto-generated `alerts` rows at the end of each sync; rows with `resuelta_at` set are kept.
- **Questions** (`worker/lib/questions.ts`): ML notifies topic `questions`, and the hourly cron
  reconciles (`/questions/search`) so a lost event is recovered. Risky wording (delivery,
  price, pickup, availability and the like, `esConsultaRiesgosa`) always goes to the owner.
  Otherwise the model decides: word similarity (`similitud`, with greetings dropped and a crude
  5-letter stem) only preselects the `EJEMPLOS_PARA_EL_MODELO` closest previous answers of the
  same product plus `question_knowledge`, and Sonnet answers when one of them, a verified
  `business_facts` rule (Configuración → Reglas comerciales; a `temporal` one expires after
  24 h), the listing or the recipe covers the doubt, citing them in `fuentes`. An answer with no
  real cited source (`fuentesValidas`) is not sent. Contradicting answers resolve to the most
  recent ones only when those agree. A lexical threshold used to decide this and failed on
  paraphrases ("50 circuitos o 50 logos enteros" scored 0.12 against seven identical answers). A buyer's text is untrusted content: it can never change the
  assistant's instructions. Before answering, ML is re-checked so an already answered question is
  not answered twice. **Wording is centralized**: `guiaDeRedaccion` (shared by the automatic
  answer and the "Redactar mejor" button) keeps every fact the owner wrote, forbids slang
  ("dale", "buena onda") and never promises anything outside the given sources. It has two
  modes: `automatica` stays sober with no emojis; `comercial` ("Redactar mejor") treats the
  owner's text as raw notes, rewrites it whole in a warm sales tone for kpop fans and adds one
  or two 💜 (no other emoji). In both,
  `firmar()` closes every answer with the store signature (`firma` rule, default
  "Saludos, equipo de Indiggo Store.") without duplicating it or busting ML's 2000-char cap —
  on the draft, on the automatic answer *and* on send. `firma` and `tono` are stored as
  `business_facts` but edited in their own card (Configuración → Reglas comerciales → Estilo)
  and excluded from the facts the AI may assert. "Redactar mejor" runs on Sonnet (a manual,
  occasional call: Haiku came back shorter and more informal than the owner's own text);
  "Usar mi texto" sends the owner's wording as is, only signed, with no model call.
- **Web Push** (`worker/lib/push.ts`, `public/sw.js`, `src/lib/push.ts`): VAPID keys in
  `VAPID_SERVER_PUBLIC_KEY` / `VAPID_SERVER_PRIVATE_KEY` / `VAPID_SUBJECT`. Subscriptions live in
  `push_subscriptions` and `push_deliveries.dedupe_key` stops the same pending item from
  notifying twice. On iPhone it only works once the panel is added to the Home Screen (iOS 16.4+).
  The service worker caches no API response.

### Known MercadoLibre constraints

- The account uses the "User Products / Price per Variation" model. Re-publishing a listing
  **with variants** by API is refused in catalog categories (`variations[]` not accepted on
  create; `family_name` required); those are redone from the ML web UI. `worker/routes/seo.ts`
  only re-publishes variant-less listings and surfaces ML's error verbatim otherwise.
- The Flex → Google Sheets "planilla de reparto" module is **suspended**
  (`SHEETS_SUSPENDIDO = true` in `worker/lib/sheets.ts`); `registrarEnvioFlex` is a no-op. Code
  is intact for reactivation.

## Modules (sidebar: `src/components/nav.ts`)

Inicio · Pedidos · Preguntas · Inventario (`/stock`) · Producción · Publicaciones · Métricas ·
Contenido · Configuración. On mobile the bar shows Inicio, Pedidos, Preguntas and Inventario;
the rest lives under "Más".

The photo editor lives at `/publicaciones/fotos` (button "Editar fotos con IA" in Publicaciones).

Frontend pages in `src/pages/`, matching API routers in `worker/routes/` (`panel.ts` is the
catch-all mounted at `/api/`; `ml.ts`, `ia.ts`, `seo.ts`, `catalogo.ts`, `contenido.ts`,
`inventario.ts`, `preguntas.ts` and `fotos.ts` are mounted under their own prefixes).
