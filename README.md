# Indiggo · Panel

Panel privado de un solo usuario para automatizar la operación de **Indiggo Store**
en Mercado Libre (site MLA): catálogo consolidado, inventario físico, producción,
pedidos, preguntas, métricas y contenido para redes.

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
npx wrangler secret put VAPID_SERVER_PUBLIC_KEY
npx wrangler secret put VAPID_SERVER_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
```

## Build y deploy

```bash
npm run build     # wrangler types + tsc + vite build  ->  dist/
npm test          # pruebas críticas de inventario, concurrencia y preguntas
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

Todas las publicaciones creadas desde el panel, incluidas las republicaciones, se crean en
pausa y deben quedar verificadas con **Mercado Envíos sin Flex**. El cron también corrige Flex
si Mercado Libre lo vuelve a habilitar o si una publicación entró por fuera del panel.

ML también notifica en tiempo real. En el devcenter, la app tiene la misma URL
para el redirect de OAuth y para las notificaciones, así que el Worker acepta el
POST de ML tanto en `/api/ml/notifications` como en `/api/ml/callback`.

## Seguridad

Ver [`docs/seguridad.md`](docs/seguridad.md). Resumen:

1. **Clave del panel** (ya en el código): `npx wrangler secret put PANEL_TOKEN`
2. **Cloudflare Access** (login con Google): se configura una vez en el dashboard de Zero Trust.

## Estructura

```
src/
  App.tsx              layout + ruteo (sidebar fijo + drawer mobile) + Gate (clave)
  components/          Sidebar, Logo, Gate, íconos, primitivos de UI
  pages/               Inicio, Pedidos, Preguntas, Inventario, Produccion,
                       Publicaciones, Metricas, Contenido, Configuracion
  lib/                 api (fetch + hook), auth, theme, format, database.types
worker/
  index.ts             entry: fetch (Hono) + scheduled (cron)
  routes/              api (+ gate), ml, inventario, preguntas, catalogo, panel,
                       ia, seo, contenido
  lib/                 ml (OAuth), sync, derivar (catálogo), inventory-logic
                       (armados y piezas compartidas), stock (colchón de ML),
                       questions, push, bom (planificador), alertas, claude,
                       kie, sheets, supabase
tests/                 inventario, contrato de migraciones y preguntas
public/                manifest.webmanifest + sw.js (app en la pantalla de inicio)
supabase/migrations/   esquema, inventario transaccional, preguntas y Web Push
docs/seguridad.md      pasos para PANEL_TOKEN y Cloudflare Access
```

## Módulos

| Módulo | Qué hace |
|---|---|
| **Inicio** | Resumen del día + alertas automáticas (stock, publicaciones, producción) + últimos pedidos |
| **Publicaciones** | Lista real de ML · "IA" por fila (reescribe título/desc, aplica a ML) · "+ Crear con IA" (crea en pausa) · "Editar precios" (masivo por %) |
| **Inventario** | Productos terminados, reservas, piezas compartidas, recetas editables y movimientos trazables |
| **Producción** | Registro de impresiones y armados sugeridos sin asignar una pieza dos veces |
| **Preguntas** | Historial, respuesta automática con fuentes, revisión del vendedor y avisos Web Push |
| **Métricas** | Ventas, cobertura, faltantes y proporción de respuestas automáticas |
| **Contenido** | Imagen (nano-banana) o video (Veo3) + caption + hashtags con Claude, usando la foto real del producto |
| **Configuración** | Conectar ML · reglas comerciales que la IA puede afirmar · notificaciones del iPhone · envíos · derivar catálogo · grupos e integrantes |

## Cómo funciona la sincronización

- OAuth2 + PKCE. El `access_token` (6 h) se refresca solo por cron cada 4 h.
- Sync completo (publicaciones + variantes + pedidos 60 d) por cron cada hora, y
  webhook en tiempo real a `/api/ml/notifications` cuando cambia algo.
- Los pedidos pagados reservan terminados. El despacho consume la reserva una sola vez.
- El stock físico y el publicado se mantienen separados; ML conserva el colchón 2 / +3.
- Las preguntas llegan por webhook y se reconcilian cada hora por si se pierde un evento.

## Estado

Antes de desplegar una versión que agregue tablas, aplicá las migraciones de
`supabase/migrations` en orden. La migración `0023` guarda un snapshot del catálogo
anterior (tabla `inventory_legacy_snapshot`) antes de consolidar el inventario;
`0025` cierra el acceso público a las funciones de inventario y `0026` evita que
un pedido ya despachado vuelva a reservar stock.

Para recibir los avisos en el iPhone: abrí el panel en Safari, **Compartir →
Agregar a inicio**, abrilo desde el ícono y tocá **Activar notificaciones** en
Configuración (iOS 16.4 o posterior).
