import { Hono } from "hono";
import type { Env } from "../env";
import { supa } from "../lib/supabase";
import { mlFetch } from "../lib/ml";
import { descontarPorDespacho, syncEnvio, syncOneItem } from "../lib/sync";
import { sheetsConfigurado, sheetsSuspendido } from "../lib/sheets";
import { resolverAlertaManual, sincronizarStockML } from "../lib/stock";
import { regenerarAlertas } from "../lib/alertas";
import { inicioDiaAR, inicioDiaARHace } from "../lib/fecha";
import {
  etiquetaLogistica,
  pedidoActivo,
  urgenciaDespacho,
  type UrgenciaDespacho,
} from "../lib/envios";

export const panel = new Hono<{ Bindings: Env }>();

// --- Publicaciones (espejo de ML) ---
panel.get("/publicaciones", async (c) => {
  const db = supa(c.env);
  const estado = c.req.query("estado");
  const q = c.req.query("q");
  const verDescontinuadas = estado === "descontinuadas";

  let query = db
    .from("ml_listings")
    .select(
      "id, product_id, ml_item_id, titulo, estado, precio, moneda, cantidad_ml, tiene_variantes, permalink, thumbnail, categoria_sugerida, categoria_analisis, reemplazada_por, family_name:raw->>family_name, products(id,nombre,nombre_interno,descontinuado)",
    )
    .order("titulo");
  if (estado && estado !== "todas" && !verDescontinuadas)
    query = query.eq("estado", estado);
  if (q) query = query.ilike("titulo", `%${q}%`);

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);

  const { data: vars } = await db
    .from("ml_listing_variations")
    .select("ml_listing_id, cantidad_ml");
  const porListing = new Map<string, { n: number; stock: number }>();
  for (const v of vars ?? []) {
    const cur = porListing.get(v.ml_listing_id) ?? { n: 0, stock: 0 };
    cur.n += 1;
    cur.stock += v.cantidad_ml ?? 0;
    porListing.set(v.ml_listing_id, cur);
  }

  // las descontinuadas (Elias ya no las vende, aunque ML no deje borrar la
  // publicación) quedan afuera de todos los filtros salvo que se las pida
  // explícitamente — es la idea de "no las quiero ver más".
  const esDescontinuada = (l: { products: unknown }) =>
    Boolean((l.products as { descontinuado?: boolean } | null)?.descontinuado);
  const filtradas = (data ?? []).filter((l) =>
    verDescontinuadas ? esDescontinuada(l) : !esDescontinuada(l),
  );

  const publicaciones = filtradas.map((l) => {
    const agg = porListing.get(l.id) ?? { n: 0, stock: 0 };
    return {
      id: l.id,
      ml_item_id: l.ml_item_id,
      titulo: l.titulo,
      estado: l.estado,
      precio: l.precio,
      moneda: l.moneda,
      permalink: l.permalink,
      thumbnail: l.thumbnail?.replace(/^http:/, "https:") ?? null,
      variantes: agg.n,
      stock_ml: l.tiene_variantes ? agg.stock : (l.cantidad_ml ?? 0),
      categoria_sugerida: l.categoria_sugerida,
      categoria_analisis: l.categoria_analisis,
      reemplazada_por: l.reemplazada_por,
      familia: Boolean(l.family_name),
      descontinuada: esDescontinuada(l),
      product_id: l.product_id,
      producto_nombre:
        (l.products as { nombre_interno?: string | null; nombre?: string } | null)
          ?.nombre_interno ||
        (l.products as { nombre?: string } | null)?.nombre ||
        "Sin agrupar",
    };
  });

  const { data: todos } = await db
    .from("ml_listings")
    .select("estado, products(descontinuado)");
  const conteo: Record<string, number> = { todas: 0, descontinuadas: 0 };
  for (const r of todos ?? []) {
    if (esDescontinuada(r)) {
      conteo.descontinuadas++;
      continue;
    }
    conteo.todas++;
    conteo[r.estado] = (conteo[r.estado] ?? 0) + 1;
  }

  return c.json({ publicaciones, conteo });
});

