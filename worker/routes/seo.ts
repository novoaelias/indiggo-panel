// Analizador SEO de categorías de Mercado Libre.
//
// ML no deja cambiar la categoría de una publicación ya creada. Cuando una
// publicación quedó en la categoría equivocada (o ML la finalizó por eso), la
// única salida es cerrarla y volver a crearla idéntica en la categoría correcta.
//
// - POST /seo/analizar            → corre el análisis sobre todas las publicaciones
// - POST /seo/publicacion/:id/plan       → arma la propuesta de re-publicación
// - POST /seo/publicacion/:id/republicar → ejecuta (crea la nueva EN PAUSA, cierra la vieja)
import { Hono } from "hono";
import type { Env } from "../env";
import { supa } from "../lib/supabase";
import { mlFetch } from "../lib/ml";
import { claude, parseJsonLaxo } from "../lib/claude";
import { syncOneItem } from "../lib/sync";
import { derivarCatalogo } from "../lib/derivar";

export const seo = new Hono<{ Bindings: Env }>();

type DB = ReturnType<typeof supa>;

// ---------- tipos laxos del item de ML ----------
interface MlAttr {
  id: string;
  name?: string;
  value_id?: string | null;
  value_name?: string | null;
  tags?: Record<string, boolean>;
}
interface MlComb {
  id: string;
  value_id?: string | null;
  value_name?: string | null;
}
interface MlVariation {
  id: number | string;
  price: number | null;
  available_quantity: number | null;
  picture_ids?: string[];
  attributes?: MlAttr[];
  attribute_combinations?: MlComb[];
}
interface MlItemFull {
  id: string;
  title: string;
  family_name?: string | null;
  category_id: string;
  price: number | null;
  currency_id: string;
  buying_mode?: string;
  condition?: string;
  listing_type_id?: string;
  available_quantity?: number | null;
  permalink?: string | null;
  pictures?: Array<{ id: string; url?: string; secure_url?: string }>;
  attributes?: MlAttr[];
  sale_terms?: MlAttr[];
  shipping?: {
    mode?: string;
    local_pick_up?: boolean;
    free_shipping?: boolean;
  } | null;
  variations?: MlVariation[];
}

// ---------- helpers de categoría ----------
type CatCache = Map<string, { id: string; nombre: string; path: string }>;

async function catInfo(
  env: Env,
  db: DB,
  id: string | null | undefined,
  cache: CatCache,
): Promise<{ id: string; nombre: string; path: string }> {
  if (!id) return { id: "", nombre: "—", path: "—" };
  const hit = cache.get(id);
  if (hit) return hit;
  let out = { id, nombre: id, path: id };
  try {
    const r = await mlFetch(env, db, `/categories/${id}`);
    if (r.ok) {
      const j = (await r.json()) as {
        name?: string;
        path_from_root?: Array<{ name: string }>;
      };
      const path = (j.path_from_root ?? []).map((x) => x.name).join(" > ");
      out = { id, nombre: j.name ?? id, path: path || j.name || id };
    }
  } catch {
    /* fallback = id */
  }
  cache.set(id, out);
  return out;
}

async function predecirCategorias(
  env: Env,
  db: DB,
  titulo: string,
): Promise<Array<{ id: string; nombre: string }>> {
  try {
    const r = await mlFetch(
      env,
      db,
      `/sites/MLA/domain_discovery/search?limit=8&q=${encodeURIComponent(titulo)}`,
    );
    if (!r.ok) return [];
    const arr = (await r.json()) as Array<{
      category_id?: string;
      category_name?: string;
    }>;
    return arr
      .filter((x) => x.category_id)
      .map((x) => ({ id: x.category_id!, nombre: x.category_name ?? "" }));
  } catch {
    return [];
  }
}

interface Candidata {
  id: string;
  nombre: string;
  path: string;
  usos?: number; // publicaciones propias del vendedor en esta categoría
  fuente: "propia" | "ml";
}
interface Analisis {
  actual_id: string;
  actual_nombre: string;
  actual_path: string;
  sugerida_id: string;
  sugerida_nombre: string;
  sugerida_path: string;
  coincide: boolean;
  confianza: "alta" | "media" | "baja";
  motivo: string;
  candidatas: Candidata[];
  chequeado_at: string;
}

