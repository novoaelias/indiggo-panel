# Indiggo · Panel

Panel privado de un solo usuario para automatizar la operación de **Indiggo Store**
en Mercado Libre (site MLA): publicaciones, stock y producción, métricas y contenido
para redes, todo asistido por IA con pantalla de revisión antes de aplicar nada.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | React 19 + Vite 6 + React Router 7 + Tailwind v4 |
| Backend | Cloudflare Worker (Hono) + Cron Triggers, servido junto al SPA (Workers Static Assets) |
| DB | Supabase (Postgres) — proyecto `Indiggo` (`<tu-proyecto-supabase>`) |
| IA texto | Claude API (Anthropic) |
| IA imagen/video | kie.ai |
| Auth | Cloudflare Access (Zero Trust) — se configura sobre el deploy, no hay auth en el código |

## Desarrollo

```bash
npm install
cp .env.example .dev.vars   # y completá las claves
npm run dev                 # http://localhost:5173  (SPA + worker + cron, todo en uno)
```

`npm run dev` levanta Vite con el plugin de Cloudflare: el mismo servidor sirve el
SPA con HMR y el Worker real (`/api/*`) sobre el runtime de workerd.

### Claves

Nunca van al repo. En local viven en `.dev.vars` (git-ignored). En producción:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put KIE_API_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put ML_CLIENT_ID
npx wrangler secret put ML_CLIENT_SECRET
npx wrangler secret put ML_REDIRECT_URI
npx wrangler secret put ML_SELLER_ID
```

## Build y deploy

```bash
npm run build     # wrangler types + tsc + vite build  ->  dist/
npm run deploy    # build + wrangler deploy
```

Primera vez (una sola):

```bash
npm run deploy                       # crea el Worker, imprime la URL .workers.dev
npx wrangler secret bulk .dev.vars   # sube los secretos al Worker desplegado
```

## Conectar Mercado Libre

1. En el devcenter de ML, poné como **Redirect URI**:
   `https://<url-del-worker>/api/ml/callback`
2. Abrí `https://<url-del-worker>/api/ml/connect` en el browser y autorizá.
3. Vuelve a `/configuracion?ml=conectado` y arranca solo el primer sync
   (publicaciones + variantes + pedidos de los últimos 60 días).

El `access_token` (6 h) se refresca solo por cron cada 4 h; el sync corre cada hora.

## Estructura

```
src/
  App.tsx              layout + ruteo (sidebar fijo + drawer mobile)
  components/          Sidebar, Logo, íconos, primitivos de UI
  pages/               Inicio, Publicaciones, Stock, Metricas, Contenido, Configuracion
  data/mock.ts         datos de muestra del esqueleto (se reemplazan módulo a módulo)
  lib/                 tipos del dominio + helpers de formato
worker/
  index.ts             entry: fetch (Hono) + scheduled (cron)
  routes/api.ts        /api/health, /api/status
  cron.ts              handlers de los cron triggers (stub)
public/brand/          logos exportados del brand guide
```

## Estado

Esqueleto navegable con datos mock en los 6 módulos, fiel al diseño
`Panel Indiggo.dc.html`. Próximo: schema en Supabase y conexión módulo por módulo,
empezando por Stock y Publicaciones.
