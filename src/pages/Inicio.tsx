import { Link } from "react-router-dom";
import { Card, Dot, EmptyHint, PageHeader } from "@/components/ui";
import { useApi } from "@/lib/api";
import { formatARS, hoyLargo, saludo } from "@/lib/format";

interface InicioData {
  ventas_hoy: number;
  pedidos_hoy: number;
  ventas_semana: number;
  publicaciones_activas: number;
  publicaciones_pausadas: number;
  ultimos_pedidos: Array<{
    id: string;
    fecha: string;
    total: number | null;
    comprador: string | null;
    estado: string | null;
  }>;
  alertas: Array<{
    tono: "ok" | "warn" | "danger" | "info";
    titulo: string;
    texto: string;
  }>;
}

export function Inicio() {
  const { data, error, loading } = useApi<InicioData>("/inicio");

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

      <section className="quick-start" aria-label="Accesos rápidos">
        <div><span className="eyebrow">TU TIENDA, EN ORDEN</span><h2>¿Qué necesitás hacer hoy?</h2><p>Elegí una tarea para empezar.</p></div>
        <div className="quick-links">{[
          ["/pedidos", "01", "Preparar pedidos", "Revisá los próximos despachos"],
          ["/publicaciones", "02", "Gestionar publicaciones", "Fotos, colores y precios"],
          ["/stock", "03", "Organizar producción", "Qué tenés y qué falta producir"],
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
            {data.alertas.map((a, i) => (
              <div
                key={i}
                className="flex items-center gap-3.5 rounded-[12px] border bg-surface p-4 hairline"
              >
                <Dot tono={a.tono} />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold">{a.titulo}</div>
                  <div className="mt-0.5 text-[13.5px] text-ink/55">
                    {a.texto}
                  </div>
                </div>
              </div>
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
