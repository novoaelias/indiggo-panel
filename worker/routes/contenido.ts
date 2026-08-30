import { Hono } from "hono";
import type { Env } from "../env";
import { supa } from "../lib/supabase";
import { claude, parseJsonLaxo } from "../lib/claude";
import { generarImagen } from "../lib/kie";

export const contenido = new Hono<{ Bindings: Env }>();

const SISTEMA = `Sos el creador de contenido de Indiggo Store (merch de kpop impreso en 3D,
vende en Mercado Libre Argentina: holders/porta photocards, mostacillas, clickers, llaveros,
stickers). El contenido es para Instagram y TikTok, apuntado a fans de kpop jóvenes de Argentina.
Tono cercano, entusiasta, nada corporativo. Español rioplatense.`;

interface GenIA {
  prompt_imagen: string;
  caption: string;
  hashtags: string;
}

// Genera una pieza de contenido (imagen + caption + hashtags) para redes.
contenido.post("/generar", async (c) => {
  const body = await c.req.json<{
    producto_id?: string;
    plataforma?: "instagram" | "tiktok";
    objetivo?: string;
  }>();
  const plataforma = body.plataforma === "tiktok" ? "tiktok" : "instagram";
  const db = supa(c.env);

  let contextoProducto = "un producto de la tienda";
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
  }

  // 1. Claude: prompt de imagen + copy
  const { texto } = await claude(c.env, {
    system: SISTEMA,
    messages: [
      {
        role: "user",
        content: `Producto: ${contextoProducto}
Plataforma: ${plataforma}
${body.objetivo ? `Objetivo: ${body.objetivo}` : ""}

Devolvé SOLO este JSON:
{
  "prompt_imagen": "prompt EN INGLÉS para generar una foto de producto atractiva tipo flat-lay o lifestyle, estética kpop, colores suaves con violeta, fondo limpio. Detallado, sin texto en la imagen.",
  "caption": "texto del posteo en español, 2-4 líneas, con gancho al inicio",
  "hashtags": "8-12 hashtags relevantes separados por espacio, en una línea"
}`,
      },
    ],
    maxTokens: 900,
  });
  const gen = parseJsonLaxo<GenIA>(texto);

  // 2. kie.ai: imagen
  const { url, taskId } = await generarImagen(c.env, {
    prompt: gen.prompt_imagen,
    aspectRatio: plataforma === "tiktok" ? "9:16" : "4:5",
  });

  // 3. guardar copia en Storage (la URL de kie expira ~24 h)
  let mediaUrl = url;
  try {
    const img = await fetch(url);
    const bytes = await img.arrayBuffer();
    const path = `${crypto.randomUUID()}.png`;
    const up = await db.storage
      .from("contenido")
      .upload(path, bytes, { contentType: "image/png", upsert: false });
    if (!up.error) {
      mediaUrl = db.storage.from("contenido").getPublicUrl(path).data.publicUrl;
    }
  } catch {
    /* si falla, queda la URL temporal de kie */
  }

  // 4. persistir
  const { data: pieza, error } = await db
    .from("content_pieces")
    .insert({
      plataforma,
      formato: "imagen",
      caption: gen.caption,
      hashtags: gen.hashtags,
      media_url: mediaUrl,
      product_id: body.producto_id ?? null,
    })
    .select("*")
    .single();
  if (error) return c.json({ error: error.message }, 500);

  return c.json({ pieza, kie_task: taskId });
});

contenido.get("/", async (c) => {
  const db = supa(c.env);
  const { data, error } = await db
    .from("content_pieces")
    .select("id, plataforma, formato, caption, hashtags, media_url, estado, created_at")
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
