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
