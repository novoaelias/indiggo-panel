import { describe, expect, it } from "vitest";
import {
  entregaAcordada,
  esperaDespacho,
  pedidoActivo,
  urgenciaDespacho,
} from "../worker/lib/envios";

// Viernes 2/10/2026, 14:00 en Argentina (17:00 UTC).
const viernes = new Date("2026-10-02T17:00:00Z");

describe("plazo de despacho de ML (Pedidos: hoy sí o sí / puede esperar)", () => {
  it("lo que vence hoy a las 23:59 AR sale hoy", () => {
    expect(urgenciaDespacho("2026-10-02T23:59:59-03:00", viernes)).toBe("hoy");
  });

  it("lo pagado el viernes después del corte vence el lunes: puede esperar", () => {
    expect(urgenciaDespacho("2026-10-05T23:59:59-03:00", viernes)).toBe("despues");
  });

  it("un plazo que ya pasó es demorado", () => {
    expect(urgenciaDespacho("2026-10-01T23:59:59-03:00", viernes)).toBe("vencido");
  });

  // A las 22:00 AR ya es sábado en UTC: el día se compara en horario de Argentina.
  it("de noche no confunde el día de hoy con el de UTC", () => {
    const viernesNoche = new Date("2026-10-03T01:00:00Z");
    expect(urgenciaDespacho("2026-10-02T23:59:59-03:00", viernesNoche)).toBe("hoy");
    expect(urgenciaDespacho("2026-10-03T23:59:59-03:00", viernesNoche)).toBe("despues");
  });

  it("sin dato de ML no inventa un plazo", () => {
    expect(urgenciaDespacho(null, viernes)).toBe("sin_fecha");
    expect(urgenciaDespacho("cualquier cosa", viernes)).toBe("sin_fecha");
  });

  it("sólo pide el plazo de envíos que siguen en el taller y no son Full", () => {
    expect(esperaDespacho("ready_to_ship", "drop_off")).toBe(true);
    expect(esperaDespacho("handling", "self_service")).toBe(true);
    expect(esperaDespacho("shipped", "drop_off")).toBe(false);
    expect(esperaDespacho("ready_to_ship", "fulfillment")).toBe(false);
    expect(esperaDespacho(null, "drop_off")).toBe(false);
  });
});

describe("ventas a acordar con el vendedor (sin envío de ML)", () => {
  const acordada = { tags: ["no_shipping", "paid", "not_delivered"] };

  it("se reconocen por el tag no_shipping", () => {
    expect(entregaAcordada(acordada)).toBe(true);
    expect(entregaAcordada({ tags: ["paid"] })).toBe(false);
    expect(entregaAcordada(null)).toBe(false);
  });

  // Antes se ocultaban: la venta quedaba con stock reservado y sin aparecer en Pedidos.
  it("siguen pendientes hasta que se marcan como entregadas", () => {
    const base = { estado: "paid", estado_envio: null, raw: acordada };
    expect(pedidoActivo(base)).toBe(true);
    expect(pedidoActivo({ ...base, stock_descontado_at: "2026-10-02T15:00:00Z" })).toBe(false);
  });

  it("si ML ya la da por entregada o no está paga, no es pendiente", () => {
    expect(
      pedidoActivo({ estado: "paid", estado_envio: null, raw: { tags: ["no_shipping", "delivered"] } }),
    ).toBe(false);
    expect(pedidoActivo({ estado: "cancelled", estado_envio: null, raw: acordada })).toBe(false);
  });
});
