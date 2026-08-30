import { useState } from "react";
import { Badge, Card, EmptyHint, PageHeader } from "@/components/ui";
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
  stock_minimo: number;
  estado_tono: EstadoTono;
  estado_label: string;
}
interface StockResp {
  items: StockItem[];
  cola: Array<{ id: string; nombre: string; origen: string; cantidad: number }>;
  bajo_minimo: number;
  sin_catalogo: boolean;
}

const ORIGEN_LABEL: Record<string, string> = {
  impresora3d: "Impresora 3D",
  imprenta: "Imprenta",
  externo: "Externo",
  mixto: "Mixto",
};

export function Stock() {
  const { data, error, loading, reload } = useApi<StockResp>("/stock");

  return (
    <div>
      <PageHeader
        titulo="Stock y producción"
        subtitulo={
          data && !data.sin_catalogo
            ? `${data.bajo_minimo} ${data.bajo_minimo === 1 ? "variante" : "variantes"} por debajo del mínimo`
            : "Stock real vs. stock publicado en Mercado Libre"
        }
      />

      {loading && <EmptyHint>Cargando stock…</EmptyHint>}
      {error && <EmptyHint>No se pudo cargar: {error}</EmptyHint>}

      {data?.sin_catalogo && (
        <EmptyHint>
          Todavía no hay catálogo. Andá a <b>Configuración → Catálogo</b> y tocá
          “Derivar desde publicaciones”.
        </EmptyHint>
      )}

      {data && !data.sin_catalogo && (
        <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          <Card padding={false} className="overflow-hidden">
            <div className="grid grid-cols-[2fr_0.8fr_0.8fr_0.8fr] gap-2 border-b hairline px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.03em] text-ink/45">
              <div>Variante</div>
              <div className="text-right">Real</div>
              <div className="text-right">Mín.</div>
              <div className="text-right">Estado</div>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {data.items.map((i) => (
                <StockFila key={i.id} item={i} onSaved={reload} />
              ))}
            </div>
          </Card>

          <Card>
            <div className="text-[15px] font-semibold">Producir</div>
            <div className="mb-4 mt-1 text-[12.5px] text-ink/50">
              Variantes por debajo del mínimo, agrupadas por origen
            </div>
            {data.cola.length === 0 && (
              <div className="text-[13px] text-ink/45">
                Nada por debajo del mínimo. 🎉
              </div>
            )}
            {["impresora3d", "imprenta", "externo", "mixto"].map((org) => {
              const tareas = data.cola.filter((q) => q.origen === org);
              if (!tareas.length) return null;
              return (
                <div key={org} className="mb-4 last:mb-0">
                  <div className="mb-1.5 text-[12px] font-semibold text-ink/55">
                    {ORIGEN_LABEL[org] ?? org}
                  </div>
                  <div className="flex flex-col">
                    {tareas.map((q) => (
                      <label
                        key={q.id}
                        className="flex cursor-pointer items-center gap-2.5 border-b hairline py-2 last:border-b-0"
                      >
                        <input type="checkbox" className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-[13px]">
                          {q.nombre}
                        </span>
                        <span className="shrink-0 text-[13px] font-bold text-accent">
                          ×{q.cantidad}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </Card>
        </div>
      )}
    </div>
  );
}

function StockFila({ item, onSaved }: { item: StockItem; onSaved: () => void }) {
  return (
    <div className="grid grid-cols-[2fr_0.8fr_0.8fr_0.8fr] items-center gap-2 border-b hairline px-4 py-2.5 last:border-b-0">
      <div className="min-w-0 pr-2">
        <div className="truncate text-[13px] font-semibold">{item.nombre}</div>
        <div className="text-[11px] text-ink/40">
          {item.categoria} · publicado {item.stock_ml}
        </div>
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
