import { useState } from "react";
import { Card, PageHeader, cx } from "@/components/ui";
import { metricas } from "@/data/mock";
import { formatARS } from "@/lib/format";

export function Metricas() {
  const [rango, setRango] = useState<"7d" | "30d">("7d");
  const maxDia = Math.max(...metricas.porDia.map((d) => d.monto));

  return (
    <div>
      <PageHeader
        titulo="Métricas"
        subtitulo="Ventas en Mercado Libre"
        acciones={
          <div className="flex gap-1 rounded-[9px] bg-ink/[0.05] p-[3px]">
            {(["7d", "30d"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRango(r)}
                className={cx(
                  "rounded-[7px] px-3.5 py-1.5 text-[13px] font-semibold transition-colors",
                  rango === r ? "bg-surface shadow-sm" : "text-ink/50",
                )}
              >
                {r === "7d" ? "7 días" : "30 días"}
              </button>
            ))}
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <Kpi label="Ventas totales" value={formatARS(metricas.ventasTotales)} />
        <Kpi label="Ticket promedio" value={formatARS(metricas.ticketPromedio)} />
        <Kpi label="Pedidos" value={String(metricas.pedidos)} />
      </div>

      <Card className="mb-6">
        <div className="mb-5 text-[14px] font-semibold">Ventas por día</div>
        <div className="flex h-36 items-end gap-3 sm:gap-4">
          {metricas.porDia.map((d) => (
            <div
              key={d.dia}
              className="flex h-full flex-1 flex-col items-center justify-end gap-2"
            >
              <div
                className={cx(
                  "w-3/5 rounded-t-[5px]",
                  d.monto === maxDia ? "bg-accent" : "bg-accent/35",
                )}
                style={{ height: `${(d.monto / maxDia) * 100}%` }}
              />
              <div className="text-[12px] text-ink/50">{d.dia}</div>
            </div>
          ))}
        </div>
      </Card>

      <h2 className="mb-3.5 text-[15px] font-semibold">Productos más vendidos</h2>
      <Card className="flex flex-col gap-4">
        {metricas.top.map((t) => (
          <div key={t.nombre}>
            <div className="mb-1.5 flex justify-between text-[13.5px]">
              <span className="font-semibold">{t.nombre}</span>
              <span className="text-ink/50">{t.porcentaje}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${t.porcentaje}%` }}
              />
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <div className="mb-2 text-[12.5px] text-ink/50">{label}</div>
      <div className="font-display text-[22px] font-bold">{value}</div>
    </Card>
  );
}
