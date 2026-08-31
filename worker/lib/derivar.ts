// Deriva el catálogo interno (products + product_variants) desde el espejo de
// MercadoLibre. Idempotente.
//
// Grupos: varias `ml_listings` pueden ser el mismo producto físico (duplicadas
// por planes de cuotas / títulos reescritos). Se agrupan en `listing_groups` con
// una publicación canónica; el grupo deriva 1 solo `product` (sku_base = ml_item_id
// de la canónica) y las variantes se matchean por integrante entre todas las
// publicaciones del grupo. El stock real es único; el buffer de ML se publica a
// todas las publicaciones del grupo (ver resolverMLTodas en panel.ts).
//
// No toca stock_real ni stock_minimo de filas que ya existían (los edita Elias).
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
  productos_agrupados: number;
  variantes_nuevas: number;
  variantes_total: number;
  con_integrante: number;
  sin_integrante: number;
  grupos_detectados: Record<string, number>;
  sin_categoria: string[];
}

type Listing = {
  id: string;
  ml_item_id: string;
  titulo: string;
  tiene_variantes: boolean;
  cantidad_ml: number | null;
  grupo_id: string | null;
};

export async function derivarCatalogo(db: DB): Promise<DerivarResumen> {
  const [
    { data: listings },
    { data: vars },
    { data: cats },
    { data: gm },
    { data: grupos },
  ] = await Promise.all([
    db
      .from("ml_listings")
      .select(
        "id, ml_item_id, titulo, tiene_variantes, cantidad_ml, grupo_id",
      ),
    db
      .from("ml_listing_variations")
      .select("id, ml_listing_id, ml_variation_id, combinacion, cantidad_ml"),
    db.from("categories").select("id, slug"),
    db
      .from("group_members")
      .select("id, nombre, group_id, groups(nombre)"),
    db.from("listing_groups").select("id, canonical_listing_id, nombre"),
  ]);

  const catBySlug = new Map((cats ?? []).map((c) => [c.slug, c.id]));
  const grupoNombreToId = new Map<string, string>();
  const miembrosPorGrupo = new Map<string, Map<string, string>>();
  for (const m of gm ?? []) {
    const gname = (m.groups as { nombre: string } | null)?.nombre;
    if (!gname) continue;
    grupoNombreToId.set(gname, m.group_id);
    if (!miembrosPorGrupo.has(gname)) miembrosPorGrupo.set(gname, new Map());
    miembrosPorGrupo.get(gname)!.set(norm(m.nombre), m.id);
  }

  const listingById = new Map((listings ?? []).map((l) => [l.id, l as Listing]));
  // grupo_id -> { canónica, nombre, miembros[] }
  const grupoInfo = new Map<
    string,
    { canonica: Listing; nombre: string | null; miembros: Listing[] }
  >();
  for (const g of grupos ?? []) {
    const canonica = listingById.get(g.canonical_listing_id);
    if (canonica)
      grupoInfo.set(g.id, { canonica, nombre: g.nombre, miembros: [] });
  }
  for (const l of (listings ?? []) as Listing[]) {
    if (l.grupo_id && grupoInfo.has(l.grupo_id))
      grupoInfo.get(l.grupo_id)!.miembros.push(l);
  }

  // Publicación cuyo ml_item_id es el sku_base del producto de esta publicación.
  const pkl = (l: Listing): Listing =>
    l.grupo_id && grupoInfo.has(l.grupo_id)
      ? grupoInfo.get(l.grupo_id)!.canonica
      : l;

  const resumen: DerivarResumen = {
    productos_nuevos: 0,
    productos_total: 0,
    productos_agrupados: 0,
    variantes_nuevas: 0,
    variantes_total: 0,
    con_integrante: 0,
    sin_integrante: 0,
    grupos_detectados: {},
    sin_categoria: [],
  };

  // --- atributos por producto (keyed por sku_base = ml_item_id de la canónica) ---
  interface Deriv {
    sku_base: string;
    category_id: string | null;
    group_id: string | null;
    grupoNombre: string | null;
    variantes_por_integrante: boolean;
    tiene_variantes: boolean;
    nombre: string;
  }
  const derivados = new Map<string, Deriv>();
  for (const l of (listings ?? []) as Listing[]) {
    const base = pkl(l);
    const grupoDb = l.grupo_id ? grupoInfo.get(l.grupo_id) : undefined;
    const tieneVar = grupoDb
      ? grupoDb.miembros.some((m) => m.tiene_variantes)
      : l.tiene_variantes;
    const catSlug = detectar(base.titulo, CATEGORIAS);
    const grupo = detectar(base.titulo, GRUPOS);
    if (!derivados.has(base.ml_item_id)) {
      if (grupo)
        resumen.grupos_detectados[grupo] =
          (resumen.grupos_detectados[grupo] ?? 0) + 1;
      if (!catSlug) resumen.sin_categoria.push(base.titulo);
      derivados.set(base.ml_item_id, {
        sku_base: base.ml_item_id,
        category_id: catSlug ? (catBySlug.get(catSlug) ?? null) : null,
        group_id: grupo ? (grupoNombreToId.get(grupo) ?? null) : null,
        grupoNombre: grupo,
        variantes_por_integrante:
          catSlug === "holders" && tieneVar && grupo != null,
        tiene_variantes: tieneVar,
        nombre: grupoDb?.nombre?.trim() || base.titulo,
      });
      if (grupoDb) resumen.productos_agrupados++;
    }
  }
  resumen.productos_total = derivados.size;

  // --- productos existentes ---
  const { data: prodExist } = await db
    .from("products")
    .select("id, sku_base");
  const prodBySku = new Map(
    (prodExist ?? [])
      .filter((p) => p.sku_base)
      .map((p) => [p.sku_base as string, p.id]),
  );

  // --- crear productos faltantes ---
  const nuevosProd: Database["public"]["Tables"]["products"]["Insert"][] = [];
  for (const d of derivados.values()) {
    if (prodBySku.has(d.sku_base)) continue;
    nuevosProd.push({
      sku_base: d.sku_base,
      nombre: d.nombre,
      category_id: d.category_id,
      group_id: d.group_id,
      variantes_por_integrante: d.variantes_por_integrante,
    });
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
  for (const d of derivados.values()) {
    const pid = prodBySku.get(d.sku_base);
    if (pid)
      await db
        .from("products")
        .update({
          nombre: d.nombre,
          category_id: d.category_id,
          group_id: d.group_id,
          variantes_por_integrante: d.variantes_por_integrante,
          activo: true,
        })
        .eq("id", pid);
  }

  // --- vincular ml_listings.product_id (todas las del grupo → producto canónico) ---
  const prodPorListing = new Map<string, string>();
  for (const l of (listings ?? []) as Listing[]) {
    const pid = prodBySku.get(pkl(l).ml_item_id);
    if (!pid) continue;
    prodPorListing.set(l.id, pid);
    await db.from("ml_listings").update({ product_id: pid }).eq("id", l.id);
  }

  // --- desactivar productos (y sus variantes) sin ninguna publicación ---
  const productosUsados = new Set(prodPorListing.values());
  const productosSinUso = [...new Set(prodBySku.values())].filter(
    (pid) => !productosUsados.has(pid),
  );
  if (productosSinUso.length) {
    await db
      .from("products")
      .update({ activo: false })
      .in("id", productosSinUso);
    await db
      .from("product_variants")
      .update({ activo: false })
      .in("product_id", productosSinUso);
  }

  // --- consolidar stock de piezas 3D al agrupar publicaciones ---
  // Elias pudo haber cargado el cuerpo/llavero en cualquiera de las publicaciones
  // duplicadas; pasamos el stock (el mayor) al componente del producto canónico
  // y dejamos en 0 los de los hermanos para que derivarBOM los limpie.
  const nombreComp = (rol: string, nombreProd: string) =>
    `${rol} · ${nombreProd}`.slice(0, 120);
  for (const gi of grupoInfo.values()) {
    if (gi.miembros.length < 2) continue;
    const d = derivados.get(gi.canonica.ml_item_id);
    if (!d) continue;
    for (const rol of ["Cuerpo", "Llavero"] as const) {
      const nombresHermanos = gi.miembros.map((m) => nombreComp(rol, m.titulo));
      const canonNombre = nombreComp(rol, d.nombre);
      const { data: cs } = await db
        .from("components")
        .select("id, nombre, stock_real, stock_minimo")
        .in("nombre", [...new Set([...nombresHermanos, canonNombre])]);
      if (!cs?.length) continue;
      const maxReal = Math.max(...cs.map((c) => c.stock_real), 0);
      const maxMin = Math.max(...cs.map((c) => c.stock_minimo), 0);
      if (maxReal === 0 && maxMin === 0) continue;
      const canon = cs.find((c) => c.nombre === canonNombre);
      if (canon) {
        await db
          .from("components")
          .update({ stock_real: maxReal, stock_minimo: maxMin })
          .eq("id", canon.id);
      } else {
        await db.from("components").insert({
          nombre: canonNombre,
          origen: "impresora3d",
          stock_real: maxReal,
          stock_minimo: maxMin,
        });
      }
      for (const c of cs)
        if (c.nombre !== canonNombre)
          await db
            .from("components")
            .update({ stock_real: 0, stock_minimo: 0 })
            .eq("id", c.id);
    }
  }

  // ---------------- variantes ----------------
  const { data: varExist } = await db
    .from("product_variants")
    .select("id, sku, product_id, group_member_id, stock_ml");
  const varBySku = new Map(
    (varExist ?? []).filter((v) => v.sku).map((v) => [v.sku as string, v]),
  );
  const varByProdMember = new Map(
    (varExist ?? [])
      .filter((v) => v.group_member_id)
      .map((v) => [`${v.product_id}:${v.group_member_id}`, v]),
  );

  const varsPorListing = new Map<string, typeof vars>();
  for (const v of vars ?? []) {
    if (!varsPorListing.has(v.ml_listing_id))
      varsPorListing.set(v.ml_listing_id, []);
    varsPorListing.get(v.ml_listing_id)!.push(v);
  }

  // sku deseado -> definición
  interface VarDef {
    product_id: string;
    sku: string;
    etiqueta: string;
    group_member_id: string | null;
    stock_ml_seed: number;
    id?: string; // existente
  }
  const deseadas = new Map<string, VarDef>();
  // ml_listing_variations.id -> sku de la variante interna
  const linkVarSku = new Map<string, string>();
  // ml_listing (sin variantes) -> sku de la variante "Único"
  const linkListingSku = new Map<string, string>();
  const skusPorProducto = new Map<string, Set<string>>();
  const marcarSku = (pid: string, sku: string) => {
    if (!skusPorProducto.has(pid)) skusPorProducto.set(pid, new Set());
    skusPorProducto.get(pid)!.add(sku);
  };

  for (const l of (listings ?? []) as Listing[]) {
    const pid = prodPorListing.get(l.id);
    if (!pid) continue;
    const base = pkl(l);
    const d = derivados.get(base.ml_item_id)!;
    const miembros = d.grupoNombre
      ? miembrosPorGrupo.get(d.grupoNombre)
      : undefined;
    const lvars = varsPorListing.get(l.id) ?? [];

    if (!d.tiene_variantes || lvars.length === 0) {
      // producto simple: 1 variante "Único" (sólo si el producto no es de variantes)
      if (d.tiene_variantes) continue;
      const sku = base.ml_item_id;
      marcarSku(pid, sku);
      linkListingSku.set(l.id, sku);
      if (!deseadas.has(sku))
        deseadas.set(sku, {
          product_id: pid,
          sku,
          etiqueta: "Único",
          group_member_id: null,
          stock_ml_seed: l.cantidad_ml ?? 0,
          id: varBySku.get(sku)?.id,
        });
      resumen.variantes_total++;
      continue;
    }

    for (const v of lvars) {
      const valueName =
        (v.combinacion as Array<{ value_name?: string }> | null)?.[0]
          ?.value_name ?? "Variante";
      const memberId = miembros?.get(norm(valueName)) ?? null;
      const sku = memberId
        ? `${base.ml_item_id}#${memberId}`
        : `${base.ml_item_id}#e:${norm(valueName)}`;
      marcarSku(pid, sku);
      linkVarSku.set(v.id, sku);
      resumen.variantes_total++;
      if (memberId) resumen.con_integrante++;
      else resumen.sin_integrante++;

      if (!deseadas.has(sku)) {
        const exist =
          (memberId && varByProdMember.get(`${pid}:${memberId}`)) ||
          varBySku.get(sku);
        deseadas.set(sku, {
          product_id: pid,
          sku,
          etiqueta: valueName,
          group_member_id: memberId,
          stock_ml_seed: v.cantidad_ml ?? 0,
          id: exist?.id,
        });
      } else {
        // acumular el buffer más alto entre publicaciones del grupo para el seed
        const cur = deseadas.get(sku)!;
        cur.stock_ml_seed = Math.max(cur.stock_ml_seed, v.cantidad_ml ?? 0);
      }
    }
  }

  // --- aplicar: update existentes, insert nuevas ---
  const nuevas: Database["public"]["Tables"]["product_variants"]["Insert"][] = [];
  for (const def of deseadas.values()) {
    if (def.id) {
      await db
        .from("product_variants")
        .update({
          sku: def.sku,
          etiqueta: def.etiqueta,
          group_member_id: def.group_member_id,
          activo: true,
        })
        .eq("id", def.id);
    } else {
      nuevas.push({
        product_id: def.product_id,
        sku: def.sku,
        etiqueta: def.etiqueta,
        group_member_id: def.group_member_id,
        stock_ml: def.stock_ml_seed,
      });
    }
  }
  if (nuevas.length) {
    const { data, error } = await db
      .from("product_variants")
      .insert(nuevas)
      .select("id, sku");
    if (error) throw new Error(`insertar variantes: ${error.message}`);
    for (const nv of data ?? [])
      if (nv.sku) varBySku.set(nv.sku, { ...(varBySku.get(nv.sku) ?? {}), ...nv } as never);
    resumen.variantes_nuevas = data?.length ?? 0;
  }

  // resolver id final por sku (recargar las nuevas)
  const { data: varAll } = await db
    .from("product_variants")
    .select("id, sku, product_id");
  const idPorSku = new Map(
    (varAll ?? []).filter((v) => v.sku).map((v) => [v.sku as string, v.id]),
  );

  // --- desactivar variantes que ya no corresponden (por producto tocado) ---
  for (const [pid, skus] of skusPorProducto) {
    for (const v of varAll ?? []) {
      if (v.product_id !== pid || !v.sku) continue;
      const debeEstar = skus.has(v.sku);
      await db
        .from("product_variants")
        .update({ activo: debeEstar })
        .eq("id", v.id);
    }
  }

  // --- vincular ml_listing_variations.product_variant_id ---
  for (const [vId, sku] of linkVarSku) {
    const vid = idPorSku.get(sku);
    if (vid)
      await db
        .from("ml_listing_variations")
        .update({ product_variant_id: vid })
        .eq("id", vId);
  }

  return resumen;
}
