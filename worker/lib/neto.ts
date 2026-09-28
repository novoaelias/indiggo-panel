// Neto de cada venta: lo que Mercado Pago acredita de verdad después de la
// comisión de ML, el cargo por cuotas, el costo fijo por unidad, las
// retenciones de impuestos y el envío que paga el vendedor.
//
// El pedido de ML sólo trae `sale_fee` (comisión por unidad) y no dice nada de
// retenciones ni de envío: el dato completo vive en el pago de Mercado Pago
// (`/v1/payments/{id}`), que acepta el mismo token de ML.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { Env } from "../env";
import { mlFetch } from "./ml";

type DB = SupabaseClient<Database>;

export interface MpCargo {
  type?: string;
  name?: string;
  accounts?: { from?: string; to?: string };
  amounts?: { original?: number; refunded?: number };
}

export interface MpPago {
  id: number;
  status?: string;
  transaction_amount?: number;
  shipping_amount?: number;
  transaction_details?: { net_received_amount?: number };
  charges_details?: MpCargo[];
}

export interface NetoPedido {
  neto: number;
  comision_ml: number;
  impuestos: number;
  envio_vendedor: number;
}

const redondear = (n: number) => Math.round(n * 100) / 100;

function monto(c: MpCargo): number {
  return Number(c.amounts?.original ?? 0) - Number(c.amounts?.refunded ?? 0);
}

/**
 * Suma los pagos aprobados de un pedido. Devuelve null si todavía no está
 * liquidado: ML carga la comisión unos segundos después de acreditar el pago,
 * así que un pedido recién cobrado no tiene cargos de tipo "fee" y su neto
 * saldría inflado. `comisionEsperada` es la suma de `sale_fee` del pedido:
 * cuando es 0 (venta sin comisión) no hay cargo que esperar.
 */
export function netoDePagos(
  pagos: MpPago[],
  comisionEsperada: number,
): NetoPedido | null {
  const aprobados = pagos.filter((p) => p.status === "approved");
  if (!aprobados.length) return null;
  let neto = 0;
  let comision = 0;
  let impuestos = 0;
  let envio = 0;
  for (const p of aprobados) {
    const cargos = (p.charges_details ?? []).filter(
      (c) => c.accounts?.from === "collector",
    );
    const fees = cargos.filter((c) => c.type === "fee");
    if (!fees.length && comisionEsperada > 0) return null;
    const recibido = p.transaction_details?.net_received_amount;
    if (recibido == null) return null;
    comision += fees.reduce((s, c) => s + monto(c), 0);
    impuestos += cargos
      .filter((c) => c.type === "tax")
      .reduce((s, c) => s + monto(c), 0);
    // El envío que paga el comprador entra en el cobro y en Mercado Envíos sale
    // como cargo "shipping": sólo es costo propio lo que excede a lo que él
    // pagó. En Flex no sale: queda acreditado para pagar el reparto propio, no
    // es plata de la venta, así que se saca del neto.
    const envioCobrado = cargos
      .filter((c) => c.type === "shipping")
      .reduce((s, c) => s + monto(c), 0);
    const pagadoComprador = Number(p.shipping_amount ?? 0);
    envio += Math.max(0, envioCobrado - pagadoComprador);
    neto += Number(recibido) - Math.max(0, pagadoComprador - envioCobrado);
  }
  return {
    neto: redondear(neto),
    comision_ml: redondear(comision),
    impuestos: redondear(impuestos),
    envio_vendedor: redondear(envio),
  };
}

/** Comisión que ML informa en el pedido: `sale_fee` es por unidad. */
export function comisionDelPedido(raw: unknown): number {
  const items = (raw as { order_items?: Array<{ sale_fee?: number; quantity?: number }> })
    ?.order_items;
  return (items ?? []).reduce(
    (s, li) => s + Number(li.sale_fee ?? 0) * Number(li.quantity ?? 1),
    0,
  );
}

/** Trae los pagos de un pedido y guarda su neto. Sin liquidar, no toca nada
 *  y el próximo sync lo vuelve a intentar. */
export async function syncNeto(
  env: Env,
  db: DB,
  ref: { id: string; raw: unknown },
): Promise<boolean> {
  const ids = ((ref.raw as { payments?: Array<{ id?: number; status?: string }> })
    ?.payments ?? [])
    .filter((p) => p.id != null && p.status === "approved")
    .map((p) => p.id as number);
  if (!ids.length) return false;
  const pagos: MpPago[] = [];
  for (const id of ids) {
    const res = await mlFetch(env, db, `https://api.mercadopago.com/v1/payments/${id}`);
    if (!res.ok) throw new Error(`GET pago ${id} → ${res.status}`);
    pagos.push((await res.json()) as MpPago);
  }
  const neto = netoDePagos(pagos, comisionDelPedido(ref.raw));
  if (!neto) return false;
  await db
    .from("ml_orders")
    .update({ ...neto, neto_sync_at: new Date().toISOString() })
    .eq("id", ref.id);
  return true;
}
