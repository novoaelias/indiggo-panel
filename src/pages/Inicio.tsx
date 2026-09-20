import { useState } from "react";
import { Link } from "react-router-dom";
import { AvisoPush } from "@/components/AvisoPush";
import { Card, Dot, EmptyHint, PageHeader } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { formatARS, hoyLargo, saludo } from "@/lib/format";

interface InicioData {
  ventas_hoy: number;
  pedidos_hoy: number;
  ventas_semana: number;
  publicaciones_activas: number;
  publicaciones_pausadas: number;
  preguntas_pendientes: number;
  faltantes_pedidos: number;
  piezas_bajas: number;
  ultimos_pedidos: Array<{
    id: string;
    fecha: string;
    total: number | null;
    comprador: string | null;
    estado: string | null;
  }>;
  alertas: Array<{
    id: string;
    tipo: string;
    tono: "ok" | "warn" | "danger" | "info";
    titulo: string;
    texto: string;
  }>;
}

export function Inicio() {
  const { data, error, loading, reload } = useApi<InicioData>("/inicio");

  const stats = data
    ? [
        { label: "Ventas hoy", value: formatARS(data.ventas_hoy) },
        { label: "Pedidos hoy", value: String(data.pedidos_hoy) },
        { label: "Ventas últimos 7 días", value: formatARS(data.ventas_semana) },
        {
          label: "Publicaciones activas",
          value: String(data.publicaciones_activas),
        },
      ]
    : [];

  return (
    <div>
      <PageHeader
        titulo={saludo()}
        subtitulo={(() => {
          const h = hoyLargo();
          return h.charAt(0).toUpperCase() + h.slice(1);
        })()}
      />

      <AvisoPush />

      <section className="quick-start" aria-label="Accesos rápidos">
        <div><span className="eyebrow">TU TIENDA, EN ORDEN</span><h2>¿Qué necesitás hacer hoy?</h2><p>Elegí una tarea para empezar.</p></div>
        <div className="quick-links">{[
          ["/preguntas", data?.preguntas_pendientes ? String(data.preguntas_pendientes) : "✓", "Responder preguntas", data?.preguntas_pendientes ? "Hay consultas que necesitan atención" : "No hay preguntas pendientes"],
          ["/pedidos", data?.faltantes_pedidos ? String(data.faltantes_pedidos) : "✓", "Preparar pedidos", data?.faltantes_pedidos ? "Faltan productos por completar" : "Los pedidos tienen stock reservado"],
          ["/produccion", data?.piezas_bajas ? String(data.piezas_bajas) : "✓", "Organizar producción", data?.piezas_bajas ? "Hay piezas por reponer" : "Inventario de piezas en orden"],
        ].map(([to, n, title, desc]) => <Link to={to} key={to}><span className="quick-number">{n}</span><strong>{title} <span aria-hidden>↗</span></strong><small>{desc}</small></Link>)}</div>
      </section>
      {loading && <EmptyHint>Cargando resumen…</EmptyHint>}
      {error && <EmptyHint>No se pudo cargar el resumen: {error}</EmptyHint>}

      {data && (
        <>
          <div className="mb-9 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
            {stats.map((s) => (
              <div
                key={s.label}
                className="rounded-[12px] border bg-surface p-5 hairline"
              >
                <div className="mb-2 text-[12.5px] text-ink/50">{s.label}</div>
                <div className="font-display text-[22px] font-bold">
                  {s.value}
                </div>
              </div>
            ))}
          </div>

          <h2 className="mb-3.5 text-[15px] font-semibold">Necesita tu atención</h2>
          {data.alertas.length === 0 && <div className="mb-6 rounded-xl bg-ok-bg p-5 text-ok">Todo al día. No hay alertas pendientes.</div>}
          <div className="mb-9 flex flex-col gap-2.5">
            {data.alertas.map((a) => (
              <AlertaFila key={a.id} alerta={a} onResuelta={reload} />
            ))}
          </div>

          <h2 className="mb-3.5 text-[15px] font-semibold">Últimos pedidos</h2>
          <Card padding={false} className="overflow-hidden">
            {data.ultimos_pedidos.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-4 border-b hairline px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold">
                    {p.comprador ?? "—"}
                  </div>
                  <div className="text-[12px] text-ink/50">
                    {new Date(p.fecha).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}
                  </div>
                </div>
                <div className="text-[13.5px] font-bold">
                  {p.total != null ? formatARS(p.total) : "—"}
                </div>
                <div className="w-20 text-right text-[12px] text-ink/50">
                  {({ paid: "Pagado", cancelled: "Cancelado", confirmed: "Confirmado" } as Record<string, string>)[p.estado ?? ""] ?? p.estado}
                </div>
              </div>
            ))}
            {data.ultimos_pedidos.length === 0 && (
              <div className="px-4 py-6 text-center text-[13px] text-ink/45">
                Sin pedidos todavía.
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function AlertaFila({
  alerta,
  onResuelta,
}: {
  alerta: InicioData["alertas"][number];
  onResuelta: () => void;
}) {
  const [verificando, setVerificando] = useState(false);
  const [motivo, setMotivo] = useState<string>();

  async function resolver() {
    setVerificando(true);
    setMotivo(undefined);
    try {
      const r = await api<{ resuelta: boolean; motivo?: string }>(
        `/alertas/${alerta.id}/resolver`,
        { method: "POST" },
      );
      if (r.resuelta) onResuelta();
      else setMotivo(r.motivo ?? "todavía no se puede descartar");
    } catch (e) {
      setMotivo((e as Error).message);
    } finally {
      setVerificando(false);
    }
  }

  return (
    <div className="flex items-center gap-3.5 rounded-[12px] border bg-surface p-4 hairline">
      <Dot tono={alerta.tono} />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold">{alerta.titulo}</div>
        <div className="mt-0.5 text-[13.5px] text-ink/55">{alerta.texto}</div>
        {motivo && (
          <div className="mt-1 text-[12px] text-warn">
            No se descartó: {motivo}
          </div>
        )}
      </div>
      {alerta.tipo === "venta_stock_manual" && (
        <button
          onClick={resolver}
          disabled={verificando}
          className="shrink-0 rounded-lg border border-ink/12 px-3 py-1.5 text-[12.5px] font-semibold text-ink/60 hover:bg-ink/[0.04] disabled:opacity-50"
          title="Verifica el stock real antes de borrarla"
        >
          {verificando ? "Verificando…" : "Ya lo ajusté"}
        </button>
      )}
    </div>
  );
}
