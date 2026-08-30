import { Hono } from "hono";
import type { Env } from "../env";
import { supa } from "../lib/supabase";
import { claude, parseJsonLaxo } from "../lib/claude";
import { encolarVideo, estadoVideo, generarImagen } from "../lib/kie";

export const contenido = new Hono<{ Bindings: Env }>();
type DB = ReturnType<typeof supa>;

const SISTEMA = `Sos el creador de contenido de Indiggo Store (merch de kpop impreso en 3D,
vende en Mercado Libre Argentina: holders/porta photocards, mostacillas, clickers, llaveros,
stickers). El contenido es para Instagram y TikTok, apuntado a fans de kpop jóvenes de Argentina.
Tono cercano, entusiasta, nada corporativo. Español rioplatense.`;

interface GenIA {
  prompt_media: string;
  caption: string;
  hashtags: string;
}

async function guardarEnStorage(
  db: DB,
  url: string,
  ext: "png" | "mp4",
): Promise<string> {
  try {
    const res = await fetch(url);
    const bytes = await res.arrayBuffer();
    const path = `${crypto.randomUUID()}.${ext}`;
    const up = await db.storage
      .from("contenido")
      .upload(path, bytes, {
        contentType: ext === "mp4" ? "video/mp4" : "image/png",
        upsert: false,
      });
    if (!up.error)
      return db.storage.from("contenido").getPublicUrl(path).data.publicUrl;
  } catch {
    /* fallback */
  }
  return url;
}

// Genera una pieza de contenido. Imagen = sincrónico (~20 s). Video = async
// (se devuelve estado "generando" y se poolea con /:id/refrescar).
contenido.post("/generar", async (c) => {
  const body = await c.req.json<{
    producto_id?: string;
    plataforma?: "instagram" | "tiktok";
    formato?: "imagen" | "video";
    objetivo?: string;
  }>();
  const plataforma = body.plataforma === "tiktok" ? "tiktok" : "instagram";
  const formato = body.formato === "video" ? "video" : "imagen";
  const db = supa(c.env);

  let contextoProducto = "un producto de la tienda";
  const referencias: string[] = [];
  if (body.producto_id) {
    const { data: p } = await db
      .from("products")
      .select("nombre, categories(nombre), groups(nombre)")
      .eq("id", body.producto_id)
      .single();
    if (p) {
      const cat = (p.categories as { nombre?: string } | null)?.nombre;
      const grp = (p.groups as { nombre?: string } | null)?.nombre;
      contextoProducto = `${p.nombre}${cat ? ` (${cat})` : ""}${grp ? `, grupo ${grp}` : ""}`;
    }
    const { data: ml } = await db
      .from("ml_listings")
      .select("thumbnail")
      .eq("product_id", body.producto_id)
      .limit(1)
      .maybeSingle();
    if (ml?.thumbnail)
      referencias.push(ml.thumbnail.replace(/^http:/, "https:"));
  }
  const hayRef = referencias.length > 0;

  const { texto } = await claude(c.env, {
    system: SISTEMA,
    messages: [
      {
        role: "user",
        content: `Producto: ${contextoProducto}
Plataforma: ${plataforma}
Formato: ${formato}
${body.objetivo ? `Objetivo: ${body.objetivo}` : ""}
${hayRef ? "Hay una FOTO DE REFERENCIA del producto real; el prompt debe mantener el producto tal cual, mejorando luz/fondo/encuadre." : ""}

Devolvé SOLO este JSON:
{
  "prompt_media": "prompt EN INGLÉS para ${
    formato === "video"
      ? "un clip corto vertical mostrando el producto con movimiento suave de cámara"
      : hayRef
        ? "editar la foto de referencia"
        : "una foto de producto tipo flat-lay o lifestyle"
  }, estética kpop, violeta suave, fondo limpio, sin texto en pantalla",
  "caption": "texto del posteo en español, 2-4 líneas, con gancho al inicio",
  "hashtags": "8-12 hashtags relevantes separados por espacio, en una línea"
}`,
      },
    ],
    maxTokens: 900,
  });
  const gen = parseJsonLaxo<GenIA>(texto);

  if (formato === "video") {
    const taskId = await encolarVideo(c.env, {
      prompt: gen.prompt_media,
      aspectRatio: plataforma === "tiktok" ? "9:16" : "9:16",
      imageUrls: referencias,
    });
    const { data: pieza, error } = await db
      .from("content_pieces")
      .insert({
        plataforma,
        formato: "video",
        estado: "generando",
        kie_task_id: taskId,
        caption: gen.caption,
        hashtags: gen.hashtags,
        product_id: body.producto_id ?? null,
      })
      .select("*")
      .single();
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ pieza });
  }

  // imagen
  const { url } = await generarImagen(c.env, {
    prompt: gen.prompt_media,
    aspectRatio: plataforma === "tiktok" ? "9:16" : "4:5",
    imageUrls: referencias,
  });
  const mediaUrl = await guardarEnStorage(db, url, "png");

  const { data: pieza, error } = await db
    .from("content_pieces")
    .insert({
      plataforma,
      formato: "imagen",
      estado: "listo",
      caption: gen.caption,
      hashtags: gen.hashtags,
      media_url: mediaUrl,
      product_id: body.producto_id ?? null,
    })
    .select("*")
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ pieza });
});

// Poolea un video pendiente y, si terminó, lo baja a Storage.
contenido.post("/:id/refrescar", async (c) => {
  const db = supa(c.env);
  const { data: p } = await db
    .from("content_pieces")
    .select("id, estado, kie_task_id")
    .eq("id", c.req.param("id"))
    .single();
  if (!p) return c.json({ error: "no encontrada" }, 404);
  if (p.estado !== "generando" || !p.kie_task_id)
    return c.json({ estado: p.estado });

  const st = await estadoVideo(c.env, p.kie_task_id);
  if (st.estado === "generando") return c.json({ estado: "generando" });

  if (st.estado === "error") {
    await db
      .from("content_pieces")
      .update({ estado: "error", error: st.detalle })
      .eq("id", p.id);
    return c.json({ estado: "error", error: st.detalle });
  }

  const mediaUrl = await guardarEnStorage(db, st.url, "mp4");
  await db
    .from("content_pieces")
    .update({ estado: "listo", media_url: mediaUrl })
    .eq("id", p.id);
  return c.json({ estado: "listo", media_url: mediaUrl });
});

contenido.get("/", async (c) => {
  const db = supa(c.env);
  const { data, error } = await db
    .from("content_pieces")
    .select(
      "id, plataforma, formato, caption, hashtags, media_url, estado, error, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ piezas: data });
});

contenido.delete("/:id", async (c) => {
  const db = supa(c.env);
  const { error } = await db
    .from("content_pieces")
    .delete()
    .eq("id", c.req.param("id"));
  if (error) return c.json({ error: error.message }, 500);
  return c.body(null, 204);
});
