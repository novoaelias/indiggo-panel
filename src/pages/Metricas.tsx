import { useState } from "react";
import { Card, EmptyHint, PageHeader, cx } from "@/components/ui";
import { useApi } from "@/lib/api";
import { formatARS } from "@/lib/format";

interface MetricasData {
  dias: number;
  ventas_totales: number;
  ventas_netas: number;
  comisiones: number;
  impuestos: number;
  envios: number;
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

function delta(actual: number, prev: number): string | null {
  if (!prev) return null;
  const pct = Math.round(((actual - prev) / prev) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

const DIA_CORTO = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** Lo que se lleva Mercado Libre, en una línea: sólo lo que no es cero. */
function desgloseCostos(d: MetricasData): string {
  const partes = [
    ["Comisión", d.comisiones],
    ["Retenciones", d.impuestos],
    ["Envíos", d.envios],
  ] as const;
  const visibles = partes.filter(([, monto]) => monto > 0);
  if (!visibles.length) return "Sin cargos en este período";
  return visibles.map(([nombre, monto]) => `${nombre} ${formatARS(monto)}`).join(" · ");
}

function notaNeto(d: MetricasData): string {
  const pct = d.ventas_totales
    ? Math.round((d.ventas_netas / d.ventas_totales) * 100)
    : 0;
  const base = `${pct}% de lo vendido`;
  if (!d.pedidos_estimados) return base;
  return `${base} · ${d.pedidos_estimados} ${
    d.pedidos_estimados === 1 ? "pedido estimado" : "pedidos estimados"
  } (ML todavía no liquidó)`;
}

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
          <div className="mb-6 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Ventas brutas"
              value={formatARS(data.ventas_totales)}
              delta={delta(data.ventas_totales, data.ventas_prev)}
            />
            <Kpi
              label="Te queda (neto)"
              value={formatARS(data.ventas_netas)}
              delta={delta(data.ventas_netas, data.ventas_netas_prev)}
              nota={notaNeto(data)}
            />
            <Kpi
              label="Costos de Mercado Libre"
              value={formatARS(data.comisiones + data.impuestos + data.envios)}
              nota={desgloseCostos(data)}
            />
            <Kpi
              label="Pedidos"
              value={String(data.pedidos)}
              delta={delta(data.pedidos, data.pedidos_prev)}
              nota={`Ticket promedio ${formatARS(data.ticket_promedio)}`}
            />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <Kpi
              label="Cobertura de stock"
              value={
                data.inventario.cobertura_dias == null
                  ? "—"
                  : `${data.inventario.cobertura_dias} días`
              }
              nota={
                data.inventario.variantes_bajo_cobertura
                  ? `${data.inventario.variantes_bajo_cobertura} variantes por debajo de 7 días`
                  : "Ninguna variante por debajo de 7 días"
              }
            />
            <Kpi
              label="Unidades faltantes"
              value={String(data.inventario.unidades_faltantes)}
              nota="Comprometidas con pedidos y todavía sin armar"
            />
            <Kpi
              label="Variantes sin stock libre"
              value={String(data.inventario.variantes_sin_libres)}
            />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-3.5 sm:grid-cols-4">
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
          </div>

          <Card className="mb-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[14px] font-semibold">Ventas por día</div>
              <div className="flex gap-3.5 text-[11.5px] text-ink/50">
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-[3px] bg-accent" />
                  Neto
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-[3px] bg-accent/30" />
                  Costos de ML
                </span>
              </div>
            </div>
            <div className="flex h-40 items-end gap-1.5 overflow-x-auto">
              {data.por_dia.map((d) => {
                const dow = new Date(d.dia + "T12:00:00").getDay();
                return (
                  <div
                    key={d.dia}
                    title={`${d.dia}: ${formatARS(d.monto)} bruto · ${formatARS(d.neto)} neto · ${d.pedidos} pedidos`}
                    className="flex h-full min-w-[24px] flex-1 flex-col items-center justify-end gap-2"
                  >
                    {/* La barra entera es el bruto; la parte llena, lo que queda. */}
                    <div
                      className="flex w-full max-w-[26px] flex-col justify-end overflow-hidden rounded-t-[4px] bg-accent/30"
                      style={{
                        height: `${Math.max((d.monto / maxDia) * 100, d.monto > 0 ? 4 : 0)}%`,
                      }}
                    >
                      <div
                        className="w-full bg-accent"
                        style={{
                          height: `${d.monto > 0 ? Math.min(100, Math.max(0, (d.neto / d.monto) * 100)) : 0}%`,
                        }}
                      />
                    </div>
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
  nota,
}: {
  label: string;
  value: string;
  delta?: string | null;
  nota?: string;
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
      {nota && <div className="mt-0.5 text-[11px] text-ink/40">{nota}</div>}
    </Card>
  );
}
