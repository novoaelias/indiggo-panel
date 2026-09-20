import { Hono } from "hono";
import type { Env } from "../env";
import { supa } from "../lib/supabase";
import {
  answerInMl,
  draftWithOwnerContext,
  processPendingQuestions,
  reconcileQuestions,
} from "../lib/questions";
import { pushConfigured } from "../lib/push";

export const preguntas = new Hono<{ Bindings: Env }>();
type LooseDb = { from: (name: string) => any };
const dbFor = (env: Env) => supa(env) as unknown as LooseDb;

preguntas.get("/", async (c) => {
  const db = dbFor(c.env);
  const filter = c.req.query("estado") ?? "pendientes";
  let query = db
    .from("ml_questions")
    .select(
      "id,ml_item_id,product_id,pregunta,respuesta,estado_ml,estado_panel,sugerencia,motivo_revision,respuesta_usuario,automatico,preguntada_at,respondida_at,products(nombre,nombre_interno)",
    )
    .order("preguntada_at", { ascending: false })
    .limit(150);
  if (filter === "pendientes")
    query = query.in("estado_panel", ["pendiente", "procesando", "necesita_respuesta", "sugerida", "error"]);
  else if (filter === "automaticas") query = query.eq("estado_panel", "respondida_auto");
  else if (filter === "respondidas")
    query = query.in("estado_panel", ["respondida_auto", "respondida_manual"]);
  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);
  const itemIds = [...new Set((data ?? []).map((row: any) => row.ml_item_id))];
  const { data: listings } = itemIds.length
    ? await db
        .from("ml_listings")
        .select("ml_item_id,titulo,thumbnail,permalink")
        .in("ml_item_id", itemIds)
    : { data: [] };
  const listingByItem = new Map(
    (listings ?? []).map((row: any) => [row.ml_item_id, row]),
  );
  const { data: all } = await db.from("ml_questions").select("estado_panel");
  const counts = { pendientes: 0, automaticas: 0, respondidas: 0 };
  for (const row of all ?? []) {
    if (["pendiente", "procesando", "necesita_respuesta", "sugerida", "error"].includes(row.estado_panel))
      counts.pendientes++;
    if (row.estado_panel === "respondida_auto") counts.automaticas++;
    if (["respondida_auto", "respondida_manual"].includes(row.estado_panel)) counts.respondidas++;
  }
  return c.json({
    preguntas: (data ?? []).map((row: any) => ({
      ...row,
      listing: listingByItem.get(row.ml_item_id) ?? null,
    })),
    counts,
  });
});

preguntas.post("/sync", async (c) => {
  const db = dbFor(c.env);
  const imported = await reconcileQuestions(c.env, db, 4);
  const processed = await processPendingQuestions(c.env, db);
  return c.json({ imported, processed });
});

preguntas.post("/:id/draft", async (c) => {
  const body = await c.req.json<{ context?: string }>();
  if (!body.context?.trim()) return c.json({ error: "contame qué debería responder" }, 400);
  const db = dbFor(c.env);
  const { data: question } = await db
    .from("ml_questions")
    .select("pregunta")
    .eq("id", c.req.param("id"))
    .maybeSingle();
  if (!question) return c.json({ error: "pregunta inexistente" }, 404);
  const suggestion = await draftWithOwnerContext(c.env, question.pregunta, body.context.trim());
  await db
    .from("ml_questions")
    .update({
      respuesta_usuario: body.context.trim(),
      sugerencia: suggestion,
      estado_panel: "sugerida",
      motivo_revision: null,
    })
    .eq("id", c.req.param("id"));
  return c.json({ suggestion });
});

