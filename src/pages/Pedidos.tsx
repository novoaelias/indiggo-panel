import { useMemo, useState } from "react";
import { Badge, Card, EmptyHint, PageHeader, cx } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { formatARS } from "@/lib/format";

interface Paquete {
  key: string;
  comprador: string | null;
  fecha: string;
  total: number;
  items: Array<{
    id: string;
    titulo: string;
    cantidad: number;
    reservado: number;
    faltante: number;
    mapeado: boolean;
    opciones: Array<{ id: string; etiqueta: string }>;
  }>;
  faltantes: number;
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

/** Registrar la variante que eligió el comprador, sin salir del pedido. */
function ElegirVariante({
  item,
  onListo,
}: {
  item: { id: string; opciones: Array<{ id: string; etiqueta: string }> };
  onListo: () => void;
}) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string>();
  if (!item.opciones.length)
    return <span className="ml-1 text-warn">(elegir variante)</span>;
  return (
    <span className="ml-1 inline-flex items-center gap-1 align-middle">
      <select
        className="rounded-md border hairline bg-surface px-1.5 py-0.5 text-[11.5px]"
        defaultValue=""
        disabled={guardando}
        onChange={async (e) => {
          const variante = e.target.value;
          if (!variante) return;
          setGuardando(true);
          setError(undefined);
          try {
            await api(`/pedidos/items/${item.id}/variante`, {
              method: "POST",
              body: JSON.stringify({ product_variant_id: variante }),
            });
            onListo();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setGuardando(false);
          }
        }}
      >
        <option value="">Elegir variante…</option>
        {item.opciones.map((o) => (
          <option key={o.id} value={o.id}>
            {o.etiqueta}
          </option>
        ))}
      </select>
      {error && <span className="text-danger">{error}</span>}
    </span>
  );
}

export function Pedidos() {
  const { data, error, loading, reload } = useApi<PedidosResp>("/pedidos-activos");

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
                      {p.items.map((it) => (
                        <span key={it.id} className="mr-2 inline-block">
                          {it.cantidad > 1 ? `${it.cantidad}× ` : ""}{it.titulo}
                          {!it.mapeado && (
                            <ElegirVariante item={it} onListo={reload} />
                          )}
                          {it.faltante > 0 && <span className="ml-1 text-danger">(falta {it.faltante})</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                  {p.faltantes > 0 ? (
                    <Badge tono="danger">Completar {p.faltantes}</Badge>
                  ) : (
                    <Badge tono="ok">Stock reservado</Badge>
                  )}
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
