import { useMemo, useState, type ReactNode } from "react";
import {
  Badge,
  Card,
  GhostButton,
  PageHeader,
  PrimaryButton,
  cx,
} from "@/components/ui";
import { publicaciones } from "@/data/mock";
import { formatARS } from "@/lib/format";
import type { EstadoPublicacion, EstadoTono } from "@/lib/types";

const FILTROS: Array<{ key: "todas" | EstadoPublicacion; label: string }> = [
  { key: "todas", label: "Todas" },
  { key: "activa", label: "Activas" },
  { key: "pausada", label: "Pausadas" },
  { key: "borrador", label: "Borradores" },
];

const badgeTono: Record<EstadoPublicacion, EstadoTono> = {
  activa: "ok",
  pausada: "warn",
  borrador: "neutral",
};

const estadoLabel: Record<EstadoPublicacion, string> = {
  activa: "Activa",
  pausada: "Pausada",
  borrador: "Borrador",
};

export function Publicaciones() {
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]["key"]>("todas");

  const conteo = useMemo(() => {
    const c = { activa: 0, pausada: 0, borrador: 0 };
    for (const p of publicaciones) c[p.estado]++;
    return c;
  }, []);

  const lista = publicaciones.filter(
    (p) => filtro === "todas" || p.estado === filtro,
  );

  return (
    <div>
      <PageHeader
        titulo="Publicaciones"
        subtitulo={`${conteo.activa} activas · ${conteo.pausada} pausadas · ${conteo.borrador} borradores`}
        acciones={
          <>
            <GhostButton>Editar precios en lote</GhostButton>
            <PrimaryButton>+ Crear con IA</PrimaryButton>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap gap-1.5">
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
          </button>
        ))}
      </div>

      <Card padding={false} className="mb-8 overflow-hidden">
        {lista.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-4 border-b hairline px-4 py-3.5 last:border-b-0"
          >
            <div className="h-11 w-11 shrink-0 rounded-lg bg-[repeating-linear-gradient(45deg,rgba(16,24,32,0.07)_0_6px,rgba(16,24,32,0.02)_6px_12px)]" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold">
                {p.titulo}
              </div>
              <div className="mt-0.5 text-[12.5px] text-ink/50">
                Stock ML: {p.stockMl}
              </div>
            </div>
            <div className="w-20 shrink-0 text-right text-[14px] font-bold sm:text-left">
              {formatARS(p.precio)}
            </div>
            <div className="hidden sm:block">
              <Badge tono={badgeTono[p.estado]}>{estadoLabel[p.estado]}</Badge>
            </div>
            <button className="shrink-0 text-[13px] font-semibold text-accent hover:text-accent-hover">
              Editar
            </button>
          </div>
        ))}
        {lista.length === 0 && (
          <div className="px-4 py-8 text-center text-[13.5px] text-ink/45">
            No hay publicaciones con este filtro.
          </div>
        )}
      </Card>

      <h2 className="mb-3.5 text-[15px] font-semibold">
        Crear publicación con IA
      </h2>
      <Card className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-3.5">
          <Field label="Título (generado por IA)">
            Holder acrílico Jimin — ver. 2 edición coleccionista
          </Field>
          <Field label="Descripción" multiline>
            Holder impreso en 3D para tus photocards favoritas, con acabado mate y
            detalle en violeta…
          </Field>
          <button className="text-left text-[13px] font-semibold text-accent hover:text-accent-hover">
            ↻ Regenerar con IA
          </button>
        </div>
        <div>
          <div className="mb-1.5 text-[12.5px] text-ink/50">Imágenes</div>
          <div className="grid grid-cols-3 gap-2">
            {["foto 1", "foto 2", "generada IA"].map((t) => (
              <div
                key={t}
                className="flex aspect-square items-center justify-center rounded-lg bg-[repeating-linear-gradient(45deg,rgba(16,24,32,0.07)_0_6px,rgba(16,24,32,0.02)_6px_12px)] p-1.5 text-center font-mono text-[9px] text-ink/40"
              >
                {t}
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

function Field({
  label,
  children,
  multiline,
}: {
  label: string;
  children: ReactNode;
  multiline?: boolean;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[12.5px] text-ink/50">{label}</div>
      <div
        className={cx(
          "rounded-lg border border-ink/12 px-3 py-2.5 text-[13.5px]",
          multiline ? "min-h-16 text-ink/60" : "",
        )}
      >
        {children}
      </div>
    </div>
  );
}