// tokens de un título, sin ruido, para medir similitud entre publicaciones
const RUIDO = new Set([
  "combo", "porta", "holder", "photocard", "pc", "de", "tu", "bias", "llavero",
  "charm", "con", "para", "el", "la", "kpop", "bts", "stray", "kids", "straykids",
  "skz", "katseye", "twice", "army", "arirang", "hooligan", "cuotas", "cuota",
  "sin", "interes", "hasta", "mercado", "libre", "full", "envio", "gratis",
  "pack", "set", "unidades", "insumos", "insumo", "freebies", "freebie",
  "especial", "nuevo", "nueva", "random", "mixtas", "surtidas", "logo",
]);
const tokset = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !RUIDO.has(w)),
  );
const jacc = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
};

// ---------- POST /seo/analizar ----------
// Estrategia: agrupar las publicaciones por tipo de producto (similitud de
// título) y decidir UNA categoría por grupo con Claude (sonnet). Así la
// recomendación es consistente — todos los holders van a la misma, todas las
// mostacillas a la misma, etc.
seo.post("/analizar", async (c) => {
  const db = supa(c.env);
  const [{ data: listings, error }, { data: prods }, { data: cats }] =
    await Promise.all([
      db
        .from("ml_listings")
        .select("id, ml_item_id, titulo, estado, raw, reemplazada_por, product_id")
        .in("estado", ["active", "paused", "under_review", "closed"])
        .is("reemplazada_por", null),
      db.from("products").select("id, category_id"),
      db.from("categories").select("id, slug"),
    ]);
  if (error) return c.json({ error: error.message }, 500);

  const conCat = (listings ?? []).filter(
    (l) => l.raw && (l.raw as { category_id?: string }).category_id,
  );
  const catDe = (l: (typeof conCat)[number]) =>
    (l.raw as { category_id: string }).category_id;
  const tokDe = new Map(conCat.map((l) => [l.id, tokset(l.titulo)]));
  const byId = new Map(conCat.map((l) => [l.id, l]));

  // uso global de cada categoría de ML (contexto para Claude)
  const usosGlobal = new Map<string, number>();
  for (const l of conCat)
    usosGlobal.set(catDe(l), (usosGlobal.get(catDe(l)) ?? 0) + 1);

  // --- clusterizar por TIPO de producto ---
  // Preferimos la categoría interna del catálogo (holders / mostacillas /
  // llaveros / stickers / photocards / clickers / otros), que ya clasificó cada
  // publicación. Fallback: similitud de título; último recurso: singleton.
  const slugDeCat = new Map((cats ?? []).map((c) => [c.id, c.slug]));
  const slugDeProd = new Map(
    (prods ?? []).map((p) => [p.id, p.category_id ? slugDeCat.get(p.category_id) : null]),
  );
  // "otros" es un cajón de sastre (letras, fundas, charms…): para esos usamos un
  // detector de tipo por palabra clave del título; si tampoco, similitud de título.
  const TIPO: Array<[RegExp, string]> = [
    [/\bletras?\b/i, "t:letras"],
    [/\bfunda/i, "t:fundas"],
    [/\b(sticker|plancha)/i, "t:stickers"],
    [/\bmostacill/i, "t:mostacillas"],
    [/\b(holder|porta ?photocard|porta ?holder)/i, "t:holder"],
    [/\bllavero/i, "t:llavero"],
    [/\b(clicker|fidget)/i, "t:clicker"],
    [/\b(mostacilla|clicker)s?\b/i, "t:mostacillas"],
  ];
  const claveDe = (l: (typeof conCat)[number]): string | null => {
    const s = l.product_id ? slugDeProd.get(l.product_id) : null;
    if (s && s !== "otros") return s;
    for (const [re, k] of TIPO) if (re.test(l.titulo)) return k;
    return null;
  };

  const clusters: string[][] = [];
  const puesto = new Set<string>();

  // 1) por categoría interna
  const porSlug = new Map<string, string[]>();
  for (const l of conCat) {
    const k = claveDe(l);
    if (!k) continue;
    if (!porSlug.has(k)) porSlug.set(k, []);
    porSlug.get(k)!.push(l.id);
    puesto.add(l.id);
  }
  for (const ids of porSlug.values()) clusters.push(ids);

  // 2) resto: por similitud de título (greedy single-link)
  for (const l of conCat) {
    if (puesto.has(l.id)) continue;
    const grupo = [l.id];
    puesto.add(l.id);
    for (const o of conCat) {
      if (puesto.has(o.id)) continue;
      if (jacc(tokDe.get(l.id)!, tokDe.get(o.id)!) >= 0.34) {
        grupo.push(o.id);
        puesto.add(o.id);
      }
    }
    clusters.push(grupo);
  }

  const cache: CatCache = new Map();
  const errores: string[] = [];
  let con_problema = 0;
  let ok = 0;

  const procesarCluster = async (ids: string[]) => {
    try {
      const ls = ids.map((id) => byId.get(id)!);
      const catCount = new Map<string, number>();
      for (const l of ls)
        catCount.set(catDe(l), (catCount.get(catDe(l)) ?? 0) + 1);
      const catsActuales = [...catCount.entries()].sort((a, b) => b[1] - a[1]);

      // predicciones de ML sobre 2 títulos representativos (más corto y más largo)
      const porLargo = [...ls].sort((a, b) => a.titulo.length - b.titulo.length);
      const repTitulos = [
        ...new Set([
          porLargo[0].titulo,
          porLargo[porLargo.length - 1].titulo,
        ]),
      ];
      const mlSet = new Map<string, string>();
      for (const t of repTitulos)
        for (const p of await predecirCategorias(c.env, db, t))
          mlSet.set(p.id, p.nombre);

      const candIds = new Set<string>([...catCount.keys(), ...mlSet.keys()]);
      // sumar las categorías propias más usadas globalmente como contexto
      for (const [cid] of [...usosGlobal.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6))
        candIds.add(cid);

      const candidatas: Candidata[] = [];
      for (const cid of candIds) {
        const info = await catInfo(c.env, db, cid, cache);
        candidatas.push({
          ...info,
          usos: usosGlobal.get(cid),
          fuente: catCount.has(cid) ? "propia" : "ml",
        });
      }
      candidatas.sort((a, b) => (b.usos ?? 0) - (a.usos ?? 0));

      let elegidaId: string;
      let confianza: Analisis["confianza"];
      let motivo: string;
      const unanime = catsActuales.length === 1 && ls.length >= 2;

      if (unanime) {
        elegidaId = catsActuales[0][0];
        confianza = "alta";
        motivo = `Los ${ls.length} productos de este tipo ya están todos en esta categoría.`;
      } else {
        const attrsRep = ((porLargo[0].raw as { attributes?: Array<{ name?: string; value_name?: string }> }).attributes ?? [])
          .filter((a) => a.name && a.value_name)
          .slice(0, 10)
          .map((a) => `${a.name}: ${a.value_name}`)
          .join("; ");
        const pathDe = (cid: string) =>
          candidatas.find((x) => x.id === cid)?.path ?? cid;
        const { texto } = await claude(c.env, {
          model: "claude-sonnet-5",
          system:
            "Elegís la categoría de Mercado Libre Argentina (MLA) para un grupo de productos DEL MISMO TIPO de un vendedor de merch de kpop (holders/porta photocards impresos en 3D, mostacillas, llaveros, stickers, packs de letras para freebies). Devolvés UNA sola categoría para todo el grupo, la que mejor describa el producto real. Respondés sólo con JSON.",
          messages: [
            {
              role: "user",
              content: `Grupo de ${ls.length} producto(s) del mismo tipo. Títulos:
${ls.slice(0, 8).map((l) => `- ${l.titulo}`).join("\n")}
Atributos de ejemplo: ${attrsRep || "—"}

Dónde están hoy:
${catsActuales.map(([cid, n]) => `- ${pathDe(cid)} (${cid}) — ${n}/${ls.length}`).join("\n")}

Candidatas (sugeridas por ML por el título, o categorías que el vendedor usa en otros productos):
${
  candidatas
    .filter((x) => !catCount.has(x.id))
    .map(
      (x) =>
        `- ${x.path} (${x.id})${x.usos ? ` — la usa en ${x.usos} publicaciones` : ""}`,
    )
    .join("\n") || "(ninguna)"
}

Elegí UNA categoría para todo el grupo. Puede ser una de "dónde están hoy" si ya es correcta.
Devolvé SOLO este JSON:
{ "categoria_id": "MLA...", "confianza": "alta"|"media"|"baja", "motivo": "1-2 frases para el vendedor en español rioplatense" }`,
            },
          ],
          maxTokens: 500,
        });
        const j = parseJsonLaxo<{
          categoria_id?: string;
          confianza?: string;
          motivo?: string;
        }>(texto);
        elegidaId = j.categoria_id?.trim() || catsActuales[0][0];
        confianza = (["alta", "media", "baja"].includes(j.confianza ?? "")
          ? j.confianza
          : "media") as Analisis["confianza"];
        motivo = j.motivo ?? "Categoría elegida para unificar el grupo.";
      }

      if (!candidatas.some((x) => x.id === elegidaId)) {
        const info = await catInfo(c.env, db, elegidaId, cache);
        candidatas.unshift({ ...info, fuente: "ml" });
      }
      const elegida = candidatas.find((x) => x.id === elegidaId)!;

      for (const l of ls) {
        const actualId = catDe(l);
        const actual = await catInfo(c.env, db, actualId, cache);
        const coincide = actualId === elegidaId;
        const analisis: Analisis = {
          actual_id: actualId,
          actual_nombre: actual.nombre,
          actual_path: actual.path,
          sugerida_id: elegidaId,
          sugerida_nombre: elegida.nombre,
          sugerida_path: elegida.path,
          coincide,
          confianza,
          motivo:
            coincide && !unanime
              ? "Está en la categoría correcta para este tipo de producto."
              : motivo,
          candidatas,
          chequeado_at: new Date().toISOString(),
        };
        await db
          .from("ml_listings")
          .update({
            categoria_sugerida: coincide ? null : elegidaId,
            categoria_analisis: analisis as unknown as never,
          })
          .eq("id", l.id);
        if (coincide) ok++;
        else con_problema++;
      }
    } catch (e) {
      errores.push(`grupo (${ids.length}): ${(e as Error).message}`);
    }
  };

  for (let i = 0; i < clusters.length; i += 4) {
    await Promise.all(clusters.slice(i, i + 4).map(procesarCluster));
  }

  return c.json({
    analizadas: conCat.length,
    grupos: clusters.length,
    con_problema,
    ok,
    errores,
  });
});

