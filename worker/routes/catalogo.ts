import { Hono } from "hono";
import type { Env } from "../env";
import { supa } from "../lib/supabase";
import { derivarCatalogo } from "../lib/derivar";
import { derivarBOM } from "../lib/bom";

export const catalogo = new Hono<{ Bindings: Env }>();

// Deriva products + product_variants desde el espejo de ML. Idempotente.
catalogo.post("/derivar", async (c) => {
  const db = supa(c.env);
  try {
    const resumen = await derivarCatalogo(db);
    return c.json(resumen);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

catalogo.get("/resumen", async (c) => {
  const db = supa(c.env);
  const [
    { count: productos },
    { count: variantes },
    { count: publicaciones },
    { count: insumos },
  ] = await Promise.all([
    db.from("products").select("id", { count: "exact", head: true }),
    db.from("product_variants").select("id", { count: "exact", head: true }),
    db.from("ml_listings").select("id", { count: "exact", head: true }),
    db.from("components").select("id", { count: "exact", head: true }),
  ]);
  return c.json({
    productos: productos ?? 0,
    variantes: variantes ?? 0,
    publicaciones: publicaciones ?? 0,
    insumos: insumos ?? 0,
  });
});

// Arma automáticamente la lista de materiales de los holders con variante por
// integrante (1 cuerpo 3D + 1 llavero 3D propio del holder + 1 photocard de
// imprenta por variante). Idempotente.
catalogo.post("/derivar-bom", async (c) => {
  const db = supa(c.env);
  try {
    return c.json(await derivarBOM(db));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// ---------------- Agrupar publicaciones (mismo producto físico) ----------------
const RUIDO = new Set([
  "combo","porta","holder","photocard","pc","de","tu","bias","llavero","charm",
  "con","y","para","el","la","kpop","bts","stray","kids","straykids","skz",
  "cuotas","cuota","sin","interes","interés","hasta","x3","x6","x9","x12","3","6","9","12",
  "mercado","libre","full","envio","envío","gratis","+","-","el","del","un","una","random",
]);
const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !RUIDO.has(w)),
  );
const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
};

catalogo.get("/agrupables", async (c) => {
  const db = supa(c.env);
  const [{ data: listings, error }, { data: grupos }] = await Promise.all([
    db
      .from("ml_listings")
      .select(
        "id, ml_item_id, titulo, thumbnail, estado, precio, tiene_variantes, grupo_id",
      )
      .order("titulo"),
    db.from("listing_groups").select("id, nombre, canonical_listing_id"),
  ]);
  if (error) return c.json({ error: error.message }, 500);

  const ls = listings ?? [];
  const sueltas = ls.filter((l) => !l.grupo_id);

  // sugerencias: por thumbnail idéntico o por título muy parecido
  const tokMap = new Map(sueltas.map((l) => [l.id, tokens(l.titulo)]));
  const usados = new Set<string>();
  const sugerencias: string[][] = [];
  for (let i = 0; i < sueltas.length; i++) {
    const a = sueltas[i];
    if (usados.has(a.id)) continue;
    const cluster = [a.id];
    for (let j = i + 1; j < sueltas.length; j++) {
      const b = sueltas[j];
      if (usados.has(b.id)) continue;
      const mismoThumb =
        a.thumbnail && b.thumbnail && a.thumbnail === b.thumbnail;
      const parecido = jaccard(tokMap.get(a.id)!, tokMap.get(b.id)!) >= 0.5;
      if (mismoThumb || parecido) cluster.push(b.id);
    }
    if (cluster.length > 1) {
      cluster.forEach((id) => usados.add(id));
      sugerencias.push(cluster);
    }
  }

  return c.json({
    publicaciones: ls,
    grupos: grupos ?? [],
    sugerencias,
  });
});

catalogo.post("/agrupables", async (c) => {
  const body = await c.req.json<{
    listing_ids?: string[];
    canonical_listing_id?: string;
    nombre?: string;
  }>();
  const ids = [...new Set(body.listing_ids ?? [])];
  const canon = body.canonical_listing_id;
  if (ids.length < 2 || !canon || !ids.includes(canon))
    return c.json({ error: "elegí 2+ publicaciones y una principal" }, 400);

  const db = supa(c.env);
  // sacar estas publicaciones de cualquier grupo previo
  await db
    .from("ml_listings")
    .update({ grupo_id: null })
    .in("id", ids);
  await limpiarGruposVacios(db);

  const { data: grupo, error } = await db
    .from("listing_groups")
    .insert({ canonical_listing_id: canon, nombre: body.nombre?.trim() || null })
    .select("id")
    .single();
  if (error) return c.json({ error: error.message }, 500);

  const { error: e2 } = await db
    .from("ml_listings")
    .update({ grupo_id: grupo.id })
    .in("id", ids);
  if (e2) return c.json({ error: e2.message }, 500);

  try {
    const resumen = await derivarCatalogo(db);
    return c.json({ id: grupo.id, resumen });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

catalogo.delete("/agrupables/:id", async (c) => {
  const db = supa(c.env);
  const id = c.req.param("id");
  await db.from("ml_listings").update({ grupo_id: null }).eq("grupo_id", id);
  await db.from("listing_groups").delete().eq("id", id);
  try {
    const resumen = await derivarCatalogo(db);
    return c.json({ resumen });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

async function limpiarGruposVacios(db: ReturnType<typeof supa>) {
  const [{ data: grupos }, { data: usados }] = await Promise.all([
    db.from("listing_groups").select("id"),
    db.from("ml_listings").select("grupo_id").not("grupo_id", "is", null),
  ]);
  const conUso = new Set((usados ?? []).map((l) => l.grupo_id));
  const vacios = (grupos ?? [])
    .map((g) => g.id)
    .filter((gid) => !conUso.has(gid));
  if (vacios.length)
    await db.from("listing_groups").delete().in("id", vacios);
}

// --- Grupos e integrantes ---
catalogo.get("/grupos", async (c) => {
  const db = supa(c.env);
  const { data: grupos, error } = await db
    .from("groups")
    .select("id, nombre, group_members(id, nombre, orden, activo)")
    .order("nombre");
  if (error) return c.json({ error: error.message }, 500);

  const out = (grupos ?? []).map((g) => ({
    id: g.id,
    nombre: g.nombre,
    integrantes: [...(g.group_members ?? [])]
      .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
      .map((m) => ({ id: m.id, nombre: m.nombre, activo: m.activo })),
  }));
  return c.json({ grupos: out });
});

catalogo.post("/grupos", async (c) => {
  const body = await c.req.json<{ nombre?: string; integrantes?: string[] }>();
  const nombre = body.nombre?.trim();
  if (!nombre) return c.json({ error: "nombre requerido" }, 400);

  const db = supa(c.env);
  const { data: grupo, error } = await db
    .from("groups")
    .insert({ nombre })
    .select("id, nombre")
    .single();
  if (error) return c.json({ error: error.message }, 500);

  const integrantes = (body.integrantes ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (integrantes.length) {
    const { error: e2 } = await db.from("group_members").insert(
      integrantes.map((nom, i) => ({
        group_id: grupo.id,
        nombre: nom,
        orden: i,
      })),
    );
    if (e2) return c.json({ error: e2.message }, 500);
  }
  return c.json({ id: grupo.id }, 201);
});

catalogo.post("/grupos/:id/integrantes", async (c) => {
  const groupId = c.req.param("id");
  const body = await c.req.json<{ nombre?: string }>();
  const nombre = body.nombre?.trim();
  if (!nombre) return c.json({ error: "nombre requerido" }, 400);

  const db = supa(c.env);
  const { count } = await db
    .from("group_members")
    .select("id", { count: "exact", head: true })
    .eq("group_id", groupId);

  const { data, error } = await db
    .from("group_members")
    .insert({ group_id: groupId, nombre, orden: count ?? 0 })
    .select("id")
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ id: data.id }, 201);
});

catalogo.delete("/integrantes/:id", async (c) => {
  const db = supa(c.env);
  const { error } = await db
    .from("group_members")
    .delete()
    .eq("id", c.req.param("id"));
  if (error) return c.json({ error: error.message }, 500);
  return c.body(null, 204);
});

// --- Categorías ---
catalogo.get("/productos", async (c) => {
  const db = supa(c.env);
  const { data, error } = await db
    .from("products")
    .select("id, nombre")
    .eq("activo", true)
    .order("nombre");
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ productos: data });
});

catalogo.get("/categorias", async (c) => {
  const db = supa(c.env);
  const { data, error } = await db
    .from("categories")
    .select("id, nombre, slug, origen")
    .order("nombre");
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ categorias: data });
});
