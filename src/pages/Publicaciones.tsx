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
import { api, useApi } from "@/lib/api";
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

  const { data, error, loading, reload } = useApi<Resp>(
    `/publicaciones${qs ? `?${qs}` : ""}`,
  );
  const [iaPara, setIaPara] = useState<PublicacionApi | null>(null);

  return (
    <div>
      {iaPara && (
        <SugerenciaModal
          publicacion={iaPara}
          onClose={() => setIaPara(null)}
          onAplicado={() => {
            setIaPara(null);
            reload();
          }}
        />
      )}
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
                <button
                  onClick={() => setIaPara(p)}
                  className="shrink-0 text-[13px] font-semibold text-accent hover:text-accent-hover"
                >
                  IA
                </button>
                <a
                  href={p.permalink ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="hidden shrink-0 text-[13px] font-semibold text-ink/45 hover:text-ink sm:block"
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

interface Sugerencia {
  titulo: string;
  descripcion: string;
  palabras_clave: string[];
  notas: string;
}

function SugerenciaModal({
  publicacion,
  onClose,
  onAplicado,
}: {
  publicacion: PublicacionApi;
  onClose: () => void;
  onAplicado: () => void;
}) {
  const [objetivo, setObjetivo] = useState("");
  const [cargando, setCargando] = useState(false);
  const [sug, setSug] = useState<Sugerencia>();
  const [err, setErr] = useState<string>();
  const [copiado, setCopiado] = useState<string>();
  const [aplicando, setAplicando] = useState(false);

  async function aplicar() {
    if (!sug) return;
    if (
      !window.confirm(
        "Se va a cambiar el título y la descripción de esta publicación en Mercado Libre. ¿Confirmás?",
      )
    )
      return;
    setAplicando(true);
    setErr(undefined);
    try {
      const r = await api<{ aplicado: string[]; errores: string[] }>(
        `/ia/publicacion/${publicacion.id}/aplicar`,
        {
          method: "POST",
          body: JSON.stringify({
            titulo: sug.titulo,
            descripcion: sug.descripcion,
          }),
        },
      );
      if (r.errores.length && !r.aplicado.length) {
        setErr(r.errores.join(" · "));
      } else {
        onAplicado();
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAplicando(false);
    }
  }

  async function generar() {
    setCargando(true);
    setErr(undefined);
    try {
      const r = await api<{ sugerencia: Sugerencia }>(
        `/ia/publicacion/${publicacion.id}`,
        {
          method: "POST",
          body: JSON.stringify({ objetivo: objetivo.trim() || undefined }),
        },
      );
      setSug(r.sugerencia);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  function copiar(texto: string, que: string) {
    navigator.clipboard?.writeText(texto);
    setCopiado(que);
    setTimeout(() => setCopiado(undefined), 1500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 sm:p-8">
      <div className="w-full max-w-2xl rounded-[14px] border bg-surface p-6 hairline">
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 className="text-[16px] font-semibold">Reescribir con IA</h2>
          <button
            onClick={onClose}
            className="text-[18px] font-bold text-ink/40 hover:text-ink"
          >
            ×
          </button>
        </div>
        <p className="mb-4 text-[12.5px] text-ink/50">{publicacion.titulo}</p>

        <label className="mb-3 flex flex-col gap-1.5">
          <span className="text-[12.5px] text-ink/50">
            Qué querés lograr (opcional)
          </span>
          <input
            value={objetivo}
            onChange={(e) => setObjetivo(e.target.value)}
            placeholder="ej: resaltar que es impreso en 3D, apuntar a regalo"
            className="rounded-lg border border-ink/12 px-3 py-2.5 text-[13.5px] outline-none focus:border-accent"
          />
        </label>

        <PrimaryButton onClick={generar}>
          {cargando ? "Generando…" : sug ? "Regenerar" : "Generar sugerencia"}
        </PrimaryButton>

        {err && <div className="mt-3 text-[12.5px] text-danger">{err}</div>}

        {sug && (
          <div className="mt-5 flex flex-col gap-4">
            <Campo
              titulo={`Título (${sug.titulo.length}/60)`}
              onCopiar={() => copiar(sug.titulo, "titulo")}
              copiado={copiado === "titulo"}
            >
              {sug.titulo}
            </Campo>
            <Campo
              titulo="Descripción"
              onCopiar={() => copiar(sug.descripcion, "desc")}
              copiado={copiado === "desc"}
            >
              <pre className="whitespace-pre-wrap font-sans">
                {sug.descripcion}
              </pre>
            </Campo>
            {sug.palabras_clave?.length > 0 && (
              <div>
                <div className="mb-1.5 text-[12.5px] text-ink/50">
                  Palabras clave
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {sug.palabras_clave.map((k) => (
                    <span
                      key={k}
                      className="rounded-full bg-ink/[0.05] px-2.5 py-1 text-[12px] text-ink/70"
                    >
                      {k}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {sug.notas && (
              <div className="rounded-lg bg-accent-soft px-3 py-2 text-[12.5px] text-accent">
                {sug.notas}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 border-t hairline pt-4">
              <button
                onClick={aplicar}
                disabled={aplicando}
                className="rounded-[9px] bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {aplicando ? "Aplicando…" : "Aplicar a Mercado Libre"}
              </button>
              <span className="text-[11.5px] text-ink/40">
                Cambia título y descripción en la publicación real.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Campo({
  titulo,
  children,
  onCopiar,
  copiado,
}: {
  titulo: string;
  children: React.ReactNode;
  onCopiar: () => void;
  copiado: boolean;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12.5px] text-ink/50">{titulo}</span>
        <button
          onClick={onCopiar}
          className="text-[12px] font-semibold text-accent hover:text-accent-hover"
        >
          {copiado ? "copiado ✓" : "copiar"}
        </button>
      </div>
      <div className="rounded-lg border border-ink/12 px-3 py-2.5 text-[13.5px]">
        {children}
      </div>
    </div>
  );
}