// Marca (o desmarca) un producto como descontinuado: Elias ya no lo vende más,
// aunque la publicación de ML siga viva (ML no deja borrarla). Se guarda en el
// producto interno — cubre también a las publicaciones hermanas (duplicados
// por cuotas) del mismo producto.
panel.post("/publicaciones/:id/descontinuar", async (c) => {
  const id = c.req.param("id");
  const { descontinuado } = await c.req.json<{ descontinuado?: boolean }>();
  const db = supa(c.env);
  const { data: listing } = await db
    .from("ml_listings")
    .select("product_id")
    .eq("id", id)
    .maybeSingle();
  if (!listing?.product_id)
    return c.json({ error: "esta publicación no tiene producto vinculado" }, 400);
  const { error } = await db
    .from("products")
    .update({ descontinuado: descontinuado !== false })
    .eq("id", listing.product_id);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true });
});

// Actualiza precios en lote. body: { cambios: [{ id, precio }] } (id = ml_listings.id)
panel.post("/publicaciones/precios", async (c) => {
  const body = await c.req.json<{
    cambios?: Array<{ id: string; precio: number }>;
  }>();
  const cambios = (body.cambios ?? []).filter(
    (x) => x.id && Number.isFinite(x.precio) && x.precio > 0,
  );
  if (!cambios.length) return c.json({ error: "sin cambios" }, 400);

  const db = supa(c.env);
  const { data: listings } = await db
    .from("ml_listings")
    .select("id, ml_item_id")
    .in(
      "id",
      cambios.map((x) => x.id),
    );
  const itemPorId = new Map((listings ?? []).map((l) => [l.id, l.ml_item_id]));

  let ok = 0;
  const errores: string[] = [];
  const tocados = new Set<string>();
  for (const cambio of cambios.slice(0, 200)) {
    const itemId = itemPorId.get(cambio.id);
    if (!itemId) {
      errores.push(`${cambio.id}: no encontrado`);
      continue;
    }
    const r = await mlFetch(c.env, db, `/items/${itemId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ price: Math.round(cambio.precio) }),
    });
    if (r.ok) {
      ok++;
      tocados.add(itemId);
    } else {
      errores.push(`${itemId}: ${(await r.text()).slice(0, 120)}`);
    }
  }
  for (const it of tocados) {
    try {
      await syncOneItem(c.env, db, it);
    } catch {
      /* ignore */
    }
  }
  return c.json({ actualizados: ok, errores });
});

// --- Métricas ---
interface MetricasResumen {
  dias: number;
  ventas_totales: number;
  /** Lo que acredita Mercado Pago después de comisión, retenciones y envío. */
  ventas_netas: number;
  comisiones: number;
  impuestos: number;
  envios: number;
  /** Pedidos todavía sin liquidar: su neto sale de `sale_fee`, sin retenciones. */
  pedidos_estimados: number;
  pedidos: number;
  ticket_promedio: number;
  ventas_prev: number;
  ventas_netas_prev: number;
  pedidos_prev: number;
  por_dia: Array<{ dia: string; monto: number; neto: number; pedidos: number }>;
  top: Array<{ nombre: string; unidades: number; ingreso: number }>;
  preguntas: {
    respondidas: number;
    automaticas: number;
    porcentaje_automaticas: number;
    pendientes: number;
    horas_respuesta: number | null;
  };
  inventario: {
    unidades_faltantes: number;
    variantes_sin_libres: number;
    cobertura_dias: number | null;
    variantes_bajo_cobertura: number;
  };
}

/** Días que aguanta el stock terminado al ritmo de venta del período. Se toma
 *  la mediana entre las variantes que efectivamente vendieron: el promedio lo
 *  deforma la variante que no vende y tiene stock para un año. */
function coberturaDeStock(
  ventasPorVariante: Map<string, number>,
  libresPorVariante: Map<string, number>,
  dias: number,
): { cobertura_dias: number | null; variantes_bajo_cobertura: number } {
  const coberturas: number[] = [];
  let bajo = 0;
  for (const [varianteId, unidades] of ventasPorVariante) {
    if (unidades <= 0) continue;
    const diaria = unidades / dias;
    const cobertura = (libresPorVariante.get(varianteId) ?? 0) / diaria;
    coberturas.push(cobertura);
    if (cobertura < DIAS_COBERTURA_MINIMA) bajo++;
  }
  if (!coberturas.length) return { cobertura_dias: null, variantes_bajo_cobertura: 0 };
  coberturas.sort((a, b) => a - b);
  return {
    cobertura_dias: Math.round(coberturas[Math.floor(coberturas.length / 2)] * 10) / 10,
    variantes_bajo_cobertura: bajo,
  };
}

const DIAS_COBERTURA_MINIMA = 7;

panel.get("/metricas", async (c) => {
  const dias = Math.min(Math.max(Number(c.req.query("dias") ?? 7), 1), 90);
  const db = supa(c.env);
  const [{ data, error }, preguntasResp, pendientesResp, reservasResp, variantesResp] =
    await Promise.all([
      db.rpc("panel_metricas", { p_dias: dias }),
      (db as unknown as { from: (name: string) => any })
        .from("ml_questions")
        .select("automatico, preguntada_at, respondida_at")
        .not("respondida_at", "is", null)
        .gte("respondida_at", new Date(Date.now() - dias * 86_400_000).toISOString()),
      (db as unknown as { from: (name: string) => any })
        .from("ml_questions")
        .select("id", { count: "exact", head: true })
        .in("estado_panel", ["pendiente", "procesando", "necesita_respuesta", "sugerida", "error"]),
      (db as unknown as { from: (name: string) => any })
        .from("inventory_reservations")
        .select("missing_qty")
        .eq("estado", "activa")
        .gt("missing_qty", 0),
      db
        .from("product_variants")
        .select("id,stock_real")
        .eq("activo", true)
        .eq("es_eleccion", false),
    ]);
  // Cobertura de stock: unidades vendidas por variante en el período contra lo
  // que queda libre (terminados menos lo reservado por pedidos).
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
  const [ventasResp, reservadasResp] = await Promise.all([
    (db as unknown as { from: (name: string) => any })
      .from("ml_order_items")
      .select("cantidad,product_variant_id,ml_orders!inner(estado,fecha)")
      .eq("ml_orders.estado", "paid")
      .gte("ml_orders.fecha", desde)
      .not("product_variant_id", "is", null),
    (db as unknown as { from: (name: string) => any })
      .from("inventory_reservations")
      .select("product_variant_id,reserved_qty")
      .eq("estado", "activa"),
  ]);
  const ventasPorVariante = new Map<string, number>();
  for (const row of (ventasResp.data ?? []) as any[])
    ventasPorVariante.set(
      row.product_variant_id,
      (ventasPorVariante.get(row.product_variant_id) ?? 0) + Number(row.cantidad || 0),
    );
  const reservadoPorVariante = new Map<string, number>();
  for (const row of (reservadasResp.data ?? []) as any[]) {
    // reserved_qty es lo que quedó tomado de unidades terminadas; lo que no se
    // pudo cubrir vive aparte en missing_qty y no descuenta stock.
    const tomado = Number(row.reserved_qty || 0);
    if (tomado <= 0) continue;
    reservadoPorVariante.set(
      row.product_variant_id,
      (reservadoPorVariante.get(row.product_variant_id) ?? 0) + tomado,
    );
  }
  const libresPorVariante = new Map<string, number>();
  for (const row of (variantesResp.data ?? []) as any[])
    libresPorVariante.set(
      row.id,
      Math.max(0, Number(row.stock_real || 0) - (reservadoPorVariante.get(row.id) ?? 0)),
    );
  const cobertura = coberturaDeStock(ventasPorVariante, libresPorVariante, dias);
  if (error) return c.json({ error: error.message }, 500);
  const questions = preguntasResp.data ?? [];
  const automaticas = questions.filter((row: any) => row.automatico).length;
  // Tiempo típico de respuesta: mediana en horas, que no se deforma con la
  // pregunta vieja que se contestó meses después.
  const demoras = questions
    .map(
      (row: any) =>
        (new Date(row.respondida_at).getTime() -
          new Date(row.preguntada_at).getTime()) /
        3_600_000,
    )
    .filter((horas: number) => Number.isFinite(horas) && horas >= 0)
    .sort((a: number, b: number) => a - b);
  const horasRespuesta = demoras.length
    ? Math.round(demoras[Math.floor(demoras.length / 2)] * 10) / 10
    : null;
  const resumen = data as unknown as Omit<MetricasResumen, "preguntas" | "inventario">;
  return c.json({
    ...resumen,
    preguntas: {
      respondidas: questions.length,
      automaticas,
      porcentaje_automaticas: questions.length
        ? Math.round((automaticas / questions.length) * 100)
        : 0,
      pendientes: pendientesResp.count ?? 0,
      horas_respuesta: horasRespuesta,
    },
    inventario: {
      unidades_faltantes: (reservasResp.data ?? []).reduce(
        (sum: number, row: any) => sum + Number(row.missing_qty || 0),
        0,
      ),
      variantes_sin_libres: (variantesResp.data ?? []).filter(
        (row) => Number(row.stock_real || 0) <= 0,
      ).length,
      ...cobertura,
    },
  } satisfies MetricasResumen);
});

// --- Stock y producción ---
// El inventario físico (piezas, armados, ajustes y el empuje del colchón a ML)
// vive en worker/routes/inventario.ts: todo pasa por las operaciones
// transaccionales, y abrir una pantalla no modifica cantidades.

// --- Inicio (resumen del día + alertas de la tabla) ---
const TONO_POR_SEV: Record<string, "ok" | "warn" | "danger" | "info"> = {
  ok: "ok",
  warn: "warn",
  danger: "danger",
  info: "info",
};

panel.get("/inicio", async (c) => {
  const db = supa(c.env);
  // "hoy" y "hace 7 días" en horario de Argentina (el Worker corre en UTC).
  const hoy = inicioDiaAR();
  const hace7 = inicioDiaAR(new Date(Date.now() - 6 * 864e5));

  const [ventasHoy, ventasSemana, listings, ultimosPedidos, alertasRows] =
    await Promise.all([
      db.from("ml_orders").select("total").eq("estado", "paid").gte("fecha", hoy),
      db
        .from("ml_orders")
        .select("total")
        .eq("estado", "paid")
        .gte("fecha", hace7),
      db.from("ml_listings").select("estado"),
      db
        .from("ml_orders")
        .select("id, fecha, total, comprador, estado")
        .order("fecha", { ascending: false })
        .limit(5),
      db
        .from("alerts")
        .select("id, tipo, severidad, titulo, detalle")
        .is("resuelta_at", null)
        .order("created_at", { ascending: false })
        .limit(12),
    ]);

  const sum = (rows: { total: number | null }[] | null) =>
    (rows ?? []).reduce((s, r) => s + (r.total ?? 0), 0);
  const activas =
    listings.data?.filter((l) => l.estado === "active").length ?? 0;

  const alertas = (alertasRows.data ?? []).map((a) => ({
    id: a.id,
    tipo: a.tipo,
    tono: TONO_POR_SEV[a.severidad] ?? "info",
    titulo: a.titulo,
    texto: a.detalle ?? "",
  }));

  const dbLoose = db as unknown as { from: (name: string) => any };
  const [questionsPending, reservationsMissing, lowComponents] = await Promise.all([
    dbLoose
      .from("ml_questions")
      .select("id", { count: "exact", head: true })
      .in("estado_panel", ["pendiente", "procesando", "necesita_respuesta", "sugerida", "error"]),
    dbLoose
      .from("inventory_reservations")
      .select("missing_qty")
      .eq("estado", "activa"),
    dbLoose
      .from("components")
      .select("id,stock_real,stock_minimo")
      .eq("activo", true),
  ]);

  return c.json({
    ventas_hoy: sum(ventasHoy.data),
    pedidos_hoy: ventasHoy.data?.length ?? 0,
    ventas_semana: sum(ventasSemana.data),
    publicaciones_activas: activas,
    publicaciones_pausadas: (listings.data?.length ?? 0) - activas,
    preguntas_pendientes: questionsPending.count ?? 0,
    faltantes_pedidos: (reservationsMissing.data ?? []).reduce(
      (sum: number, row: { missing_qty: number }) => sum + row.missing_qty,
      0,
    ),
    piezas_bajas: (lowComponents.data ?? []).filter(
      (row: { stock_real: number; stock_minimo: number }) =>
        row.stock_minimo > 0 && row.stock_real < row.stock_minimo,
    ).length,
    ultimos_pedidos: ultimosPedidos.data ?? [],
    alertas,
  });
});

// --- Pedidos activos (pagados y sin despachar), separados por logística ---
/** Variantes reales (no "a elección") que puede llevar cada ítem de pedido, a
 *  partir de la publicación que compró. Sirve para registrar la elección del
 *  comprador desde Pedidos sin adivinar por el título. */
async function variantesElegibles(
  db: ReturnType<typeof supa>,
  items: Array<{ id: string; ml_item_id?: string | null }>,
): Promise<Map<string, Array<{ id: string; etiqueta: string }>>> {
  const out = new Map<string, Array<{ id: string; etiqueta: string }>>();
  const itemIds = [...new Set(items.map((i) => i.ml_item_id).filter(Boolean))] as string[];
  if (!itemIds.length) return out;
  const { data: listings } = await db
    .from("ml_listings")
    .select("ml_item_id, product_id")
    .in("ml_item_id", itemIds);
  const productoPorItem = new Map(
    (listings ?? [])
      .filter((l) => l.product_id)
      .map((l) => [l.ml_item_id, l.product_id as string]),
  );
  const productIds = [...new Set(productoPorItem.values())];
  if (!productIds.length) return out;
  const { data: variantes } = await db
    .from("product_variants")
    .select("id, product_id, etiqueta, es_eleccion")
    .in("product_id", productIds)
    .eq("activo", true)
    .eq("es_eleccion", false);
  const porProducto = new Map<string, Array<{ id: string; etiqueta: string }>>();
  for (const v of variantes ?? []) {
    const arr = porProducto.get(v.product_id) ?? [];
    arr.push({ id: v.id, etiqueta: v.etiqueta });
    porProducto.set(v.product_id, arr);
  }
  for (const item of items) {
    const pid = item.ml_item_id ? productoPorItem.get(item.ml_item_id) : null;
    const opciones = pid ? porProducto.get(pid) : null;
    if (opciones?.length) out.set(item.id, opciones);
  }
  return out;
}

interface ItemPedido {
  id: string;
  titulo: string;
  producto: string;
  variante: string | null;
  thumbnail: string | null;
  contenido: Array<{ nombre: string; cantidad: number }>;
  cantidad: number;
  reservado: number;
  faltante: number;
  mapeado: boolean;
  opciones: Array<{ id: string; etiqueta: string }>;
}

panel.get("/pedidos-activos", async (c) => {
  const db = supa(c.env);

  const { data: orders, error } = await db
    .from("ml_orders")
    .select(
      "id, ml_order_id, comprador, fecha, total, estado, estado_envio, envio_substatus, logistic_type, envio_limite_despacho, raw",
    )
    .eq("estado", "paid")
    .gte("fecha", inicioDiaARHace(45))
    .order("fecha", { ascending: true });
  if (error) return c.json({ error: error.message }, 500);

  const activos = (orders ?? []).filter((o) =>
    pedidoActivo({ estado: o.estado, estado_envio: o.estado_envio, raw: o.raw }),
  );

  const { data: items } = await db
    .from("ml_order_items")
    .select("id, ml_order_id, ml_item_id, titulo, cantidad, product_variant_id")
    .in(
      "ml_order_id",
      activos.map((o) => o.id),
    );
  const itemIds = (items ?? []).map((item) => item.id);
  const variantIds = [...new Set((items ?? []).map((item) => item.product_variant_id).filter(Boolean))] as string[];
  const dbLoosePedidos = db as unknown as { from: (name: string) => any };
  const listingIds = [...new Set((items ?? []).map((item) => item.ml_item_id).filter(Boolean))];
  const [
    { data: reservationRows },
    { data: choiceRows },
    { data: recipeRows },
    { data: listingRows },
  ] = await Promise.all([
    itemIds.length
      ? dbLoosePedidos
          .from("inventory_reservations")
          .select("order_item_id,reserved_qty,missing_qty,estado")
          .in("order_item_id", itemIds)
      : Promise.resolve({ data: [] }),
    variantIds.length
      ? dbLoosePedidos
          .from("product_variants")
          .select("id,es_eleccion,etiqueta,products(nombre,nombre_interno)")
          .in("id", variantIds)
      : Promise.resolve({ data: [] }),
    variantIds.length
      ? dbLoosePedidos
          .from("variant_components")
          .select("variant_id,cantidad,components(nombre)")
          .in("variant_id", variantIds)
      : Promise.resolve({ data: [] }),
    listingIds.length
      ? dbLoosePedidos
          .from("ml_listings")
          .select("ml_item_id,thumbnail")
          .in("ml_item_id", listingIds)
      : Promise.resolve({ data: [] }),
  ]);
  const variantById = new Map<string, any>(
    (choiceRows ?? []).map((row: any) => [row.id, row]),
  );
  // Lo que lleva una unidad de cada variante, según la receta de Inventario.
  // En el pedido se multiplica por la cantidad comprada: es lo que se mete en
  // la bolsa al armar el paquete.
  const recetaPorVariante = new Map<string, Array<{ nombre: string; cantidad: number }>>();
  for (const row of recipeRows ?? []) {
    const lista = recetaPorVariante.get(row.variant_id) ?? [];
    lista.push({ nombre: row.components?.nombre ?? "Pieza", cantidad: Number(row.cantidad) || 0 });
    recetaPorVariante.set(row.variant_id, lista);
  }
  const thumbnailPorItem = new Map<string, string | null>(
    (listingRows ?? []).map((row: any) => [row.ml_item_id, row.thumbnail]),
  );
  const choiceVariants = new Set(
    (choiceRows ?? []).filter((row: any) => row.es_eleccion).map((row: any) => row.id),
  );

  // Para los ítems que todavía no tienen una variante real (compras "a elección"
  // o publicaciones sin mapear), se ofrecen las variantes del producto para
  // registrar la elección desde el pedido.
  const opcionesPorItem = await variantesElegibles(
    db,
    (items ?? []).filter(
      (item) =>
        !item.product_variant_id || choiceVariants.has(item.product_variant_id),
    ),
  );
  const reservationByItem = new Map(
    (reservationRows ?? []).map((row: any) => [row.order_item_id, row]),
  );
  const itemsPorPedido = new Map<string, ItemPedido[]>();
  for (const it of items ?? []) {
    const arr = itemsPorPedido.get(it.ml_order_id) ?? [];
    const reservation = reservationByItem.get(it.id) as
      | { reserved_qty: number; missing_qty: number }
      | undefined;
    const variante = it.product_variant_id ? variantById.get(it.product_variant_id) : null;
    const cantidad = it.cantidad ?? 1;
    arr.push({
      id: it.id,
      titulo: it.titulo ?? "—",
      producto:
        variante?.products?.nombre_interno || variante?.products?.nombre || it.titulo || "—",
      // "Único" no dice nada, y una variante "a elección" todavía no es la
      // que va en la bolsa: en los dos casos no se muestra.
      variante:
        variante && !variante.es_eleccion && variante.etiqueta !== "Único"
          ? variante.etiqueta
          : null,
      thumbnail: thumbnailPorItem.get(it.ml_item_id ?? "") ?? null,
      contenido: (recetaPorVariante.get(it.product_variant_id ?? "") ?? []).map((pieza) => ({
        nombre: pieza.nombre,
        cantidad: pieza.cantidad * cantidad,
      })),
      cantidad,
      reservado: reservation?.reserved_qty ?? 0,
      faltante: reservation?.missing_qty ?? (it.product_variant_id ? it.cantidad : 0),
      mapeado: Boolean(it.product_variant_id) && !choiceVariants.has(it.product_variant_id),
      opciones: opcionesPorItem.get(it.id) ?? [],
    });
    itemsPorPedido.set(it.ml_order_id, arr);
  }

  // Agrupar por envío/pack: ML puede juntar varios pedidos del mismo comprador
  // en un solo paquete.
  const shipId = (o: (typeof activos)[number]) => {
    const raw = o.raw as { shipping?: { id?: unknown }; pack_id?: unknown } | null;
    return (
      (raw?.shipping?.id != null && String(raw.shipping.id)) ||
      (raw?.pack_id != null && `pack:${raw.pack_id}`) ||
      `order:${o.ml_order_id}`
    );
  };

  interface Paquete {
    key: string;
    comprador: string | null;
    fecha: string;
    total: number;
    items: ItemPedido[];
    faltantes: number;
    estado_envio: string | null;
    envio_substatus: string | null;
    etiqueta_logistica: string;
    a_imprimir: boolean;
    limite_despacho: string | null;
    urgencia: UrgenciaDespacho;
  }
  const paquetes = new Map<string, Paquete>();
  for (const o of activos) {
    const key = shipId(o);
    const eti = etiquetaLogistica(o.logistic_type);
    const cur = paquetes.get(key);
    const its = itemsPorPedido.get(o.id) ?? [];
    if (cur) {
      cur.total += o.total ?? 0;
      cur.items.push(...its);
      cur.faltantes += its.reduce((sum, item) => sum + item.faltante, 0);
      if (o.fecha < cur.fecha) cur.fecha = o.fecha;
      // Un pack comparte el envío, pero por las dudas manda el plazo más corto.
      if (
        o.envio_limite_despacho &&
        (!cur.limite_despacho || o.envio_limite_despacho < cur.limite_despacho)
      )
        cur.limite_despacho = o.envio_limite_despacho;
    } else {
      paquetes.set(key, {
        key,
        comprador: o.comprador,
        fecha: o.fecha,
        total: o.total ?? 0,
        items: its,
        faltantes: its.reduce((sum, item) => sum + item.faltante, 0),
        estado_envio: o.estado_envio,
        envio_substatus: o.envio_substatus,
        etiqueta_logistica: eti,
        a_imprimir:
          o.envio_substatus === "ready_to_print" ||
          o.estado_envio === "ready_to_ship",
        limite_despacho: o.envio_limite_despacho,
        urgencia: "sin_fecha",
      });
    }
  }
  const ahora = new Date();
  for (const p of paquetes.values())
    p.urgencia = urgenciaDespacho(p.limite_despacho, ahora);

  const ORDEN = ["Flex", "Mercado Envíos", "Full", "Otro"];
  const lista = [...paquetes.values()].sort(
    (a, b) =>
      ORDEN.indexOf(a.etiqueta_logistica) - ORDEN.indexOf(b.etiqueta_logistica) ||
      (a.limite_despacho ?? "9999").localeCompare(b.limite_despacho ?? "9999") ||
      a.fecha.localeCompare(b.fecha),
  );
  const conteos: Record<string, number> = {};
  for (const p of lista)
    conteos[p.etiqueta_logistica] = (conteos[p.etiqueta_logistica] ?? 0) + 1;

  return c.json({ paquetes: lista, conteos, total: lista.length });
});

// Registrar la variante elegida por el comprador (compras "a elección" o ítems
// que quedaron sin mapear). Reserva de nuevo el pedido para que el faltante y el
// stock libre queden coherentes en el acto.
panel.post("/pedidos/items/:id/variante", async (c) => {
  const itemId = c.req.param("id");
  const body = await c.req.json<{ product_variant_id?: string }>();
  if (!body.product_variant_id) return c.json({ error: "falta la variante" }, 400);

  const db = supa(c.env);
  const { data: item } = await db
    .from("ml_order_items")
    .select("id, ml_order_id, ml_item_id")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return c.json({ error: "ítem inexistente" }, 404);

  // La variante tiene que ser del producto de esa publicación: así no se
  // descuenta stock de otro producto por un error de tipeo.
  const opciones = await variantesElegibles(db, [item]);
  const validas = opciones.get(item.id) ?? [];
  if (!validas.some((v) => v.id === body.product_variant_id))
    return c.json({ error: "esa variante no corresponde a la publicación" }, 400);

  const { error } = await db
    .from("ml_order_items")
    .update({ product_variant_id: body.product_variant_id })
    .eq("id", item.id);
  if (error) return c.json({ error: error.message }, 500);

  await (db as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ error?: { message: string } | null }>;
  }).rpc("inventory_reserve_order", { p_order_id: item.ml_order_id });

  return c.json({ ok: true });
});

// --- Planilla de reparto (Google Sheets): pedidos Flex → filas por día ---
panel.get("/pedidos/planilla", async (c) => {
  const db = supa(c.env);
  const desde = inicioDiaARHace(2);

  const [{ count: escritos }, { data: pend }, { data: ult }] = await Promise.all([
    db
      .from("ml_orders")
      .select("id", { count: "exact", head: true })
      .not("sheet_synced_at", "is", null),
    db
      .from("ml_orders")
      .select("id")
      .eq("estado", "paid")
      .eq("logistic_type", "self_service")
      .is("sheet_synced_at", null)
      .gte("fecha", desde),
    db
      .from("ml_orders")
      .select("sheet_synced_at")
      .not("sheet_synced_at", "is", null)
      .order("sheet_synced_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return c.json({
    configurado: sheetsConfigurado(c.env),
    suspendido: sheetsSuspendido(),
    sheet_id: c.env.SHEETS_ID ?? null,
    sheet_url: c.env.SHEETS_ID
      ? `https://docs.google.com/spreadsheets/d/${c.env.SHEETS_ID}/edit`
      : null,
    escritos_total: escritos ?? 0,
    pendientes: pend?.length ?? 0,
    ultimo: (ult as { sheet_synced_at?: string } | null)?.sheet_synced_at ?? null,
  });
});

