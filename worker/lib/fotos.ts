// Editor de fotos en lote: la parte pura (sin red) para poder probarla.
// El flujo vive en worker/routes/fotos.ts.
import type { AspectoKie } from "./kie";

export type ModoEdicion = "borrar" | "agregar";

export interface LoteEdicion {
  modo: ModoEdicion;
  descripcion: string;
  ubicacion: string | null;
  referencias: string[];
}

export interface Deteccion {
  aplica: boolean;
  donde: string;
  motivo: string;
}

const ASPECTOS: Array<[AspectoKie, number]> = [
  ["1:1", 1],
  ["4:5", 4 / 5],
  ["3:4", 3 / 4],
  ["2:3", 2 / 3],
  ["9:16", 9 / 16],
  ["5:4", 5 / 4],
  ["4:3", 4 / 3],
  ["3:2", 3 / 2],
  ["16:9", 16 / 9],
];

/** Relación de aspecto de kie.ai más parecida a la foto ("907x1200" → 3:4),
 *  para que la foto editada no salga recortada ni estirada. */
export function aspectoMasCercano(size: string | null | undefined): AspectoKie | null {
  const m = /^(\d+)x(\d+)$/.exec(size ?? "");
  if (!m) return null;
  const r = Number(m[1]) / Number(m[2]);
  if (!Number.isFinite(r) || r <= 0) return null;
  let mejor = ASPECTOS[0];
  for (const a of ASPECTOS)
    if (Math.abs(Math.log(a[1] / r)) < Math.abs(Math.log(mejor[1] / r))) mejor = a;
  return mejor[0];
}

export interface FotoPublicacion {
  ml_picture_id: string;
  original_url: string;
  aspect_ratio: AspectoKie | null;
  ml_item_ids: string[];
  orden: number;
}

/** La URL que ML guarda en la publicación ("-O") es la versión de 500 px. La
 *  "-F" es la foto completa (hasta 1200 px): con la chica, la IA edita una
 *  miniatura y la detección no distingue objetos chicos. */
export function urlFotoCompleta(url: string): string {
  return url.replace(/^http:/, "https:").replace(/-O\.(\w+)$/, "-F.$1");
}

/** Fotos distintas de un conjunto de publicaciones. La misma foto la usan
 *  varias publicaciones y variantes: se edita y se sube una sola vez. */
export function fotosDistintas(
  publicaciones: Array<{ ml_item_id: string; raw: unknown }>,
): FotoPublicacion[] {
  const porId = new Map<string, FotoPublicacion>();
  for (const pub of publicaciones) {
    const pictures =
      (pub.raw as { pictures?: Array<{ id?: string; secure_url?: string; url?: string; max_size?: string; size?: string }> })
        ?.pictures ?? [];
    for (const p of pictures) {
      if (!p.id) continue;
      const previa = porId.get(p.id);
      if (previa) {
        if (!previa.ml_item_ids.includes(pub.ml_item_id)) previa.ml_item_ids.push(pub.ml_item_id);
        continue;
      }
      const url = urlFotoCompleta(p.secure_url ?? p.url ?? "");
      if (!url) continue;
      porId.set(p.id, {
        ml_picture_id: p.id,
        original_url: url,
        aspect_ratio: aspectoMasCercano(p.max_size ?? p.size),
        ml_item_ids: [pub.ml_item_id],
        orden: porId.size,
      });
    }
  }
  return [...porId.values()];
}

export interface ItemConFotos {
  pictures?: Array<{ id: string }>;
  variations?: Array<{ id: number | string; picture_ids?: string[] }>;
}

/**
 * Cambia las fotos de una publicación según `mapa` (id viejo → id nuevo),
 * conservando el orden y las fotos de cada variante. Devuelve el cuerpo del
 * PUT a /items/{id} y qué reemplazos se hicieron de verdad (una foto del mapa
 * que la publicación ya no tiene no cuenta).
 */
export function reemplazarFotos(
  item: ItemConFotos,
  mapa: Record<string, string>,
): {
  body: {
    pictures: Array<{ id: string }>;
    variations?: Array<{ id: number | string; picture_ids: string[] }>;
  };
  reemplazos: Record<string, string>;
} {
  const reemplazos: Record<string, string> = {};
  const cambiar = (id: string) => {
    const nuevo = mapa[id];
    if (!nuevo) return id;
    reemplazos[id] = nuevo;
    return nuevo;
  };
  const vistos = new Set<string>();
  const pictures: Array<{ id: string }> = [];
  for (const p of item.pictures ?? []) {
    const id = cambiar(p.id);
    // Si la foto nueva ya estaba en la publicación, no se repite.
    if (vistos.has(id)) continue;
    vistos.add(id);
    pictures.push({ id });
  }
  const variaciones = item.variations ?? [];
  const body: ReturnType<typeof reemplazarFotos>["body"] = { pictures };
  if (variaciones.length)
    body.variations = variaciones.map((v) => ({
      id: v.id,
      picture_ids: [...new Set((v.picture_ids ?? []).map(cambiar))],
    }));
  return { body, reemplazos };
}

/** Para deshacer: el mismo mapa al revés. */
export function invertir(mapa: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(mapa).map(([viejo, nuevo]) => [nuevo, viejo]));
}

