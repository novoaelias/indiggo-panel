// Lista de materiales (BOM) y planificador de producción.
//
// Modelo: un holder con variante por integrante consume, al armarse, 1 "cuerpo"
// (frente + dorso del holder) impreso en 3D + 1 llavero impreso en 3D (propio de
// ese holder, el de BTS ≠ el de Stray Kids) + 1 photocard (imprenta) del
// integrante elegido. Los productos simples (mostacillas, clickers, stickers…)
// se producen directo, sin BOM.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type DB = SupabaseClient<Database>;

const rec = (s: string) => s.slice(0, 120);

// ---------- derivación automática del BOM ----------
export async function derivarBOM(db: DB): Promise<{
  cuerpos: number;
  llaveros: number;
  photocards: number;
  vinculos: number;
}> {
  const { data: prods } = await db
    .from("products")
    .select("id, nombre, variantes_por_integrante, categories(origen)")
    .eq("variantes_por_integrante", true)
    .eq("activo", true);

  const { data: variants } = await db
    .from("product_variants")
    .select("id, product_id, group_member_id, etiqueta")
    .eq("activo", true);

  const { data: gm } = await db
    .from("group_members")
    .select("id, nombre, groups(nombre)");
  const memberLabel = new Map(
    (gm ?? []).map((m) => [
      m.id,
      `${m.nombre} · ${(m.groups as { nombre?: string } | null)?.nombre ?? ""}`.trim(),
    ]),
  );

  const varsPorProducto = new Map<string, typeof variants>();
  for (const v of variants ?? []) {
    if (!varsPorProducto.has(v.product_id))
      varsPorProducto.set(v.product_id, []);
    varsPorProducto.get(v.product_id)!.push(v);
  }

  // componentes a asegurar (por nombre único)
  const compNuevos = new Map<
    string,
    Database["public"]["Tables"]["components"]["Insert"]
  >();
  // vínculos: variantId -> [nombreComponente]
  const vinculos: Array<{ variantId: string; compNombre: string }> = [];

  for (const p of prods ?? []) {
    const cuerpoNombre = rec(`Cuerpo · ${p.nombre}`);
    compNuevos.set(cuerpoNombre, {
      nombre: cuerpoNombre,
      origen: "impresora3d",
    });
    const llaveroNombre = rec(`Llavero · ${p.nombre}`);
    compNuevos.set(llaveroNombre, {
      nombre: llaveroNombre,
      origen: "impresora3d",
    });

    for (const v of varsPorProducto.get(p.id) ?? []) {
      vinculos.push({ variantId: v.id, compNombre: cuerpoNombre });
      vinculos.push({ variantId: v.id, compNombre: llaveroNombre });
      if (v.group_member_id) {
        const pcNombre = rec(
          `Photocard · ${memberLabel.get(v.group_member_id) ?? v.etiqueta}`,
        );
        compNuevos.set(pcNombre, {
          nombre: pcNombre,
          origen: "imprenta",
          group_member_id: v.group_member_id,
        });
        vinculos.push({ variantId: v.id, compNombre: pcNombre });
      }
    }
  }

  // --- si un Cuerpo/Llavero cambió de nombre (ej. merge de publicaciones que
  //     renombra el producto), renombrar el componente existente en vez de
  //     crear uno nuevo y perder el stock que cargó Elias ---
  const { data: compsPre } = await db
    .from("components")
    .select("id, nombre, origen, stock_real");
  const { data: vcPre } = await db
    .from("variant_components")
    .select("variant_id, component_id");
  const compByIdPre = new Map((compsPre ?? []).map((c) => [c.id, c]));
  const nombreExistePre = new Set((compsPre ?? []).map((c) => c.nombre));
  const prodPorVariant = new Map(
    (variants ?? []).map((v) => [v.id, v.product_id]),
  );
  const auto3dPorProd = new Map<string, Set<string>>();
  for (const r of vcPre ?? []) {
    const c = compByIdPre.get(r.component_id);
    const pid = prodPorVariant.get(r.variant_id);
    if (
      !c ||
      !pid ||
      c.origen !== "impresora3d" ||
      !(c.nombre.startsWith("Cuerpo · ") || c.nombre.startsWith("Llavero · "))
    )
      continue;
    if (!auto3dPorProd.has(pid)) auto3dPorProd.set(pid, new Set());
    auto3dPorProd.get(pid)!.add(r.component_id);
  }
  for (const p of prods ?? []) {
    const usados = [...(auto3dPorProd.get(p.id) ?? [])]
      .map((id) => compByIdPre.get(id))
      .filter(Boolean) as Array<{ id: string; nombre: string }>;
    for (const rol of ["Cuerpo", "Llavero"] as const) {
      const deseado = rec(`${rol} · ${p.nombre}`);
      const actual = usados.find((c) => c.nombre.startsWith(`${rol} · `));
      if (actual && actual.nombre !== deseado && !nombreExistePre.has(deseado)) {
        await db
          .from("components")
          .update({ nombre: deseado })
          .eq("id", actual.id);
        nombreExistePre.add(deseado);
      }
    }
  }

  if (compNuevos.size) {
    await db
      .from("components")
      .upsert([...compNuevos.values()], {
        onConflict: "nombre",
        ignoreDuplicates: true,
      });
  }

  const { data: comps } = await db.from("components").select("id, nombre");
  const idPorNombre = new Map((comps ?? []).map((c) => [c.nombre, c.id]));
  const nombresValidos = new Set(compNuevos.keys());

  const vcRows = vinculos
    .map((v) => ({
      variant_id: v.variantId,
      component_id: idPorNombre.get(v.compNombre),
      cantidad: 1,
    }))
    .filter(
      (r): r is { variant_id: string; component_id: string; cantidad: number } =>
        Boolean(r.component_id),
    );

  // --- limpieza de BOM viejo (idempotencia) ---
  const paresValidos = new Set(
    vcRows.map((r) => `${r.variant_id}:${r.component_id}`),
  );
  const { data: vcExist } = await db
    .from("variant_components")
    .select("variant_id, component_id");
  for (const r of vcExist ?? []) {
    if (!paresValidos.has(`${r.variant_id}:${r.component_id}`)) {
      await db
        .from("variant_components")
        .delete()
        .eq("variant_id", r.variant_id)
        .eq("component_id", r.component_id);
    }
  }
  // borrar componentes auto-generados que ya no aplican (nombre "Cuerpo · " o
  // "Photocard · " y no están en el set válido)
  for (const c of comps ?? []) {
    const esAuto =
      c.nombre.startsWith("Cuerpo · ") ||
      c.nombre.startsWith("Llavero · ") ||
      c.nombre.startsWith("Photocard · ");
    if (esAuto && !nombresValidos.has(c.nombre)) {
      await db.from("components").delete().eq("id", c.id);
    }
  }

  if (vcRows.length) {
    await db
      .from("variant_components")
      .upsert(vcRows, { onConflict: "variant_id,component_id" });
  }

  const nombres = [...compNuevos.keys()];
  const cuerpos = nombres.filter((n) => n.startsWith("Cuerpo · ")).length;
  const llaveros = nombres.filter((n) => n.startsWith("Llavero · ")).length;
  return {
    cuerpos,
    llaveros,
    photocards: compNuevos.size - cuerpos - llaveros,
    vinculos: vcRows.length,
  };
}