// Rellena la planilla con los pedidos Flex recientes que todavía no se escribieron
// (ej. si Sheets estuvo caído). Cada uno va al bloque de su día de reparto.
panel.post("/pedidos/planilla/sync", async (c) => {
  const db = supa(c.env);
  if (sheetsSuspendido())
    return c.json(
      { error: "El módulo de planilla de reparto está suspendido." },
      409,
    );
  if (!sheetsConfigurado(c.env))
    return c.json(
      { error: "Falta el Service Account de Google (GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY)." },
      409,
    );

  const { data: orders } = await db
    .from("ml_orders")
    .select("id, ml_order_id, raw, sheet_synced_at")
    .eq("estado", "paid")
    .is("sheet_synced_at", null)
    .gte("fecha", inicioDiaARHace(2))
    .order("fecha", { ascending: true });

  let escritos = 0;
  const errores: string[] = [];
  for (const o of orders ?? []) {
    const raw = o.raw as { shipping?: { id?: unknown } } | null;
    const shippingId =
      raw?.shipping?.id != null ? String(raw.shipping.id) : null;
    if (!shippingId) continue;
    try {
      await syncEnvio(c.env, db, { id: o.id, shippingId, status: "paid" });
      const { data: after } = await db
        .from("ml_orders")
        .select("sheet_synced_at")
        .eq("id", o.id)
        .maybeSingle();
      if ((after as { sheet_synced_at?: string } | null)?.sheet_synced_at)
        escritos++;
    } catch (e) {
      errores.push(`${o.ml_order_id}: ${(e as Error).message}`);
    }
  }
  return c.json({ escritos, revisados: orders?.length ?? 0, errores });
});

