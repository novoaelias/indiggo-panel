import { Badge, Card, PageHeader } from "@/components/ui";
import { colaProduccion, stockItems } from "@/data/mock";
import type { EstadoTono, ItemStock, OrigenProduccion } from "@/lib/types";

function evaluar(i: ItemStock): { tono: EstadoTono; label: string } {
  if (i.stockReal === 0) return { tono: "danger", label: "Sin stock" };
  if (i.stockReal <= Math.ceil(i.minimo * 0.4))
    return { tono: "danger", label: "Crítico" };
  if (i.stockReal < i.minimo) return { tono: "warn", label: "Bajo" };
  return { tono: "ok", label: "OK" };
}

const origenLabel: Record<OrigenProduccion, string> = {
  impresora3d: "Impresora 3D",
  imprenta: "Imprenta",
};

export function Stock() {
  const bajoMinimo = stockItems.filter((i) => i.stockReal < i.minimo).length;

  return (
    <div>
      <PageHeader
        titulo="Stock y producción"
        subtitulo={`${bajoMinimo} ${bajoMinimo === 1 ? "producto" : "productos"} por debajo del mínimo`}
      />

      <div className="mb-6 rounded-[12px] bg-warn-bg px-4 py-3 text-[13px] text-warn">
        Datos de ejemplo. Este módulo se conecta cuando derivemos el catálogo de
        productos desde las publicaciones y cargues el stock físico.
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Card padding={false} className="overflow-hidden">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr] border-b hairline px-4 py-3 text-[11.5px] font-semibold uppercase tracking-[0.03em] text-ink/45">
            <div>Producto</div>
            <div>Categoría</div>
            <div className="text-right">Real / ML</div>
            <div className="text-right">Estado</div>
          </div>
          {stockItems.map((i) => {
            const e = evaluar(i);
            return (
              <div
                key={i.id}
                className="grid grid-cols-[2fr_1fr_1fr_1fr] items-center border-b hairline px-4 py-3.5 last:border-b-0"
              >
                <div className="min-w-0 pr-2">
                  <div className="truncate text-[13.5px] font-semibold">
                    {i.nombre}
                  </div>
                  <div className="text-[11.5px] text-ink/40">
                    mín. {i.minimo} · {origenLabel[i.origen]}
                  </div>
                </div>
                <div className="text-[13px] text-ink/55">{i.categoria}</div>
                <div className="text-right font-display text-[13.5px] font-bold tabular-nums">
                  {i.stockReal}
                  <span className="font-sans font-normal text-ink/40">
                    {" "}
                    / {i.stockMl}
                  </span>
                </div>
                <div className="flex justify-end">
                  <Badge tono={e.tono}>{e.label}</Badge>
                </div>
              </div>
            );
          })}
        </Card>

        <Card>
          <div className="text-[15px] font-semibold">Imprimir hoy</div>
          <div className="mb-4 mt-1 text-[12.5px] text-ink/50">
            Se armó según stock real y pedidos
          </div>
          <div className="flex flex-col">
            {colaProduccion.map((q) => (
              <label
                key={q.id}
                className="flex cursor-pointer items-center gap-2.5 border-b hairline py-2.5 last:border-b-0"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                />
                <span className="min-w-0 flex-1 truncate text-[13.5px]">
                  {q.nombre}
                  <span className="ml-1.5 text-[11px] text-ink/40">
                    {origenLabel[q.origen]}
                  </span>
                </span>
                <span className="shrink-0 text-[13px] font-bold text-accent">
                  ×{q.cantidad}
                </span>
              </label>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