// ---------- planificador ----------
export interface TareaPlan {
  nombre: string;
  origen: string;
  cantidad: number;
  ya_tengo?: number;
  necesito?: number;
  tipo: "insumo" | "directo";
}

export async function planificar(db: DB): Promise<{
  imprimir_3d: TareaPlan[];
  imprenta: TareaPlan[];
  otros: TareaPlan[];
  variantes_criticas: number;
  sin_bom: boolean;
}> {
  const { data: variants } = await db
    .from("product_variants")
    .select(
      "id, etiqueta, stock_real, stock_minimo, product_id, group_member_id",
    )
    .eq("activo", true);

  const { data: prods } = await db
    .from("products")
    .select("id, nombre, categories(origen)");
  const prodInfo = new Map(
    (prods ?? []).map((p) => [
      p.id,
      {
        nombre: p.nombre,
        origen:
          (p.categories as { origen?: string } | null)?.origen ?? "impresora3d",
      },
    ]),
  );

  const { data: gm } = await db.from("group_members").select("id, nombre");
  const memberNombre = new Map((gm ?? []).map((m) => [m.id, m.nombre]));

  const { data: vc } = await db
    .from("variant_components")
    .select("variant_id, component_id, cantidad");
  const bomPorVariante = new Map<string, typeof vc>();
  for (const r of vc ?? []) {
    if (!bomPorVariante.has(r.variant_id))
      bomPorVariante.set(r.variant_id, []);
    bomPorVariante.get(r.variant_id)!.push(r);
  }

  const { data: comps } = await db
    .from("components")
    .select("id, nombre, origen, stock_real");
  const compInfo = new Map(
    (comps ?? []).map((c) => [
      c.id,
      { nombre: c.nombre, origen: c.origen, stock: c.stock_real },
    ]),
  );

  const necesidad = new Map<string, number>();
  const directos: TareaPlan[] = [];
  let criticas = 0;

  for (const v of variants ?? []) {
    if (v.stock_real >= v.stock_minimo) continue;
    criticas++;
    const faltan = Math.max(
      v.stock_minimo * 2 - v.stock_real,
      v.stock_minimo - v.stock_real,
    );
    const bom = bomPorVariante.get(v.id) ?? [];
    if (bom.length) {
      for (const b of bom)
        necesidad.set(
          b.component_id,
          (necesidad.get(b.component_id) ?? 0) + faltan * b.cantidad,
        );
    } else {
      const pi = prodInfo.get(v.product_id);
      const nombreVar =
        v.etiqueta === "Único"
          ? (pi?.nombre ?? "—")
          : `${pi?.nombre ?? "—"} — ${v.group_member_id ? memberNombre.get(v.group_member_id) : v.etiqueta}`;
      directos.push({
        nombre: nombreVar,
        origen: pi?.origen ?? "impresora3d",
        cantidad: faltan,
        tipo: "directo",
      });
    }
  }

  const insumos: TareaPlan[] = [];
  for (const [compId, nec] of necesidad) {
    const info = compInfo.get(compId);
    if (!info) continue;
    const neto = Math.max(nec - info.stock, 0);
    if (neto <= 0) continue;
    insumos.push({
      nombre: info.nombre,
      origen: info.origen,
      cantidad: neto,
      ya_tengo: info.stock,
      necesito: nec,
      tipo: "insumo",
    });
  }

  const todo = [...insumos, ...directos].sort((a, b) => b.cantidad - a.cantidad);
  const por = (o: string) => todo.filter((t) => t.origen === o);

  return {
    imprimir_3d: por("impresora3d"),
    imprenta: por("imprenta"),
    otros: todo.filter(
      (t) => t.origen !== "impresora3d" && t.origen !== "imprenta",
    ),
    variantes_criticas: criticas,
    sin_bom: (vc ?? []).length === 0,
  };
}