// ---------- prompts ----------

const CONSERVAR =
  "Keep everything else identical: every other product, accessory, chain, ring, " +
  "clasp, tassel, card, photocard, face, letter of text, logo, color, texture, " +
  "lighting, shadow, the background and the framing. Do not add borders, " +
  "watermarks, captions or any new element that is not requested.";

/** Instrucción para Nano Banana Pro. La foto a editar va primera; las de
 *  referencia (foto marcada u objeto nuevo) van después. */
export function promptEdicion(
  lote: LoteEdicion,
  opts: { donde?: string | null; nota?: string | null },
): string {
  const refs = lote.referencias.length;
  const partes: string[] = [];
  if (lote.modo === "borrar") {
    partes.push(
      `Edit the FIRST image only. Remove this object everywhere it appears in the photo: "${lote.descripcion.trim()}".`,
    );
    if (refs)
      partes.push(
        `The other image${refs > 1 ? "s show" : " shows"} that object marked or circled as a reference: ` +
          "use it only to recognise the object, never copy marks, circles, arrows or annotations into the result.",
      );
    partes.push(
      "Also remove any small part that only holds that object (a jump ring or a short chain), " +
        "but keep the rings and chains that hold anything else.",
    );
    partes.push(CONSERVAR);
    partes.push(
      "Where the object is removed, show what is naturally behind it, with no leftovers, holes, ghosts or smudges.",
    );
  } else {
    partes.push(
      `Edit the FIRST image only. Add this object to the product in the photo: "${lote.descripcion.trim()}".`,
    );
    if (refs)
      partes.push(
        `The other image${refs > 1 ? "s show" : " shows"} the real object: reproduce it faithfully ` +
          "(shape, colours, materials, proportions and details), do not redesign it.",
      );
    if (lote.ubicacion?.trim()) partes.push(`Where it goes: ${lote.ubicacion.trim()}.`);
    partes.push(
      "Match the scale, perspective, lighting and shadows of the photo so it looks photographed together.",
    );
    partes.push(CONSERVAR);
  }
  if (opts.donde?.trim()) partes.push(`In this photo: ${opts.donde.trim()}.`);
  if (opts.nota?.trim())
    partes.push(`Correction from the owner after a previous attempt: ${opts.nota.trim()}.`);
  return partes.join(" ");
}

/** Detección en tanda: qué fotos llevan la edición. `n` es el número de la
 *  foto dentro de la tanda, contando desde 1 después de las referencias. */
export function promptDeteccion(lote: LoteEdicion, cantidad: number): string {
  const refs = lote.referencias.length;
  const intro = refs
    ? `Las primeras ${refs} imágenes son de referencia. Las siguientes ${cantidad} son fotos de publicaciones, numeradas del 1 al ${cantidad} en el orden en que aparecen.`
    : `Las ${cantidad} imágenes son fotos de publicaciones, numeradas del 1 al ${cantidad} en el orden en que aparecen.`;
  const criterio =
    lote.modo === "borrar"
      ? `Hay que BORRAR este objeto: "${lote.descripcion.trim()}". ` +
        (refs ? "En la referencia está marcado (círculo o trazo): el trazo no es parte del objeto. " : "") +
        "Una foto aplica si el objeto se ve en ella, aunque sea chico o parcial. " +
        "No confundas el objeto con otros accesorios parecidos del mismo producto."
      : `Hay que AGREGAR este objeto: "${lote.descripcion.trim()}"` +
        (lote.ubicacion?.trim() ? `, ubicado así: ${lote.ubicacion.trim()}` : "") +
        ". " +
        (refs ? "En la referencia está el objeto real. " : "") +
        "Una foto aplica si muestra el producto de forma que se pueda agregar el objeto en ese lugar. " +
        "No aplica en fotos sin el producto, tablas de medidas, fotos de otros productos o si el objeto ya está.";
  return (
    `${intro}\n\n${criterio}\n\n` +
    "Respondé SOLO con JSON, sin texto antes ni después:\n" +
    '{"fotos":[{"n":1,"aplica":true,"donde":"dónde está (o dónde iría) en esta foto, en pocas palabras","motivo":"por qué aplica o no"}]}\n' +
    "Una entrada por foto. El campo donde se le pasa al editor de imágenes: que sea concreto " +
    '(ej. "en los dos llaveros, colgando del aro a la izquierda de cada holder").'
  );
}

/** Normaliza la respuesta de la detección. Una foto sin respuesta clara
 *  vuelve como null: la ruta la deja para editar (con aviso), nunca descartada
 *  en silencio. */
export function leerDeteccion(
  json: { fotos?: Array<Partial<Deteccion> & { n?: number }> },
  cantidad: number,
): Array<Deteccion | null> {
  const out: Array<Deteccion | null> = Array.from({ length: cantidad }, () => null);
  for (const f of json.fotos ?? []) {
    const i = Number(f.n) - 1;
    if (!Number.isInteger(i) || i < 0 || i >= cantidad) continue;
    if (typeof f.aplica !== "boolean") continue;
    out[i] = { aplica: f.aplica, donde: String(f.donde ?? ""), motivo: String(f.motivo ?? "") };
  }
  return out;
}
