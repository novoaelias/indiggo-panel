import { describe, expect, it } from "vitest";
import { esperaDespacho, urgenciaDespacho } from "../worker/lib/envios";

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
