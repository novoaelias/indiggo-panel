// Deriva el catálogo interno (products + product_variants) desde el espejo de
// MercadoLibre. Idempotente: identifica productos por `sku_base = ml_item_id` y
// variantes por `sku = <ml_item_id>:<ml_variation_id>`. No toca stock_real ni
// stock_minimo de filas que ya existían (los edita Elias).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type DB = SupabaseClient<Database>;

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

const CATEGORIAS: Array<[RegExp, string]> = [
  [/\bmostacilla/i, "mostacillas"],
  [/\b(clicker|fidget)/i, "clickers"],
  [/\b(holder|porta ?photocard|porta ?holder)/i, "holders"],
  [/\b(sticker|plancha|letras|funda|charm)\b/i, "otros"],
  [/\bllavero\b/i, "llaveros"],
  [/\bphotocard\b/i, "photocards"],
];

const GRUPOS: Array<[RegExp, string]> = [
  [/\b(bts|army|arirang|bangtan|bt21|hooligan)\b/i, "BTS"],
  [/\b(stray ?kids|straykids|skz)\b/i, "Stray Kids"],
  [/\bkatseye\b/i, "Katseye"],
  [/\btwice\b/i, "Twice"],
];

function detectar(
  titulo: string,
  regexes: Array<[RegExp, string]>,
): string | null {
  for (const [re, val] of regexes) if (re.test(titulo)) return val;
  return null;
}

export interface DerivarResumen {
  productos_nuevos: number;
  productos_total: number;
  variantes_nuevas: number;
  variantes_total: number;
  con_integrante: number;
  sin_integrante: number;
  grupos_detectados: Record<string, number>;
  sin_categoria: string[];
}

