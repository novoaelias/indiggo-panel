import { useEffect, useMemo, useState } from "react";
import { Badge, Card, EmptyHint, GhostButton, PageHeader, PrimaryButton } from "@/components/ui";
import { api, useApi } from "@/lib/api";

interface ComponentItem {
  id: string;
  nombre: string;
  unidad: string;
  equivalencia: string | null;
  stock_real: number;
  rinde_por_placa: number | null;
  minutos_placa: number | null;
  origen: string;
}
interface Suggestion {
  variant_id: string;
  nombre: string;
  etiqueta: string;
  cantidad: number;
  motivo: string;
}
interface Trabajo {
  component_id: string;
  nombre: string;
  unidad: string;
  origen: string;
  stock_real: number;
  faltan: number;
  sugerido: number;
  placas: number | null;
  placas_label: string;
  minutos: number | null;
  para_pedidos: boolean;
  en_curso: number;
}
interface ProductionRun {
  id: string;
  component_id: string | null;
  tipo: "impresion" | "compra";
  cantidad: number;
  placas: number | null;
  estado: string;
  nota: string | null;
  created_at: string;
  components: { nombre: string; unidad: string; origen: string } | null;
}
interface ProductionData {
  components: ComponentItem[];
  suggestions: Suggestion[];
  imprimir: Trabajo[];
  encargar: Trabajo[];
  production_runs: ProductionRun[];
  summary: { faltantes_pedidos: number; piezas_bajas: number };
}

