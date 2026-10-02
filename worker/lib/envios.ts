import { hoyAR } from "./fecha";

// Tipo de logística de Mercado Libre → etiqueta que entiende Elias.
//   self_service                       → Flex (lo despacha él, retiro a domicilio)
//   fulfillment                        → Full (ML tiene el stock)
//   cross_docking / drop_off / xd_*    → Mercado Envíos (lo lleva a un punto / correo)
export type EtiquetaLogistica = "Flex" | "Mercado Envíos" | "Full" | "Otro";

export function etiquetaLogistica(
  logisticType: string | null | undefined,
): EtiquetaLogistica {
  switch (logisticType) {
    case "self_service":
      return "Flex";
    case "fulfillment":
      return "Full";
    case "cross_docking":
    case "drop_off":
    case "xd_drop_off":
      return "Mercado Envíos";
    default:
      return "Otro";
  }
}

// status del shipment que significan "ya salió de acá" (no es un pedido activo).
const ENVIO_TERMINADO = new Set([
  "shipped",
  "delivered",
  "not_delivered",
  "cancelled",
]);

/** ¿El envío ya salió del taller (despachado / entregado / cancelado)? */
export function envioTerminado(status: string | null | undefined): boolean {
  return !!status && ENVIO_TERMINADO.has(status);
}

/** ¿El pedido está pago y todavía sin despachar? */
export function pedidoActivo(o: {
  estado: string | null;
  estado_envio: string | null;
  raw: unknown;
}): boolean {
  if (o.estado !== "paid") return false;
  const tags = (o.raw as { tags?: unknown })?.tags;
  if (Array.isArray(tags) && (tags.includes("delivered") || tags.includes("no_shipping")))
    return false;
  return !o.estado_envio || !ENVIO_TERMINADO.has(o.estado_envio);
}

// Estados del shipment en los que todavía corre el plazo de despacho.
const ENVIO_POR_DESPACHAR = new Set(["pending", "handling", "ready_to_ship"]);

/** ¿Tiene sentido pedir el plazo de despacho (`/sla`) de este envío? Full no:
 *  ese lo despacha ML. */
export function esperaDespacho(
  status: string | null | undefined,
  logisticType: string | null | undefined,
): boolean {
  return !!status && ENVIO_POR_DESPACHAR.has(status) && logisticType !== "fulfillment";
}

/**
 * Qué tan apurado está un paquete según la fecha límite de despacho de ML:
 *   vencido    → el plazo ya pasó (ML ya lo cuenta como demorado)
 *   hoy        → vence hoy: sale hoy sí o sí
 *   despues    → vence otro día (el próximo hábil o más adelante)
 *   sin_fecha  → ML no informó plazo (Full, o todavía no se sincronizó)
 * Se compara por día en horario de Argentina, no por hora: ML pone el corte a
 * las 23:59:59 del día límite.
 */
export type UrgenciaDespacho = "vencido" | "hoy" | "despues" | "sin_fecha";

export function urgenciaDespacho(
  limite: string | null | undefined,
  ahora: Date = new Date(),
): UrgenciaDespacho {
  if (!limite) return "sin_fecha";
  const fin = new Date(limite);
  if (Number.isNaN(fin.getTime())) return "sin_fecha";
  if (fin.getTime() < ahora.getTime()) return "vencido";
  return hoyAR(fin) === hoyAR(ahora) ? "hoy" : "despues";
}
