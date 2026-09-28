// Editor de fotos en lote: borrar (o agregar) un objeto en las fotos ya
// publicadas. Todo pasa por revisión: detectar → editar → Elias aprueba cada
// foto → recién ahí se sube a Mercado Libre, publicación por publicación, y
// queda registrado qué se cambió para poder deshacerlo.
//
// El panel maneja el ritmo: cada endpoint hace una tanda chica (una tanda de
// detección, una foto, una publicación) para no depender de un request largo.
import { Hono } from "hono";
import type { Env } from "../env";
import type { Json } from "@/lib/database.types";
import { supa } from "../lib/supabase";
import { claude, mensajeConImagenesEmbebidas, parseJsonLaxo } from "../lib/claude";
import {
  MODELO_EDICION,
  costoUsd,
  encargarEdicionPro,
  estadoTarea,
  type AspectoKie,
} from "../lib/kie";
import { mlFetch } from "../lib/ml";
import { syncOneItem } from "../lib/sync";
import {
  fotosDistintas,
  invertir,
  leerDeteccion,
  promptDeteccion,
  promptEdicion,
  reemplazarFotos,
  type Deteccion,
  type ItemConFotos,
  type LoteEdicion,
  type ModoEdicion,
} from "../lib/fotos";

export const fotos = new Hono<{ Bindings: Env }>();

type DB = ReturnType<typeof supa>;

const TANDA_DETECCION = 8;
// Una edición "editando" sin novedades en este tiempo se da por perdida en
// kie.ai y se puede volver a encargar.
const EDICION_COLGADA_MS = 20 * 60_000;

async function cargarLote(db: DB, id: string) {
  const { data } = await db.from("photo_edit_batches").select("*").eq("id", id).maybeSingle();
  return data;
}

function comoLote(b: {
  modo: string;
  descripcion: string;
  ubicacion: string | null;
  referencias: Json;
}): LoteEdicion {
  return {
    modo: b.modo as ModoEdicion,
    descripcion: b.descripcion,
    ubicacion: b.ubicacion,
    referencias: Array.isArray(b.referencias) ? (b.referencias as string[]) : [],
  };
}

async function errorMl(res: Response): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as {
    message?: string;
    cause?: Array<{ message?: string; code?: string }>;
  };
  const detalle =
    (j.cause ?? []).map((x) => x.message || x.code).filter(Boolean).join(" · ") ||
    j.message ||
    `HTTP ${res.status}`;
  return detalle.slice(0, 600);
}

// ---------- publicaciones para elegir ----------

fotos.get("/publicaciones", async (c) => {
  const db = supa(c.env);
  const { data, error } = await db
    .from("ml_listings")
    .select("id, ml_item_id, titulo, estado, thumbnail, raw")
    .in("estado", ["active", "paused", "under_review"])
    .order("titulo");
  if (error) return c.json({ error: error.message }, 500);
  return c.json({
    publicaciones: (data ?? []).map((l) => ({
      id: l.id,
      ml_item_id: l.ml_item_id,
      titulo: l.titulo,
      estado: l.estado,
      thumbnail: l.thumbnail,
      foto_ids: fotosDistintas([{ ml_item_id: l.ml_item_id, raw: l.raw }]).map(
        (f) => f.ml_picture_id,
      ),
    })),
  });
});

// ---------- lotes ----------

fotos.get("/lotes", async (c) => {
  const db = supa(c.env);
  const { data: lotes, error } = await db
    .from("photo_edit_batches")
    .select("id, modo, descripcion, created_at, ml_item_ids")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return c.json({ error: error.message }, 500);
  const ids = (lotes ?? []).map((l) => l.id);
  const { data: items } = ids.length
    ? await db.from("photo_edit_items").select("batch_id, estado").in("batch_id", ids)
    : { data: [] };
  const { data: aplicadas } = ids.length
    ? await db.from("photo_edit_applies").select("batch_id, estado").in("batch_id", ids)
    : { data: [] };
  return c.json({
    lotes: (lotes ?? []).map((l) => {
      const conteo: Record<string, number> = {};
      for (const it of items ?? []) if (it.batch_id === l.id) conteo[it.estado] = (conteo[it.estado] ?? 0) + 1;
      return {
        ...l,
        conteo,
        publicaciones_aplicadas: (aplicadas ?? []).filter(
          (a) => a.batch_id === l.id && a.estado === "aplicada",
        ).length,
      };
    }),
  });
});

