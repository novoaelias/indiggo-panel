import { useState } from "react";
import { Badge, Card, EmptyHint, PageHeader, cx } from "@/components/ui";
import { api, useApi } from "@/lib/api";

type Tono = "ok" | "warn" | "danger";

interface SimpleItem {
  id: string;
  nombre: string;
  categoria: string;
  origen: string;
  grupo: string | null;
  stock_real: number;
  stock_ml: number;
  publicado_ml: number | null;
  stock_minimo: number;
  estado_tono: Tono;
  estado_label: string;
}
interface Pieza {
  component_id: string;
  nombre: string;
  stock_real: number;
  stock_minimo: number;
}
interface PhotocardRow {
  variant_id: string;
  member: string;
  component_id: string | null;
  pc_stock_real: number | null;
  pc_stock_minimo: number | null;
  vendibles: number;
  stock_minimo: number;
  stock_ml: number;
  publicado_ml: number | null;
  estado_tono: Tono;
  estado_label: string;
}
interface Holder {
  product_id: string;
  nombre: string;
  categoria: string | null;
  grupo: string | null;
  piezas: Pieza[];
  photocards: PhotocardRow[];
  vendibles_total: number;
  estado_tono: Tono;
}
interface StockResp {
  simples: SimpleItem[];
  holders: Holder[];
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

function desyncCount(d: StockResp): number {
  const dm = (p: number | null, ml: number) => p != null && p !== ml;
  let n = 0;
  for (const s of d.simples) if (dm(s.publicado_ml, s.stock_ml)) n++;
  for (const h of d.holders)
    for (const pc of h.photocards) if (dm(pc.publicado_ml, pc.stock_ml)) n++;
  return n;
}

export function Stock() {
  const stock = useApi<StockResp>("/stock");
  const plan = useApi<Plan>("/produccion");
  const [tab, setTab] = useState<"variantes" | "insumos">("variantes");
  const [pushAll, setPushAll] = useState(false);

  const d = stock.data;
  const desync = d ? desyncCount(d) : 0;

  function recargar() {
    stock.reload();
    plan.reload();
  }

  async function publicarTodo() {
    setPushAll(true);
    try {
      await api("/stock/publicar-todo", { method: "POST" });
      recargar();
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
                  {t === "insumos" ? "Piezas sueltas" : "Productos"}
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
              <div className="flex flex-col gap-3">
                {d.holders.map((h) => (
                  <HolderCard key={h.product_id} holder={h} onSaved={recargar} />
                ))}

                {d.simples.length > 0 && (
                  <Card padding={false} className="overflow-hidden">
                    <div className="border-b hairline px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.03em] text-ink/45">
                      Otros productos
                    </div>
                    <div className="overflow-x-auto">
                      <div className="min-w-[480px]">
                        <div className="grid grid-cols-[1.7fr_0.6fr_0.6fr_1fr_0.7fr] gap-2 border-b hairline px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.03em] text-ink/45">
                          <div>Producto</div>
                          <div className="text-right">Real</div>
                          <div className="text-right">Mín.</div>
                          <div className="text-right">ML</div>
                          <div className="text-right">Estado</div>
                        </div>
                        <div className="max-h-[60vh] overflow-y-auto">
                          {d.simples.map((i) => (
                            <SimpleFila key={i.id} item={i} onSaved={recargar} />
                          ))}
                        </div>
                      </div>
                    </div>
                  </Card>
                )}
              </div>
            ) : (
              <InsumosTab onSaved={recargar} />
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
                          <span
                            className="min-w-0 flex-1 text-[13px] leading-snug [overflow-wrap:anywhere]"
                            title={q.nombre}
                          >
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

function HolderCard({
  holder,
  onSaved,
}: {
  holder: Holder;
  onSaved: () => void;
}) {
  const [abierto, setAbierto] = useState(false);

  return (
    <Card padding={false} className="overflow-hidden">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ink/[0.02]"
      >
        <span
          className={cx(
            "text-ink/35 transition-transform",
            abierto && "rotate-90",
          )}
        >
          ▸
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-semibold leading-snug [overflow-wrap:anywhere]">
            {holder.nombre}
          </span>
          <span className="text-[11px] text-ink/40">
            {holder.grupo ?? "Holders"} · {holder.photocards.length} integrantes
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-[11px] uppercase tracking-[0.03em] text-ink/40">
            Vendibles
          </span>
          <span className="text-[15px] font-bold tabular-nums">
            {holder.vendibles_total}
          </span>
        </span>
        <Badge tono={holder.estado_tono}>
          {holder.estado_tono === "danger"
            ? "Falta"
            : holder.estado_tono === "warn"
              ? "Bajo"
              : "OK"}
        </Badge>
      </button>

      {abierto && (
        <div className="border-t hairline">
          <div className="px-4 py-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.03em] text-ink/45">
              Piezas 3D del holder
            </div>
            <div className="flex flex-col gap-1.5">
              {holder.piezas.map((p) => (
                <div
                  key={p.component_id}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-2"
                >
                  <span className="text-[13px] font-medium">{p.nombre}</span>
                  <NumeroEditable
                    valor={p.stock_real}
                    label="real"
                    onGuardar={(v) =>
                      api(`/componentes/${p.component_id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ stock_real: v }),
                      }).then(onSaved)
                    }
                  />
                  <NumeroEditable
                    valor={p.stock_minimo}
                    label="mín"
                    onGuardar={(v) =>
                      api(`/componentes/${p.component_id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ stock_minimo: v }),
                      }).then(onSaved)
                    }
                  />
                </div>
              ))}
              {holder.piezas.length === 0 && (
                <div className="text-[12px] text-ink/40">
                  Sin piezas 3D en la lista de materiales. Regenerá el BOM en
                  Configuración → Catálogo.
                </div>
              )}
            </div>
          </div>

          <div className="border-t hairline px-4 py-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.03em] text-ink/45">
              Photocards por integrante
            </div>
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-2 gap-y-1 text-[10.5px] font-semibold uppercase tracking-[0.02em] text-ink/35">
              <div>Integrante</div>
              <div className="text-right">PC real</div>
              <div className="text-right">PC mín</div>
              <div className="text-right">Vend.</div>
              <div className="text-right">ML</div>
            </div>
            <div className="mt-1 flex flex-col">
              {holder.photocards.map((pc) => (
                <PhotocardFila key={pc.variant_id} pc={pc} onSaved={onSaved} />
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function PhotocardFila({
  pc,
  onSaved,
}: {
  pc: PhotocardRow;
  onSaved: () => void;
}) {
  const [publicando, setPublicando] = useState(false);
  const desincronizado =
    pc.publicado_ml != null && pc.publicado_ml !== pc.stock_ml;

  async function publicar() {
    setPublicando(true);
    try {
      await api(`/stock/${pc.variant_id}/publicar`, { method: "POST" });
      onSaved();
    } finally {
      setPublicando(false);
    }
  }

  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-2 border-b hairline py-1.5 last:border-b-0">
      <span className="text-[13px] font-medium [overflow-wrap:anywhere]">
        {pc.member}
      </span>
      {pc.component_id ? (
        <>
          <NumeroEditable
            valor={pc.pc_stock_real ?? 0}
            label="real"
            onGuardar={(v) =>
              api(`/componentes/${pc.component_id}`, {
                method: "PATCH",
                body: JSON.stringify({ stock_real: v }),
              }).then(onSaved)
            }
          />
          <NumeroEditable
            valor={pc.pc_stock_minimo ?? 0}
            label="mín"
            onGuardar={(v) =>
              api(`/componentes/${pc.component_id}`, {
                method: "PATCH",
                body: JSON.stringify({ stock_minimo: v }),
              }).then(onSaved)
            }
          />
        </>
      ) : (
        <>
          <span
            className="px-1.5 text-right text-[12px] text-ink/30"
            title="Variante sin photocard fija (ej. Random)"
          >
            —
          </span>
          <span className="px-1.5 text-right text-[12px] text-ink/30">—</span>
        </>
      )}
      <span
        className={cx(
          "px-1.5 text-right text-[13.5px] font-bold tabular-nums",
          pc.vendibles === 0 && "text-danger",
        )}
      >
        {pc.vendibles}
      </span>
      <div className="flex items-center justify-end gap-1">
        {desincronizado &&
          (publicando ? (
            <span className="text-[10px] text-ink/40">…</span>
          ) : (
            <button
              onClick={publicar}
              title={`En ML hay ${pc.publicado_ml}. Publicar ${pc.stock_ml}.`}
              className="rounded bg-accent-soft px-1 py-0.5 text-[10px] font-bold text-accent"
            >
              ↑
            </button>
          ))}
        <NumeroEditable
          valor={pc.stock_ml}
          label="ML"
          onGuardar={(v) =>
            api(`/stock/${pc.variant_id}`, {
              method: "PATCH",
              body: JSON.stringify({ stock_ml: v }),
            }).then(onSaved)
          }
        />
      </div>
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
      <div className="border-b hairline px-4 py-2.5 text-[11px] text-ink/45">
        Vista plana de todas las piezas. Las de holders también se editan
        expandiendo cada producto arriba.
      </div>
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
              <div
                className="text-[13px] font-semibold leading-snug [overflow-wrap:anywhere]"
                title={c.nombre}
              >
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

function SimpleFila({
  item,
  onSaved,
}: {
  item: SimpleItem;
  onSaved: () => void;
}) {
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
        <div
          className="text-[13px] font-semibold leading-snug [overflow-wrap:anywhere]"
          title={item.nombre}
        >
          {item.nombre}
        </div>
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
  label,
  onGuardar,
}: {
  valor: number;
  label?: string;
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
        className="w-14 rounded-md border border-accent px-1.5 py-1 text-right text-[13px] font-bold tabular-nums outline-none"
      />
    );
  }

  return (
    <button
      onClick={() => {
        setTxt(String(valor));
        setEditando(true);
      }}
      aria-label={label}
      className="min-w-[2.25rem] rounded-md px-1.5 py-1 text-right text-[13.5px] font-bold tabular-nums hover:bg-accent-soft"
      style={{ opacity: guardando ? 0.5 : 1 }}
    >
      {valor}
    </button>
  );
}
