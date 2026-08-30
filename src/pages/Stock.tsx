import { useState } from "react";
import { Badge, Card, EmptyHint, PageHeader, cx } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import type { EstadoTono } from "@/lib/types";

interface StockItem {
  id: string;
  nombre: string;
  categoria: string;
  origen: string;
  grupo: string | null;
  stock_real: number;
  stock_ml: number;
  publicado_ml: number | null;
  stock_minimo: number;
  estado_tono: EstadoTono;
  estado_label: string;
}
interface StockResp {
  items: StockItem[];
  bajo_minimo: number;
  sin_catalogo: boolean;
}
interface Componente {
  id: string;
  nombre: string;
  origen: string;
  stock_real: number;
  stock_minimo: number;
}
interface TareaPlan {
  nombre: string;
  origen: string;
  cantidad: number;
  ya_tengo?: number;
  necesito?: number;
  tipo: "insumo" | "directo";
}
interface Plan {
  imprimir_3d: TareaPlan[];
  imprenta: TareaPlan[];
  otros: TareaPlan[];
  variantes_criticas: number;
  sin_bom: boolean;
}

const ORIGEN_LABEL: Record<string, string> = {
  impresora3d: "Impresora 3D",
  imprenta: "Imprenta",
  externo: "Externo",
  mixto: "Otros",
};