// ---------- GET /seo/categorias — las que usa el vendedor + búsqueda ----------
seo.get("/categorias", async (c) => {
  const db = supa(c.env);
  const q = c.req.query("q")?.trim();
  const cache: CatCache = new Map();

  if (q) {
    // búsqueda manual: predictor de ML sobre el texto que tipeó el vendedor
    const preds = await predecirCategorias(c.env, db, q);
    const out: Array<{ id: string; nombre: string; path: string }> = [];
    for (const p of preds.slice(0, 10))
      out.push(await catInfo(c.env, db, p.id, cache));
    return c.json({ resultados: out });
  }

  // categorías propias, con cuántas publicaciones tiene en cada una
  const { data: listings } = await db
    .from("ml_listings")
    .select("raw, reemplazada_por")
    .is("reemplazada_por", null);
  const usos = new Map<string, number>();
  for (const l of listings ?? []) {
    const cid = (l.raw as { category_id?: string } | null)?.category_id;
    if (cid) usos.set(cid, (usos.get(cid) ?? 0) + 1);
  }
  const propias: Array<{
    id: string;
    nombre: string;
    path: string;
    usos: number;
  }> = [];
  for (const [cid, n] of [...usos.entries()].sort((a, b) => b[1] - a[1]))
    propias.push({ ...(await catInfo(c.env, db, cid, cache)), usos: n });
  return c.json({ propias });
});

