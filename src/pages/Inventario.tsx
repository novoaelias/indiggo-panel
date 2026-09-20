import { useMemo, useState } from "react";
import { Badge, Card, EmptyHint, GhostButton, PageHeader, PrimaryButton, cx } from "@/components/ui";
import { api, useApi } from "@/lib/api";

interface ComponentItem {
  id: string;
  codigo: string | null;
  nombre: string;
  unidad: string;
  equivalencia: string | null;
  color: string | null;
  origen: string;
  stock_real: number;
  stock_minimo: number;
  rinde_por_placa: number | null;
  minutos_placa: number | null;
}
interface RecipeLine {
  component_id: string;
  cantidad: number;
  notas: string | null;
  component: ComponentItem | null;
}
interface VariantItem {
  id: string;
  product_id: string;
  nombre: string;
  etiqueta: string;
  categoria: string | null;
  grupo: string | null;
  terminados: number;
  reservados: number;
  libres: number;
  faltantes_pedidos: number;
  armables: number;
  stock_ml_objetivo: number;
  stock_ml_publicado: number | null;
  stock_minimo: number;
  receta: RecipeLine[];
}
interface MovementLine {
  entity_type: "variant" | "component";
  delta: number;
  quantity_before: number;
  quantity_after: number;
  product_variants?: { etiqueta: string; products?: { nombre: string; nombre_interno: string | null } } | null;
  components?: { nombre: string; unidad: string } | null;
}
interface Movement {
  id: string;
  tipo: string;
  nota: string | null;
  created_at: string;
  inventory_movement_lines: MovementLine[];
}
interface InventoryData {
  variants: VariantItem[];
  components: ComponentItem[];
  movements: Movement[];
  summary: {
    productos: number;
    faltantes_pedidos: number;
    piezas_bajas: number;
    ml_desincronizado: number;
  };
}

type Tab = "productos" | "piezas" | "movimientos";

