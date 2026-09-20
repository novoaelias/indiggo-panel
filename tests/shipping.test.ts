import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { estadoEnvio, mercadoEnviosSinFlex } from "../worker/lib/shipping";

const ia = readFileSync(new URL("../worker/routes/ia.ts", import.meta.url), "utf8");
const seo = readFileSync(new URL("../worker/routes/seo.ts", import.meta.url), "utf8");

describe("publicaciones sólo con Mercado Envíos", () => {
  it("arma el payload de ME2 sin retiro local", () => {
    expect(mercadoEnviosSinFlex(false)).toEqual({
      mode: "me2",
      local_pick_up: false,
      free_shipping: false,
    });
  });

  it("detecta Flex por tag o por tipo logístico", () => {
    expect(
      estadoEnvio({ shipping: { mode: "me2", tags: ["self_service_in"] } }).ok,
    ).toBe(false);
    expect(
      estadoEnvio({ shipping: { mode: "me2", logistic_type: "self_service" } })
        .flex,
    ).toBe(true);
    expect(
      estadoEnvio({
        shipping: {
          mode: "me2",
          logistic_type: "drop_off",
          tags: ["self_service_out"],
        },
      }).ok,
    ).toBe(true);
  });

  it("la creación desde cero y la republicación verifican Flex", () => {
    for (const source of [ia, seo]) {
      expect(source).toContain("mercadoEnviosSinFlex");
      expect(
        source.indexOf("const envio = await garantizarMercadoEnviosSinFlex"),
      ).toBeLessThan(
        source.indexOf("const pausa", source.indexOf("const envio = await")),
      );
    }
    expect(
      seo.indexOf("const envio = await garantizarMercadoEnviosSinFlex"),
    ).toBeLessThan(
      seo.indexOf("// cerrar la vieja"),
    );
  });
});
