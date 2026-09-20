import type { Env } from "./env";
import { supa } from "./lib/supabase";
import { getToken, validToken } from "./lib/ml";
import { syncAll } from "./lib/sync";
import { processPendingQuestions, reconcileQuestions } from "./lib/questions";

/**
 * Cron triggers (ver `triggers.crons` en wrangler.jsonc):
 *  - "0 * / 4 * * *"  → mantener vivo el access_token de MercadoLibre.
 *  - "15 * * * *"     → sincronizar cuenta ML (publicaciones, pedidos) cada hora.
 */
export async function runCron(cron: string, env: Env): Promise<void> {
  const db = supa(env);
  const conectado = Boolean(await getToken(db));
  if (!conectado) {
    console.log("[cron] ML no conectado, nada que hacer");
    return;
  }

  if (cron === "0 */4 * * *") {
    await validToken(env, db); // refresca si está por vencer
    console.log("[cron] token ML verificado");
    return;
  }

  if (cron === "15 * * * *") {
    const res = await syncAll(env, db);
    const preguntas = await reconcileQuestions(env, db as never).catch(() => 0);
    const procesadas = await processPendingQuestions(env, db as never).catch(() => 0);
    console.log(
      `[cron] sync ML: ${res.publicaciones} publicaciones, ${res.pedidos} pedidos, ${preguntas} preguntas, ${procesadas} procesadas, ${res.errores.length} errores`,
    );
    return;
  }

  console.log(`[cron] trigger desconocido: ${cron}`);
}
