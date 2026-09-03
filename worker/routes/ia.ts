import { Hono } from "hono";
import type { Env } from "../env";
import { supa } from "../lib/supabase";
import { claude, mensajeConImagenes, parseJsonLaxo } from "../lib/claude";
import { mlFetch } from "../lib/ml";
import { syncOneItem } from "../lib/sync";
import { derivarCatalogo } from "../lib/derivar";

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

// ---------------------------------------------------------------------------
// Crear publicación nueva con IA: Elias sube fotos + describe el producto y,
// opcionalmente, define variantes (eje + valores, cada una con su foto).
// ---------------------------------------------------------------------------

// Sube UNA imagen al bucket público "publicaciones" y devuelve su URL. El panel
// llama esto por cada archivo antes de generar / publicar.
ia.post("/imagen", async (c) => {
  const form = await c.req.parseBody().catch(() => null);
  const file = form?.["file"];
  if (!(file instanceof File) || file.size === 0)
    return c.json({ error: "no llegó ningún archivo" }, 400);
  if (file.size > 15 * 1024 * 1024)
    return c.json({ error: "la imagen supera 15 MB" }, 400);

  const tipo = file.type || "image/jpeg";
  const ext = tipo.includes("png")
    ? "png"
    : tipo.includes("webp")
      ? "webp"
      : "jpg";
  const db = supa(c.env);
  const mes = new Date().toISOString().slice(0, 7); // YYYY-MM
  const path = `${mes}/${crypto.randomUUID()}.${ext}`;
  const up = await db.storage
    .from("publicaciones")
    .upload(path, await file.arrayBuffer(), { contentType: tipo, upsert: false });
  if (up.error) return c.json({ error: up.error.message }, 502);

  const url = db.storage.from("publicaciones").getPublicUrl(path).data.publicUrl;
  return c.json({ url, path });
});

interface MlCatAttr {
  id: string;
  name: string;
  tags?: Record<string, boolean>;
  values?: Array<{ name: string }>;
}

async function categoriaAttrs(
  env: Env,
  db: ReturnType<typeof supa>,
  categoriaId: string,
): Promise<MlCatAttr[]> {
  try {
    const r = await mlFetch(env, db, `/categories/${categoriaId}/attributes`);
    if (r.ok) return (await r.json()) as MlCatAttr[];
  } catch {
    /* sin atributos */
  }
  return [];
}

interface PropuestaNueva {
  titulo: string;
  descripcion: string;
  palabras_clave: string[];
  precio_sugerido: number | null;
  atributos_sugeridos: Array<{ id?: string; nombre: string; valor: string }>;
}

