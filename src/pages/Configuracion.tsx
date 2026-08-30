import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
        <MercadoLibreSection />
        <GruposSection />
        <ConexionesSection />
      </div>
    </div>
  );
}

interface MlEstado {
  conectado: boolean;
  vendedor?: string | null;
  ultimo_sync?: string | null;
  token_vence?: string | null;
  publicaciones?: number;
  variantes?: number;
  pedidos?: number;
}

function MercadoLibreSection() {
  const { data, loading, reload } = useApi<MlEstado>("/ml/estado");
  const [params, setParams] = useSearchParams();
  const aviso = params.get("ml");
  const [sincronizando, setSincronizando] = useState(false);
  const [resultado, setResultado] = useState<string>();

  async function sincronizar() {
    setSincronizando(true);
    setResultado(undefined);
    try {
      const r = await api<{
        publicaciones: number;
        pedidos: number;
        variantes: number;
        errores: string[];
      }>("/ml/sync", { method: "POST" });
      setResultado(
        `${r.publicaciones} publicaciones, ${r.variantes} variantes, ${r.pedidos} pedidos` +
          (r.errores.length ? ` · ${r.errores.length} errores` : ""),
      );
      reload();
    } catch (e) {
      setResultado((e as Error).message);
    } finally {
      setSincronizando(false);
    }
  }

  async function desconectar() {
    await api("/ml/desconectar", { method: "POST" });
    reload();
  }

  // Al volver del OAuth, disparar la primera sincronización en primer plano
  // (más confiable que el background del callback para cuentas grandes).
  const autoSyncHecho = useRef(false);
  useEffect(() => {
    if (
      aviso === "conectado" &&
      data?.conectado &&
      !data.ultimo_sync &&
      !autoSyncHecho.current &&
      !sincronizando
    ) {
      autoSyncHecho.current = true;
      void sincronizar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aviso, data]);

  const cerrarAviso = () => {
    params.delete("ml");
    params.delete("motivo");
    setParams(params, { replace: true });
  };

  return (
    <section>
      <h2 className="mb-3.5 text-[15px] font-semibold">Mercado Libre</h2>

      {aviso === "conectado" && (
        <Banner tono="ok" onClose={cerrarAviso}>
          Cuenta conectada. Estamos trayendo tus publicaciones y pedidos…
        </Banner>
      )}
      {aviso === "error" && (
        <Banner tono="danger" onClose={cerrarAviso}>
          No se pudo conectar: {params.get("motivo") ?? "error desconocido"}
        </Banner>
      )}

      <Card>
        {loading && <div className="text-[13.5px] text-ink/50">Cargando…</div>}

        {!loading && !data?.conectado && (
          <div className="flex flex-col gap-3">
            <p className="max-w-prose text-[13.5px] text-ink/55">
              Conectá tu cuenta para que el panel acceda a tus publicaciones,
              variantes, precios y pedidos. Se abre el login de Mercado Libre.
            </p>
            <div>
              <a
                href="/api/ml/connect"
                className="inline-block rounded-[9px] bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white hover:bg-accent-hover"
              >
                Conectar Mercado Libre
              </a>
            </div>
          </div>
        )}

        {!loading && data?.conectado && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Mini label="Vendedor" value={data.vendedor ?? "—"} />
              <Mini label="Publicaciones" value={String(data.publicaciones ?? 0)} />
              <Mini label="Variantes" value={String(data.variantes ?? 0)} />
              <Mini label="Pedidos" value={String(data.pedidos ?? 0)} />
            </div>
            <div className="text-[12.5px] text-ink/50">
              Última sincronización:{" "}
              {data.ultimo_sync
                ? new Date(data.ultimo_sync).toLocaleString("es-AR")
                : "nunca"}
            </div>
            {resultado && (
              <div className="text-[12.5px] text-ink/60">{resultado}</div>
            )}
            <div className="flex gap-2.5">
              <PrimaryButton onClick={sincronizar}>
                {sincronizando ? "Sincronizando…" : "Re-sincronizar ahora"}
              </PrimaryButton>
              <GhostButton onClick={desconectar}>Desconectar</GhostButton>
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[12px] text-ink/50">{label}</div>
      <div className="font-display text-[18px] font-bold">{value}</div>
    </div>
  );
}

function Banner({
  tono,
  children,
  onClose,
}: {
  tono: "ok" | "danger";
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className={
        "mb-4 flex items-start justify-between gap-3 rounded-[12px] px-4 py-3 text-[13px] " +
        (tono === "ok" ? "bg-ok-bg text-ok" : "bg-danger-bg text-danger")
      }
    >
      <span>{children}</span>
      <button onClick={onClose} className="shrink-0 font-bold opacity-70">
        ×
      </button>
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