// ---------- armado del item nuevo ----------
// La cuenta usa el modelo "User Products / Price per Variation": el body NO puede
// llevar `variations[]` y `family_name` es obligatorio en estas categorías. El
// título lo compone ML. El envío se hereda de la cuenta (mandarlo rompe con
// `shipping.lost_me1_by_user`). Sólo re-publicamos publicaciones SIN variantes.
interface ArmarOpts {
  familyMode: boolean; // family_name (default) vs title, por si alguna cat no pide family
  picsById: boolean; // reusar fotos por id vs re-subir por source
}

function limpiarAttr(a: MlAttr): { id: string } & Record<string, unknown> {
  return a.value_id
    ? { id: a.id, value_id: a.value_id }
    : { id: a.id, value_name: a.value_name ?? "" };
}

function armarItem(
  item: MlItemFull,
  categoriaId: string,
  catAttrIds: Set<string> | null,
  extra: Array<{ id: string; value_name: string }>,
  opts: ArmarOpts,
): Record<string, unknown> {
  const byId = new Map<string, Record<string, unknown>>();
  for (const a of item.attributes ?? []) {
    if (a.value_id == null && (a.value_name == null || a.value_name === ""))
      continue;
    if (a.tags?.read_only || a.tags?.variation_attribute) continue;
    // sólo atributos que la categoría destino conoce (evita item.attribute.invalid)
    if (catAttrIds && catAttrIds.size && !catAttrIds.has(a.id)) continue;
    byId.set(a.id, limpiarAttr(a));
  }
  for (const a of extra)
    if (a.id && a.value_name.trim())
      byId.set(a.id, { id: a.id, value_name: a.value_name.trim() });

  const pics = (item.pictures ?? [])
    .slice(0, 12)
    .map((p) =>
      opts.picsById
        ? { id: p.id }
        : {
            source: (p.secure_url ?? p.url ?? "").replace(/^http:/, "https:"),
          },
    )
    .filter((p) => ("id" in p ? p.id : p.source));

  const body: Record<string, unknown> = {
    ...(opts.familyMode
      ? { family_name: (item.family_name || item.title).slice(0, 60) }
      : { title: item.title.slice(0, 60) }),
    category_id: categoriaId,
    price: item.price,
    currency_id: item.currency_id ?? "ARS",
    buying_mode: item.buying_mode ?? "buy_it_now",
    condition: item.condition ?? "new",
    listing_type_id: item.listing_type_id ?? "gold_special",
    available_quantity: Math.max(item.available_quantity ?? 1, 1),
    pictures: pics,
    attributes: [...byId.values()],
  };

  const saleTermsOk = new Set(["WARRANTY_TYPE", "WARRANTY_TIME"]);
  const st = (item.sale_terms ?? []).filter((s) => saleTermsOk.has(s.id));
  if (st.length) body.sale_terms = st.map(limpiarAttr);

  return body;
}

