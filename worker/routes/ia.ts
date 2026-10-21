import { Hono } from "hono";
import type { Env } from "../env";
import { supa } from "../lib/supabase";
import { claude, mensajeConImagenes, parseJsonLaxo } from "../lib/claude";
import {
  costoUsd,
  encargarEdicionPro,
  estadoTarea,
  generarImagen,
  MODELO_EDICION,
} from "../lib/kie";
import { mlFetch } from "../lib/ml";
import { syncOneItem } from "../lib/sync";
import { derivarCatalogo } from "../lib/derivar";
import {
  garantizarMercadoEnviosSinFlex,
  mercadoEnviosSinFlex,
} from "../lib/shipping";

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
  value_type?: string;
  tags?: Record<string, boolean>;
  values?: Array<{ id?: string; name: string }>;
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

// ---------------------------------------------------------------------------
// Borrador de la publicación nueva: un solo JSON en un bucket privado, para que
// el trabajo del modal sobreviva a una recarga (fotos subidas, fotos con IA que
// tardan minutos, atributos editados).
// ---------------------------------------------------------------------------

const BUCKET_BORRADORES = "borradores";
const RUTA_BORRADOR = "publicacion-nueva.json";
const MAX_BORRADOR_BYTES = 500_000;
let bucketBorradoresListo = false;

// Crea el bucket privado la primera vez; si ya existe, no pasa nada.
async function asegurarBucketBorradores(db: ReturnType<typeof supa>): Promise<void> {
  if (bucketBorradoresListo) return;
  const { error } = await db.storage.createBucket(BUCKET_BORRADORES, { public: false });
  if (error && !/already exists|duplicate/i.test(error.message))
    throw new Error(error.message);
  bucketBorradoresListo = true;
}

ia.get("/borrador", async (c) => {
  const db = supa(c.env);
  const { data, error } = await db.storage.from(BUCKET_BORRADORES).download(RUTA_BORRADOR);
  if (error || !data) return c.json({ borrador: null });
  try {
    const borrador = JSON.parse(await data.text()) as Record<string, unknown>;
    const guardado = typeof borrador.guardado_at === "string" ? borrador.guardado_at : undefined;
    return c.json({ borrador, guardado_at: guardado });
  } catch {
    return c.json({ borrador: null });
  }
});

ia.put("/borrador", async (c) => {
  const texto = await c.req.text();
  if (texto.length > MAX_BORRADOR_BYTES)
    return c.json({ error: "El borrador es demasiado grande para guardarse." }, 413);
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    return c.json({ error: "El borrador no es un JSON válido." }, 400);
  }
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo))
    return c.json({ error: "El borrador tiene que ser un objeto." }, 400);

  const db = supa(c.env);
  try {
    await asegurarBucketBorradores(db);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
  const guardado_at = new Date().toISOString();
  const up = await db.storage.from(BUCKET_BORRADORES).upload(
    RUTA_BORRADOR,
    new Blob([JSON.stringify({ ...(cuerpo as object), guardado_at })], {
      type: "application/json",
    }),
    // Sin esto Storage lo sirve con max-age=3600 y al recargar volvía una copia
    // de hasta una hora atrás.
    { contentType: "application/json", upsert: true, cacheControl: "0" },
  );
  if (up.error) return c.json({ error: up.error.message }, 502);
  return c.json({ ok: true, guardado_at });
});

ia.delete("/borrador", async (c) => {
  const db = supa(c.env);
  const { error } = await db.storage.from(BUCKET_BORRADORES).remove([RUTA_BORRADOR]);
  if (error) return c.json({ error: error.message }, 502);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Guías de talles (ropa). Mercado Libre las exige en categorías de moda: el
// ítem lleva SIZE_GRID_ID, SIZE_GRID_ROW_ID y SIZE, y la guía se crea aparte
// en /catalog/charts.
// ---------------------------------------------------------------------------

type DB = ReturnType<typeof supa>;

interface FilaGuia {
  id: string;
  talle: string;
}
interface GuiaTalles {
  id: string;
  nombre: string;
  filas: FilaGuia[];
}
interface Equivalencia {
  id: string;
  name: string;
}

// Equivalencias (FILTRABLE_SIZE) conocidas de T_SHIRTS: sólo de respaldo si
// technical_specs falla.
const EQUIVALENCIAS_RESPALDO: Equivalencia[] = [
  { id: "12917835", name: "3XS" },
  { id: "12917836", name: "2XS" },
  { id: "12917776", name: "XS" },
  { id: "12917796", name: "S" },
  { id: "12917795", name: "M" },
  { id: "12917802", name: "L" },
  { id: "12917787", name: "XL" },
  { id: "12917846", name: "2XL" },
  { id: "12917837", name: "3XL" },
  { id: "12917843", name: "4XL" },
  { id: "12917842", name: "5XL" },
  { id: "12917838", name: "6XL" },
  { id: "12917841", name: "7XL" },
  { id: "12917845", name: "8XL" },
];

const GENERO_POR_DEFECTO = "Sin género";
const MARCA_POR_DEFECTO = "Indiggo Store";
const AGE_GROUP_ADULTOS = { id: "AGE_GROUP", value_id: "6725189", value_name: "Adultos" };
const MSJ_FALTA_GUIA =
  "Esta categoría (moda) pide una guía de talles: elegí o creá una y asigná el talle de cada variante.";

const requiereGuia = (attrs: MlCatAttr[]) => attrs.some((a) => a.value_type === "grid_id");

// Dominio de la categoría ("MLA-T_SHIRTS"). Primero el dato de la categoría;
// si no viene, domain_discovery buscando por el nombre de la categoría.
async function dominioDeCategoria(
  env: Env,
  db: DB,
  categoriaId: string,
): Promise<string | null> {
  let nombre = "";
  try {
    const r = await mlFetch(env, db, `/categories/${categoriaId}`);
    if (r.ok) {
      const j = (await r.json()) as {
        name?: string;
        domain_id?: string;
        settings?: { domain_id?: string };
      };
      const directo = j.domain_id ?? j.settings?.domain_id;
      if (directo) return directo;
      nombre = j.name ?? "";
    }
  } catch {
    /* se prueba con domain_discovery */
  }
  if (!nombre) return null;
  try {
    const r = await mlFetch(
      env,
      db,
      `/sites/MLA/domain_discovery/search?limit=8&q=${encodeURIComponent(nombre)}`,
    );
    if (r.ok) {
      const arr = (await r.json()) as Array<{ category_id?: string; domain_id?: string }>;
      return arr.find((x) => x.category_id === categoriaId)?.domain_id ?? null;
    }
  } catch {
    /* sin dominio */
  }
  return null;
}

// Los endpoints de guías usan el dominio sin el prefijo del sitio ("T_SHIRTS").
const dominioSinSitio = (d: string) => d.replace(/^MLA-/, "");

async function vendedorId(env: Env, db: DB): Promise<string | null> {
  try {
    const r = await mlFetch(env, db, "/users/me");
    if (r.ok) {
      const j = (await r.json()) as { id?: number | string };
      if (j.id) return String(j.id);
    }
  } catch {
    /* se usa la variable de entorno */
  }
  const deEnv = (env as unknown as { ML_SELLER_ID?: string }).ML_SELLER_ID;
  return deEnv ? String(deEnv) : null;
}

// Busca recursivamente el atributo `id` dentro de la respuesta de technical_specs
// (la estructura de grupos/componentes cambia según el dominio).
function buscarAtributo(nodo: unknown, id: string): { values?: unknown } | null {
  if (!nodo || typeof nodo !== "object") return null;
  if (Array.isArray(nodo)) {
    for (const x of nodo) {
      const r = buscarAtributo(x, id);
      if (r) return r;
    }
    return null;
  }
  const o = nodo as Record<string, unknown>;
  if (o.id === id && Array.isArray(o.values)) return o as { values?: unknown };
  for (const v of Object.values(o)) {
    const r = buscarAtributo(v, id);
    if (r) return r;
  }
  return null;
}

async function equivalenciasDeTalle(
  env: Env,
  db: DB,
  dominio: string,
  genero: string,
  generoId: string | undefined,
  marca: string,
): Promise<Equivalencia[]> {
  try {
    const r = await mlFetch(env, db, `/domains/${dominio}/technical_specs?section=grids`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        attributes: [
          { id: "BRAND", value_name: marca, values: [{ name: marca }] },
          {
            id: "GENDER",
            ...(generoId ? { value_id: generoId } : {}),
            value_name: genero,
            values: [generoId ? { id: generoId, name: genero } : { name: genero }],
          },
        ],
      }),
    });
    if (r.ok) {
      const attr = buscarAtributo(await r.json(), "FILTRABLE_SIZE");
      const vals = ((attr?.values as Array<{ id?: string; name?: string }>) ?? [])
        .filter((v) => v.id && v.name)
        .map((v) => ({ id: String(v.id), name: String(v.name) }));
      if (vals.length) return vals;
    }
  } catch {
    /* respaldo */
  }
  return EQUIVALENCIAS_RESPALDO;
}

