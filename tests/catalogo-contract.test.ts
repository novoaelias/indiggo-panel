import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const derivar = readFileSync(
  new URL("../worker/lib/derivar.ts", import.meta.url),
  "utf8",
);
const sync = readFileSync(
  new URL("../worker/lib/sync.ts", import.meta.url),
  "utf8",
);
const panel = readFileSync(
  new URL("../worker/routes/panel.ts", import.meta.url),
  "utf8",
);
const stock = readFileSync(
  new URL("../worker/lib/stock.ts", import.meta.url),
  "utf8",
);

describe("catálogo: un producto físico, varias publicaciones", () => {
  // Varias publicaciones del mismo producto comparten variante interna, así que
  // todas descuentan del mismo inventario. El vínculo es por id, nunca por título.
  it("vincula publicaciones y variaciones con la variante interna por id", () => {
    expect(derivar).toContain('.update({ product_variant_id: vid })');
    expect(derivar).toContain('.from("ml_listing_variations")');
    expect(sync).toContain("resolverVariantePedido");
    expect(sync).toContain('.select("product_variant_id")');
  });

  // Cambiar el título en ML no puede renombrar el producto interno ni tocar su
  // receta: el nombre interno queda bloqueado y las recetas viven en la base.
  it("no pisa nombres internos ni recetas al sincronizar", () => {
    expect(derivar).toContain("catalog_locked");
    expect(derivar).toMatch(/if \(pid && !locked\)/);
    expect(sync).not.toContain("derivarBOM");
  });

  // El colchón de ML y los movimientos físicos tienen un solo dueño: las
  // pantallas de consulta no reconstruyen stock.
  it("deja el inventario físico fuera de las pantallas de consulta", () => {
    expect(panel).not.toContain("recalcularDerivado");
    expect(panel).not.toContain('panel.get("/stock"');
    expect(panel).not.toContain('panel.patch("/componentes/:id"');
  });

  // Un producto puede tener una publicación por color. Si el stock se empujara
  // por producto, el buffer de un color pisaría el del otro en cada sync.
  it("publica el stock a la publicación de esa variante, no a todo el producto", () => {
    expect(stock).toContain('.eq("product_variant_id", variantId)');
    expect(stock).toContain('.is("product_variant_id", null)');
  });
});