preguntas.post("/:id/send", async (c) => {
  const body = await c.req.json<{ answer?: string }>();
  const answer = body.answer?.trim().slice(0, 2000);
  if (!answer) return c.json({ error: "respuesta vacía" }, 400);
  const db = dbFor(c.env);
  const { data: question } = await db
    .from("ml_questions")
    .select("id,product_id,pregunta,respuesta_usuario")
    .eq("id", c.req.param("id"))
    .maybeSingle();
  if (!question) return c.json({ error: "pregunta inexistente" }, 404);
  try {
    await answerInMl(c.env, db, question.id, answer);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 409);
  }
  await db
    .from("ml_questions")
    .update({
      respuesta: answer,
      sugerencia: answer,
      estado_ml: "ANSWERED",
      estado_panel: "respondida_manual",
      automatico: false,
      respondida_at: new Date().toISOString(),
    })
    .eq("id", question.id);
  if (question.respuesta_usuario)
    await db.from("question_knowledge").insert({
      product_id: question.product_id,
      pregunta: question.pregunta,
      respuesta: answer,
      fuente: "respuesta_manual",
      vigente: true,
      temporal: false,
      source_question_id: question.id,
      verified_at: new Date().toISOString(),
    });
  return c.json({ ok: true });
});

// --- Reglas comerciales: los datos que la IA puede dar por ciertos ---
// Son la fuente "verificada" que se suma a las respuestas anteriores. Si una
// regla es temporal (una promo, una demora puntual), vale 24 h y después deja de
// usarse sola, para no prometer nada viejo.
preguntas.get("/reglas", async (c) => {
  const db = dbFor(c.env);
  const { data, error } = await db
    .from("business_facts")
    .select("id,clave,valor,temporal,vigente,verified_at,product_id,products(nombre,nombre_interno)")
    .eq("vigente", true)
    .order("clave");
  if (error) return c.json({ error: error.message }, 500);
  const { data: productos } = await db
    .from("products")
    .select("id,nombre,nombre_interno")
    .eq("activo", true)
    .order("nombre");
  return c.json({
    reglas: (data ?? []).map((row: any) => ({
      id: row.id,
      clave: row.clave,
      valor: row.valor,
      temporal: row.temporal,
      verified_at: row.verified_at,
      product_id: row.product_id,
      producto:
        row.products?.nombre_interno || row.products?.nombre || "Todos los productos",
    })),
    productos: (productos ?? []).map((p: any) => ({
      id: p.id,
      nombre: p.nombre_interno || p.nombre,
    })),
  });
});

preguntas.post("/reglas", async (c) => {
  const body = await c.req.json<{
    clave?: string;
    valor?: string;
    product_id?: string | null;
    temporal?: boolean;
  }>();
  const clave = body.clave?.trim();
  const valor = body.valor?.trim();
  if (!clave || !valor) return c.json({ error: "falta la regla" }, 400);

  const db = dbFor(c.env);
  const productId = body.product_id || null;
  // unique(product_id, clave) no alcanza cuando product_id es null (en Postgres
  // dos null no chocan), así que la regla general se busca a mano.
  let query = db.from("business_facts").select("id").eq("clave", clave);
  query = productId ? query.eq("product_id", productId) : query.is("product_id", null);
  const { data: existente } = await query.maybeSingle();
  const fila = {
    clave,
    valor,
    product_id: productId,
    temporal: Boolean(body.temporal),
    vigente: true,
    verified_at: new Date().toISOString(),
  };
  const { error } = existente
    ? await db.from("business_facts").update(fila).eq("id", existente.id)
    : await db.from("business_facts").insert(fila);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

preguntas.delete("/reglas/:id", async (c) => {
  const db = dbFor(c.env);
  const { error } = await db.from("business_facts").delete().eq("id", c.req.param("id"));
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

preguntas.get("/push/config", (c) =>
  c.json({
    configured: pushConfigured(c.env),
    publicKey: c.env.VAPID_SERVER_PUBLIC_KEY ?? null,
  }),
);

preguntas.post("/push/subscribe", async (c) => {
  const body = await c.req.json<{
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  }>();
  if (!body.endpoint || !body.keys?.p256dh || !body.keys.auth)
    return c.json({ error: "suscripción inválida" }, 400);
  const db = dbFor(c.env);
  const { error } = await db.from("push_subscriptions").upsert(
    {
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      user_agent: c.req.header("user-agent") ?? null,
      activo: true,
      last_error: null,
    },
    { onConflict: "endpoint" },
  );
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});
