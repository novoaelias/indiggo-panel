import { describe, expect, it } from "vitest";
import {
  allocateAssemblySuggestions,
  armablesPorReceta,
  disponibleComercial,
  planPiezas,
  topeEleccion,
} from "../worker/lib/inventory-logic";
import { calcBuffer, redondearPlaca } from "../worker/lib/bom";
import { distribuirStock, recibeStock } from "../worker/lib/stock";

describe("inventario físico", () => {
  it("no asigna una pieza compartida a dos productos", () => {
    const result = allocateAssemblySuggestions(
      [
        {
          id: "pedido",
          nombre: "Holder",
          etiqueta: "Rojo",
          faltantes_pedidos: 3,
          stock_minimo: 0,
          libres: 0,
          receta: [{ component_id: "llavero", cantidad: 1 }],
        },
        {
          id: "suelto",
          nombre: "Llavero suelto",
          etiqueta: "Rojo",
          faltantes_pedidos: 0,
          stock_minimo: 5,
          libres: 0,
          receta: [{ component_id: "llavero", cantidad: 1 }],
        },
      ],
      new Map([["llavero", 4]]),
    );
    expect(result.map((x) => [x.variant_id, x.cantidad])).toEqual([
      ["pedido", 3],
      ["suelto", 1],
    ]);
  });

  it("respeta las recetas verificadas de mixtos", () => {
    const result = allocateAssemblySuggestions(
      [
        {
          id: "mixto50",
          nombre: "Mixto 50",
          etiqueta: "Rojo",
          faltantes_pedidos: 2,
          stock_minimo: 0,
          libres: 0,
          receta: [
            { component_id: "logo", cantidad: 19 },
            { component_id: "desglosado", cantidad: 3 },
            { component_id: "nombres", cantidad: 1 },
          ],
        },
      ],
      new Map([
        ["logo", 38],
        ["desglosado", 6],
        ["nombres", 2],
      ]),
    );
    expect(result[0]?.cantidad).toBe(2);
  });

  // Recetas verificadas: el mixto de 50 y el de 100 comparten logos y juegos de
  // nombres, y el pack de 110 consume 5 juegos. Con piezas para un solo mixto de
  // 100, el pedido pendiente se lleva las piezas y el resto no puede armarse.
  it("arma mixtos y packs de 110 sin repartir dos veces la misma pieza", () => {
    const receta100 = [
      { component_id: "logo", cantidad: 38 },
      { component_id: "desglosado", cantidad: 6 },
      { component_id: "nombres", cantidad: 2 },
    ];
    const receta50 = [
      { component_id: "logo", cantidad: 19 },
      { component_id: "desglosado", cantidad: 3 },
      { component_id: "nombres", cantidad: 1 },
    ];
    const piezas = new Map([
      ["logo", 38],
      ["desglosado", 6],
      ["nombres", 5],
    ]);
    const result = allocateAssemblySuggestions(
      [
        {
          id: "mixto100",
          nombre: "Mixto 100",
          etiqueta: "Rojo",
          faltantes_pedidos: 1,
          stock_minimo: 0,
          libres: 0,
          receta: receta100,
        },
        {
          id: "mixto50",
          nombre: "Mixto 50",
          etiqueta: "Rojo",
          faltantes_pedidos: 0,
          stock_minimo: 2,
          libres: 0,
          receta: receta50,
        },
        {
          id: "pack110",
          nombre: "Pack 110",
          etiqueta: "Rojo",
          faltantes_pedidos: 0,
          stock_minimo: 1,
          libres: 0,
          receta: [{ component_id: "nombres", cantidad: 5 }],
        },
      ],
      piezas,
    );
    expect(result.find((x) => x.variant_id === "mixto100")?.cantidad).toBe(1);
    // ya no quedan logos ni desglosados para el mixto de 50
    expect(result.find((x) => x.variant_id === "mixto50")).toBeUndefined();
    // y los juegos de nombres que sobran (3) no alcanzan para un pack de 110
    expect(result.find((x) => x.variant_id === "pack110")).toBeUndefined();
  });

  it("mantiene el colchón comercial separado", () => {
    expect(calcBuffer(0)).toBe(2);
    expect(calcBuffer(4)).toBe(7);
  });

  it("publica sobre lo que se puede entregar, no sólo sobre lo armado", () => {
    // Holder sin terminados pero con piezas para 3: se publica 3 + colchón.
    const armables = armablesPorReceta(
      [
        { component_id: "cuerpo", cantidad: 1 },
        { component_id: "llavero", cantidad: 1 },
        { component_id: "photocard", cantidad: 1 },
      ],
      new Map([
        ["cuerpo", 12],
        ["llavero", 15],
        ["photocard", 3],
      ]),
    );
    expect(armables).toBe(3);
    const disponible = disponibleComercial({
      terminados: 0,
      reservados: 0,
      armables,
      faltantes: 0,
    });
    expect(calcBuffer(disponible)).toBe(6);
  });

  it("no promete piezas ya comprometidas en un pedido", () => {
    expect(
      disponibleComercial({
        terminados: 2,
        reservados: 2,
        armables: 3,
        faltantes: 1,
      }),
    ).toBe(2);
    expect(
      disponibleComercial({
        terminados: 0,
        reservados: 0,
        armables: 1,
        faltantes: 4,
      }),
    ).toBe(0);
  });

  it("distribuye User Product sin multiplicar el total", () => {
    const locations = distribuirStock(7, [
      { type: "seller_warehouse", store_id: "a", quantity: 3 },
      { type: "seller_warehouse", store_id: "b", quantity: 1 },
    ]);
    expect(locations.reduce((sum, x) => sum + Number(x.quantity), 0)).toBe(7);
  });

  // Una venta que deja la publicación en 0 hace que ML la pause por falta de
  // stock. Si el panel sólo repone las activas, queda pausada para siempre (le
  // pasó al holder de Katseye). Una pausa del vendedor no se toca.
  it("repone las publicaciones que ML pausó sólo por quedarse sin stock", () => {
    expect(recibeStock("active", [])).toBe(true);
    expect(recibeStock("paused", ["out_of_stock"])).toBe(true);
    expect(recibeStock("paused", ["paused_by_seller"])).toBe(false);
    expect(recibeStock("paused", ["out_of_stock", "paused_by_seller"])).toBe(false);
    expect(recibeStock("paused", null)).toBe(false);
    expect(recibeStock("under_review", ["forbidden"])).toBe(false);
    expect(recibeStock("closed", ["deleted"])).toBe(false);
  });

  // Lo que hay que reponer sale de los pedidos pendientes y de los mínimos, y
  // se sugiere en fracciones de placa, que es como se imprime.
  it("planifica impresiones por placa y separa lo que se encarga", () => {
    const trabajos = planPiezas(
      [
        {
          id: "holder",
          nombre: "Holder",
          etiqueta: "RM",
          faltantes_pedidos: 4,
          stock_minimo: 0,
          libres: 0,
          receta: [
            { component_id: "cuerpo", cantidad: 1 },
            { component_id: "photocard", cantidad: 1 },
          ],
        },
      ],
      [
        {
          id: "cuerpo",
          nombre: "Cuerpo 3D",
          unidad: "unidad",
          origen: "impresora3d",
          stock_real: 1,
          stock_minimo: 0,
          rinde_por_placa: 3,
          minutos_placa: 120,
          minutos_produccion: null,
        },
        {
          id: "photocard",
          nombre: "Photocard RM",
          unidad: "unidad",
          origen: "imprenta",
          stock_real: 0,
          stock_minimo: 0,
          rinde_por_placa: null,
          minutos_placa: null,
          minutos_produccion: null,
        },
      ],
      redondearPlaca,
    );
    const cuerpo = trabajos.find((t) => t.component_id === "cuerpo");
    const photocard = trabajos.find((t) => t.component_id === "photocard");
    expect(cuerpo?.faltan).toBe(3);
    expect(cuerpo?.placas).toBe(1);
    expect(cuerpo?.minutos).toBe(120);
    expect(photocard?.faltan).toBe(4);
    expect(photocard?.origen).toBe("imprenta");
    expect(photocard?.placas).toBeNull();
  });

  // La variante "Random" se arma con cuerpo y llavero, pero igual sale una
  // photocard: no puede publicar más que el total de photocards que quedan.
  it("topea la variante a elección por las piezas que igual se despachan", () => {
    const random = [
      { component_id: "cuerpo" },
      { component_id: "llavero" },
    ];
    const hermanas = [
      [{ component_id: "cuerpo" }, { component_id: "llavero" }, { component_id: "pc-rm" }],
      [{ component_id: "cuerpo" }, { component_id: "llavero" }, { component_id: "pc-jin" }],
    ];
    const stock = new Map([
      ["cuerpo", 12],
      ["llavero", 15],
      ["pc-rm", 2],
      ["pc-jin", 1],
    ]);
    expect(topeEleccion(random, hermanas, stock)).toBe(3);
    expect(Math.min(armablesPorReceta([
      { component_id: "cuerpo", cantidad: 1 },
      { component_id: "llavero", cantidad: 1 },
    ], stock), topeEleccion(random, hermanas, stock)!)).toBe(3);
  });
});