async function crearItem(
  env: Env,
  db: DB,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; id?: string; permalink?: string; error?: string }> {
  const r = await mlFetch(env, db, "/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as {
    id?: string;
    permalink?: string;
    cause?: Array<{ type?: string; code?: string; message?: string }>;
    message?: string;
  };
  if (r.ok && j.id) return { ok: true, id: j.id, permalink: j.permalink };
  const errs = (j.cause ?? [])
    .filter((x) => (x.type ?? "error") === "error")
    .map((x) => x.message || x.code)
    .join(" · ");
  return {
    ok: false,
    error: (errs || j.message || JSON.stringify(j)).slice(0, 500),
  };
}

async function leerItem(
  env: Env,
  db: DB,
  itemId: string,
): Promise<MlItemFull | null> {
  const r = await mlFetch(env, db, `/items/${itemId}?include_attributes=all`);
  if (!r.ok) return null;
  return (await r.json()) as MlItemFull;
}

// ---------- POST /seo/publicacion/:id/plan ----------
seo.post("/publicacion/:id/plan", async (c) => {
  const id = c.req.param("id");
  const body = await c.req
    .json<{ categoria_id?: string }>()
    .catch(() => ({}) as { categoria_id?: string });
  const db = supa(c.env);

  const { data: l } = await db
    .from("ml_listings")
    .select("ml_item_id, categoria_sugerida, categoria_analisis")
    .eq("id", id)
    .single();
  if (!l) return c.json({ error: "publicación no encontrada" }, 404);

  const item = await leerItem(c.env, db, l.ml_item_id);
  if (!item)
    return c.json({ error: `no se pudo leer el item ${l.ml_item_id}` }, 502);

  const analisis = l.categoria_analisis as Analisis | null;
  const target =
    body.categoria_id?.trim() ||
    l.categoria_sugerida ||
    analisis?.sugerida_id ||
    item.category_id;

  const cache: CatCache = new Map();
  const actual = await catInfo(c.env, db, item.category_id, cache);
  const nueva = await catInfo(c.env, db, target, cache);

  let atributos_faltantes: Array<{
    id: string;
    nombre: string;
    valores: string[];
  }> = [];
  try {
    const ra = await mlFetch(c.env, db, `/categories/${target}/attributes`);
    if (ra.ok) {
      const attrs = (await ra.json()) as Array<{
        id: string;
        name: string;
        tags?: Record<string, boolean>;
        values?: Array<{ name: string }>;
      }>;
      const tengo = new Set(
        (item.attributes ?? [])
          .filter((a) => a.value_id != null || a.value_name)
          .map((a) => a.id),
      );
      atributos_faltantes = attrs
        .filter((a) => a.tags?.required && !tengo.has(a.id))
        .map((a) => ({
          id: a.id,
          nombre: a.name,
          valores: (a.values ?? []).slice(0, 25).map((v) => v.name),
        }));
    }
  } catch {
    /* si falla, se re-publica sin chequeo previo de atributos */
  }

  return c.json({
    categoria_actual: { id: item.category_id, path: actual.path },
    categoria_nueva: { id: target, path: nueva.path },
    atributos_faltantes,
    preview: {
      titulo: item.title,
      precio: item.price,
      moneda: item.currency_id,
      listing_type_id: item.listing_type_id ?? "gold_special",
      condicion: item.condition ?? "new",
      fotos: item.pictures?.length ?? 0,
      variaciones: item.variations?.length ?? 0,
      atributos: (item.attributes ?? []).filter(
        (a) => a.value_id != null || a.value_name,
      ).length,
    },
  });
});

