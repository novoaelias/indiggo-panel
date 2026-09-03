import { useMemo } from "react";
import { Badge, Card, EmptyHint, PageHeader, cx } from "@/components/ui";
import { useApi } from "@/lib/api";
import { formatARS } from "@/lib/format";

interface Paquete {
  key: string;
  comprador: string | null;
  fecha: string;
  total: number;
  items: Array<{ titulo: string; cantidad: number }>;
  estado_envio: string | null;
  envio_substatus: string | null;
  etiqueta_logistica: string;
  a_imprimir: boolean;
}
interface PedidosResp {
  paquetes: Paquete[];
  conteos: Record<string, number>;
  total: number;
}

const ORDEN = ["Flex", "Mercado Envíos", "Full", "Otro"];

const ENVIO_LABEL: Record<string, string> = {
  pending: "Pendiente",
  handling: "En preparación",
  ready_to_ship: "Listo para despachar",
  shipped: "Despachado",
  delivered: "Entregado",
};

function haceCuanto(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "recién";
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}

export function Pedidos() {
  const { data, error, loading } = useApi<PedidosResp>("/pedidos-activos");

  const grupos = useMemo(() => {
    if (!data) return [];
    const m = new Map<string, Paquete[]>();
    for (const p of data.paquetes) {
      if (!m.has(p.etiqueta_logistica)) m.set(p.etiqueta_logistica, []);
      m.get(p.etiqueta_logistica)!.push(p);
    }
    return [...m.entries()].sort(
      (a, b) => ORDEN.indexOf(a[0]) - ORDEN.indexOf(b[0]),
    );
  }, [data]);

  return (
    <div>
      <PageHeader
        titulo="Pedidos"
        subtitulo={
          data
            ? data.total === 0
              ? "Nada pendiente de despacho"
              : `${data.total} ${data.total === 1 ? "paquete" : "paquetes"} sin despachar`
            : "Pagados y sin despachar"
        }
      />

      {loading && <EmptyHint>Cargando pedidos…</EmptyHint>}
      {error && <EmptyHint>No se pudo cargar: {error}</EmptyHint>}
      {data && data.total === 0 && (
        <EmptyHint>Todo despachado. 🎉</EmptyHint>
      )}

      <div className="flex flex-col gap-7">
        {grupos.map(([etiqueta, paquetes]) => (
          <div key={etiqueta}>
            <div className="mb-3 flex items-center gap-2.5">
              <h2 className="text-[15px] font-semibold">{etiqueta}</h2>
              <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-[11.5px] font-bold text-ink/55">
                {paquetes.length}
              </span>
            </div>
            <Card padding={false} className="overflow-hidden">
              {paquetes.map((p) => (
                <div
                  key={p.key}
                  className="flex flex-col gap-1.5 border-b hairline px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-semibold">
                        {p.comprador ?? "—"}
                      </span>
                      <span className="text-[11.5px] text-ink/40">
                        {haceCuanto(p.fecha)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-ink/55 [overflow-wrap:anywhere]">
                      {p.items
                        .map((it) =>
                          it.cantidad > 1
                            ? `${it.cantidad}× ${it.titulo}`
                            : it.titulo,
                        )
                        .join(" · ") || "—"}
                    </div>
                  </div>
                  {p.a_imprimir ? (
                    <Badge tono="warn">Imprimir etiqueta</Badge>
                  ) : (
                    <span
                      className={cx(
                        "shrink-0 text-[11.5px]",
                        p.estado_envio === "ready_to_ship"
                          ? "text-ok"
                          : "text-ink/45",
                      )}
                    >
                      {ENVIO_LABEL[p.estado_envio ?? ""] ??
                        p.estado_envio ??
                        "Sin datos de envío"}
                    </span>
                  )}
                  <div className="shrink-0 text-[13.5px] font-bold tabular-nums">
                    {formatARS(p.total)}
                  </div>
                </div>
              ))}
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}
