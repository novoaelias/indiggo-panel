import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../supabase/migrations/0023_inventory_core.sql", import.meta.url),
  "utf8",
);
const reservas = readFileSync(
  new URL("../supabase/migrations/0026_reservas_solo_pendientes.sql", import.meta.url),
  "utf8",
);
const sync = readFileSync(
  new URL("../worker/lib/sync.ts", import.meta.url),
  "utf8",
);

describe("contrato transaccional del inventario", () => {
  it("protege reintentos y bloquea filas durante movimientos", () => {
    expect(migration).toContain("idempotency_key text not null unique");
    expect(migration.match(/for update/gi)?.length).toBeGreaterThanOrEqual(4);
  });

  it("incluye reservas, liberación y despacho explícitos", () => {
    expect(migration).toContain("inventory_reserve_order");
    expect(migration).toContain("inventory_release_order");
    expect(migration).toContain("inventory_fulfill_order");
  });

  // ML deja los pedidos en "paid" para siempre: sin este corte, cada sync
  // volvía a reservar ventas ya despachadas y el stock libre caía a cero.
  it("no reserva stock de pedidos ya despachados", () => {
    expect(reservas).toContain("o.stock_descontado_at is null");
    expect(reservas).toMatch(/coalesce\(o\.estado, ''\) = 'paid'/);
    expect(sync).toContain('o.status === "paid" && !order.stock_descontado_at');
  });
});
