import { Hono } from "hono";
import type { Env } from "../env";
import { supa } from "../lib/supabase";

export const catalogo = new Hono<{ Bindings: Env }>();

// --- Grupos e integrantes ---
catalogo.get("/grupos", async (c) => {
  const db = supa(c.env);
  const { data: grupos, error } = await db
    .from("groups")
    .select("id, nombre, group_members(id, nombre, orden, activo)")
    .order("nombre");
  if (error) return c.json({ error: error.message }, 500);

  const out = (grupos ?? []).map((g) => ({
    id: g.id,
    nombre: g.nombre,
    integrantes: [...(g.group_members ?? [])]
      .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
      .map((m) => ({ id: m.id, nombre: m.nombre, activo: m.activo })),
  }));
  return c.json({ grupos: out });
});

catalogo.post("/grupos", async (c) => {
  const body = await c.req.json<{ nombre?: string; integrantes?: string[] }>();
  const nombre = body.nombre?.trim();
  if (!nombre) return c.json({ error: "nombre requerido" }, 400);

  const db = supa(c.env);
  const { data: grupo, error } = await db
    .from("groups")
    .insert({ nombre })
    .select("id, nombre")
    .single();
  if (error) return c.json({ error: error.message }, 500);

  const integrantes = (body.integrantes ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (integrantes.length) {
    const { error: e2 } = await db.from("group_members").insert(
      integrantes.map((nom, i) => ({
        group_id: grupo.id,
        nombre: nom,
        orden: i,
      })),
    );
    if (e2) return c.json({ error: e2.message }, 500);
  }
  return c.json({ id: grupo.id }, 201);
});

catalogo.post("/grupos/:id/integrantes", async (c) => {
  const groupId = c.req.param("id");
  const body = await c.req.json<{ nombre?: string }>();
  const nombre = body.nombre?.trim();
  if (!nombre) return c.json({ error: "nombre requerido" }, 400);

  const db = supa(c.env);
  const { count } = await db
    .from("group_members")
    .select("id", { count: "exact", head: true })
    .eq("group_id", groupId);

  const { data, error } = await db
    .from("group_members")
    .insert({ group_id: groupId, nombre, orden: count ?? 0 })
    .select("id")
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ id: data.id }, 201);
});

catalogo.delete("/integrantes/:id", async (c) => {
  const db = supa(c.env);
  const { error } = await db
    .from("group_members")
    .delete()
    .eq("id", c.req.param("id"));
  if (error) return c.json({ error: error.message }, 500);
  return c.body(null, 204);
});

// --- Categorías ---
catalogo.get("/categorias", async (c) => {
  const db = supa(c.env);
  const { data, error } = await db
    .from("categories")
    .select("id, nombre, slug, origen")
    .order("nombre");
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ categorias: data });
});