// Marcar un pedido como despachado a mano (si ML tarda en actualizar el envío):
// descuenta el stock de la venta, una sola vez.
panel.post("/pedidos/:id/despachar", async (c) => {
  const db = supa(c.env);
  const id = c.req.param("id");
  const { data: o } = await db
    .from("ml_orders")
    .select("id")
    .eq("ml_order_id", id)
    .maybeSingle();
  if (!o) return c.json({ error: "pedido no encontrado" }, 404);

  const { ya, aplicados, avisos } = await descontarPorDespacho(db, o.id);
  if (ya) return c.json({ ok: true, ya: true, aplicados: 0, avisos: [] });
  await sincronizarStockML(c.env, db, {
    onItemTocado: (it) => syncOneItem(c.env, db, it).catch(() => {}),
  });
  return c.json({ ok: true, aplicados, avisos });
});

panel.post("/alertas/regenerar", async (c) => {
  const db = supa(c.env);
  const n = await regenerarAlertas(db);
  return c.json({ ok: true, alertas: n });
});

// Descarta una alerta de "ajustá stock a mano" — pero sólo si se verifica
// contra el stock real actual que Elias ya la corrigió. Si no, la deja.
panel.post("/alertas/:id/resolver", async (c) => {
  const db = supa(c.env);
  const id = c.req.param("id");
  const r = await resolverAlertaManual(db, id);
  return c.json(r);
});
