import { describe, expect, it } from "vitest";
import {
  aspectoMasCercano,
  fotosDistintas,
  invertir,
  leerDeteccion,
  promptEdicion,
  reemplazarFotos,
} from "../worker/lib/fotos";

describe("editor de fotos en lote", () => {
  it("elige la relación de aspecto de kie.ai más parecida", () => {
    expect(aspectoMasCercano("907x1200")).toBe("3:4");
    expect(aspectoMasCercano("960x1200")).toBe("4:5");
    expect(aspectoMasCercano("1200x1200")).toBe("1:1");
    expect(aspectoMasCercano(undefined)).toBeNull();
  });

  // Los dos holders de Arirang comparten las mismas fotos: se editan una vez.
  it("junta la misma foto de varias publicaciones en un solo ítem", () => {
    const foto = { id: "A", secure_url: "https://x/A.webp", max_size: "907x1200" };
    const distintas = fotosDistintas([
      { ml_item_id: "MLA1", raw: { pictures: [foto, { id: "B", url: "http://x/B.jpg" }] } },
      { ml_item_id: "MLA2", raw: { pictures: [foto] } },
    ]);
    expect(distintas).toHaveLength(2);
    expect(distintas[0]).toMatchObject({ ml_picture_id: "A", ml_item_ids: ["MLA1", "MLA2"], aspect_ratio: "3:4" });
    expect(distintas[1].original_url).toBe("https://x/B.jpg");
  });

  it("usa la foto completa de ML, no la de 500 px", () => {
    const [f] = fotosDistintas([
      {
        ml_item_id: "MLA1",
        raw: { pictures: [{ id: "A", url: "http://http2.mlstatic.com/D_762450-MLA1_062026-O.webp" }] },
      },
    ]);
    expect(f.original_url).toBe("https://http2.mlstatic.com/D_762450-MLA1_062026-F.webp");
  });

  it("reemplaza en la publicación y en cada variante, sin mover el orden", () => {
    const { body, reemplazos } = reemplazarFotos(
      {
        pictures: [{ id: "A" }, { id: "B" }, { id: "C" }],
        variations: [
          { id: 1, picture_ids: ["B", "A"] },
          { id: 2, picture_ids: ["C"] },
        ],
      },
      { A: "A2", X: "X2" },
    );
    expect(body.pictures).toEqual([{ id: "A2" }, { id: "B" }, { id: "C" }]);
    expect(body.variations).toEqual([
      { id: 1, picture_ids: ["B", "A2"] },
      { id: 2, picture_ids: ["C"] },
    ]);
    // X no estaba en la publicación: no cuenta como reemplazo hecho.
    expect(reemplazos).toEqual({ A: "A2" });
  });

  it("sin variantes no manda el campo variations", () => {
    const { body } = reemplazarFotos({ pictures: [{ id: "A" }] }, { A: "A2" });
    expect(body).toEqual({ pictures: [{ id: "A2" }] });
  });

  it("deshacer vuelve exactamente a las fotos originales", () => {
    const original = {
      pictures: [{ id: "A" }, { id: "B" }],
      variations: [{ id: 1, picture_ids: ["A", "B"] }],
    };
    const ida = reemplazarFotos(original, { A: "A2", B: "B2" });
    const vuelta = reemplazarFotos(ida.body, invertir(ida.reemplazos));
    expect(vuelta.body).toEqual({
      pictures: original.pictures,
      variations: original.variations,
    });
  });

  it("una foto sin respuesta de la detección no se descarta sola", () => {
    const res = leerDeteccion(
      { fotos: [{ n: 2, aplica: false, donde: "", motivo: "no aparece" }, { n: 9, aplica: true }] },
      3,
    );
    expect(res[0]).toBeNull();
    expect(res[1]).toMatchObject({ aplica: false });
    expect(res[2]).toBeNull();
  });

  it("el prompt de borrado prohíbe copiar las marcas de la referencia", () => {
    const p = promptEdicion(
      {
        modo: "borrar",
        descripcion: "tira de cuentas rojas con corazones y estrella",
        ubicacion: null,
        referencias: ["https://x/marcada.jpg"],
      },
      { donde: "en los dos llaveros", nota: "dejá la borla" },
    );
    expect(p).toContain("never copy marks");
    expect(p).toContain("en los dos llaveros");
    expect(p).toContain("dejá la borla");
  });
});