export function Inventario() {
  const inventory = useApi<InventoryData>("/inventario");
  const [tab, setTab] = useState<Tab>("productos");
  const [q, setQ] = useState("");
  const [recipeFor, setRecipeFor] = useState<VariantItem | null>(null);
  const [syncing, setSyncing] = useState(false);
  const data = inventory.data;
  const normalized = q.trim().toLowerCase();
  const variants = useMemo(
    () =>
      (data?.variants ?? []).filter((v) =>
        `${v.nombre} ${v.etiqueta}`.toLowerCase().includes(normalized),
      ),
    [data, normalized],
  );
  const components = useMemo(
    () =>
      (data?.components ?? []).filter((v) =>
        `${v.nombre} ${v.color ?? ""}`.toLowerCase().includes(normalized),
      ),
    [data, normalized],
  );

  async function syncMl() {
    setSyncing(true);
    try {
      await api("/inventario/sync-ml", { method: "POST" });
      inventory.reload();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <PageHeader
        titulo="Inventario"
        subtitulo="Productos terminados, reservas y piezas compartidas"
        acciones={
          <GhostButton onClick={syncMl} disabled={syncing}>
            {syncing ? "Sincronizando…" : "Sincronizar Mercado Libre"}
          </GhostButton>
        }
      />
      {inventory.loading && <EmptyHint>Cargando inventario…</EmptyHint>}
      {inventory.error && <EmptyHint>No se pudo cargar: {inventory.error}</EmptyHint>}
      {data && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Productos" value={data.summary.productos} />
            <Stat label="Faltan para pedidos" value={data.summary.faltantes_pedidos} danger={data.summary.faltantes_pedidos > 0} />
            <Stat label="Piezas bajas" value={data.summary.piezas_bajas} danger={data.summary.piezas_bajas > 0} />
            <Stat label="ML por sincronizar" value={data.summary.ml_desincronizado} danger={data.summary.ml_desincronizado > 0} />
          </div>
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-1 rounded-lg bg-ink/[0.05] p-1">
              {(["productos", "piezas", "movimientos"] as Tab[]).map((value) => (
                <button
                  key={value}
                  onClick={() => setTab(value)}
                  className={cx(
                    "rounded-md px-3 py-2 text-[13px] font-semibold capitalize",
                    tab === value ? "bg-surface shadow-sm" : "text-ink/50",
                  )}
                >
                  {value === "piezas" ? "Piezas e insumos" : value}
                </button>
              ))}
            </div>
            {tab !== "movimientos" && (
              <input
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Buscar…"
                className="w-full rounded-lg border border-ink/12 px-3 py-2 text-[13px] outline-none focus:border-accent sm:w-64"
              />
            )}
          </div>

          {tab === "productos" && (
            <Card padding={false} className="overflow-hidden">
              <div className="hidden grid-cols-[minmax(220px,1fr)_repeat(5,86px)_80px] gap-2 border-b px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-ink/40 hairline lg:grid">
                <span>Producto</span><span>Terminados</span><span>Reservados</span><span>Libres</span><span>Podés armar</span><span>Publicado ML</span><span />
              </div>
              {variants.map((v) => (
                <div key={v.id} className="border-b p-4 last:border-b-0 hairline">
                  <div className="grid items-center gap-3 lg:grid-cols-[minmax(220px,1fr)_repeat(5,86px)_80px]">
                    <div className="min-w-0">
                      <div className="font-semibold text-[13.5px]">{v.nombre}</div>
                      <div className="mt-0.5 text-[11px] text-ink/45">{v.etiqueta !== "Único" ? v.etiqueta : v.categoria ?? v.grupo ?? "Unidad"}</div>
                      {v.faltantes_pedidos > 0 && <Badge tono="danger">Faltan {v.faltantes_pedidos} para pedidos</Badge>}
                    </div>
                    <Metric label="Terminados" value={v.terminados}>
                      <QuantityEditor entityType="variant" id={v.id} value={v.terminados} onSaved={inventory.reload} />
                    </Metric>
                    <Metric label="Reservados" value={v.reservados} />
                    <Metric label="Libres" value={v.libres} strong />
                    <Metric label="Podés armar" value={v.armables} />
                    <Metric label="Publicado ML" value={v.stock_ml_publicado ?? "—"} sub={`objetivo ${v.stock_ml_objetivo}`} />
                    <button onClick={() => setRecipeFor(v)} className="rounded-lg border border-ink/12 px-2 py-2 text-[12px] font-semibold hover:bg-ink/[0.03]">Receta</button>
                  </div>
                  {v.receta.length > 0 && (
                    <div className="mt-2 text-[11px] text-ink/40">
                      {v.receta.map((line) => `${line.cantidad} ${line.component?.unidad ?? "u."} de ${line.component?.nombre ?? "pieza"}`).join(" · ")}
                    </div>
                  )}
                </div>
              ))}
              {variants.length === 0 && <div className="p-8 text-center text-[13px] text-ink/45">No hay productos con ese nombre.</div>}
            </Card>
          )}

          {tab === "piezas" && (
            <div className="grid gap-3 md:grid-cols-2">
              {components.map((component) => (
                <Card key={component.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[14px] font-semibold">{component.nombre}</div>
                      <div className="mt-1 text-[11.5px] text-ink/45">
                        {[component.color, component.equivalencia, component.origen].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    {component.stock_real < component.stock_minimo && <Badge tono="warn">Bajo</Badge>}
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div><span className="text-[26px] font-bold">{component.stock_real}</span><span className="ml-1 text-[12px] text-ink/45">{component.unidad}</span></div>
                    <QuantityEditor entityType="component" id={component.id} value={component.stock_real} onSaved={inventory.reload} />
                  </div>
                  {(component.rinde_por_placa || component.minutos_placa) && (
                    <div className="mt-3 border-t pt-3 text-[11px] text-ink/45 hairline">
                      {component.rinde_por_placa ?? "—"} por placa · {component.minutos_placa ?? "—"} minutos
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}

          {tab === "movimientos" && <MovementList movements={data.movements} />}
        </>
      )}
      {recipeFor && data && (
        <RecipeEditor
          variant={recipeFor}
          components={data.components}
          onClose={() => setRecipeFor(null)}
          onSaved={() => { setRecipeFor(null); inventory.reload(); }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return <Card><div className="text-[11.5px] text-ink/45">{label}</div><div className={cx("mt-1 text-[23px] font-bold", danger && "text-danger")}>{value}</div></Card>;
}

function Metric({ label, value, sub, strong, children }: { label: string; value: number | string; sub?: string; strong?: boolean; children?: React.ReactNode }) {
  return <div className="flex items-center justify-between lg:block lg:text-center"><span className="text-[10px] text-ink/40 lg:hidden">{label}</span><div className={cx("text-[15px] tabular-nums", strong ? "font-bold" : "font-semibold")}>{value}</div>{sub && <div className="text-[9.5px] text-ink/35">{sub}</div>}{children}</div>;
}

function QuantityEditor({ entityType, id, value, onSaved }: { entityType: "variant" | "component"; id: string; value: number; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [quantity, setQuantity] = useState(String(value));
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await api("/inventario/adjust", { method: "POST", body: JSON.stringify({ entity_type: entityType, entity_id: id, quantity: Math.max(0, Number(quantity) || 0), reason: "Conteo manual desde Inventario", idempotency_key: `ajuste:${crypto.randomUUID()}` }) });
      setEditing(false); onSaved();
    } finally { setSaving(false); }
  }
  if (!editing) return <button onClick={() => { setQuantity(String(value)); setEditing(true); }} className="mt-1 text-[10px] font-semibold text-accent">Ajustar</button>;
  return <div className="mt-1 flex justify-center gap-1"><input autoFocus value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ""))} className="h-8 min-h-0 w-12 rounded border border-ink/15 text-center text-[12px]" /><button disabled={saving} onClick={save} className="h-8 min-h-0 rounded bg-accent px-2 text-[10px] font-bold text-white">OK</button></div>;
}

function MovementList({ movements }: { movements: Movement[] }) {
  const labels: Record<string, string> = { ajuste: "Ajuste", impresion: "Impresión", armado: "Armado", despacho: "Despacho", devolucion: "Devolución", reserva: "Reserva" };
  return <Card padding={false} className="overflow-hidden">{movements.map((movement) => <div key={movement.id} className="border-b px-4 py-3 last:border-b-0 hairline"><div className="flex justify-between gap-3"><div><span className="text-[13px] font-semibold">{labels[movement.tipo] ?? movement.tipo}</span>{movement.nota && <span className="ml-2 text-[11px] text-ink/45">{movement.nota}</span>}</div><span className="text-[10.5px] text-ink/40">{new Date(movement.created_at).toLocaleString("es-AR")}</span></div><div className="mt-1 text-[11.5px] text-ink/55">{(movement.inventory_movement_lines ?? []).map((line) => { const product = line.product_variants?.products; const name = line.components?.nombre ?? `${product?.nombre_interno || product?.nombre || "Producto"} ${line.product_variants?.etiqueta ?? ""}`; return `${line.delta > 0 ? "+" : ""}${line.delta} ${name}`; }).join(" · ")}</div></div>)}{movements.length === 0 && <div className="p-8 text-center text-[13px] text-ink/45">Todavía no hay movimientos.</div>}</Card>;
}

function RecipeEditor({ variant, components, onClose, onSaved }: { variant: VariantItem; components: ComponentItem[]; onClose: () => void; onSaved: () => void }) {
  const [lines, setLines] = useState<Record<string, string>>(() => Object.fromEntries(variant.receta.map((x) => [x.component_id, String(x.cantidad)])));
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await api(`/inventario/recipes/${variant.id}`, { method: "PUT", body: JSON.stringify({ lines: Object.entries(lines).filter(([, qty]) => Number(qty) > 0).map(([component_id, qty]) => ({ component_id, cantidad: Number(qty) })) }) });
      onSaved();
    } finally { setSaving(false); }
  }
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><Card className="max-h-[85vh] w-full max-w-lg overflow-auto"><div className="mb-4 flex items-start justify-between"><div><h2 className="text-[18px] font-bold">Receta</h2><p className="text-[12px] text-ink/45">{variant.nombre} · {variant.etiqueta}</p></div><button onClick={onClose} className="text-xl">×</button></div><div className="flex flex-col gap-2">{components.map((component) => <label key={component.id} className="flex items-center gap-3 rounded-lg border border-ink/10 px-3 py-2"><span className="min-w-0 flex-1 text-[12.5px]">{component.nombre}<span className="block text-[10px] text-ink/40">{component.equivalencia ?? component.unidad}</span></span><input inputMode="numeric" value={lines[component.id] ?? ""} onChange={(e) => setLines((current) => ({ ...current, [component.id]: e.target.value.replace(/\D/g, "") }))} placeholder="0" className="w-14 rounded border border-ink/15 px-2 text-center text-[12px]" /></label>)}</div><div className="mt-5 flex justify-end gap-2"><GhostButton onClick={onClose}>Cancelar</GhostButton><PrimaryButton disabled={saving} onClick={save}>{saving ? "Guardando…" : "Guardar receta"}</PrimaryButton></div></Card></div>;
}