fotos.post("/lotes", async (c) => {
  const body = await c.req.json<{
    modo?: string;
    descripcion?: string;
    ubicacion?: string;
    referencias?: string[];
    ml_item_ids?: string[];
  }>();
  const modo = body.modo === "agregar" ? "agregar" : body.modo === "borrar" ? "borrar" : null;
  if (!modo) return c.json({ error: "elegí si hay que borrar o agregar" }, 400);
  const descripcion = body.descripcion?.trim();
  if (!descripcion) return c.json({ error: "describí el objeto" }, 400);
  const referencias = (body.referencias ?? []).filter(Boolean).slice(0, 4);
  if (modo === "agregar" && !referencias.length)
    return c.json({ error: "para agregar un objeto subí al menos una foto de ese objeto" }, 400);
  const ids = [...new Set(body.ml_item_ids ?? [])];
  if (!ids.length) return c.json({ error: "elegí al menos una publicación" }, 400);

  const db = supa(c.env);
  const { data: pubs, error } = await db
    .from("ml_listings")
    .select("ml_item_id, raw")
    .in("ml_item_id", ids);
  if (error) return c.json({ error: error.message }, 500);
  const distintas = fotosDistintas(pubs ?? []);
  if (!distintas.length) return c.json({ error: "esas publicaciones no tienen fotos" }, 400);

  const { data: lote, error: e1 } = await db
    .from("photo_edit_batches")
    .insert({
      modo,
      descripcion,
      ubicacion: modo === "agregar" ? body.ubicacion?.trim() || null : null,
      referencias,
      ml_item_ids: ids,
      modelo: MODELO_EDICION,
    })
    .select("id")
    .single();
  if (e1 || !lote) return c.json({ error: e1?.message ?? "no se pudo crear el lote" }, 500);

  const { error: e2 } = await db.from("photo_edit_items").insert(
    distintas.map((f) => ({ batch_id: lote.id, ...f })),
  );
  if (e2) return c.json({ error: e2.message }, 500);
  return c.json({ id: lote.id, fotos: distintas.length });
});

fotos.get("/lotes/:id", async (c) => {
  const db = supa(c.env);
  const lote = await cargarLote(db, c.req.param("id"));
  if (!lote) return c.json({ error: "lote no encontrado" }, 404);
  const [{ data: items }, { data: aplicadas }, { data: pubs }] = await Promise.all([
    db.from("photo_edit_items").select("*").eq("batch_id", lote.id).order("orden"),
    db.from("photo_edit_applies").select("*").eq("batch_id", lote.id),
    db
      .from("ml_listings")
      .select("id, ml_item_id, titulo, thumbnail, estado")
      .in("ml_item_id", lote.ml_item_ids),
  ]);
  return c.json({ lote, items: items ?? [], aplicadas: aplicadas ?? [], publicaciones: pubs ?? [] });
});

// ---------- detección ----------

async function detectarTanda(
  env: Env,
  lote: LoteEdicion,
  urls: string[],
): Promise<Array<Deteccion | null>> {
  const { texto } = await claude(env, {
    messages: [
      await mensajeConImagenesEmbebidas(promptDeteccion(lote, urls.length), [
        ...lote.referencias,
        ...urls,
      ]),
    ],
    maxTokens: 300 + 200 * urls.length,
  });
  return leerDeteccion(parseJsonLaxo(texto), urls.length);
}

/** Mira la próxima tanda de fotos sin decidir. El panel lo llama hasta que
 *  `restantes` llega a 0. */