export async function derivarCatalogo(db: DB): Promise<DerivarResumen> {
  const [{ data: listings }, { data: vars }, { data: cats }, { data: gm }] =
    await Promise.all([
      db
        .from("ml_listings")
        .select("id, ml_item_id, titulo, tiene_variantes, cantidad_ml"),
      db
        .from("ml_listing_variations")
        .select("id, ml_listing_id, ml_variation_id, combinacion, cantidad_ml"),
      db.from("categories").select("id, slug"),
      db
        .from("group_members")
        .select("id, nombre, group_id, groups(nombre)"),
    ]);

  const catBySlug = new Map((cats ?? []).map((c) => [c.slug, c.id]));
  const grupoNombreToId = new Map<string, string>();
  // miembro normalizado -> { memberId } por nombre de grupo
  const miembrosPorGrupo = new Map<string, Map<string, string>>();
  for (const m of gm ?? []) {
    const gname = (m.groups as { nombre: string } | null)?.nombre;
    if (!gname) continue;
    grupoNombreToId.set(gname, m.group_id);
    if (!miembrosPorGrupo.has(gname)) miembrosPorGrupo.set(gname, new Map());
    miembrosPorGrupo.get(gname)!.set(norm(m.nombre), m.id);
  }

  // --- productos existentes ---
  const { data: prodExist } = await db
    .from("products")
    .select("id, sku_base");
  const prodBySku = new Map(
    (prodExist ?? [])
      .filter((p) => p.sku_base)
      .map((p) => [p.sku_base as string, p.id]),
  );

  const resumen: DerivarResumen = {
    productos_nuevos: 0,
    productos_total: listings?.length ?? 0,
    variantes_nuevas: 0,
    variantes_total: 0,
    con_integrante: 0,
    sin_integrante: 0,
    grupos_detectados: {},
    sin_categoria: [],
  };

  // atributos derivados de ML por publicación (categoría/grupo/holder-con-variantes)
  const derivados = new Map<
    string,
    {
      category_id: string | null;
      group_id: string | null;
      variantes_por_integrante: boolean;
      nombre: string;
    }
  >();
  for (const l of listings ?? []) {
    const catSlug = detectar(l.titulo, CATEGORIAS);
    const grupo = detectar(l.titulo, GRUPOS);
    if (grupo)
      resumen.grupos_detectados[grupo] =
        (resumen.grupos_detectados[grupo] ?? 0) + 1;
    if (!catSlug) resumen.sin_categoria.push(l.titulo);
    derivados.set(l.ml_item_id, {
      category_id: catSlug ? (catBySlug.get(catSlug) ?? null) : null,
      group_id: grupo ? (grupoNombreToId.get(grupo) ?? null) : null,
      // sólo los holders reales tienen estructura cuerpo + photocard
      variantes_por_integrante:
        catSlug === "holders" && l.tiene_variantes && grupo != null,
      nombre: l.titulo,
    });
  }

  // --- crear productos faltantes ---
  const nuevosProd: Database["public"]["Tables"]["products"]["Insert"][] = [];
  for (const l of listings ?? []) {
    if (prodBySku.has(l.ml_item_id)) continue;
    const d = derivados.get(l.ml_item_id)!;
    nuevosProd.push({ sku_base: l.ml_item_id, ...d });
  }
  if (nuevosProd.length) {
    const { data, error } = await db
      .from("products")
      .insert(nuevosProd)
      .select("id, sku_base");
    if (error) throw new Error(`insertar productos: ${error.message}`);
    for (const p of data ?? [])
      if (p.sku_base) prodBySku.set(p.sku_base, p.id);
    resumen.productos_nuevos = data?.length ?? 0;
  }

  // --- refrescar atributos ML en productos existentes (no toca stock) ---
  for (const [sku, d] of derivados) {
    const pid = prodBySku.get(sku);
    if (pid)
      await db
        .from("products")
        .update({
          nombre: d.nombre,
          category_id: d.category_id,
          group_id: d.group_id,
          variantes_por_integrante: d.variantes_por_integrante,
        })
        .eq("id", pid);
  }

  // --- vincular ml_listings.product_id ---
  for (const l of listings ?? []) {
    const pid = prodBySku.get(l.ml_item_id);
    if (pid) await db.from("ml_listings").update({ product_id: pid }).eq("id", l.id);
  }

  // --- variantes ---
  const { data: varExist } = await db
    .from("product_variants")
    .select("id, sku");
  const varBySku = new Map(
    (varExist ?? []).filter((v) => v.sku).map((v) => [v.sku as string, v.id]),
  );

  const listingById = new Map((listings ?? []).map((l) => [l.id, l]));
  const varsPorListing = new Map<string, typeof vars>();
  for (const v of vars ?? []) {
    if (!varsPorListing.has(v.ml_listing_id))
      varsPorListing.set(v.ml_listing_id, []);
    varsPorListing.get(v.ml_listing_id)!.push(v);
  }

  const nuevasVar: Array<
    Database["public"]["Tables"]["product_variants"]["Insert"] & {
      _linkVarId?: string;
    }
  > = [];

  for (const l of listings ?? []) {
    const pid = prodBySku.get(l.ml_item_id);
    if (!pid) continue;
    const grupo = detectar(l.titulo, GRUPOS);
    const miembros = grupo ? miembrosPorGrupo.get(grupo) : undefined;
    const lvars = varsPorListing.get(l.id) ?? [];

    if (!l.tiene_variantes || lvars.length === 0) {
      const sku = l.ml_item_id;
      resumen.variantes_total++;
      if (varBySku.has(sku)) continue;
      nuevasVar.push({
        product_id: pid,
        etiqueta: "Único",
        sku,
        stock_ml: l.cantidad_ml ?? 0,
      });
      continue;
    }

    for (const v of lvars) {
      const sku = `${l.ml_item_id}:${v.ml_variation_id}`;
      const valueName =
        (v.combinacion as Array<{ value_name?: string }> | null)?.[0]
          ?.value_name ?? "Variante";
      const memberId = miembros?.get(norm(valueName)) ?? null;
      resumen.variantes_total++;
      if (memberId) resumen.con_integrante++;
      else resumen.sin_integrante++;
      if (varBySku.has(sku)) continue;
      nuevasVar.push({
        product_id: pid,
        etiqueta: valueName,
        sku,
        group_member_id: memberId,
        stock_ml: v.cantidad_ml ?? 0,
        _linkVarId: v.id,
      });
    }
  }

  if (nuevasVar.length) {
    const payload = nuevasVar.map(({ _linkVarId, ...rest }) => {
      void _linkVarId;
      return rest;
    });
    const { data, error } = await db
      .from("product_variants")
      .insert(payload)
      .select("id, sku");
    if (error) throw new Error(`insertar variantes: ${error.message}`);
    for (const nv of data ?? [])
      if (nv.sku) varBySku.set(nv.sku, nv.id);
    resumen.variantes_nuevas = data?.length ?? 0;
  }

  // --- vincular ml_listing_variations.product_variant_id ---
  for (const v of vars ?? []) {
    const l = listingById.get(v.ml_listing_id);
    if (!l) continue;
    const sku = `${l.ml_item_id}:${v.ml_variation_id}`;
    const vid = varBySku.get(sku);
    if (vid)
      await db
        .from("ml_listing_variations")
        .update({ product_variant_id: vid })
        .eq("id", v.id);
  }

  return resumen;
}
