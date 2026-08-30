import type { Env } from "./env";

/**
 * Puntos de entrada de los cron triggers (ver `triggers.crons` en wrangler.jsonc).
 *  - "0 * / 4 * * *"  → refrescar el access_token de MercadoLibre (expira ~6h).
 *  - "15 * * * *"     → chequear stock real vs. ventas y recalcular alertas.
 *
 * Todavía sin implementar: sólo deja traza para verificar que el schedule corre.
 */
export async function runCron(cron: string, _env: Env): Promise<void> {
  switch (cron) {
    case "0 */4 * * *":
      console.log("[cron] refresh ML token — pendiente de implementar");
      break;
    case "15 * * * *":
      console.log("[cron] chequeo de stock/producción — pendiente de implementar");
      break;
    default:
      console.log(`[cron] trigger desconocido: ${cron}`);
  }
}