fotos.post("/lotes/:id/detectar", async (c) => {
  const db = supa(c.env);
  const b = await cargarLote(db, c.req.param("id"));
  if (!b) return c.json({ error: "lote no encontrado" }, 404);
  const lote = comoLote(b);
  const { data: tanda } = await db
    .from("photo_edit_items")
    .select("id, original_url")
    .eq("batch_id", b.id)
    .eq("estado", "pendiente")
    .order("orden")
    .limit(TANDA_DETECCION);
  if (!tanda?.length) return c.json({ restantes: 0 });

  const guardar = async (id: string, d: Deteccion | null) =>
    db
      .from("photo_edit_items")
      .update({
        // Sin respuesta clara queda para editar: la edición es un paso aparte
        // y Elias la puede excluir antes, mejor que perder una foto.
        estado: !d || d.aplica ? "para_editar" : "descartada",
        deteccion: (d ?? {
          aplica: true,
          donde: "",
          motivo: "La IA no pudo decidir sobre esta foto: revisala antes de editar.",
        }) as unknown as Json,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

  try {
    const res = await detectarTanda(c.env, lote, tanda.map((t) => t.original_url));
    await Promise.all(tanda.map((t, i) => guardar(t.id, res[i])));
  } catch {
    // Una foto que Anthropic no puede bajar tira abajo la tanda entera: se
    // reintenta de a una para aislarla.
    for (const t of tanda) {
      try {
        const [d] = await detectarTanda(c.env, lote, [t.original_url]);
        await guardar(t.id, d);
      } catch (e) {
        await db
          .from("photo_edit_items")
          .update({ estado: "error", error: `detección: ${(e as Error).message}`.slice(0, 500) })
          .eq("id", t.id);
      }
    }
  }
  const { count } = await db
    .from("photo_edit_items")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", b.id)
    .eq("estado", "pendiente");
  return c.json({ restantes: count ?? 0 });
});

// ---------- edición ----------

/** Encarga la edición de una foto a Nano Banana Pro. También sirve para
 *  reintentar con una corrección (`nota`). No espera el resultado: el panel
 *  consulta /items/:id/consultar hasta que deja de estar "editando". */
fotos.post("/items/:id/editar", async (c) => {
  const body = await c.req.json<{ nota?: string }>().catch(() => ({}) as { nota?: string });
  const db = supa(c.env);
  const colgada = new Date(Date.now() - EDICION_COLGADA_MS).toISOString();
  // Claim atómico: dos clics (o dos pestañas) no pagan dos veces la misma foto.
  const { data: tomadas } = await db
    .from("photo_edit_items")
    .update({
      estado: "editando",
      error: null,
      kie_task_id: null,
      updated_at: new Date().toISOString(),
      ...(body.nota !== undefined ? { nota: body.nota.trim() || null } : {}),
    })
    .eq("id", c.req.param("id"))
    .is("nuevo_ml_picture_id", null)
    .or(
      `estado.in.(pendiente,para_editar,descartada,revisar,rechazada,error),and(estado.eq.editando,updated_at.lt.${colgada})`,
    )
    .select("*");
  const item = tomadas?.[0];
  if (!item)
    return c.json({ error: "esta foto se está editando o ya se subió a Mercado Libre" }, 409);
  const b = await cargarLote(db, item.batch_id);
  if (!b) return c.json({ error: "lote no encontrado" }, 404);
  const lote = comoLote(b);
  try {
    const taskId = await encargarEdicionPro(c.env, {
      prompt: promptEdicion(lote, {
        donde: (item.deteccion as { donde?: string } | null)?.donde,
        nota: item.nota,
      }),
      imageUrls: [item.original_url, ...lote.referencias],
      aspectRatio: (item.aspect_ratio as AspectoKie | null) ?? undefined,
    });
    const { data } = await db
      .from("photo_edit_items")
      .update({ kie_task_id: taskId, intentos: item.intentos + 1, updated_at: new Date().toISOString() })
      .eq("id", item.id)
      .select("*")
      .single();
    return c.json({ item: data });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    const { data } = await db
      .from("photo_edit_items")
      .update({ estado: "error", error: msg, updated_at: new Date().toISOString() })
      .eq("id", item.id)
      .select("*")
      .single();
    return c.json({ item: data, error: msg }, 502);
  }
});

/** Mira en qué anda la edición encargada. Cuando termina guarda la copia en
 *  Storage (la URL de kie.ai vence en ~24 h) y la deja para revisar. */
fotos.post("/items/:id/consultar", async (c) => {
  const db = supa(c.env);
  const { data: item } = await db
    .from("photo_edit_items")
    .select("*")
    .eq("id", c.req.param("id"))
    .maybeSingle();
  if (!item) return c.json({ error: "foto no encontrada" }, 404);
  if (item.estado !== "editando" || !item.kie_task_id) return c.json({ item });

  const tarea = await estadoTarea(c.env, item.kie_task_id).catch(
    () => ({ estado: "generando" }) as const,
  );
  if (tarea.estado === "generando") return c.json({ item });

  // Claim: si dos consultas llegan juntas al final, sólo una guarda y registra
  // el gasto.
  const { data: tomada } = await db
    .from("photo_edit_items")
    .update({ kie_task_id: null, updated_at: new Date().toISOString() })
    .eq("id", item.id)
    .eq("kie_task_id", item.kie_task_id)
    .select("id");
  if (!tomada?.length) {
    const { data: actual } = await db.from("photo_edit_items").select("*").eq("id", item.id).single();
    return c.json({ item: actual });
  }

  const b = await cargarLote(db, item.batch_id);
  const lote = b ? comoLote(b) : null;
  const prompt = lote
    ? promptEdicion(lote, {
        donde: (item.deteccion as { donde?: string } | null)?.donde,
        nota: item.nota,
      })
    : null;
  try {
    if (tarea.estado === "error") throw new Error(tarea.detalle);
    const img = await fetch(tarea.url);
    if (!img.ok) throw new Error(`no se pudo bajar la foto de kie.ai (${img.status})`);
    const path = `fotos-editadas/${item.batch_id}/${item.id}-${item.intentos}.jpg`;
    const up = await db.storage
      .from("publicaciones")
      .upload(path, await img.arrayBuffer(), { contentType: "image/jpeg", upsert: true });
    if (up.error) throw new Error(`storage: ${up.error.message}`);
    const url = db.storage.from("publicaciones").getPublicUrl(path).data.publicUrl;
    await db.from("media_generations").insert({
      tipo: "imagen",
      modelo: MODELO_EDICION,
      costo_usd: costoUsd(MODELO_EDICION),
      prompt,
      ref_urls: [item.original_url, ...(lote?.referencias ?? [])],
      media_url: url,
      storage_path: path,
    });
    const { data } = await db
      .from("photo_edit_items")
      .update({ estado: "revisar", editada_url: url, error: null, updated_at: new Date().toISOString() })
      .eq("id", item.id)
      .select("*")
      .single();
    return c.json({ item: data });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    await db.from("media_generations").insert({
      tipo: "imagen",
      modelo: MODELO_EDICION,
      costo_usd: 0,
      prompt,
      ok: false,
      error: msg,
    });
    const { data } = await db
      .from("photo_edit_items")
      .update({ estado: "error", error: msg, updated_at: new Date().toISOString() })
      .eq("id", item.id)
      .select("*")
      .single();
    return c.json({ item: data });
  }
});

const TRANSICIONES: Record<string, string[]> = {
  // Reintentar una foto que falló en la detección.
  pendiente: ["error"],
  aprobada: ["revisar", "rechazada"],
  // "Volver a revisar" una aprobada que todavía no se subió.
  revisar: ["aprobada", "rechazada"],
  rechazada: ["revisar", "aprobada"],
  para_editar: ["descartada", "pendiente", "error"],
  descartada: ["para_editar", "pendiente", "error", "revisar", "rechazada"],
};

/** Aprobar, rechazar, incluir o excluir una foto. */
fotos.post("/items/:id/estado", async (c) => {
  const { estado } = await c.req.json<{ estado?: string }>();
  const desde = TRANSICIONES[estado ?? ""];
  if (!desde) return c.json({ error: "estado inválido" }, 400);
  const db = supa(c.env);
  const { data } = await db
    .from("photo_edit_items")
    .update({ estado: estado!, updated_at: new Date().toISOString() })
    .eq("id", c.req.param("id"))
    .in("estado", desde)
    .is("nuevo_ml_picture_id", null)
    .select("*");
  if (!data?.length)
    return c.json({ error: "esa foto ya cambió de estado o ya está en Mercado Libre" }, 409);
  return c.json({ item: data[0] });
});

fotos.post("/lotes/:id/aprobar-todas", async (c) => {
  const db = supa(c.env);
  const { data } = await db
    .from("photo_edit_items")
    .update({ estado: "aprobada", updated_at: new Date().toISOString() })
    .eq("batch_id", c.req.param("id"))
    .eq("estado", "revisar")
    .select("id");
  return c.json({ aprobadas: data?.length ?? 0 });
});

// ---------- aplicar en Mercado Libre ----------

async function subirFotoMl(env: Env, db: DB, url: string): Promise<string> {
  const img = await fetch(url);
  if (!img.ok) throw new Error(`no se pudo leer la foto editada (${img.status})`);
  const fd = new FormData();
  fd.append("file", new Blob([await img.arrayBuffer()], { type: "image/jpeg" }), "foto.jpg");
  const res = await mlFetch(env, db, "/pictures/items/upload", { method: "POST", body: fd });
  if (!res.ok) throw new Error(`subir foto a ML: ${await errorMl(res)}`);
  const j = (await res.json()) as { id?: string };
  if (!j.id) throw new Error("ML no devolvió el id de la foto");
  return j.id;
}

async function leerItem(env: Env, db: DB, mlItemId: string): Promise<ItemConFotos> {
  const res = await mlFetch(env, db, `/items/${mlItemId}`);
  if (!res.ok) throw new Error(`leer publicación: ${await errorMl(res)}`);
  return (await res.json()) as ItemConFotos;
}

async function ponerFotos(
  env: Env,
  db: DB,
  mlItemId: string,
  body: unknown,
): Promise<string | null> {
  const res = await mlFetch(env, db, `/items/${mlItemId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok ? null : await errorMl(res);
}

/** Cambia en UNA publicación sus fotos aprobadas del lote. Una foto compartida
 *  se sube a ML una sola vez y se reusa en las demás publicaciones. */
fotos.post("/lotes/:id/aplicar", async (c) => {
  const { ml_item_id } = await c.req.json<{ ml_item_id?: string }>();
  if (!ml_item_id) return c.json({ error: "falta la publicación" }, 400);
  const db = supa(c.env);
  const batchId = c.req.param("id");
  const { data: aprobadas } = await db
    .from("photo_edit_items")
    .select("id, ml_picture_id, editada_url, nuevo_ml_picture_id")
    .eq("batch_id", batchId)
    .eq("estado", "aprobada")
    .contains("ml_item_ids", [ml_item_id]);
  if (!aprobadas?.length)
    return c.json({ error: "esta publicación no tiene fotos aprobadas en el lote" }, 400);

  const { data: previa } = await db
    .from("photo_edit_applies")
    .select("reemplazos, estado")
    .eq("batch_id", batchId)
    .eq("ml_item_id", ml_item_id)
    .maybeSingle();
  const yaAplicada = previa?.estado === "aplicada";
  const registrar = (fila: {
    estado: "aplicada" | "error";
    error: string | null;
    reemplazos?: Json;
    aplicada_at?: string;
    deshecha_at?: null;
  }) =>
    db
      .from("photo_edit_applies")
      .upsert({ batch_id: batchId, ml_item_id, ...fila }, { onConflict: "batch_id,ml_item_id" });
  // Si una tanda anterior ya quedó aplicada, un error nuevo no puede pisar ese
  // estado: se perdería el registro para deshacerla.
  const registrarError = (msg: string) =>
    yaAplicada
      ? db
          .from("photo_edit_applies")
          .update({ error: msg })
          .eq("batch_id", batchId)
          .eq("ml_item_id", ml_item_id)
      : registrar({ estado: "error", error: msg });

  try {
    const mapa: Record<string, string> = {};
    for (const it of aprobadas) {
      let nuevo = it.nuevo_ml_picture_id;
      if (!nuevo) {
        if (!it.editada_url) continue;
        nuevo = await subirFotoMl(c.env, db, it.editada_url);
        await db.from("photo_edit_items").update({ nuevo_ml_picture_id: nuevo }).eq("id", it.id);
      }
      mapa[it.ml_picture_id] = nuevo;
    }
    const item = await leerItem(c.env, db, ml_item_id);
    const { body, reemplazos } = reemplazarFotos(item, mapa);
    if (!Object.keys(reemplazos).length)
      return c.json({ aplicada: false, aviso: "la publicación ya no tiene esas fotos" });
    const fallo = await ponerFotos(c.env, db, ml_item_id, body);
    if (fallo) {
      await registrarError(fallo);
      return c.json({ error: fallo }, 502);
    }
    const anteriores = yaAplicada ? (previa!.reemplazos as Record<string, string>) : {};
    await registrar({
      estado: "aplicada",
      error: null,
      reemplazos: { ...anteriores, ...reemplazos },
      aplicada_at: new Date().toISOString(),
      deshecha_at: null,
    });
    await syncOneItem(c.env, db, ml_item_id).catch(() => {});
    return c.json({ aplicada: true, fotos: Object.keys(reemplazos).length });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 600);
    await registrarError(msg);
    return c.json({ error: msg }, 502);
  }
});

/** Vuelve a poner las fotos originales en UNA publicación. */
fotos.post("/lotes/:id/deshacer", async (c) => {
  const { ml_item_id } = await c.req.json<{ ml_item_id?: string }>();
  if (!ml_item_id) return c.json({ error: "falta la publicación" }, 400);
  const db = supa(c.env);
  const batchId = c.req.param("id");
  const { data: aplicada } = await db
    .from("photo_edit_applies")
    .select("reemplazos")
    .eq("batch_id", batchId)
    .eq("ml_item_id", ml_item_id)
    .eq("estado", "aplicada")
    .maybeSingle();
  if (!aplicada) return c.json({ error: "no hay cambios aplicados para deshacer" }, 400);
  try {
    const item = await leerItem(c.env, db, ml_item_id);
    const { body, reemplazos } = reemplazarFotos(
      item,
      invertir(aplicada.reemplazos as Record<string, string>),
    );
    if (Object.keys(reemplazos).length) {
      const fallo = await ponerFotos(c.env, db, ml_item_id, body);
      if (fallo) return c.json({ error: fallo }, 502);
    }
    await db
      .from("photo_edit_applies")
      .update({ estado: "deshecha", deshecha_at: new Date().toISOString() })
      .eq("batch_id", batchId)
      .eq("ml_item_id", ml_item_id);
    await syncOneItem(c.env, db, ml_item_id).catch(() => {});
    return c.json({ deshecha: true, fotos: Object.keys(reemplazos).length });
  } catch (e) {
    return c.json({ error: (e as Error).message.slice(0, 600) }, 502);
  }
});

// ---------- títulos y descripciones ----------

interface PropuestaTexto {
  n: number;
  titulo?: string | null;
  descripcion?: string | null;
  motivo?: string;
}

/** Propone los cambios de texto que acompañan a la edición (sacar la mención
 *  del objeto borrado, o sumarla si se agregó). No aplica nada: el panel usa
 *  /ia/publicacion/:id/aplicar con lo que Elias confirme. */
fotos.post("/lotes/:id/textos", async (c) => {
  const db = supa(c.env);
  const b = await cargarLote(db, c.req.param("id"));
  if (!b) return c.json({ error: "lote no encontrado" }, 404);
  const lote = comoLote(b);
  const { data: pubs } = await db
    .from("ml_listings")
    .select("id, ml_item_id, titulo")
    .in("ml_item_id", b.ml_item_ids);
  const lista = pubs ?? [];
  const descripciones = await Promise.all(
    lista.map(async (p) => {
      const r = await mlFetch(c.env, db, `/items/${p.ml_item_id}/description`);
      if (!r.ok) return "";
      return ((await r.json()) as { plain_text?: string }).plain_text ?? "";
    }),
  );

  const accion =
    lote.modo === "borrar"
      ? `El producto ya NO incluye este objeto: "${lote.descripcion}". Sacá toda mención a él (en el título, en lo que incluye, en la lista de componentes, en frases de venta).`
      : `El producto ahora SÍ incluye este objeto: "${lote.descripcion}"${lote.ubicacion ? ` (${lote.ubicacion})` : ""}. Sumalo donde se lista lo que incluye, en una frase corta; en el título sólo si entra sin sacar palabras clave.`;
  const bloques = lista
    .map(
      (p, i) =>
        `### Publicación ${i + 1}\nTÍTULO: ${p.titulo}\nDESCRIPCIÓN:\n${descripciones[i] || "(sin descripción)"}`,
    )
    .join("\n\n");
  const { texto } = await claude(c.env, {
    system:
      "Editás textos de publicaciones de Mercado Libre de Indiggo Store. Hacés el cambio mínimo: " +
      "copiás todo lo demás letra por letra (datos, tono, formato, saltos de línea). Título de 60 caracteres como máximo.",
    messages: [
      {
        role: "user",
        content:
          `${accion}\n\n${bloques}\n\n` +
          "Respondé SOLO con JSON: " +
          '{"cambios":[{"n":1,"titulo":"título nuevo o null si no cambia","descripcion":"descripción completa nueva o null si no cambia","motivo":"qué cambiaste"}]}. ' +
          "Incluí sólo las publicaciones que cambian.",
      },
    ],
    maxTokens: 16000,
  });
  const cambios = parseJsonLaxo<{ cambios?: PropuestaTexto[] }>(texto).cambios ?? [];
  return c.json({
    propuestas: cambios
      .map((cambio) => {
        const i = Number(cambio.n) - 1;
        const p = lista[i];
        if (!p) return null;
        const titulo = cambio.titulo?.trim() || null;
        const descripcion = cambio.descripcion?.trim() || null;
        if (!titulo && !descripcion) return null;
        return {
          listing_id: p.id,
          ml_item_id: p.ml_item_id,
          titulo_actual: p.titulo,
          titulo_nuevo: titulo && titulo !== p.titulo ? titulo.slice(0, 60) : null,
          descripcion_actual: descripciones[i],
          descripcion_nueva: descripcion && descripcion !== descripciones[i] ? descripcion : null,
          motivo: cambio.motivo ?? "",
        };
      })
      .filter((p) => p && (p.titulo_nuevo || p.descripcion_nueva)),
  });
});
