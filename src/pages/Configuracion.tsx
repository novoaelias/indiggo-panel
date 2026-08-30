import { useState } from "react";
import {
  Card,
  EmptyHint,
  GhostButton,
  PageHeader,
  PrimaryButton,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";

interface Integrante {
  id: string;
  nombre: string;
  activo: boolean;
}
interface Grupo {
  id: string;
  nombre: string;
  integrantes: Integrante[];
}
type Status = Record<"mercadolibre" | "supabase" | "claude" | "kie", boolean>;

export function Configuracion() {
  return (
    <div>
      <PageHeader
        titulo="Configuración"
        subtitulo="Catálogo base, grupos de kpop e integrantes, conexiones"
      />
      <div className="flex flex-col gap-8">
        <GruposSection />
        <ConexionesSection />
      </div>
    </div>
  );
}

function GruposSection() {
  const { data, error, loading, reload } = useApi<{ grupos: Grupo[] }>(
    "/catalogo/grupos",
  );
  const [creando, setCreando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [integrantes, setIntegrantes] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [errForm, setErrForm] = useState<string>();

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setErrForm(undefined);
    try {
      await api("/catalogo/grupos", {
        method: "POST",
        body: JSON.stringify({
          nombre,
          integrantes: integrantes
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      setNombre("");
      setIntegrantes("");
      setCreando(false);
      reload();
    } catch (err) {
      setErrForm((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section>
      <div className="mb-3.5 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Grupos e integrantes</h2>
        {!creando && (
          <GhostButton onClick={() => setCreando(true)}>+ Grupo</GhostButton>
        )}
      </div>
      <p className="mb-4 max-w-prose text-[13.5px] text-ink/55">
        Cada holder se publica en Mercado Libre con una variante por integrante.
        Estos grupos alimentan esas variantes y el stock de photocards.
      </p>

      {creando && (
        <Card className="mb-4">
          <form onSubmit={crear} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] text-ink/50">Nombre del grupo</span>
              <input
                autoFocus
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="BTS"
                className="rounded-lg border border-ink/12 px-3 py-2.5 text-[13.5px] outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] text-ink/50">
                Integrantes (separados por coma)
              </span>
              <input
                value={integrantes}
                onChange={(e) => setIntegrantes(e.target.value)}
                placeholder="RM, Jin, SUGA, j-hope, Jimin, V, Jung Kook"
                className="rounded-lg border border-ink/12 px-3 py-2.5 text-[13.5px] outline-none focus:border-accent"
              />
            </label>
            {errForm && (
              <div className="text-[12.5px] text-danger">{errForm}</div>
            )}
            <div className="flex gap-2.5">
              <PrimaryButton>
                {guardando ? "Guardando…" : "Crear grupo"}
              </PrimaryButton>
              <GhostButton onClick={() => setCreando(false)}>
                Cancelar
              </GhostButton>
            </div>
          </form>
        </Card>
      )}

      {loading && <EmptyHint>Cargando grupos…</EmptyHint>}
      {error && (
        <EmptyHint>
          No se pudieron cargar los grupos: {error}
          <div className="mt-2">
            <GhostButton onClick={reload}>Reintentar</GhostButton>
          </div>
        </EmptyHint>
      )}
      {data && data.grupos.length === 0 && !creando && (
        <EmptyHint>
          Todavía no cargaste ningún grupo. Empezá con “+ Grupo”.
        </EmptyHint>
      )}

      {data && data.grupos.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.grupos.map((g) => (
            <GrupoCard key={g.id} grupo={g} onChange={reload} />
          ))}
        </div>
      )}
    </section>
  );
}

function GrupoCard({
  grupo,
  onChange,
}: {
  grupo: Grupo;
  onChange: () => void;
}) {
  const [nuevo, setNuevo] = useState("");
  const [busy, setBusy] = useState(false);

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    if (!nuevo.trim()) return;
    setBusy(true);
    try {
      await api(`/catalogo/grupos/${grupo.id}/integrantes`, {
        method: "POST",
        body: JSON.stringify({ nombre: nuevo.trim() }),
      });
      setNuevo("");
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function quitar(id: string) {
    await api(`/catalogo/integrantes/${id}`, { method: "DELETE" });
    onChange();
  }

  return (
    <Card>
      <div className="mb-2 text-[14px] font-semibold">{grupo.nombre}</div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {grupo.integrantes.map((m) => (
          <button
            key={m.id}
            onClick={() => quitar(m.id)}
            title="Quitar"
            className="group rounded-full bg-ink/[0.05] px-2.5 py-1 text-[12px] text-ink/70 hover:bg-danger-bg hover:text-danger"
          >
            {m.nombre}
            <span className="ml-1 opacity-0 group-hover:opacity-100">×</span>
          </button>
        ))}
        {grupo.integrantes.length === 0 && (
          <span className="text-[12px] text-ink/40">Sin integrantes</span>
        )}
      </div>
      <form onSubmit={agregar} className="flex gap-1.5">
        <input
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          placeholder="Agregar integrante"
          className="min-w-0 flex-1 rounded-lg border border-ink/12 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent"
        />
        <button
          disabled={busy}
          className="shrink-0 rounded-lg bg-accent-soft px-2.5 py-1.5 text-[12.5px] font-semibold text-accent disabled:opacity-50"
        >
          +
        </button>
      </form>
    </Card>
  );
}

function ConexionesSection() {
  const { data, loading } = useApi<Status>("/status");
  const filas: Array<{ key: keyof Status; nombre: string; detalle: string }> = [
    { key: "mercadolibre", nombre: "Mercado Libre", detalle: "OAuth2 · site MLA" },
    { key: "supabase", nombre: "Supabase", detalle: "Base de datos del panel" },
    { key: "claude", nombre: "Claude API", detalle: "Generación de textos y análisis" },
    { key: "kie", nombre: "kie.ai", detalle: "Generación de imágenes y video" },
  ];

  return (
    <section>
      <h2 className="mb-3.5 text-[15px] font-semibold">Conexiones</h2>
      <div className="flex flex-col gap-2.5">
        {filas.map((f) => {
          const ok = data?.[f.key];
          return (
            <div
              key={f.key}
              className="flex items-center justify-between rounded-[12px] border bg-surface px-4 py-3.5 hairline"
            >
              <div>
                <div className="text-[14px] font-semibold">{f.nombre}</div>
                <div className="mt-0.5 text-[12.5px] text-ink/50">
                  {f.detalle}
                </div>
              </div>
              <span
                className={
                  "rounded-full px-2.5 py-1 text-[12px] font-semibold " +
                  (loading
                    ? "bg-ink/[0.06] text-ink/45"
                    : ok
                      ? "bg-ok-bg text-ok"
                      : "bg-ink/[0.06] text-ink/55")
                }
              >
                {loading ? "…" : ok ? "Clave cargada" : "Sin configurar"}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[12px] text-ink/45">
        “Clave cargada” sólo indica que el secreto está presente en el servidor,
        no que la conexión esté probada.
      </p>
    </section>
  );
}
