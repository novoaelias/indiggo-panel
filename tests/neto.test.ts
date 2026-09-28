import { describe, expect, it } from "vitest";
import { comisionDelPedido, netoDePagos, type MpCargo } from "../worker/lib/neto";

const cargo = (type: string, name: string, original: number): MpCargo => ({
  type,
  name,
  accounts: { from: "collector", to: type === "tax" ? "mp" : "ml" },
  amounts: { original, refunded: 0 },
});

// Montos tomados de ventas reales de septiembre de 2026.
describe("neto de una venta", () => {
  it("descuenta comisión, cuotas, costo fijo y retenciones", () => {
    const neto = netoDePagos(
      [
        {
          id: 1,
          status: "approved",
          transaction_amount: 47997,
          shipping_amount: 0,
          transaction_details: { net_received_amount: 26685.81 },
          charges_details: [
            cargo("tax", "tax_withholding_sirtac_noinsc-cordoba", 1439.91),
            cargo("fee", "meli_percentage_fee", 7199.55),
            cargo("fee", "financing_add_on_fee", 4271.73),
            cargo("fee", "flat_fee", 8400),
          ],
        },
      ],
      19871.28,
    );
    expect(neto).toEqual({
      neto: 26685.81,
      comision_ml: 19871.28,
      impuestos: 1439.91,
      envio_vendedor: 0,
    });
  });

  // El envío que paga el comprador entra y sale del cobro: no es un costo.
  it("no cuenta como costo el envío que pagó el comprador", () => {
    const neto = netoDePagos(
      [
        {
          id: 2,
          status: "approved",
          transaction_amount: 12999,
          shipping_amount: 12990,
          transaction_details: { net_received_amount: 8879.48 },
          charges_details: [
            cargo("tax", "tax_withholding_sirtac_noinsc-buenos_aires", 779.67),
            cargo("shipping", "shp_dropoff", 12990),
            cargo("fee", "meli_percentage_fee", 1949.85),
            cargo("fee", "flat_fee", 1390),
          ],
        },
      ],
      3339.85,
    );
    expect(neto?.envio_vendedor).toBe(0);
    expect(neto?.neto).toBe(8879.48);
  });

  // En Flex el envío del comprador queda acreditado para pagar el reparto: no
  // es plata de la venta y el neto no puede pasar al bruto.
  it("saca del neto el envío Flex que cobró el vendedor", () => {
    const neto = netoDePagos(
      [
        {
          id: 5,
          status: "approved",
          transaction_amount: 13999,
          shipping_amount: 8490,
          transaction_details: { net_received_amount: 17958.23 },
          charges_details: [
            cargo("fee", "meli_percentage_fee", 2099.85),
            cargo("fee", "financing_add_on_fee", 1175.92),
            cargo("fee", "flat_fee", 1255),
          ],
        },
      ],
      4530.77,
    );
    expect(neto).toEqual({
      neto: 9468.23,
      comision_ml: 4530.77,
      impuestos: 0,
      envio_vendedor: 0,
    });
  });

  // ML carga la comisión unos segundos después del pago: sin cargos "fee",
  // el neto saldría igual al bruto y quedaría guardado para siempre.
  it("no da neto mientras ML no cargó la comisión", () => {
    expect(
      netoDePagos(
        [
          {
            id: 3,
            status: "approved",
            transaction_details: { net_received_amount: 12999 },
            charges_details: [],
          },
        ],
        3339.85,
      ),
    ).toBeNull();
  });

  it("ignora pagos rechazados", () => {
    expect(
      netoDePagos([{ id: 4, status: "rejected", charges_details: [] }], 0),
    ).toBeNull();
  });

  it("la comisión del pedido es sale_fee por unidad", () => {
    expect(
      comisionDelPedido({ order_items: [{ sale_fee: 6623.76, quantity: 3 }] }),
    ).toBeCloseTo(19871.28, 2);
  });
});
