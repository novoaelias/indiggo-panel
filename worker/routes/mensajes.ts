import { Hono } from "hono";
import type { Env } from "../env";
import { supa } from "../lib/supabase";
import {
  LIMITE_INICIO,
  enviarMensaje,
  iniciarConversacion,
  leerConversacion,
  redactarMensaje,
} from "../lib/mensajes";

// Chat posventa de cada pedido. `:pack` es el pack_id de la venta, o el id del
// pedido cuando ML no lo agrupó en un pack.
export const mensajes = new Hono<{ Bindings: Env }>();
type LooseDb = { from: (name: string) => any };
const dbFor = (env: Env) => supa(env) as unknown as LooseDb & Parameters<typeof leerConversacion>[1];

/** La venta a la que pertenece el pack: sin esto se podría escribirle a
 *  cualquier pack de la cuenta con un id inventado. */
async function ventaDelPack(db: LooseDb, packId: string) {
  if (!/^\d+$/.test(packId)) return null;
  const { data } = await db
    .from("ml_orders")
    .select("id, ml_order_id, comprador, raw")
    .or(`ml_order_id.eq.${packId},raw->>pack_id.eq.${packId}`);
  const pedidos = (data ?? []) as Array<{
    id: string;
    ml_order_id: string;
    comprador: string | null;
    raw: { buyer?: { id?: number | string } } | null;
  }>;
  if (!pedidos.length) return null;
  const compradorId = pedidos.map((p) => p.raw?.buyer?.id).find((id) => id != null);
  const { data: items } = await db
    .from("ml_order_items")
    .select("titulo, cantidad")
    .in(
      "ml_order_id",
      pedidos.map((p) => p.id),
    );
  return {
    comprador: pedidos[0].comprador,
    compradorId: compradorId != null ? String(compradorId) : null,
    productos: ((items ?? []) as Array<{ titulo: string | null; cantidad: number | null }>)
      .filter((it) => it.titulo)
      .map((it) => `${(it.cantidad ?? 1) > 1 ? `${it.cantidad}× ` : ""}${it.titulo}`),
  };
}

mensajes.get("/:pack", async (c) => {
  const db = dbFor(c.env);
  const packId = c.req.param("pack");
  if (!(await ventaDelPack(db, packId))) return c.json({ error: "venta no encontrada" }, 404);
  try {
    return c.json(await leerConversacion(c.env, db, packId));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

mensajes.post("/:pack/redactar", async (c) => {
  const db = dbFor(c.env);
  const packId = c.req.param("pack");
  const body = await c.req.json<{ borrador?: string; inicio?: boolean }>();
  if (!body.borrador?.trim()) return c.json({ error: "escribí primero qué querés decir" }, 400);
  const venta = await ventaDelPack(db, packId);
  if (!venta) return c.json({ error: "venta no encontrada" }, 404);
  try {
    const conv = await leerConversacion(c.env, db, packId);
    const texto = await redactarMensaje(c.env, db, {
      borrador: body.borrador.trim(),
      limite: body.inicio ? LIMITE_INICIO : conv.max_largo,
      conversacion: conv.mensajes,
      productos: venta.productos,
    });
    return c.json({ texto });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

mensajes.post("/:pack/enviar", async (c) => {
  const db = dbFor(c.env);
  const packId = c.req.param("pack");
  const body = await c.req.json<{ texto?: string }>();
  const texto = body.texto?.trim();
  if (!texto) return c.json({ error: "el mensaje está vacío" }, 400);
  const venta = await ventaDelPack(db, packId);
  if (!venta?.compradorId) return c.json({ error: "venta no encontrada" }, 404);
  try {
    await enviarMensaje(c.env, db, packId, venta.compradorId, texto);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

mensajes.post("/:pack/iniciar", async (c) => {
  const db = dbFor(c.env);
  const packId = c.req.param("pack");
  const body = await c.req.json<{ opcion?: string; texto?: string }>();
  if (!(await ventaDelPack(db, packId))) return c.json({ error: "venta no encontrada" }, 404);
  try {
    // Se vuelve a leer la guía de ML: la opción tiene que seguir disponible.
    const conv = await leerConversacion(c.env, db, packId);
    const opcion = conv.opciones.find((o) => o.id === body.opcion);
    if (!opcion) return c.json({ error: "Mercado Libre ya no permite esa opción en esta venta" }, 409);
    const texto = body.texto?.trim() ?? "";
    if (opcion.tipo === "libre") {
      if (!texto) return c.json({ error: "el mensaje está vacío" }, 400);
      if (texto.length > (opcion.limite ?? LIMITE_INICIO))
        return c.json({ error: `el mensaje pasa los ${opcion.limite ?? LIMITE_INICIO} caracteres` }, 400);
    }
    await iniciarConversacion(c.env, db, packId, {
      id: opcion.id,
      plantilla_id: opcion.plantilla_id,
      texto,
    });
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});