export function Stock() {
  const stock = useApi<StockResp>("/stock");
  const plan = useApi<Plan>("/produccion");
  const [tab, setTab] = useState<"variantes" | "insumos">("variantes");
  const [pushAll, setPushAll] = useState(false);

  const d = stock.data;
  const desync =
    d?.items.filter(
      (i) => i.publicado_ml != null && i.publicado_ml !== i.stock_ml,
    ).length ?? 0;

  async function publicarTodo() {
    setPushAll(true);
    try {
      await api("/stock/publicar-todo", { method: "POST" });
      stock.reload();
    } finally {
      setPushAll(false);
    }
  }

  return (
    <div>
      <PageHeader
        titulo="Stock y producción"
        subtitulo={
          d && !d.sin_catalogo
            ? `${d.bajo_minimo} ${d.bajo_minimo === 1 ? "variante" : "variantes"} por debajo del mínimo`
            : "Stock real vs. stock publicado en Mercado Libre"
        }
      />

      {stock.loading && <EmptyHint>Cargando stock…</EmptyHint>}
      {stock.error && <EmptyHint>No se pudo cargar: {stock.error}</EmptyHint>}

      {d?.sin_catalogo && (
        <EmptyHint>
          Todavía no hay catálogo. Andá a <b>Configuración → Catálogo</b> y tocá
          “Derivar desde publicaciones”.
        </EmptyHint>
      )}

      {d && !d.sin_catalogo && (
        <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          <div>
            <div className="mb-3 flex items-center gap-1.5">
              {(["variantes", "insumos"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cx(
                    "rounded-lg px-3.5 py-2 text-[13px] font-semibold capitalize transition-colors",
                    tab === t
                      ? "bg-accent-soft text-accent"
                      : "text-ink/55 hover:bg-ink/[0.03]",
                  )}
                >
                  {t}
                </button>
              ))}
              {tab === "variantes" && desync > 0 && (
                <button
                  onClick={publicarTodo}
                  disabled={pushAll}
                  className="ml-auto rounded-lg bg-accent px-3 py-2 text-[12.5px] font-bold text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  {pushAll ? "Publicando…" : `Publicar ${desync} en ML`}
                </button>
              )}
            </div>

            {tab === "variantes" ? (
              <Card padding={false} className="overflow-hidden">
                <div className="overflow-x-auto">
                  <div className="min-w-[480px]">
                    <div className="grid grid-cols-[1.7fr_0.6fr_0.6fr_1fr_0.7fr] gap-2 border-b hairline px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.03em] text-ink/45">
                      <div>Variante</div>
                      <div className="text-right">Real</div>
                      <div className="text-right">Mín.</div>
                      <div className="text-right">ML</div>
                      <div className="text-right">Estado</div>
                    </div>
                    <div className="max-h-[70vh] overflow-y-auto">
                      {d.items.map((i) => (
                        <StockFila
                          key={i.id}
                          item={i}
                          onSaved={() => {
                            stock.reload();
                            plan.reload();
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            ) : (
              <InsumosTab onSaved={plan.reload} />
            )}
          </div>

          <Card>
            <div className="text-[15px] font-semibold">Producir</div>
            <div className="mb-4 mt-1 text-[12.5px] text-ink/50">
              Calculado desde el stock y la lista de materiales
            </div>
            {plan.loading && (
              <div className="text-[13px] text-ink/40">Calculando…</div>
            )}
            {plan.data?.sin_bom && (
              <div className="mb-3 rounded-lg bg-warn-bg px-3 py-2 text-[12px] text-warn">
                No hay lista de materiales. Andá a Configuración → Catálogo →
                “Armar lista de materiales”.
              </div>
            )}
            {plan.data &&
              [
                ["impresora3d", plan.data.imprimir_3d] as const,
                ["imprenta", plan.data.imprenta] as const,
                ["mixto", plan.data.otros] as const,
              ].map(([org, tareas]) =>
                tareas.length === 0 ? null : (
                  <div key={org} className="mb-4 last:mb-0">
                    <div className="mb-1.5 text-[12px] font-semibold text-ink/55">
                      {ORIGEN_LABEL[org]}
                    </div>
                    <div className="flex flex-col">
                      {tareas.map((q, idx) => (
                        <label
                          key={idx}
                          className="flex cursor-pointer items-center gap-2.5 border-b hairline py-2 last:border-b-0"
                        >
                          <input type="checkbox" className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 flex-1 truncate text-[13px]">
                            {q.nombre}
                            {q.tipo === "insumo" && q.ya_tengo != null && (
                              <span className="ml-1 text-[10.5px] text-ink/35">
                                (tenés {q.ya_tengo})
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-[13px] font-bold text-accent">
                            ×{q.cantidad}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ),
              )}
            {plan.data &&
              plan.data.imprimir_3d.length === 0 &&
              plan.data.imprenta.length === 0 &&
              plan.data.otros.length === 0 && (
                <div className="text-[13px] text-ink/45">
                  Nada para producir. 🎉
                </div>
              )}
          </Card>
        </div>
      )}
    </div>
  );
}

function InsumosTab({ onSaved }: { onSaved: () => void }) {
  const { data, loading, error, reload } = useApi<{ componentes: Componente[] }>(
    "/componentes",
  );

  function guardar() {
    reload();
    onSaved();
  }

  if (loading) return <EmptyHint>Cargando insumos…</EmptyHint>;
  if (error) return <EmptyHint>No se pudo cargar: {error}</EmptyHint>;
  if (!data || data.componentes.length === 0)
    return (
      <EmptyHint>
        Sin insumos. Generalos en Configuración → Catálogo → “Armar lista de
        materiales”.
      </EmptyHint>
    );

  return (
    <Card padding={false} className="overflow-hidden">
      <div className="grid grid-cols-[2fr_0.7fr_0.7fr] gap-2 border-b hairline px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.03em] text-ink/45">
        <div>Insumo</div>
        <div className="text-right">Stock</div>
        <div className="text-right">Mín.</div>
      </div>
      <div className="max-h-[70vh] overflow-y-auto">
        {data.componentes.map((c) => (
          <div
            key={c.id}
            className="grid grid-cols-[2fr_0.7fr_0.7fr] items-center gap-2 border-b hairline px-4 py-2.5 last:border-b-0"
          >
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold">
                {c.nombre}
              </div>
              <div className="text-[11px] text-ink/40">
                {ORIGEN_LABEL[c.origen] ?? c.origen}
              </div>
            </div>
            <NumeroEditable
              valor={c.stock_real}
              onGuardar={(v) =>
                api(`/componentes/${c.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ stock_real: v }),
                }).then(guardar)
              }
            />
            <NumeroEditable
              valor={c.stock_minimo}
              onGuardar={(v) =>
                api(`/componentes/${c.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ stock_minimo: v }),
                }).then(guardar)
              }
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

function StockFila({ item, onSaved }: { item: StockItem; onSaved: () => void }) {
  const [publicando, setPublicando] = useState(false);
  const desincronizado =
    item.publicado_ml != null && item.publicado_ml !== item.stock_ml;

  async function publicar() {
    setPublicando(true);
    try {
      await api(`/stock/${item.id}/publicar`, { method: "POST" });
      onSaved();
    } finally {
      setPublicando(false);
    }
  }

  return (
    <div className="grid grid-cols-[1.7fr_0.6fr_0.6fr_1fr_0.7fr] items-center gap-2 border-b hairline px-4 py-2.5 last:border-b-0">
      <div className="min-w-0 pr-2">
        <div className="truncate text-[13px] font-semibold">{item.nombre}</div>
        <div className="text-[11px] text-ink/40">{item.categoria}</div>
      </div>
      <NumeroEditable
        valor={item.stock_real}
        onGuardar={(v) =>
          api(`/stock/${item.id}`, {
            method: "PATCH",
            body: JSON.stringify({ stock_real: v }),
          }).then(onSaved)
        }
      />
      <NumeroEditable
        valor={item.stock_minimo}
        onGuardar={(v) =>
          api(`/stock/${item.id}`, {
            method: "PATCH",
            body: JSON.stringify({ stock_minimo: v }),
          }).then(onSaved)
        }
      />
      <div className="flex items-center justify-end gap-1.5">
        {desincronizado &&
          (publicando ? (
            <span className="text-[10px] text-ink/40">…</span>
          ) : (
            <button
              onClick={publicar}
              title={`En ML hay ${item.publicado_ml}. Publicar ${item.stock_ml}.`}
              className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold text-accent"
            >
              ↑ ML
            </button>
          ))}
        <NumeroEditable
          valor={item.stock_ml}
          onGuardar={(v) =>
            api(`/stock/${item.id}`, {
              method: "PATCH",
              body: JSON.stringify({ stock_ml: v }),
            }).then(onSaved)
          }
        />
      </div>
      <div className="flex justify-end">
        <Badge tono={item.estado_tono}>{item.estado_label}</Badge>
      </div>
    </div>
  );
}

function NumeroEditable({
  valor,
  onGuardar,
}: {
  valor: number;
  onGuardar: (v: number) => Promise<unknown>;
}) {
  const [editando, setEditando] = useState(false);
  const [txt, setTxt] = useState(String(valor));
  const [guardando, setGuardando] = useState(false);

  async function confirmar() {
    setEditando(false);
    const n = Number(txt);
    if (!Number.isFinite(n) || n < 0 || n === valor) {
      setTxt(String(valor));
      return;
    }
    setGuardando(true);
    try {
      await onGuardar(Math.round(n));
    } finally {
      setGuardando(false);
    }
  }

  if (editando) {
    return (
      <input
        autoFocus
        type="number"
        min={0}
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={confirmar}
        onKeyDown={(e) => {
          if (e.key === "Enter") confirmar();
          if (e.key === "Escape") {
            setTxt(String(valor));
            setEditando(false);
          }
        }}
        className="w-full rounded-md border border-accent px-1.5 py-1 text-right text-[13px] font-bold tabular-nums outline-none"
      />
    );
  }

  return (
    <button
      onClick={() => {
        setTxt(String(valor));
        setEditando(true);
      }}
      className="rounded-md px-1.5 py-1 text-right text-[13.5px] font-bold tabular-nums hover:bg-accent-soft"
      style={{ opacity: guardando ? 0.5 : 1 }}
    >
      {valor}
    </button>
  );
}
