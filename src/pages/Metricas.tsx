import { useState } from "react";
import { Card, EmptyHint, PageHeader, cx } from "@/components/ui";
import { useApi } from "@/lib/api";
import { formatARS } from "@/lib/format";

interface MetricasData {
  dias: number;
  ventas_totales: number;
  pedidos: number;
  ticket_promedio: number;
  ventas_prev: number;
  pedidos_prev: number;
  por_dia: Array<{ dia: string; monto: number; pedidos: number }>;
  top: Array<{ nombre: string; unidades: number; ingreso: number }>;
  preguntas: {
    respondidas: number;
    automaticas: number;
    porcentaje_automaticas: number;
    pendientes: number;
    horas_respuesta: number | null;
  };
  inventario: { unidades_faltantes: number; variantes_sin_libres: number };
}

function delta(actual: number, prev: number): string | null {
  if (!prev) return null;
  const pct = Math.round(((actual - prev) / prev) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

const DIA_CORTO = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export function Metricas() {
  const [dias, setDias] = useState(7);
  const { data, error, loading } = useApi<MetricasData>(`/metricas?dias=${dias}`);

  const maxDia = Math.max(1, ...(data?.por_dia ?? []).map((d) => d.monto));
  const maxIngreso = Math.max(1, ...(data?.top ?? []).map((t) => t.ingreso));

  return (
    <div>
      <PageHeader
        titulo="Métricas"
        subtitulo="Ventas pagadas en Mercado Libre"
        acciones={
          <div className="flex gap-1 rounded-[9px] bg-ink/[0.05] p-[3px]">
            {[7, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDias(d)}
                className={cx(
                  "rounded-[7px] px-3.5 py-1.5 text-[13px] font-semibold transition-colors",
                  dias === d ? "bg-surface shadow-sm" : "text-ink/50",
                )}
              >
                {d} días
              </button>
            ))}
          </div>
        }
      />

      {loading && <EmptyHint>Cargando métricas…</EmptyHint>}
      {error && <EmptyHint>No se pudieron cargar las métricas: {error}</EmptyHint>}

      {data && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <Kpi
              label="Ventas totales"
              value={formatARS(data.ventas_totales)}
              delta={delta(data.ventas_totales, data.ventas_prev)}
            />
            <Kpi
              label="Ticket promedio"
              value={formatARS(data.ticket_promedio)}
            />
            <Kpi
              label="Pedidos"
              value={String(data.pedidos)}
              delta={delta(data.pedidos, data.pedidos_prev)}
            />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-3.5 sm:grid-cols-5">
            <Kpi
              label="Preguntas respondidas"
              value={String(data.preguntas.respondidas)}
            />
            <Kpi
              label="Respuestas automáticas"
              value={`${data.preguntas.porcentaje_automaticas}%`}
            />
            <Kpi
              label="Tiempo de respuesta"
              value={
                data.preguntas.horas_respuesta == null
                  ? "—"
                  : data.preguntas.horas_respuesta < 1
                    ? `${Math.round(data.preguntas.horas_respuesta * 60)} min`
                    : `${data.preguntas.horas_respuesta} h`
              }
            />
            <Kpi
              label="Preguntas pendientes"
              value={String(data.preguntas.pendientes)}
            />
            <Kpi
              label="Unidades faltantes"
              value={String(data.inventario.unidades_faltantes)}
            />
          </div>

          <Card className="mb-6">
            <div className="mb-5 text-[14px] font-semibold">Ventas por día</div>
            <div className="flex h-40 items-end gap-1.5 overflow-x-auto">
              {data.por_dia.map((d) => {
                const dow = new Date(d.dia + "T12:00:00").getDay();
                return (
                  <div
                    key={d.dia}
                    title={`${d.dia}: ${formatARS(d.monto)} · ${d.pedidos} pedidos`}
                    className="flex h-full min-w-[24px] flex-1 flex-col items-center justify-end gap-2"
                  >
                    <div
                      className={cx(
                        "w-full max-w-[26px] rounded-t-[4px]",
                        d.monto === maxDia && d.monto > 0
                          ? "bg-accent"
                          : "bg-accent/35",
                      )}
                      style={{
                        height: `${Math.max((d.monto / maxDia) * 100, d.monto > 0 ? 4 : 0)}%`,
                      }}
                    />
                    <div className="text-[11px] text-ink/50">
                      {dias <= 14
                        ? DIA_CORTO[dow]
                        : d.dia.slice(8) + "/" + d.dia.slice(5, 7)}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <h2 className="mb-3.5 text-[15px] font-semibold">
            Productos más vendidos
          </h2>
          <Card className="flex flex-col gap-4">
            {data.top.map((t) => (
              <div key={t.nombre}>
                <div className="mb-1.5 flex justify-between gap-3 text-[13.5px]">
                  <span className="min-w-0 truncate font-semibold">
                    {t.nombre}
                  </span>
                  <span className="shrink-0 text-ink/50">
                    {t.unidades} u · {formatARS(t.ingreso)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${(t.ingreso / maxIngreso) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            {data.top.length === 0 && (
              <div className="text-[13px] text-ink/45">
                Sin ventas en este período.
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: string | null;
}) {
  const positivo = delta?.startsWith("+");
  return (
    <Card>
      <div className="mb-2 text-[12.5px] text-ink/50">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[22px] font-bold">{value}</span>
        {delta && (
          <span
            className={cx(
              "text-[12px] font-semibold",
              positivo ? "text-ok" : "text-danger",
            )}
          >
            {delta}
          </span>
        )}
      </div>
      {delta && (
        <div className="mt-0.5 text-[11px] text-ink/40">
          vs. período anterior
        </div>
      )}
    </Card>
  );
}
