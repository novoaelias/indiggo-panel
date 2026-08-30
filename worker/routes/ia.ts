import { Hono } from "hono";
import type { Env } from "../env";
import { supa } from "../lib/supabase";
import { claude, parseJsonLaxo } from "../lib/claude";

export const ia = new Hono<{ Bindings: Env }>();

const CONTEXTO_INDIGGO = `Sos el asistente de redacción de Indiggo Store, una tienda unipersonal
argentina que vende merchandising de kpop en Mercado Libre (site MLA): holders/porta photocards,
mostacillas, clickers, llaveros, stickers. Muchos productos se imprimen en 3D. El público son fans
de kpop (mayormente ARMY y otros fandoms), jóvenes, que compran para sí o para regalar/freebies.

Objetivo: títulos y descripciones que posicionen bien en el buscador de Mercado Libre y convenzan al
fan. Reglas de Mercado Libre y buenas prácticas:
- Título: máximo 60 caracteres, sin signos de puntuación innecesarios, sin "!!!", sin datos de contacto.
  Poné primero lo que la gente busca (tipo de producto + grupo/artista + característica clave).
- No prometas oficialidad ("producto oficial") si no lo es. Es merch de fan.
- Descripción: clara, en español rioplatense neutro, con viñetas cortas. Incluí material, medidas si
  se saben, qué incluye, y para qué sirve. Sin promesas de envío que no podés cumplir.
- Nada de emojis en el título. En la descripción, moderados.`;

interface Sugerencia {
  titulo: string;
  descripcion: string;
  palabras_clave: string[];
  notas: string;
}

// Genera título/descripción sugeridos para una publicación. NO aplica nada:
// devuelve la propuesta para que Elias la revise.
ia.post("/publicacion/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req
    .json<{ objetivo?: string }>()
    .catch(() => ({}) as { objetivo?: string });

  const db = supa(c.env);
  const { data: l, error } = await db
    .from("ml_listings")
    .select("titulo, precio, moneda, raw")
    .eq("id", id)
    .single();
  if (error || !l) return c.json({ error: "publicación no encontrada" }, 404);

  const raw = (l.raw ?? {}) as {
    category_id?: string;
    attributes?: Array<{ name?: string; value_name?: string }>;
    condition?: string;
  };
  const atributos = (raw.attributes ?? [])
    .filter((a) => a.name && a.value_name)
    .slice(0, 20)
    .map((a) => `${a.name}: ${a.value_name}`)
    .join("; ");

  const prompt = `Publicación actual:
Título: ${l.titulo}
Precio: ${l.precio ?? "?"} ${l.moneda}
Condición: ${raw.condition ?? "?"}
Atributos: ${atributos || "(sin datos)"}
${body.objetivo ? `\nPedido de Elias: ${body.objetivo}` : ""}

Devolvé SOLO un objeto JSON con esta forma exacta:
{
  "titulo": "nuevo título optimizado, máx 60 caracteres",
  "descripcion": "descripción completa con viñetas usando guiones",
  "palabras_clave": ["term1", "term2", "..."],
  "notas": "1-2 frases sobre qué cambiaste y por qué"
}`;

  try {
    const { texto, usage } = await claude(c.env, {
      system: CONTEXTO_INDIGGO,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 1600,
    });
    const sug = parseJsonLaxo<Sugerencia>(texto);
    if (sug.titulo && sug.titulo.length > 60)
      sug.titulo = sug.titulo.slice(0, 60).trim();
    return c.json({ sugerencia: sug, tokens: usage });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});
