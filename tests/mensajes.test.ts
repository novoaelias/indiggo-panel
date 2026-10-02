import { describe, expect, it } from "vitest";
import {
  estadoConversacion,
  normalizarMensajes,
  opcionesDeInicio,
  packsConNoLeidos,
} from "../worker/lib/mensajes";

const VENDEDOR = "100000001";

describe("mensajes de las ventas", () => {
  it("ordena la conversación de la más vieja a la más nueva y marca los míos", () => {
    const mensajes = normalizarMensajes(
      [
        { id: "b", from: { user_id: 200000002 }, text: "Muchas gracias ", message_date: { created: "2026-10-02T15:33:14Z" } },
        { id: "a", from: { user_id: 100000001 }, text: "Sisi, no hay problema!!", message_date: { created: "2026-10-02T15:30:00Z" } },
        { id: "c", from: { user_id: 200000002 }, text: "   ", message_date: { created: "2026-10-02T15:40:00Z" } },
      ],
      VENDEDOR,
    );
    expect(mensajes.map((m) => [m.id, m.mio, m.texto])).toEqual([
      ["a", true, "Sisi, no hay problema!!"],
      ["b", false, "Muchas gracias"],
    ]);
  });

  it("distingue el chat bloqueado de Mercado Envíos de uno cerrado", () => {
    expect(estadoConversacion({ status: "active" }).estado).toBe("activa");
    expect(
      estadoConversacion({
        status: "blocked",
        substatus: "blocked_by_conversation_initiated_by_seller_limited",
      }).estado,
    ).toBe("bloqueada");
    expect(estadoConversacion({ status: "blocked", substatus: "blocked_by_time" })).toEqual({
      estado: "cerrada",
      motivo: "blocked_by_time",
    });
  });

  // Forma real de /messages/action_guide/packs/{pack} (2/10/2026).
  it("ofrece la plantilla de variante y el mensaje libre, no la de factura", () => {
    const opciones = opcionesDeInicio({
      options: [
        {
          id: "REQUEST_VARIANTS",
          type: "TEMPLATE",
          enabled: true,
          actionable: true,
          cap_available: 20,
          templates: [
            {
              id: "TEMPLATE___REQUEST_VARIANTS___1",
              texts: { mla: { html: "Hola, por favor confirmá las características que querés." } },
            },
          ],
        },
        { id: "REQUEST_BILLING_INFO", type: "TEMPLATE", enabled: true, cap_available: 20, templates: [{ id: "T" }] },
        { id: "OTHER", type: "FREE_TEXT", enabled: true, actionable: true, cap_available: 1, char_limit: 350 },
      ],
    });
    expect(opciones.map((o) => [o.id, o.tipo, o.disponibles, o.limite])).toEqual([
      ["REQUEST_VARIANTS", "plantilla", 20, null],
      ["OTHER", "libre", 1, 350],
    ]);
    expect(opciones[0].plantilla_id).toBe("TEMPLATE___REQUEST_VARIANTS___1");
  });

  it("si ya se usó el mensaje libre, no lo vuelve a ofrecer", () => {
    expect(
      opcionesDeInicio({ options: [{ id: "OTHER", type: "FREE_TEXT", enabled: true, cap_available: 0 }] }),
    ).toEqual([]);
  });

  it("encuentra los packs con mensajes sin leer", () => {
    const packs = packsConNoLeidos({
      results: [{ resource: "/packs/2000000000000000/sellers/100000001", count: 2 }],
    });
    expect(packs.has("2000000000000000")).toBe(true);
    expect(packsConNoLeidos({ results: [] }).size).toBe(0);
  });
});
