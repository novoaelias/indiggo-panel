import type { Env } from "../env";
import { getToken, mlFetch } from "./ml";

type LooseDb = Parameters<typeof mlFetch>[1];
type PolicyDb = LooseDb & { from: (name: string) => any };

interface MlShipping {
  mode?: string | null;
  logistic_type?: string | null;
  local_pick_up?: boolean;
  free_shipping?: boolean;
  tags?: string[];
}

interface MlItemShipping {
  id?: string;
  status?: string;
  shipping?: MlShipping | null;
}

export interface VerificacionEnvio {
  ok: boolean;
  mode: string | null;
  logistic_type: string | null;
  flex: boolean;
  detalle?: string;
}

/** Payload explícito para publicaciones nuevas. Flex no se elige con `mode`:
 *  también hay que quitar el opt-in por ítem después de crearlo. */
export function mercadoEnviosSinFlex(freeShipping = false): MlShipping {
  return {
    mode: "me2",
    local_pick_up: false,
    free_shipping: freeShipping,
  };
}

function tagsDe(item: MlItemShipping | null): string[] {
  return Array.isArray(item?.shipping?.tags) ? item.shipping.tags : [];
}

export function estadoEnvio(item: MlItemShipping | null): VerificacionEnvio {
  const mode = item?.shipping?.mode ?? null;
  const logisticType = item?.shipping?.logistic_type ?? null;
  const tags = tagsDe(item);
  const flex =
    tags.includes("self_service_in") || logisticType === "self_service";
  const ok = mode === "me2" && !flex;
  return {
    ok,
    mode,
    logistic_type: logisticType,
    flex,
    ...(!ok
      ? {
          detalle: flex
            ? "Mercado Libre todavía informa Envíos Flex para el ítem."
            : `El modo de envío es ${mode ?? "desconocido"}; se esperaba Mercado Envíos (me2).`,
        }
      : {}),
  };
}

async function leerEnvio(
  env: Env,
  db: LooseDb,
  itemId: string,
): Promise<{ item: MlItemShipping | null; error?: string }> {
  const response = await mlFetch(
    env,
    db,
    `/items/${itemId}?attributes=id,status,shipping`,
  );
  if (!response.ok)
    return {
      item: null,
      error: `No se pudo verificar el envío (${response.status}): ${(await response.text()).slice(0, 180)}`,
    };
  return { item: (await response.json()) as MlItemShipping };
}

/**
 * Garantía poscreación: una publicación sólo se considera lista cuando ML
 * confirma `mode=me2` y no informa Flex. Usa primero el endpoint Flex v2 actual
 * y conserva el endpoint anterior como fallback para cuentas todavía migrando.
 */
export async function garantizarMercadoEnviosSinFlex(
  env: Env,
  db: LooseDb,
  itemId: string,
): Promise<VerificacionEnvio> {
  const inicial = await leerEnvio(env, db, itemId);
  if (!inicial.item)
    return {
      ok: false,
      mode: null,
      logistic_type: null,
      flex: false,
      detalle: inicial.error,
    };

  const estadoInicial = estadoEnvio(inicial.item);
  if (estadoInicial.ok) return estadoInicial;
  if (!estadoInicial.flex) return estadoInicial;

  const intentos = [
    `/flex/sites/MLA/items/${itemId}/v2`,
    `/sites/MLA/shipping/selfservice/items/${itemId}`,
  ];
  const errores: string[] = [];
  for (const path of intentos) {
    const response = await mlFetch(env, db, path, { method: "DELETE" });
    if (response.ok || response.status === 204) break;
    errores.push(`${response.status} ${(await response.text()).slice(0, 120)}`);
  }

  const final = await leerEnvio(env, db, itemId);
  if (!final.item)
    return {
      ok: false,
      mode: estadoInicial.mode,
      logistic_type: estadoInicial.logistic_type,
      flex: true,
      detalle: final.error,
    };
  const verificado = estadoEnvio(final.item);
  if (!verificado.ok && errores.length)
    verificado.detalle = `${verificado.detalle ?? "No se pudo desactivar Flex."} ${errores.join(" · ")}`;
  return verificado;
}

export async function politicaFlexOculta(db: PolicyDb): Promise<boolean> {
  const token = await getToken(db);
  const meta = token?.meta;
  return Boolean(
    meta &&
      typeof meta === "object" &&
      (meta as Record<string, unknown>).flex_oculto === true,
  );
}

/** Red de seguridad del cron: si ML reactivó Flex o entró una publicación por
 *  fuera del panel, vuelve a quitarlo cuando la política global está activa. */
export async function aplicarPoliticaFlexOculta(
  env: Env,
  db: PolicyDb,
): Promise<{ revisadas: number; corregidas: number; errores: string[] }> {
  if (!(await politicaFlexOculta(db)))
    return { revisadas: 0, corregidas: 0, errores: [] };

  const { data, error } = await db
    .from("ml_listings")
    .select("ml_item_id,raw")
    .in("estado", ["active", "paused"]);
  if (error)
    return { revisadas: 0, corregidas: 0, errores: [error.message] };

  const pendientes = (data ?? []).filter((row: any) => estadoEnvio(row.raw).flex);
  let corregidas = 0;
  const errores: string[] = [];
  for (const row of pendientes) {
    const resultado = await garantizarMercadoEnviosSinFlex(
      env,
      db,
      row.ml_item_id,
    );
    if (resultado.ok) corregidas++;
    else
      errores.push(
        `${row.ml_item_id}: ${resultado.detalle ?? "no se pudo verificar"}`,
      );
  }
  return { revisadas: pendientes.length, corregidas, errores };
}