function duracion(minutos: number | null): string | null {
  if (!minutos) return null;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function Produccion() {
  const inventory = useApi<ProductionData>("/inventario");
  const components = useMemo(
    () => (inventory.data?.components ?? []).filter((c) => c.origen === "impresora3d"),
    [inventory.data],
  );
  const [componentId, setComponentId] = useState("");
  const [recepcion, setRecepcion] = useState<Record<string, string>>({});
  const [recibiendo, setRecibiendo] = useState<string>();
  const [plates, setPlates] = useState("1");
  const [quantity, setQuantity] = useState("");
  const [saving, setSaving] = useState(false);
  const selected = components.find((c) => c.id === componentId);
  useEffect(() => {
    if (!componentId && components[0]) setComponentId(components[0].id);
  }, [componentId, components]);
  useEffect(() => {
    if (selected?.rinde_por_placa)
      setQuantity(String(Math.max(1, Math.round(selected.rinde_por_placa * (Number(plates) || 0)))));
  }, [plates, selected]);

  async function registerPrint() {
    if (!selected || Number(quantity) <= 0) return;
    setSaving(true);
    try {
      await api("/inventario/runs", {
        method: "POST",
        body: JSON.stringify({
          component_id: selected.id,
          quantity: Number(quantity),
          plates: Number(plates) || null,
          note: `Impresión de ${selected.nombre}`,
          kind: "impresion",
        }),
      });
      inventory.reload();
    } finally { setSaving(false); }
  }

  // Las piezas de imprenta se registran como encargadas; recién al confirmar su
  // llegada se suman al stock físico.
  async function registrarEncargo(trabajo: Trabajo) {
    const cantidad = Number(recepcion[trabajo.component_id] ?? trabajo.sugerido);
    if (!Number.isFinite(cantidad) || cantidad <= 0) return;
    setRecibiendo(trabajo.component_id);
    try {
      await api("/inventario/runs", {
        method: "POST",
        body: JSON.stringify({
          component_id: trabajo.component_id,
          quantity: cantidad,
          note: `Encargo a imprenta: ${trabajo.nombre}`,
          kind: "compra",
        }),
      });
      inventory.reload();
    } finally { setRecibiendo(undefined); }
  }

  async function terminarRun(run: ProductionRun) {
    setRecibiendo(run.id);
    try {
      await api(`/inventario/runs/${run.id}/complete`, { method: "POST" });
      inventory.reload();
    } finally { setRecibiendo(undefined); }
  }

  async function cancelarRun(run: ProductionRun) {
    setRecibiendo(run.id);
    try {
      await api(`/inventario/runs/${run.id}/cancel`, { method: "POST" });
      inventory.reload();
    } finally { setRecibiendo(undefined); }
  }

  return <div>
    <PageHeader titulo="Producción" subtitulo="Imprimí piezas y armá productos según los pedidos y el stock" />
    {inventory.loading && <EmptyHint>Calculando el plan…</EmptyHint>}
    {inventory.error && <EmptyHint>No se pudo cargar: {inventory.error}</EmptyHint>}
    {inventory.data && <>
      {inventory.data.production_runs.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-3 text-[15px] font-semibold">En curso</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {inventory.data.production_runs.map((run) => (
              <Card key={run.id}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold">
                      {run.components?.nombre ?? "Trabajo de producción"}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-ink/45">
                      {run.tipo === "compra" ? "Encargado" : "Imprimiendo"} · {run.cantidad} {run.components?.unidad ?? "unidades"}
                      {run.placas ? ` · ${run.placas} placa(s)` : ""}
                    </div>
                  </div>
                  <PrimaryButton disabled={recibiendo === run.id} onClick={() => terminarRun(run)}>
                    {recibiendo === run.id ? "…" : run.tipo === "compra" ? "Registrar recepción" : "Confirmar terminada"}
                  </PrimaryButton>
                  <GhostButton disabled={recibiendo === run.id} onClick={() => cancelarRun(run)}>Cancelar</GhostButton>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
      <div className="mb-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,.75fr)]">
        <div>
          <h2 className="mb-3 text-[15px] font-semibold">Qué conviene imprimir</h2>
          <div className="flex flex-col gap-3">
            {inventory.data.imprimir.map((trabajo) => (
              <Card key={trabajo.component_id}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold">{trabajo.nombre}</div>
                    <div className="mt-0.5 text-[11.5px] text-ink/45">
                      Tenés {trabajo.stock_real} · faltan {trabajo.faltan} {trabajo.unidad}
                      {trabajo.placas ? ` · ${trabajo.placas_label}` : ""}
                      {duracion(trabajo.minutos) ? ` · ${duracion(trabajo.minutos)}` : ""}
                    </div>
                  </div>
                  <Badge tono={trabajo.para_pedidos ? "danger" : "warn"}>
                    Imprimir {trabajo.sugerido}
                  </Badge>
                  <PrimaryButton
                    onClick={() => {
                      setComponentId(trabajo.component_id);
                      setPlates(String(trabajo.placas ?? 1));
                      setQuantity(String(trabajo.sugerido));
                    }}
                  >
                    Cargar
                  </PrimaryButton>
                </div>
              </Card>
            ))}
            {inventory.data.imprimir.length === 0 && (
              <EmptyHint>No hay piezas 3D por reponer.</EmptyHint>
            )}
          </div>

          {inventory.data.encargar.length > 0 && (
            <>
              <h2 className="mb-3 mt-6 text-[15px] font-semibold">Qué encargar y recibir</h2>
              <div className="flex flex-col gap-3">
                {inventory.data.encargar.map((trabajo) => (
                  <Card key={trabajo.component_id}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="text-[14px] font-semibold">{trabajo.nombre}</div>
                        <div className="mt-0.5 text-[11.5px] text-ink/45">
                          Tenés {trabajo.stock_real} · faltan {trabajo.faltan} {trabajo.unidad}
                        </div>
                      </div>
                      <Badge tono={trabajo.para_pedidos ? "danger" : "warn"}>
                        Encargar {trabajo.sugerido}
                      </Badge>
                      <input
                        inputMode="numeric"
                        value={recepcion[trabajo.component_id] ?? String(trabajo.sugerido)}
                        onChange={(e) =>
                          setRecepcion((prev) => ({
                            ...prev,
                            [trabajo.component_id]: e.target.value.replace(/\D/g, ""),
                          }))
                        }
                        className="w-16 rounded-lg border border-ink/12 px-2 text-center text-[13px]"
                      />
                      <PrimaryButton
                        disabled={recibiendo === trabajo.component_id}
                        onClick={() => registrarEncargo(trabajo)}
                      >
                        {recibiendo === trabajo.component_id ? "…" : "Marcar encargado"}
                      </PrimaryButton>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          )}

          <h2 className="mb-3 mt-6 text-[15px] font-semibold">Qué conviene armar</h2>
          <div className="flex flex-col gap-3">
            {inventory.data.suggestions.map((suggestion) => <AssemblyCard key={suggestion.variant_id} suggestion={suggestion} onSaved={inventory.reload} />)}
            {inventory.data.suggestions.length === 0 && <EmptyHint>No hay armados sugeridos con las piezas disponibles.</EmptyHint>}
          </div>
          {inventory.data.summary.faltantes_pedidos > 0 && <div className="mt-3 rounded-lg bg-danger-bg px-4 py-3 text-[12px] text-danger">Hay {inventory.data.summary.faltantes_pedidos} producto(s) comprometidos que todavía no tienen una unidad terminada reservada.</div>}
        </div>
        <div>
          <h2 className="mb-3 text-[15px] font-semibold">Iniciar una impresión</h2>
          <Card>
            <label className="block text-[11px] font-semibold text-ink/50">Pieza</label>
            <select value={componentId} onChange={(e) => setComponentId(e.target.value)} className="mt-1 w-full rounded-lg border border-ink/12 px-3 py-2 text-[13px]">
              {components.map((component) => <option key={component.id} value={component.id}>{component.nombre}</option>)}
            </select>
            {selected && <div className="mt-3 rounded-lg bg-ink/[0.03] p-3 text-[11.5px] text-ink/55">
              Tenés {selected.stock_real} {selected.unidad}. {selected.equivalencia}
              {selected.rinde_por_placa && <span className="block mt-1">Rinde: {selected.rinde_por_placa} por placa{selected.minutos_placa ? ` · ${selected.minutos_placa} min` : ""}</span>}
            </div>}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-[11px] font-semibold text-ink/50">Placas<input inputMode="decimal" value={plates} onChange={(e) => setPlates(e.target.value.replace(/[^0-9.]/g, ""))} className="mt-1 w-full rounded-lg border border-ink/12 px-3 py-2 text-[13px]" /></label>
              <label className="text-[11px] font-semibold text-ink/50">Unidades esperadas<input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ""))} className="mt-1 w-full rounded-lg border border-ink/12 px-3 py-2 text-[13px]" /></label>
            </div>
            <PrimaryButton disabled={saving || !selected} onClick={registerPrint}>{saving ? "Registrando…" : "Iniciar impresión"}</PrimaryButton>
            <p className="mt-2 text-[10.5px] text-ink/40">Se descuenta del plan para no recomendarla dos veces. Las piezas se suman al inventario recién cuando confirmás que terminó.</p>
          </Card>
        </div>
      </div>
    </>}
  </div>;
}

function AssemblyCard({ suggestion, onSaved }: { suggestion: Suggestion; onSaved: () => void }) {
  const [quantity, setQuantity] = useState(String(suggestion.cantidad));
  const [saving, setSaving] = useState(false);
  async function assemble() {
    setSaving(true);
    try {
      await api("/inventario/assemble", { method: "POST", body: JSON.stringify({ variant_id: suggestion.variant_id, quantity: Number(quantity), note: suggestion.motivo, idempotency_key: `armado:${crypto.randomUUID()}` }) });
      onSaved();
    } finally { setSaving(false); }
  }
  return <Card><div className="flex flex-col gap-3 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><div className="text-[14px] font-semibold">{suggestion.nombre}</div><div className="mt-0.5 text-[11.5px] text-ink/45">{suggestion.etiqueta} · {suggestion.motivo}</div></div><Badge tono={suggestion.motivo.includes("pedido") ? "danger" : "warn"}>Sugerido {suggestion.cantidad}</Badge><input value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="w-16 rounded-lg border border-ink/12 px-2 text-center text-[13px]" /><PrimaryButton disabled={saving || Number(quantity) <= 0} onClick={assemble}>{saving ? "…" : "Confirmar armado"}</PrimaryButton></div></Card>;
}

