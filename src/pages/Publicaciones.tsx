import { useMemo, useState } from "react";
import {
  Badge,
  Card,
  EmptyHint,
  GhostButton,
  PageHeader,
  PrimaryButton,
  cx,
} from "@/components/ui";
import { useApi } from "@/lib/api";
import { formatARS } from "@/lib/format";
import type { EstadoTono } from "@/lib/types";

interface PublicacionApi {
  id: string;
  ml_item_id: string;
  titulo: string;
  estado: string;
  precio: number | null;
  moneda: string;
  permalink: string | null;
  thumbnail: string | null;
  variantes: number;
  stock_ml: number;
}
interface Resp {
  publicaciones: PublicacionApi[];
  conteo: Record<string, number>;
}

const ESTADO_META: Record<string, { label: string; tono: EstadoTono }> = {
  active: { label: "Activa", tono: "ok" },
  paused: { label: "Pausada", tono: "warn" },
  under_review: { label: "En revisión", tono: "warn" },
  closed: { label: "Cerrada", tono: "neutral" },
  inactive: { label: "Inactiva", tono: "neutral" },
  payment_required: { label: "Pago pendiente", tono: "danger" },
};

const FILTROS: Array<{ key: string; label: string }> = [
  { key: "todas", label: "Todas" },
  { key: "active", label: "Activas" },
  { key: "under_review", label: "En revisión" },
  { key: "paused", label: "Pausadas" },
];

export function Publicaciones() {
  const [filtro, setFiltro] = useState("todas");
  const [busqueda, setBusqueda] = useState("");
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (filtro !== "todas") p.set("estado", filtro);
    if (busqueda.trim()) p.set("q", busqueda.trim());
    return p.toString();
  }, [filtro, busqueda]);

  const { data, error, loading } = useApi<Resp>(
    `/publicaciones${qs ? `?${qs}` : ""}`,
  );

  return (
    <div>
      <PageHeader
        titulo="Publicaciones"
        subtitulo={
          data
            ? `${data.conteo.todas ?? 0} en total · ${data.conteo.active ?? 0} activas`
            : "Sincronizadas desde Mercado Libre"
        }
        acciones={
          <>
            <GhostButton>Editar precios en lote</GhostButton>
            <PrimaryButton>+ Crear con IA</PrimaryButton>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFiltro(f.key)}
            className={cx(
              "rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors",
              filtro === f.key
                ? "bg-accent-soft text-accent"
                : "text-ink/55 hover:bg-ink/[0.03]",
            )}
          >
            {f.label}
            {data && f.key !== "todas" && data.conteo[f.key] != null && (
              <span className="ml-1.5 text-ink/35">{data.conteo[f.key]}</span>
            )}
          </button>
        ))}
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar…"
          className="ml-auto w-44 rounded-lg border border-ink/12 px-3 py-2 text-[13px] outline-none focus:border-accent"
        />
      </div>

      {loading && <EmptyHint>Cargando publicaciones…</EmptyHint>}
      {error && <EmptyHint>No se pudieron cargar: {error}</EmptyHint>}

      {data && (
        <Card padding={false} className="overflow-hidden">
          {data.publicaciones.map((p) => {
            const meta = ESTADO_META[p.estado] ?? {
              label: p.estado,
              tono: "neutral" as EstadoTono,
            };
            return (
              <div
                key={p.id}
                className="flex items-center gap-4 border-b hairline px-4 py-3 last:border-b-0"
              >
                <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-ink/[0.04]">
                  {p.thumbnail && (
                    <img
                      src={p.thumbnail}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">
                    {p.titulo}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-ink/50">
                    Stock ML: {p.stock_ml}
                    {p.variantes > 0 && ` · ${p.variantes} variantes`}
                  </div>
                </div>
                <div className="hidden w-24 shrink-0 text-right text-[14px] font-bold sm:block">
                  {p.precio != null ? formatARS(p.precio) : "—"}
                </div>
                <div className="hidden sm:block">
                  <Badge tono={meta.tono}>{meta.label}</Badge>
                </div>
                <a
                  href={p.permalink ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-[13px] font-semibold text-accent hover:text-accent-hover"
                >
                  Ver
                </a>
              </div>
            );
          })}
          {data.publicaciones.length === 0 && (
            <div className="px-4 py-8 text-center text-[13.5px] text-ink/45">
              No hay publicaciones con este filtro.
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
