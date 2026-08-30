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
ML también notifica en tiempo real a `/api/ml/notifications`.

## Seguridad

Ver [`docs/seguridad.md`](docs/seguridad.md). Resumen:

1. **Clave del panel** (ya en el código): `npx wrangler secret put PANEL_TOKEN`
2. **Cloudflare Access** (login con Google): se configura una vez en el dashboard de Zero Trust.

## Estructura

```
src/
  App.tsx              layout + ruteo (sidebar fijo + drawer mobile) + Gate (clave)
  components/          Sidebar, Logo, Gate, íconos, primitivos de UI
  pages/               Inicio, Publicaciones, Stock, Metricas, Contenido, Configuracion
  lib/                 api (fetch + hook), auth, theme, format, database.types
worker/
  index.ts             entry: fetch (Hono) + scheduled (cron)
  routes/              api (+ gate), ml, catalogo, panel, ia, contenido
  lib/                 ml (OAuth), sync, derivar (catálogo), bom (planificador),
                       alertas, claude, kie, supabase
supabase/migrations/   0001-0010
docs/seguridad.md      pasos para PANEL_TOKEN y Cloudflare Access
```

## Módulos

| Módulo | Qué hace |
|---|---|
| **Inicio** | Resumen del día + alertas automáticas (stock, publicaciones, producción) + últimos pedidos |
| **Publicaciones** | Lista real de ML · "IA" por fila (reescribe título/desc, aplica a ML) · "+ Crear con IA" (crea en pausa) · "Editar precios" (masivo por %) |
| **Stock y producción** | Tabs Variantes / Insumos con edición inline · pushea el buffer a ML · planificador que explota la lista de materiales (cuerpos 3D + photocards) |
| **Métricas** | Ventas por día, totales, ticket, top 5, comparación con el período anterior |
| **Contenido** | Imagen (nano-banana) o video (Veo3) + caption + hashtags con Claude, usando la foto real del producto |
| **Configuración** | Conectar ML · derivar catálogo y lista de materiales · grupos e integrantes · estado de conexiones |

## Cómo funciona la sincronización

- OAuth2 + PKCE. El `access_token` (6 h) se refresca solo por cron cada 4 h.
- Sync completo (publicaciones + variantes + pedidos 60 d) por cron cada hora, y
  webhook en tiempo real a `/api/ml/notifications` cuando cambia algo.
- Al final de cada sync se regeneran las alertas.

## Estado

Los 6 módulos funcionan con datos reales de la cuenta INDIGGOSTORE. Pendiente:
Cloudflare Access, carga del stock físico, ajuste fino del BOM.