interface ChartMl {
  id: string | number;
  names?: Record<string, string>;
  rows?: Array<{
    id: string;
    attributes?: Array<{ id: string; values?: Array<{ name?: string }> }>;
  }>;
}

function guiaDeChart(ch: ChartMl): GuiaTalles {
  return {
    id: String(ch.id),
    nombre: ch.names?.MLA ?? `Guía ${ch.id}`,
    filas: (ch.rows ?? []).map((f) => ({
      id: f.id,
      talle:
        f.attributes?.find((a) => a.id === "SIZE")?.values?.[0]?.name ??
        String(f.id).split(":").pop() ??
        f.id,
    })),
  };
}

// Id del valor de GENDER en la categoría, buscado por nombre.
function generoIdDe(attrs: MlCatAttr[], genero: string): string | undefined {
  const g = attrs.find((a) => a.id === "GENDER");
  const n = genero.trim().toLowerCase();
  return g?.values?.find((v) => v.name.trim().toLowerCase() === n)?.id;
}

ia.get("/guias-talles", async (c) => {
  const categoria = c.req.query("categoria")?.trim();
  if (!categoria) return c.json({ error: "falta la categoría" }, 400);
  const genero = c.req.query("genero")?.trim() || GENERO_POR_DEFECTO;
  const marca = c.req.query("marca")?.trim() || MARCA_POR_DEFECTO;
  const db = supa(c.env);

  const attrs = await categoriaAttrs(c.env, db, categoria);
  if (!requiereGuia(attrs)) return c.json({ requiere: false, guias: [], equivalencias: [] });

  const dominioCompleto = await dominioDeCategoria(c.env, db, categoria);
  if (!dominioCompleto)
    return c.json({
      requiere: true,
      guias: [],
      equivalencias: EQUIVALENCIAS_RESPALDO,
      aviso: "No pude averiguar el dominio de la categoría; no se listan guías existentes.",
    });
  const dominio = dominioSinSitio(dominioCompleto);
  const generoId = generoIdDe(attrs, genero);

  let guias: GuiaTalles[] = [];
  let aviso: string | undefined;
  const seller = await vendedorId(c.env, db);
  if (seller) {
    try {
      const r = await mlFetch(c.env, db, "/catalog/charts/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          domain_id: dominio,
          site_id: "MLA",
          seller_id: Number(seller),
          attributes: [
            { id: "GENDER", values: [{ name: genero }] },
            { id: "BRAND", values: [{ name: marca }] },
          ],
        }),
      });
      if (r.ok) {
        const j = (await r.json()) as { charts?: ChartMl[] };
        guias = (j.charts ?? []).map(guiaDeChart);
      } else {
        aviso = `Mercado Libre no listó las guías (${r.status}).`;
      }
    } catch (e) {
      aviso = `No pude listar las guías: ${(e as Error).message}`;
    }
  }

  const equivalencias = await equivalenciasDeTalle(
    c.env,
    db,
    dominioCompleto,
    genero,
    generoId,
    marca,
  );
  return c.json({ requiere: true, dominio: dominioCompleto, guias, equivalencias, aviso });
});

interface CrearGuiaBody {
  categoria?: string;
  genero?: string;
  marca?: string;
  nombre?: string;
  filas?: Array<{
    talle?: string;
    equivalencia_id?: string;
    pecho_persona_cm?: number;
    ancho_prenda_cm?: number;
    largo_prenda_cm?: number | null;
  }>;
}