// Genera una propuesta de publicación nueva a partir de fotos + descripción.
// Read-only: no crea nada en ML.
ia.post("/nueva", async (c) => {
  const body = await c.req.json<{
    descripcion?: string;
    idea?: string; // compatibilidad con la versión vieja
    precio?: number;
    imagenes?: string[];
    variantes?: { eje?: string; valores?: string[] };
  }>();

  const texto = (body.descripcion ?? body.idea ?? "").trim();
  const imagenes = (body.imagenes ?? []).filter(Boolean).slice(0, 16);
  if (!texto && imagenes.length === 0)
    return c.json({ error: "contá qué es el producto o subí una foto" }, 400);

  const db = supa(c.env);
  const ejeVariante = body.variantes?.eje?.trim();
  const valoresVariante = (body.variantes?.valores ?? [])
    .map((v) => v.trim())
    .filter(Boolean);

  const instruccion = `Product a publicar en Mercado Libre Argentina.
${texto ? `Descripción de Elias: ${texto}` : "(sin texto, guiate por las fotos)"}
${body.precio ? `Precio objetivo: $${body.precio}` : ""}
${imagenes.length ? `Adjunto ${imagenes.length} foto(s) del producto real.` : ""}
${
  ejeVariante
    ? `La publicación va a tener variantes por "${ejeVariante}"${
        valoresVariante.length ? `: ${valoresVariante.join(", ")}` : ""
      }. El título y la descripción tienen que servir para todas las variantes (no nombres una sola).`
    : ""
}

Devolvé SOLO este JSON:
{
  "titulo": "título optimizado, máx 60 caracteres",
  "descripcion": "descripción completa con viñetas (guiones)",
  "palabras_clave": ["term1", "term2", "..."],
  "precio_sugerido": número en pesos argentinos o null,
  "atributos_sugeridos": [
    { "nombre": "Material", "valor": "PLA" },
    { "nombre": "Personaje", "valor": "..." }
  ]
}
En "atributos_sugeridos" poné sólo lo que puedas deducir con seguridad de las fotos o el texto
(material, color, tipo de producto, grupo de kpop, personaje). No inventes marca ni medidas.`;

  let propuesta: PropuestaNueva;
  try {
    const { texto: salida } = await claude(c.env, {
      system: CONTEXTO_INDIGGO,
      messages: [
        imagenes.length
          ? mensajeConImagenes(instruccion, imagenes)
          : { role: "user", content: instruccion },
      ],
      maxTokens: 1600,
    });
    propuesta = parseJsonLaxo<PropuestaNueva>(salida);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
  if (propuesta.titulo && propuesta.titulo.length > 60)
    propuesta.titulo = propuesta.titulo.slice(0, 60).trim();
  if (!Array.isArray(propuesta.atributos_sugeridos))
    propuesta.atributos_sugeridos = [];

  // categoría sugerida por ML
  let categoria: { id: string; nombre: string } | null = null;
  try {
    const r = await mlFetch(
      c.env,
      db,
      `/sites/MLA/domain_discovery/search?limit=1&q=${encodeURIComponent(propuesta.titulo || texto)}`,
    );
    if (r.ok) {
      const arr = (await r.json()) as Array<{
        category_id?: string;
        category_name?: string;
      }>;
      if (arr[0]?.category_id)
        categoria = {
          id: arr[0].category_id,
          nombre: arr[0].category_name ?? "",
        };
    }
  } catch {
    /* la elige Elias si falla */
  }

  // atributos de la categoría: obligatorios + los que admiten variación
  let atributos_requeridos: Array<{
    id: string;
    nombre: string;
    valores: string[];
  }> = [];
  let variacion: {
    atributos: Array<{ id: string; nombre: string; valores: string[] }>;
    sugerido_id: string | null;
  } | null = null;

  if (categoria) {
    const attrs = await categoriaAttrs(c.env, db, categoria.id);
    atributos_requeridos = attrs
      .filter((a) => a.tags?.required)
      .slice(0, 12)
      .map((a) => ({
        id: a.id,
        nombre: a.name,
        valores: (a.values ?? []).slice(0, 25).map((v) => v.name),
      }));

    if (ejeVariante) {
      const varAttrs = attrs
        .filter((a) => a.tags?.allow_variations)
        .map((a) => ({
          id: a.id,
          nombre: a.name,
          valores: (a.values ?? []).slice(0, 40).map((v) => v.name),
        }));
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
      const match = varAttrs.find(
        (a) => norm(a.nombre) === norm(ejeVariante),
      );
      const parcial = varAttrs.find(
        (a) =>
          norm(a.nombre).includes(norm(ejeVariante)) ||
          norm(ejeVariante).includes(norm(a.nombre)),
      );
      const color = varAttrs.find((a) => /color/i.test(a.nombre));
      variacion = {
        atributos: varAttrs,
        sugerido_id:
          match?.id ??
          parcial?.id ??
          (/(color|personaje|integrante|miembro|figura)/i.test(ejeVariante)
            ? (color?.id ?? varAttrs[0]?.id ?? null)
            : (varAttrs[0]?.id ?? null)),
      };
    }
  }

  return c.json({
    propuesta,
    categoria,
    atributos_requeridos,
    variacion,
  });
});

interface PublicarBody {
  titulo?: string;
  descripcion?: string;
  categoria_id?: string;
  precio?: number;
  stock?: number;
  imagenes?: string[];
  atributos?: Array<{ id: string; value_name: string }>;
  variantes?: {
    atributo_id?: string;
    atributo_nombre?: string;
    items?: Array<{
      value_name: string;
      imagenes?: string[];
      stock?: number;
      precio?: number;
    }>;
  };
}

// Crea la publicación en Mercado Libre EN PAUSA (Elias la activa desde ML tras
// revisarla). Soporta variantes: cada una con su combinación, stock y fotos.
ia.post("/publicar", async (c) => {
  const body = await c.req.json<PublicarBody>();

  if (!body.titulo || !body.categoria_id || !body.precio)
    return c.json({ error: "faltan título, categoría o precio" }, 400);

  const db = supa(c.env);
  const fotosProducto = (body.imagenes ?? []).filter(Boolean);
  const atributos = (body.atributos ?? []).filter((a) => a.id && a.value_name);

  const variantesRaw = (body.variantes?.items ?? []).filter((v) =>
    v.value_name?.trim(),
  );
  const conVariantes = variantesRaw.length > 0;

  // pool de fotos del item = fotos del producto + todas las de las variantes
  const poolFotos = [
    ...fotosProducto,
    ...variantesRaw.flatMap((v) => (v.imagenes ?? []).filter(Boolean)),
  ];
  const poolUnico = [...new Set(poolFotos)].slice(0, 12);

  const item: Record<string, unknown> = {
    title: body.titulo.slice(0, 60),
    category_id: body.categoria_id,
    currency_id: "ARS",
    buying_mode: "buy_it_now",
    condition: "new",
    listing_type_id: "gold_special",
    pictures: poolUnico.map((source) => ({ source })),
    attributes: atributos,
  };

  const avisos: string[] = [];
  if (poolFotos.length > 12)
    avisos.push(
      "Mercado Libre acepta hasta 12 fotos por publicación; se recortaron las últimas.",
    );

  if (conVariantes) {
    const attrId = body.variantes?.atributo_id?.trim();
    const attrNombre = body.variantes?.atributo_nombre?.trim() || "Variante";
    item.variations = variantesRaw.map((v) => {
      const combo = attrId
        ? { id: attrId, value_name: v.value_name.trim() }
        : { name: attrNombre, value_name: v.value_name.trim() };
      const pics = (v.imagenes ?? []).filter(Boolean);
      return {
        attribute_combinations: [combo],
        available_quantity: Math.max(v.stock ?? body.stock ?? 1, 1),
        price: v.precio ?? body.precio,
        ...(pics.length ? { picture_ids: pics } : {}),
      };
    });
  } else {
    item.price = body.precio;
    item.available_quantity = Math.max(body.stock ?? 1, 1);
  }

  const r = await mlFetch(c.env, db, "/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(item),
  });
  const creado = (await r.json().catch(() => ({}))) as {
    id?: string;
    permalink?: string;
    message?: string;
    cause?: Array<{ message?: string; code?: string }>;
  };
  if (!r.ok || !creado.id) {
    const detalle =
      (creado.cause ?? [])
        .map((x) => x.message || x.code)
        .filter(Boolean)
        .join(" · ") ||
      creado.message ||
      JSON.stringify(creado);
    return c.json({ error: detalle.slice(0, 600) }, 502);
  }

  // pausar + descripción
  await mlFetch(c.env, db, `/items/${creado.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "paused" }),
  });
  if (body.descripcion?.trim()) {
    const rd = await mlFetch(c.env, db, `/items/${creado.id}/description`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plain_text: body.descripcion.trim() }),
    });
    if (!rd.ok) avisos.push("No se pudo guardar la descripción; cargala a mano.");
  }

  try {
    await syncOneItem(c.env, db, creado.id);
    await derivarCatalogo(db);
  } catch (e) {
    avisos.push(`sync interno: ${(e as Error).message}`);
  }

  return c.json({
    ml_item_id: creado.id,
    permalink: creado.permalink ?? null,
    variantes: conVariantes ? variantesRaw.length : 0,
    avisos,
  });
});

// Aplica cambios a Mercado Libre. Se llama SÓLO cuando Elias confirma en el panel.
ia.post("/publicacion/:id/aplicar", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ titulo?: string; descripcion?: string }>();

  const db = supa(c.env);
  const { data: l, error } = await db
    .from("ml_listings")
    .select("ml_item_id")
    .eq("id", id)
    .single();
  if (error || !l) return c.json({ error: "publicación no encontrada" }, 404);

  const aplicado: string[] = [];
  const errores: string[] = [];

  if (body.titulo?.trim()) {
    const r = await mlFetch(c.env, db, `/items/${l.ml_item_id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: body.titulo.trim().slice(0, 60) }),
    });
    if (r.ok) aplicado.push("título");
    else errores.push(`título: ${(await r.text()).slice(0, 200)}`);
  }

  if (body.descripcion?.trim()) {
    const r = await mlFetch(
      c.env,
      db,
      `/items/${l.ml_item_id}/description`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plain_text: body.descripcion.trim() }),
      },
    );
    if (r.ok) aplicado.push("descripción");
    else errores.push(`descripción: ${(await r.text()).slice(0, 200)}`);
  }

  if (aplicado.length) {
    try {
      await syncOneItem(c.env, db, l.ml_item_id);
    } catch (e) {
      errores.push(`re-sync: ${(e as Error).message}`);
    }
  }

  return c.json({ aplicado, errores }, errores.length && !aplicado.length ? 502 : 200);
});