// ---------- relink en Supabase ----------
async function reasignarSkuBase(
  db: DB,
  viejoItem: string,
  nuevoItem: string,
  viejoRow: string,
  nuevoRow: string | undefined,
): Promise<void> {
  const { data: prod } = await db
    .from("products")
    .select("id")
    .eq("sku_base", viejoItem)
    .maybeSingle();
  if (prod) {
    await db
      .from("products")
      .update({ sku_base: nuevoItem })
      .eq("id", prod.id);
    const { data: pvs } = await db
      .from("product_variants")
      .select("id, sku")
      .eq("product_id", prod.id);
    for (const pv of pvs ?? []) {
      if (pv.sku && pv.sku.startsWith(viejoItem))
        await db
          .from("product_variants")
          .update({ sku: nuevoItem + pv.sku.slice(viejoItem.length) })
          .eq("id", pv.id);
    }
  }
  if (nuevoRow)
    await db
      .from("listing_groups")
      .update({ canonical_listing_id: nuevoRow })
      .eq("canonical_listing_id", viejoRow);
}

// ---------- POST /seo/publicacion/:id/republicar ----------
seo.post("/publicacion/:id/republicar", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    categoria_id?: string;
    atributos_extra?: Array<{ id: string; value_name: string }>;
  }>();
  if (!body.categoria_id?.trim())
    return c.json({ error: "falta categoria_id" }, 400);

  const db = supa(c.env);
  const { data: l } = await db
    .from("ml_listings")
    .select("id, ml_item_id, estado, product_id, grupo_id, tiene_variantes")
    .eq("id", id)
    .single();
  if (!l) return c.json({ error: "publicación no encontrada" }, 404);
  const viejo = l.ml_item_id;

  const item = await leerItem(c.env, db, viejo);
  if (!item) return c.json({ error: `no se pudo leer el item ${viejo}` }, 502);

  // La cuenta usa el modelo "User Products": ML ya no acepta `variations[]` al
  // crear. Recrear una publicación con variantes por API partiría el catálogo y
  // el stock. Esas se rehacen desde la web de Mercado Libre.
  if ((item.variations?.length ?? 0) > 0 || l.tiene_variantes)
    return c.json(
      {
        error: `Esta publicación tiene ${item.variations?.length ?? "varias"} variantes. Mercado Libre cambió el modelo de publicación (User Products) y recrearlas por API rompería el stock del catálogo. Cambiale la categoría desde la web de Mercado Libre (Editar → Mover a otra categoría / re-publicar).`,
      },
      409,
    );

  let descripcion = "";
  try {
    const rd = await mlFetch(c.env, db, `/items/${viejo}/description`);
    if (rd.ok)
      descripcion = ((await rd.json()) as { plain_text?: string }).plain_text ?? "";
  } catch {
    /* sin descripción */
  }

  const avisos: string[] = [];
  const extra = body.atributos_extra ?? [];
  const cat = body.categoria_id.trim();

  // atributos que la categoría destino conoce (para no mandar los del dominio viejo)
  let catAttrIds: Set<string> | null = null;
  try {
    const ra = await mlFetch(c.env, db, `/categories/${cat}/attributes`);
    if (ra.ok) {
      const arr = (await ra.json()) as Array<{ id: string }>;
      catAttrIds = new Set(arr.map((a) => a.id));
    }
  } catch {
    /* si falla, mandamos todos los atributos */
  }

  // family_name primero (lo exigen estas categorías); title como fallback.
  // fotos por id primero; re-subidas si ML las rechaza.
  const intentos: ArmarOpts[] = [
    { familyMode: true, picsById: true },
    { familyMode: true, picsById: false },
    { familyMode: false, picsById: true },
  ];
  let creado: Awaited<ReturnType<typeof crearItem>> = { ok: false, error: "" };
  let usado: ArmarOpts | null = null;
  const fallos: string[] = [];
  for (const cfg of intentos) {
    creado = await crearItem(
      c.env,
      db,
      armarItem(item, cat, catAttrIds, extra, cfg),
    );
    if (creado.ok) {
      usado = cfg;
      break;
    }
    fallos.push(
      `[${cfg.familyMode ? "family_name" : "title"}${cfg.picsById ? "" : " · fotos re-subidas"}] ${creado.error}`,
    );
  }

  if (!creado.ok)
    return c.json(
      { error: fallos.join("   |   ").slice(0, 1200) || "no se pudo crear" },
      502,
    );
  const nuevo = creado.id!;
  if (usado && !usado.familyMode)
    avisos.push("La categoría nueva no usa family_name; se usó el título tal cual.");
  else avisos.push("El título lo compone Mercado Libre (family_name). Revisalo.");
  if (usado && !usado.picsById)
    avisos.push("Se re-subieron las fotos; revisá el orden.");
  avisos.push("El envío quedó con la config por defecto de tu cuenta — revisalo.");

  // pausar + descripción
  await mlFetch(c.env, db, `/items/${nuevo}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "paused" }),
  });
  if (descripcion.trim()) {
    const rd = await mlFetch(c.env, db, `/items/${nuevo}/description`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plain_text: descripcion.trim() }),
    });
    if (!rd.ok) avisos.push("No se pudo copiar la descripción a la nueva.");
  }

  // cerrar la vieja (best-effort: pausar y luego cerrar)
  let cerrada_vieja = false;
  try {
    await mlFetch(c.env, db, `/items/${viejo}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "paused" }),
    });
    const rc = await mlFetch(c.env, db, `/items/${viejo}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    });
    cerrada_vieja = rc.ok;
    if (!rc.ok)
      avisos.push(
        `No se pudo cerrar la publicación vieja (cerrala a mano en ML): ${(await rc.text()).slice(0, 120)}`,
      );
  } catch (e) {
    avisos.push(`Cerrar la vieja: ${(e as Error).message}`);
  }

  // relink en Supabase
  try {
    await syncOneItem(c.env, db, nuevo);
  } catch (e) {
    avisos.push(`sync de la nueva: ${(e as Error).message}`);
  }
  const { data: filaNueva } = await db
    .from("ml_listings")
    .select("id")
    .eq("ml_item_id", nuevo)
    .maybeSingle();
  await db
    .from("ml_listings")
    .update({ product_id: l.product_id, grupo_id: l.grupo_id })
    .eq("ml_item_id", nuevo);

  await reasignarSkuBase(db, viejo, nuevo, l.id, filaNueva?.id);

  try {
    await syncOneItem(c.env, db, viejo);
  } catch {
    /* ya está cerrada */
  }
  await db
    .from("ml_listings")
    .update({ estado: "closed", reemplazada_por: nuevo, categoria_sugerida: null })
    .eq("id", l.id);

  try {
    await derivarCatalogo(db);
  } catch (e) {
    avisos.push(`re-derivar catálogo: ${(e as Error).message}`);
  }

  return c.json({
    nuevo_item_id: nuevo,
    permalink: creado.permalink ?? null,
    cerrada_vieja,
    avisos,
  });
});