// Crea la guía en Mercado Libre (escritura real). Devuelve el error de ML tal cual.
ia.post("/guias-talles", async (c) => {
  const body = await c.req.json<CrearGuiaBody>();
  const categoria = body.categoria?.trim();
  if (!categoria) return c.json({ error: "Falta la categoría." }, 400);
  const genero = body.genero?.trim() || GENERO_POR_DEFECTO;
  const marca = body.marca?.trim() || MARCA_POR_DEFECTO;
  // ML sólo admite letras, números y espacios (máx. 60), sin paréntesis ni flechas.
  const nombre = (body.nombre ?? "")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim();
  if (!nombre)
    return c.json({ error: "Ponele un nombre a la guía (sólo letras, números y espacios)." }, 400);
  const filasIn = body.filas ?? [];
  if (filasIn.length === 0) return c.json({ error: "Agregá al menos un talle a la guía." }, 400);
  const positivo = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n) && n > 0;
  for (const [i, f] of filasIn.entries()) {
    const etiqueta = f.talle?.trim() ? `"${f.talle.trim()}"` : `${i + 1}`;
    if (!f.talle?.trim()) return c.json({ error: `La fila ${i + 1} no tiene talle.` }, 400);
    if (!f.equivalencia_id)
      return c.json({ error: `Elegí la equivalencia del talle ${etiqueta}.` }, 400);
    if (f.pecho_persona_cm != null && !positivo(f.pecho_persona_cm))
      return c.json(
        { error: `El contorno de pecho del talle ${etiqueta} tiene que ser mayor a cero.` },
        400,
      );
    if (!positivo(f.ancho_prenda_cm))
      return c.json(
        { error: `El ancho de pecho de la prenda del talle ${etiqueta} tiene que ser mayor a cero.` },
        400,
      );
    if (f.largo_prenda_cm != null && !positivo(f.largo_prenda_cm))
      return c.json(
        { error: `El largo de la prenda del talle ${etiqueta} tiene que ser mayor a cero.` },
        400,
      );
  }

  const db = supa(c.env);
  const attrs = await categoriaAttrs(c.env, db, categoria);
  if (!requiereGuia(attrs)) return c.json({ error: "Esta categoría no usa guía de talles." }, 400);
  const dominioCompleto = await dominioDeCategoria(c.env, db, categoria);
  if (!dominioCompleto)
    return c.json({ error: "No pude averiguar el dominio de la categoría en Mercado Libre." }, 502);
  const dominio = dominioSinSitio(dominioCompleto);
  const generoId = generoIdDe(attrs, genero);
  const equivalencias = await equivalenciasDeTalle(
    c.env,
    db,
    dominioCompleto,
    genero,
    generoId,
    marca,
  );

  // Sin `measure_type`, ML toma la guía como de medidas del cuerpo y rechaza las
  // de la prenda (GARMENT_*) con invalid_row_attribute. Las de la prenda van
  // siempre; el contorno de pecho de la persona es opcional, pero en todas las
  // filas o en ninguna (MIXED_MEASURE exige las dos clases en cada fila).
  const conPecho = filasIn.filter((f) => f.pecho_persona_cm != null).length;
  if (conPecho > 0 && conPecho < filasIn.length)
    return c.json(
      { error: "El contorno de pecho de la persona tiene que ir en todos los talles o en ninguno." },
      400,
    );
  const measureType = conPecho ? "MIXED_MEASURE" : "CLOTHING_MEASURE";

  const cm = (n: number) => ({ name: `${n} cm`, struct: { number: n, unit: "cm" } });
  const filas: Array<{ attributes: unknown[] }> = [];
  for (const f of filasIn) {
    const talle = (f.talle ?? "").trim();
    const eq = equivalencias.find((e) => e.id === f.equivalencia_id);
    if (!eq) return c.json({ error: `La equivalencia del talle "${talle}" no es válida.` }, 400);
    filas.push({
      attributes: [
        { id: "SIZE", values: [{ name: talle }] },
        { id: "FILTRABLE_SIZE", values: [{ id: eq.id, name: eq.name }] },
        { id: "GARMENT_CHEST_WIDTH_FROM", values: [cm(f.ancho_prenda_cm as number)] },
        ...(f.largo_prenda_cm
          ? [{ id: "GARMENT_LENGTH_FROM", values: [cm(f.largo_prenda_cm)] }]
          : []),
        ...(f.pecho_persona_cm != null
          ? [{ id: "CHEST_CIRCUMFERENCE_FROM", values: [cm(f.pecho_persona_cm)] }]
          : []),
      ],
    });
  }

  const payload = {
    names: { MLA: nombre },
    domain_id: dominio,
    site_id: "MLA",
    measure_type: measureType,
    main_attribute: { attributes: [{ site_id: "MLA", id: "SIZE" }] },
    attributes: [
      { id: "GENDER", values: [generoId ? { id: generoId, name: genero } : { name: genero }] },
      { id: "BRAND", values: [{ name: marca }] },
    ],
    rows: filas,
  };

  try {
    const r = await mlFetch(c.env, db, "/catalog/charts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const texto = await r.text();
    let j: (ChartMl & { message?: string; errors?: unknown[]; cause?: unknown[] }) | null = null;
    try {
      j = texto ? JSON.parse(texto) : null;
    } catch {
      /* se devuelve el texto crudo */
    }
    if (!r.ok || !j?.id) {
      const detalle = [j?.message, ...(j?.errors ?? []), ...(j?.cause ?? [])]
        .filter(Boolean)
        .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
        .join(" · ");
      return c.json(
        { error: `Mercado Libre rechazó la guía: ${detalle || texto}`.slice(0, 1500) },
        502,
      );
    }
    const guia = guiaDeChart(j);
    return c.json({ ...guia, nombre: guia.nombre || nombre });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

interface PublicarBody {
  titulo?: string;
  descripcion?: string;
  categoria_id?: string;
  precio?: number;
  stock?: number;
  imagenes?: string[];
  atributos?: Array<{ id: string; value_name: string }>;
  family_name?: string;
  guia_talles?: { id: string };
  talle_fila?: { id: string; talle: string };
  // Sólo valida contra ML (/items/validate) y no crea nada.
  solo_validar?: boolean;
  variantes?: {
    atributo_id?: string;
    atributo_nombre?: string;
    items?: Array<{
      value_name: string;
      imagenes?: string[];
      stock?: number;
      precio?: number;
      talle_fila?: { id: string; talle: string };
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

  const hayFotos =
    fotosProducto.length > 0 || variantesRaw.some((v) => (v.imagenes ?? []).some(Boolean));
  if (!hayFotos) return c.json({ error: "Cargá al menos una foto antes de publicar." }, 400);
  if (!Number.isFinite(body.precio) || body.precio <= 0) return c.json({ error: "Ingresá un precio mayor a cero." }, 400);

  // Moda: ML pide guía de talles. Se chequea antes de tocar nada en ML.
  const catAttrs = await categoriaAttrs(c.env, db, body.categoria_id);
  const exigeGuia = requiereGuia(catAttrs);
  const guiaId = body.guia_talles?.id?.trim();
  if (exigeGuia) {
    const filaOk = (f?: { id: string; talle: string }) =>
      !!f?.id?.trim() && !!f?.talle?.trim();
    const completo =
      !!guiaId &&
      (conVariantes
        ? variantesRaw.every((v) => filaOk(v.talle_fila))
        : filaOk(body.talle_fila));
    if (!completo) return c.json({ error: MSJ_FALTA_GUIA }, 400);
  }
  const tieneAgeGroup = catAttrs.some((a) => a.id === "AGE_GROUP");

  // Atributos finales de un ítem: la fila de la guía pisa a SIZE, y si la
  // categoría tiene AGE_GROUP y nadie lo mandó, va "Adultos" (salvo género infantil).
  const conGuiaYEdad = (
    base: Array<Record<string, unknown>>,
    fila?: { id: string; talle: string },
  ): Array<Record<string, unknown>> => {
    let out = base;
    if (guiaId && fila?.id) {
      out = [
        ...out.filter(
          (a) => !["SIZE_GRID_ID", "SIZE_GRID_ROW_ID", "SIZE"].includes(String(a.id)),
        ),
        { id: "SIZE_GRID_ID", value_name: guiaId },
        { id: "SIZE_GRID_ROW_ID", value_name: fila.id },
        { id: "SIZE", value_name: fila.talle.trim() },
      ];
    }
    if (tieneAgeGroup && !out.some((a) => a.id === "AGE_GROUP")) {
      const genero = String(out.find((a) => a.id === "GENDER")?.value_name ?? "");
      if (!/ni[ñn][oa]s?|beb[eé]s?|infantil/i.test(genero))
        out = [...out, { ...AGE_GROUP_ADULTOS }];
    }
    return out;
  };

  const avisos: string[] = [];
  const maxFotos = 12;

  type RespuestaCreacion = {
    id?: string;
    permalink?: string;
    message?: string;
    cause?: Array<{ message?: string; code?: string }>;
  };
  type ItemCreado = {
    id: string;
    permalink: string | null;
    pausada: boolean;
    envio: Awaited<ReturnType<typeof garantizarMercadoEnviosSinFlex>>;
  };

  // Crea UN ítem en ML y le aplica todo lo posterior (envío sin Flex, pausa,
  // descripción). Lo usan tanto la publicación simple como cada variante.
  const crearItem = async (
    item: Record<string, unknown>,
    etiqueta: string,
    opts: { reintentarFamilyName?: boolean } = {},
  ): Promise<{ ok: true; creado: ItemCreado } | { ok: false; error: string }> => {
    const pref = etiqueta ? `[${etiqueta}] ` : "";
    const crear = async () => {
      const response = await mlFetch(c.env, db, "/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(item),
      });
      const json = (await response.json().catch(() => ({}))) as RespuestaCreacion;
      return { response, json };
    };
    let { response: r, json: creado } = await crear();
    const rechazoInicial = JSON.stringify(creado).toLowerCase();
    if (
      (!r.ok || !creado.id) &&
      (rechazoInicial.includes("shipping") || rechazoInicial.includes("lost_me1"))
    ) {
      // Algunas cuentas administran ME2 a nivel de vendedor y rechazan `shipping`
      // en el alta. Reintentamos sin ese bloque, pero la garantía poscreación sigue
      // siendo obligatoria y deja el ítem pausado si no confirma ME2 sin Flex.
      delete item.shipping;
      ({ response: r, json: creado } = await crear());
      avisos.push(
        `${pref}Mercado Libre aplicó el envío desde la configuración de la cuenta; se verificó después del alta.`,
      );
    }
    if (
      (!r.ok || !creado.id) &&
      opts.reintentarFamilyName &&
      !item.family_name &&
      JSON.stringify(creado).toLowerCase().includes("family_name")
    ) {
      // Cuenta de User Products: ML pide family_name y genera el título solo.
      delete item.title;
      item.family_name = String(body.titulo).trim().slice(0, 60);
      ({ response: r, json: creado } = await crear());
      avisos.push(
        "Mercado Libre pidió un nombre de familia (family_name): se publicó con el título como family_name y ML genera el título final.",
      );
    }
    if (!r.ok || !creado.id) {
      const detalle =
        (creado.cause ?? [])
          .map((x) => x.message || x.code)
          .filter(Boolean)
          .join(" · ") ||
        creado.message ||
        "error desconocido";
      // ML a veces devuelve un código genérico ("body.invalid_fields") sin
      // detalle en cause[]: sumamos siempre el JSON crudo para no perder pistas.
      return { ok: false, error: `${detalle} — ${JSON.stringify(creado)}`.slice(0, 900) };
    }
    const id = creado.id;

    // Flex puede heredarse de la cuenta aunque el payload diga `mode: me2`.
    // Se quita y se verifica ANTES de pausar, porque la API de Flex rechaza
    // algunos ítems pausados con `item down`.
    const envio = await garantizarMercadoEnviosSinFlex(c.env, db, id);

    // Confirmar la pausa antes de informar el resultado. Si la garantía de envío
    // falló, igualmente se pausa para que nunca quede vendible por accidente.
    const pausa = await mlFetch(c.env, db, `/items/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "paused" }),
    }).catch(() => null);
    if (!pausa?.ok) avisos.push(`${pref}La publicación fue creada, pero Mercado Libre no confirmó la pausa. Revisá su estado desde el enlace antes de continuar.`);
    if (!envio.ok)
      avisos.push(
        `${pref}NO ACTIVAR: no pude confirmar Mercado Envíos sin Flex. ${envio.detalle ?? "Revisá el envío en Mercado Libre."}`,
      );

    if (body.descripcion?.trim()) {
      const rd = await mlFetch(c.env, db, `/items/${id}/description`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plain_text: body.descripcion.trim() }),
      }).catch(() => null);
      if (!rd?.ok) avisos.push(`${pref}No se pudo guardar la descripción; cargala a mano.`);
    }

    return {
      ok: true,
      creado: { id, permalink: creado.permalink ?? null, pausada: pausa?.ok ?? false, envio },
    };
  };

  // Pregunta a ML si aceptaría el ítem SIN crearlo (/items/validate responde 204).
  // Aplica sobre `item` los mismos ajustes que crearItem (sin `shipping`,
  // family_name en vez de title) para que lo validado sea lo que se crea.
  const validarItem = async (
    item: Record<string, unknown>,
    opts: { reintentarFamilyName?: boolean } = {},
  ): Promise<string | null> => {
    const validar = async () => {
      const r = await mlFetch(c.env, db, "/items/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(item),
      });
      if (r.ok) return null;
      const texto = await r.text();
      let j: RespuestaCreacion = {};
      try {
        j = JSON.parse(texto) as RespuestaCreacion;
      } catch {
        /* se usa el texto crudo */
      }
      const causas = (j.cause ?? []) as Array<{ message?: string; code?: string; type?: string }>;
      // Los avisos (type "warning") no impiden crear el ítem.
      const errores = causas.filter((x) => x.type !== "warning");
      if (causas.length && !errores.length) return null;
      const detalle =
        errores.map((x) => x.message || x.code).filter(Boolean).join(" · ") ||
        j.message ||
        texto ||
        `HTTP ${r.status}`;
      return `${detalle} — ${texto}`.slice(0, 900);
    };
    let error = await validar();
    if (error && /shipping|lost_me1/i.test(error) && item.shipping) {
      delete item.shipping;
      error = await validar();
    }
    if (error && opts.reintentarFamilyName && !item.family_name && /family_name/i.test(error)) {
      delete item.title;
      item.family_name = String(body.titulo).trim().slice(0, 60);
      error = await validar();
    }
    return error;
  };

  // ---- Con variantes: modelo "User Products" (un ítem por variante) ----
  // La cuenta es de precio por variación: `variations[]` ya no existe ni se
  // manda `title`. Cada variante es su propio ítem con el mismo family_name y
  // ML los agrupa en una familia solo.
  if (conVariantes) {
    const attrId = body.variantes?.atributo_id?.trim();
    const attrNombre = body.variantes?.atributo_nombre?.trim() || "Variante";
    const familyName = (body.family_name?.trim() || body.titulo.trim()).slice(0, 60);
    if (!attrId)
      avisos.push(
        "Sin un atributo de Mercado Libre para el eje, las variantes pueden no agruparse en una sola familia.",
      );

    let fotosRecortadas = false;
    const aCrear: Array<{ valor: string; item: Record<string, unknown> }> = [];
    for (const v of variantesRaw) {
      const valor = v.value_name.trim();
      const eje = attrId ? { id: attrId, value_name: valor } : { name: attrNombre, value_name: valor };
      // el valor de la variante pisa al atributo común si tiene el mismo id
      const attrsComunes = attrId ? atributos.filter((a) => a.id !== attrId) : atributos;
      const todas = [...new Set([...(v.imagenes ?? []).filter(Boolean), ...fotosProducto])];
      if (todas.length > maxFotos) fotosRecortadas = true;
      const item: Record<string, unknown> = {
        category_id: body.categoria_id,
        currency_id: "ARS",
        buying_mode: "buy_it_now",
        condition: "new",
        listing_type_id: "gold_special",
        family_name: familyName,
        price: v.precio ?? body.precio,
        available_quantity: Math.max(v.stock ?? body.stock ?? 1, 1),
        pictures: todas.slice(0, maxFotos).map((source) => ({ source })),
        attributes: conGuiaYEdad([...attrsComunes, eje], v.talle_fila),
        shipping: mercadoEnviosSinFlex(false),
      };
      aCrear.push({ valor, item });
    }

    // Primero se validan TODAS: si una no pasa, no se crea ninguna (antes quedaban
    // variantes sueltas creadas y un reintento las duplicaba).
    const rechazos: string[] = [];
    for (const { valor, item } of aCrear) {
      const error = await validarItem(item);
      if (error) rechazos.push(`"${valor}": ${error}`);
    }
    if (rechazos.length)
      return c.json(
        {
          error: `Mercado Libre no aceptaría la publicación; no se creó nada. ${rechazos.join(" | ")}`.slice(0, 1800),
        },
        502,
      );
    if (body.solo_validar) return c.json({ ok: true, validadas: aCrear.length });

    const creados: Array<{ variante: string } & ItemCreado> = [];
    for (const { valor, item } of aCrear) {
      const res = await crearItem(item, valor);
      if (!res.ok) {
        const previos = creados.length
          ? ` Ya se crearon (quedan pausadas): ${creados
              .map((x) => `${x.variante} → ${x.id}${x.permalink ? ` (${x.permalink})` : ""}`)
              .join("; ")}.`
          : "";
        return c.json(
          { error: `Falló la variante "${valor}": ${res.error}.${previos}`.slice(0, 1800) },
          502,
        );
      }
      creados.push({ variante: valor, ...res.creado });
    }
    if (fotosRecortadas)
      avisos.push(
        "Mercado Libre acepta hasta 12 fotos por publicación; en alguna variante se recortaron las últimas.",
      );

    try {
      for (const x of creados) await syncOneItem(c.env, db, x.id);
      await derivarCatalogo(db);
    } catch (e) {
      avisos.push(`sync interno: ${(e as Error).message}`);
    }

    const primero = creados[0];
    return c.json({
      ml_item_id: primero.id,
      permalink: primero.permalink,
      pausada: creados.every((x) => x.pausada),
      envio_verificado: creados.every((x) => x.envio.ok),
      modo_envio: primero.envio.mode,
      flex: primero.envio.flex,
      variantes: creados.length,
      items: creados.map((x) => ({
        variante: x.variante,
        ml_item_id: x.id,
        permalink: x.permalink,
        pausada: x.pausada,
        envio_verificado: x.envio.ok,
      })),
      avisos,
    });
  }

  // ---- Sin variantes: un solo ítem ----
  const poolUnico = [...new Set(fotosProducto)];
  if (poolUnico.length > maxFotos)
    avisos.push(
      "Mercado Libre acepta hasta 12 fotos por publicación; se recortaron las últimas.",
    );
  const familyName = body.family_name?.trim();
  // En User Products, ML genera title desde family_name y atributos.
  const item: Record<string, unknown> = {
    ...(familyName ? {} : { title: body.titulo.slice(0, 60) }),
    category_id: body.categoria_id,
    currency_id: "ARS",
    buying_mode: "buy_it_now",
    condition: "new",
    listing_type_id: "gold_special",
    pictures: poolUnico.slice(0, maxFotos).map((source) => ({ source })),
    attributes: conGuiaYEdad(atributos, body.talle_fila),
    shipping: mercadoEnviosSinFlex(false),
    ...(familyName ? { family_name: familyName } : {}),
    price: body.precio,
    available_quantity: Math.max(body.stock ?? 1, 1),
  };
  const rechazo = await validarItem(item, { reintentarFamilyName: true });
  if (rechazo)
    return c.json({ error: `Mercado Libre no aceptaría la publicación; no se creó nada. ${rechazo}` }, 502);
  if (body.solo_validar) return c.json({ ok: true, validadas: 1 });
  const res = await crearItem(item, "", { reintentarFamilyName: true });
  if (!res.ok) return c.json({ error: res.error }, 502);
  const { creado } = res;

  try {
    await syncOneItem(c.env, db, creado.id);
    await derivarCatalogo(db);
  } catch (e) {
    avisos.push(`sync interno: ${(e as Error).message}`);
  }

  return c.json({
    ml_item_id: creado.id,
    permalink: creado.permalink,
    pausada: creado.pausada,
    envio_verificado: creado.envio.ok,
    modo_envio: creado.envio.mode,
    flex: creado.envio.flex,
    variantes: 0,
    avisos,
  });
});

// ---------------------------------------------------------------------------
// Fotos profesionales con IA (Nano Banana Pro) para cada variante: 3 tomas
// (portada sobre blanco, detalle, ambiente) a partir de las fotos caseras.
// ---------------------------------------------------------------------------

type TipoFotoPro = "portada" | "detalle" | "ambiente";

function promptFotoPro(tipo: TipoFotoPro, producto?: string, variante?: string): string {
  const base: Record<TipoFotoPro, string> = {
    portada:
      "Professional e-commerce cover photo for a Mercado Libre listing. The product is perfectly clean and smooth (a garment is laid perfectly flat and neatly ironed, with no wrinkles or creases), centered and filling about 85% of a square frame, on a pure white (#FFFFFF) seamless background, with a soft, realistic contact shadow under it and bright, even studio lighting.",
    detalle:
      "Professional close-up product photo of the main printed design of the same product, filling about 70% of the frame, sharp focus with visible fabric or material texture, smooth surface with no wrinkles, soft studio light with gentle realistic shadows, on a pure white or very light neutral background.",
    ambiente:
      "Professional lifestyle product photo of the same product in a clean, minimal setting suited to it (for example a garment neatly folded or hanging on a light wooden hanger against an off-white wall, or an accessory on a light wooden table), soft natural window light with realistic shadows, smooth surfaces with no wrinkles, the printed design clearly visible.",
  };
  const reglas =
    "Reproduce the product and its printed design EXACTLY as in the first reference photo: same artwork, faces, text, colors, proportions and placement. Do not redraw, simplify, translate or invent any element of the design. If several references are given, the first one shows the view to reproduce and the others only help with details. True-to-life neutral colors: remove any yellow or warm color cast from the homemade photo. No text, logos, watermarks, hands, mannequins or extra props unless stated.";
  return [
    base[tipo],
    reglas,
    producto ? `Product: ${producto}` : "",
    variante ? `Variant: ${variante}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// Encarga las 3 fotos en paralelo; el panel consulta cada tarea aparte.
ia.post("/fotos-pro/encargar", async (c) => {
  const body = await c.req
    .json<{ imagenes?: string[]; producto?: string; variante?: string }>()
    .catch(() => ({}) as { imagenes?: string[]; producto?: string; variante?: string });
  const imagenes = [...new Set((body.imagenes ?? []).filter(Boolean))].slice(0, 8);
  if (!imagenes.length)
    return c.json({ error: "Falta al menos una foto de referencia." }, 400);
  const tipos: TipoFotoPro[] = ["portada", "detalle", "ambiente"];
  try {
    const tareas = await Promise.all(
      tipos.map(async (tipo) => ({
        tipo,
        taskId: await encargarEdicionPro(c.env, {
          prompt: promptFotoPro(tipo, body.producto?.trim(), body.variante?.trim()),
          imageUrls: imagenes,
          aspectRatio: "1:1",
        }),
      })),
    );
    return c.json({ tareas, costo_usd: tipos.length * costoUsd(MODELO_EDICION) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// Consulta una tarea; al terminar deja la foto permanente en Storage (la URL
// de kie.ai vence en ~24 h).
ia.get("/fotos-pro/:taskId", async (c) => {
  const tarea = await estadoTarea(c.env, c.req.param("taskId")).catch(
    () => ({ estado: "generando" }) as const,
  );
  if (tarea.estado !== "listo") return c.json(tarea);
  const url = await guardarFotoVariante(supa(c.env), tarea.url);
  return c.json({ estado: "listo", url });
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

// ---------------------------------------------------------------------------
// Agregar variantes nuevas (ej. un color más) a una publicación EXISTENTE:
// la IA propone una foto por color recoloreando las fotos actuales; Elias
// revisa/reemplaza y recién ahí se manda a Mercado Libre.
// ---------------------------------------------------------------------------

interface MlPictureRaw {
  id: string;
  url?: string;
  secure_url?: string;
}
interface MlAttrCombo {
  id?: string;
  name?: string;
  value_id?: string | null;
  value_name?: string;
}
interface MlVariationRaw {
  id: number | string;
  price: number | null;
  available_quantity: number | null;
  attribute_combinations?: MlAttrCombo[];
  picture_ids?: string[];
}
interface MlAttributeRaw {
  id?: string;
  name?: string;
  value_id?: string | null;
  value_name?: string | null;
}
interface MlItemFull {
  id: string;
  price: number | null;
  pictures?: MlPictureRaw[];
  variations?: MlVariationRaw[];
  family_name?: string | null;
  category_id?: string;
  attributes?: MlAttributeRaw[];
  title?: string;
}

// Baja la imagen temporal de kie.ai (~24 h) y la deja permanente en el mismo
// bucket que usa la subida manual de fotos (/ia/imagen).
async function guardarFotoVariante(
  db: ReturnType<typeof supa>,
  url: string,
): Promise<string> {
  try {
    const res = await fetch(url);
    const bytes = await res.arrayBuffer();
    // Nano Banana Pro entrega jpg; nano-banana-edit, png.
    const tipo = (res.headers.get("content-type") ?? "").includes("jpeg") || /\.jpe?g(\?|$)/i.test(url)
      ? "image/jpeg"
      : "image/png";
    const mes = new Date().toISOString().slice(0, 7);
    const path = `${mes}/variante-${crypto.randomUUID()}.${tipo === "image/jpeg" ? "jpg" : "png"}`;
    const up = await db.storage
      .from("publicaciones")
      .upload(path, bytes, { contentType: tipo, upsert: false });
    if (!up.error)
      return db.storage.from("publicaciones").getPublicUrl(path).data.publicUrl;
  } catch {
    /* fallback abajo */
  }
  return url;
}

// Propone una foto por cada color/valor nuevo, recoloreando las fotos
// actuales del producto. No toca Mercado Libre.
ia.post("/publicacion/:id/variantes/proponer", async (c) => {
  const id = c.req.param("id");
  const body = await c.req
    .json<{ valores?: string[]; generar_fotos?: boolean }>()
    .catch(() => ({}) as { valores?: string[]; generar_fotos?: boolean });
  const valores = [...new Set((body.valores ?? []).map((v) => v.trim()).filter(Boolean))].slice(
    0,
    6,
  );
  if (valores.length === 0)
    return c.json({ error: "indicá al menos un color/valor nuevo" }, 400);
  const generarFotos = body.generar_fotos === true;

  const db = supa(c.env);
  const { data: l, error } = await db
    .from("ml_listings")
    .select("raw")
    .eq("id", id)
    .single();
  if (error || !l) return c.json({ error: "publicación no encontrada" }, 404);

  const raw = (l.raw ?? {}) as unknown as MlItemFull;
  if (raw.family_name)
    return c.json(
      {
        error:
          `Esta publicación pertenece a una "familia de producto" de Mercado Libre ` +
          `(family_name: "${raw.family_name}"), y ML no permite agregar variantes por API ` +
          `a ese tipo de ítem. Hay que crear el color nuevo como una publicación aparte ` +
          `(con "Crear con IA") o agregarlo a mano desde el sitio de ML.`,
      },
      409,
    );
  const comboActual = raw.variations?.[0]?.attribute_combinations?.[0];
  const atributoId = comboActual?.id ?? null;
  const atributoNombre = comboActual?.name ?? null;

  // modo "ya tengo las fotos": no genera nada, sólo confirma el atributo de
  // variación para que Elias suba las fotos a mano en el paso siguiente.
  if (!generarFotos) {
    return c.json({
      atributo_id: atributoId,
      atributo_nombre: atributoNombre,
      propuestas: valores.map((valor) => ({ valor, imagen_url: null })),
      costo_usd_estimado: 0,
    });
  }

  const referencias = (raw.pictures ?? [])
    .slice(0, 3)
    .map((p) => p.secure_url ?? p.url)
    .filter((u): u is string => Boolean(u));
  if (referencias.length === 0)
    return c.json({ error: "la publicación no tiene fotos para usar de referencia" }, 400);

  const propuestas = await Promise.all(
    valores.map(async (valor) => {
      try {
        const { url, model } = await generarImagen(c.env, {
          prompt: `Cambiá el color del producto a "${valor}" manteniendo exactamente la
misma pose, ángulo, encuadre, fondo e iluminación. No cambies nada más del producto.`,
          imageUrls: referencias,
          model: "google/nano-banana-edit",
        });
        const imagen_url = await guardarFotoVariante(db, url);
        return { valor, imagen_url, modelo: model };
      } catch (e) {
        return { valor, imagen_url: null, error: (e as Error).message };
      }
    }),
  );

  return c.json({
    atributo_id: atributoId,
    atributo_nombre: atributoNombre,
    propuestas,
    costo_usd_estimado: valores.length * costoUsd("google/nano-banana-edit"),
  });
});

interface AplicarVariantesBody {
  atributo_id?: string;
  atributo_nombre?: string;
  items?: Array<{
    value_name: string;
    imagenes?: string[];
    stock?: number;
    precio?: number;
  }>;
}

// Manda las variantes nuevas a Mercado Libre en un único PUT (fotos +
// variaciones), sin tocar las que ya existían. Se llama SÓLO al confirmar.
ia.post("/publicacion/:id/variantes/aplicar", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<AplicarVariantesBody>();
  const items = (body.items ?? []).filter((it) => it.value_name?.trim());
  if (items.length === 0)
    return c.json({ error: "no hay ninguna variante para agregar" }, 400);

  const db = supa(c.env);
  const { data: l, error } = await db
    .from("ml_listings")
    .select("ml_item_id")
    .eq("id", id)
    .single();
  if (error || !l) return c.json({ error: "publicación no encontrada" }, 404);

  const rGet = await mlFetch(
    c.env,
    db,
    `/items/${l.ml_item_id}?include_attributes=all`,
  );
  if (!rGet.ok)
    return c.json({ error: `no se pudo leer la publicación en ML (${rGet.status})` }, 502);
  const item = (await rGet.json()) as MlItemFull;
  if (item.family_name)
    return c.json(
      {
        error:
          `Esta publicación pertenece a una "familia de producto" de Mercado Libre ` +
          `(family_name: "${item.family_name}"), y ML no permite agregar variantes por API ` +
          `a ese tipo de ítem. Es el mismo caso ya conocido de las republicaciones con variantes: ` +
          `hay que crear el color nuevo como una publicación aparte (con "Crear con IA", como ya ` +
          `existe para los otros colores de este mismo producto) o agregarlo a mano desde el sitio de ML.`,
      },
      409,
    );
  const existentes = item.variations ?? [];

  const comboExistente = existentes[0]?.attribute_combinations?.[0];
  const atributoId = comboExistente?.id ?? (body.atributo_id?.trim() || undefined);
  const atributoNombre =
    comboExistente?.name ?? (body.atributo_nombre?.trim() || undefined);
  if (!atributoId && !atributoNombre)
    return c.json(
      { error: "esta publicación no tiene variantes todavía: indicá por qué atributo va a variar" },
      400,
    );

  const norm = (s: string) => s.trim().toLowerCase();
  const valoresExistentes = new Set(
    existentes
      .map((v) => v.attribute_combinations?.[0]?.value_name)
      .filter((v): v is string => Boolean(v))
      .map(norm),
  );
  const repetido = items.find((it) => valoresExistentes.has(norm(it.value_name)));
  if (repetido)
    return c.json({ error: `ya existe una variante "${repetido.value_name}"` }, 400);

  const precioDefault = existentes[0]?.price ?? item.price ?? undefined;

  const fotosExistentes = (item.pictures ?? []).map((p) => ({ id: p.id }));
  const fotosNuevas = [
    ...new Set(items.flatMap((it) => (it.imagenes ?? []).filter(Boolean))),
  ].map((source) => ({ source }));

  const variacionesExistentes = existentes.map((v) => ({
    id: v.id,
    attribute_combinations: v.attribute_combinations,
    available_quantity: v.available_quantity,
    price: v.price,
    ...(v.picture_ids?.length ? { picture_ids: v.picture_ids } : {}),
  }));
  const variacionesNuevas = items.map((it) => {
    const combo = atributoId
      ? { id: atributoId, value_name: it.value_name.trim() }
      : { name: atributoNombre, value_name: it.value_name.trim() };
    const pics = (it.imagenes ?? []).filter(Boolean);
    return {
      attribute_combinations: [combo],
      available_quantity: Math.max(it.stock ?? 1, 1),
      price: it.precio ?? precioDefault,
      ...(pics.length ? { picture_ids: pics } : {}),
    };
  });

  const rPut = await mlFetch(c.env, db, `/items/${l.ml_item_id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pictures: [...fotosExistentes, ...fotosNuevas],
      variations: [...variacionesExistentes, ...variacionesNuevas],
    }),
  });
  const resp = (await rPut.json().catch(() => ({}))) as {
    message?: string;
    cause?: Array<{ message?: string; code?: string }>;
  };
  if (!rPut.ok) {
    const detalle =
      (resp.cause ?? [])
        .map((x) => x.message || x.code)
        .filter(Boolean)
        .join(" · ") ||
      resp.message ||
      "error desconocido";
    return c.json(
      { error: `${detalle} — ${JSON.stringify(resp)}`.slice(0, 900) },
      502,
    );
  }

  const avisos: string[] = [];
  try {
    await syncOneItem(c.env, db, l.ml_item_id);
    await derivarCatalogo(db);
  } catch (e) {
    avisos.push(`sync interno: ${(e as Error).message}`);
  }

  return c.json({ aplicado: true, agregadas: items.length, avisos });
});

// ---------------------------------------------------------------------------
// Duplicar como color nuevo: para publicaciones de una categoría "catálogo"
// (family_name) donde ML no permite variaciones por API ni al crear ni al
// editar. Arma el borrador de una publicación NUEVA (mismo título/categoría/
// atributos/precio, foto recoloreada con IA) para revisar y publicar con el
// mismo endpoint que "Crear con IA" (/ia/publicar).
// ---------------------------------------------------------------------------

interface PropuestaDuplicado {
  titulo: string;
  descripcion: string;
  categoria_id: string;
  precio: number | null;
  imagenes: string[];
  atributos: Array<{ id: string; nombre: string; valor: string; requerido: boolean }>;
  family_name: string | null;
  avisos: string[];
}

ia.post("/publicacion/:id/duplicar/proponer", async (c) => {
  const id = c.req.param("id");
  const body = await c.req
    .json<{ valor?: string; generar_fotos?: boolean }>()
    .catch(() => ({}) as { valor?: string; generar_fotos?: boolean });
  const valor = (body.valor ?? "").trim();
  if (!valor) return c.json({ error: "indicá el color/valor nuevo" }, 400);
  const generarFotos = body.generar_fotos === true;

  const db = supa(c.env);
  const { data: l, error } = await db
    .from("ml_listings")
    .select("ml_item_id, titulo, precio, raw")
    .eq("id", id)
    .single();
  if (error || !l) return c.json({ error: "publicación no encontrada" }, 404);

  const raw = (l.raw ?? {}) as unknown as MlItemFull;
  const avisos: string[] = [];

  if (!raw.category_id)
    return c.json({ error: "la publicación no tiene categoría en el mirror local" }, 400);

  const atributosOrig = (raw.attributes ?? []).filter((a) => a.id);
  const colorAttrOrig = atributosOrig.find((a) => /color/i.test(a.name ?? a.id ?? ""));

  // sólo copiamos atributos que la categoría ACTUAL todavía reconoce: un
  // atributo viejo/inválido (deprecado, o de cuando la publicación estaba en
  // otra categoría) es la causa típica del "invalid_fields" genérico de ML.
  const attrsCat = await categoriaAttrs(c.env, db, raw.category_id);
  const validIds = new Set(attrsCat.map((a) => a.id));
  const requeridos = attrsCat.filter((a) => a.tags?.required);
  const colorAttrCat = attrsCat.find((a) => /color/i.test(a.name));

  interface AtributoProp {
    id: string;
    nombre: string;
    valor: string;
    requerido: boolean;
  }
  const atributos: AtributoProp[] = [];
  const vistos = new Set<string>();

  for (const req of requeridos) {
    const orig = atributosOrig.find((a) => a.id === req.id);
    const esColor = colorAttrCat?.id === req.id;
    atributos.push({
      id: req.id,
      nombre: req.name,
      valor: esColor ? valor : (orig?.value_name ?? ""),
      requerido: true,
    });
    vistos.add(req.id);
  }

  for (const a of atributosOrig) {
    if (!a.id || vistos.has(a.id) || !validIds.has(a.id)) continue;
    const esColor = colorAttrCat?.id === a.id;
    let valorFinal = esColor ? valor : (a.value_name ?? "");
    if (a.id === "SELLER_SKU" && valorFinal.trim())
      valorFinal = `${valorFinal.trim()}-${valor.replace(/\s+/g, "").toUpperCase()}`;
    if (!valorFinal.trim()) continue;
    atributos.push({ id: a.id, nombre: a.name ?? a.id, valor: valorFinal, requerido: false });
    vistos.add(a.id);
  }

  if (colorAttrCat && !vistos.has(colorAttrCat.id)) {
    atributos.push({ id: colorAttrCat.id, nombre: colorAttrCat.name, valor, requerido: false });
  } else if (!colorAttrCat) {
    avisos.push(
      'Esta categoría no tiene un atributo de "Color": el color sólo queda reflejado en el título y la foto.',
    );
  }

  const faltantes = atributos.filter((a) => a.requerido && !a.valor.trim()).map((a) => a.nombre);
  if (faltantes.length)
    avisos.push(
      `Completá estos atributos obligatorios antes de publicar: ${faltantes.join(", ")}.`,
    );

  if (!raw.family_name)
    avisos.push(
      "La publicación original no tiene family_name: si esta categoría lo exige, Mercado Libre va a rechazar la publicación al confirmar.",
    );

  // corta por palabra completa, nunca a la mitad de una (ML rechaza títulos raros)
  const cortarPorPalabra = (s: string, max: number): string => {
    if (s.length <= max) return s;
    const corte = s.slice(0, max);
    const ultimoEspacio = corte.lastIndexOf(" ");
    return ultimoEspacio > 0 ? corte.slice(0, ultimoEspacio) : corte;
  };
  const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const tituloBase = l.titulo ?? raw.title ?? "";
  const colorViejo = colorAttrOrig?.value_name?.trim();
  // saco el color viejo del título (si estaba) para no duplicarlo/alargarlo
  const baseSinColor = (
    colorViejo && tituloBase.toLowerCase().includes(colorViejo.toLowerCase())
      ? tituloBase.replace(new RegExp(escapeRegExp(colorViejo), "i"), "")
      : tituloBase
  )
    .replace(/\s+-\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  // el color nuevo SIEMPRE va: reservamos su lugar y recortamos el resto si hace falta
  const sufijo = ` ${valor}`;
  const baseRecortada = cortarPorPalabra(baseSinColor, 60 - sufijo.length);
  const titulo = `${baseRecortada}${sufijo}`.trim();
  if (baseRecortada.length < baseSinColor.length)
    avisos.push(
      "El título original no entraba junto con el color nuevo dentro del límite de 60 caracteres: se acortó, revisalo antes de publicar.",
    );

  let descripcion = "";
  try {
    const rDesc = await mlFetch(c.env, db, `/items/${l.ml_item_id}/description`);
    if (rDesc.ok) {
      const dj = (await rDesc.json()) as { plain_text?: string; text?: string };
      descripcion = dj.plain_text ?? dj.text ?? "";
    }
  } catch {
    /* sin descripción original, Elias la completa a mano */
  }

  let imagenes: string[] = [];
  if (generarFotos) {
    const referencias = (raw.pictures ?? [])
      .slice(0, 3)
      .map((p) => p.secure_url ?? p.url)
      .filter((u): u is string => Boolean(u));
    if (referencias.length > 0) {
      try {
        const { url } = await generarImagen(c.env, {
          prompt: `Cambiá el color del producto a "${valor}" manteniendo exactamente la
misma pose, ángulo, encuadre, fondo e iluminación. No cambies nada más del producto.`,
          imageUrls: referencias,
          model: "google/nano-banana-edit",
        });
        imagenes = [await guardarFotoVariante(db, url)];
      } catch (e) {
        avisos.push(`no se pudo generar la foto con IA: ${(e as Error).message}`);
      }
    } else {
      avisos.push("la publicación original no tiene fotos para usar de referencia");
    }
  }

  const propuesta: PropuestaDuplicado = {
    titulo,
    descripcion,
    categoria_id: raw.category_id,
    precio: l.precio,
    imagenes,
    atributos,
    family_name: raw.family_name ?? null,
    avisos,
  };
  return c.json(propuesta);
});
