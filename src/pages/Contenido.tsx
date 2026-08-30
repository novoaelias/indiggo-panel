import { useState } from "react";
import { Card, EmptyHint, PageHeader } from "@/components/ui";
import { api, useApi } from "@/lib/api";

interface Pieza {
  id: string;
  plataforma: string;
  formato: string;
  caption: string | null;
  hashtags: string | null;
  media_url: string | null;
  created_at: string;
}
interface Producto {
  id: string;
  nombre: string;
}

export function Contenido() {
  const piezas = useApi<{ piezas: Pieza[] }>("/contenido");
  const productos = useApi<{ productos: Producto[] }>("/catalogo/productos");
  const [abierto, setAbierto] = useState(false);

  return (
    <div>
      <PageHeader
        titulo="Contenido para redes"
        subtitulo="Imágenes y textos para Instagram y TikTok, generados con IA"
        acciones={
          <button
            onClick={() => setAbierto(true)}
            className="rounded-[9px] bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white hover:bg-accent-hover"
          >
            + Generar contenido
          </button>
        }
      />

      {abierto && (
        <GenerarModal
          productos={productos.data?.productos ?? []}
          onClose={() => setAbierto(false)}
          onListo={() => {
            setAbierto(false);
            piezas.reload();
          }}
        />
      )}

      {piezas.loading && <EmptyHint>Cargando…</EmptyHint>}
      {piezas.error && <EmptyHint>No se pudo cargar: {piezas.error}</EmptyHint>}
      {piezas.data && piezas.data.piezas.length === 0 && (
        <EmptyHint>
          Todavía no generaste contenido. Tocá “+ Generar contenido”.
        </EmptyHint>
      )}

      {piezas.data && piezas.data.piezas.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {piezas.data.piezas.map((p) => (
            <PiezaCard key={p.id} pieza={p} onBorrar={() => piezas.reload()} />
          ))}
        </div>
      )}
    </div>
  );
}

function PiezaCard({
  pieza,
  onBorrar,
}: {
  pieza: Pieza;
  onBorrar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const textoCompleto = `${pieza.caption ?? ""}\n\n${pieza.hashtags ?? ""}`.trim();

  return (
    <Card padding={false} className="overflow-hidden">
      {pieza.media_url ? (
        <img
          src={pieza.media_url}
          alt=""
          className="aspect-[4/5] w-full bg-ink/[0.04] object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex aspect-[4/5] items-center justify-center bg-ink/[0.04] text-[12px] text-ink/40">
          sin imagen
        </div>
      )}
      <div className="p-4">
        <span className="inline-block rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-bold capitalize text-accent">
          {pieza.plataforma}
        </span>
        <p className="my-2.5 whitespace-pre-wrap text-[13px] leading-snug">
          {pieza.caption}
        </p>
        <p className="text-[12px] text-accent">{pieza.hashtags}</p>
        <div className="mt-3 flex items-center gap-3 border-t hairline pt-3">
          <button
            onClick={() => {
              navigator.clipboard?.writeText(textoCompleto);
              setCopiado(true);
              setTimeout(() => setCopiado(false), 1500);
            }}
            className="text-[12px] font-semibold text-accent hover:text-accent-hover"
          >
            {copiado ? "copiado ✓" : "copiar texto"}
          </button>
          {pieza.media_url && (
            <a
              href={pieza.media_url}
              target="_blank"
              rel="noreferrer"
              className="text-[12px] font-semibold text-ink/45 hover:text-ink"
            >
              abrir imagen
            </a>
          )}
          <button
            onClick={async () => {
              if (!window.confirm("¿Borrar esta pieza?")) return;
              await api(`/contenido/${pieza.id}`, { method: "DELETE" });
              onBorrar();
            }}
            className="ml-auto text-[12px] font-semibold text-ink/40 hover:text-danger"
          >
            borrar
          </button>
        </div>
      </div>
    </Card>
  );
}

function GenerarModal({
  productos,
  onClose,
  onListo,
}: {
  productos: Producto[];
  onClose: () => void;
  onListo: () => void;
}) {
  const [productoId, setProductoId] = useState("");
  const [plataforma, setPlataforma] = useState<"instagram" | "tiktok">(
    "instagram",
  );
  const [objetivo, setObjetivo] = useState("");
  const [generando, setGenerando] = useState(false);
  const [err, setErr] = useState<string>();

  async function generar(e: React.FormEvent) {
    e.preventDefault();
    setGenerando(true);
    setErr(undefined);
    try {
      await api("/contenido/generar", {
        method: "POST",
        body: JSON.stringify({
          producto_id: productoId || undefined,
          plataforma,
          objetivo: objetivo.trim() || undefined,
        }),
      });
      onListo();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setGenerando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 sm:p-8">
      <form
        onSubmit={generar}
        className="w-full max-w-md rounded-[14px] border bg-surface p-6 hairline"
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-[16px] font-semibold">Generar contenido</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[18px] font-bold text-ink/40 hover:text-ink"
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] text-ink/50">Producto (opcional)</span>
            <select
              value={productoId}
              onChange={(e) => setProductoId(e.target.value)}
              className="rounded-lg border border-ink/12 px-3 py-2.5 text-[13.5px] outline-none focus:border-accent"
            >
              <option value="">— Genérico —</option>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </label>

          <div className="flex gap-2">
            {(["instagram", "tiktok"] as const).map((pl) => (
              <button
                key={pl}
                type="button"
                onClick={() => setPlataforma(pl)}
                className={
                  "flex-1 rounded-lg px-3 py-2 text-[13px] font-semibold capitalize " +
                  (plataforma === pl
                    ? "bg-accent-soft text-accent"
                    : "border border-ink/12 text-ink/55")
                }
              >
                {pl}
              </button>
            ))}
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] text-ink/50">Idea / objetivo (opcional)</span>
            <input
              value={objetivo}
              onChange={(e) => setObjetivo(e.target.value)}
              placeholder="ej: promo de fin de semana, mostrar el detalle 3D"
              className="rounded-lg border border-ink/12 px-3 py-2.5 text-[13.5px] outline-none focus:border-accent"
            />
          </label>

          {err && <div className="text-[12.5px] text-danger">{err}</div>}

          <button
            disabled={generando}
            className="mt-1 rounded-[9px] bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {generando ? "Generando… (puede tardar ~30 s)" : "Generar"}
          </button>
          <p className="text-[11.5px] text-ink/40">
            Genera la imagen con kie.ai y el texto con Claude. Revisá antes de
            publicar.
          </p>
        </div>
      </form>
    </div>
  );
}
