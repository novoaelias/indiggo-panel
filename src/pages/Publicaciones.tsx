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
  const [nueva, setNueva] = useState(false);
  const [precios, setPrecios] = useState(false);

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
      {nueva && (
        <NuevaPublicacionModal
          onClose={() => setNueva(false)}
          onCreada={() => {
            setNueva(false);
            reload();
          }}
        />
      )}
      {precios && (
        <PreciosModal
          onClose={() => setPrecios(false)}
          onAplicado={() => {
            setPrecios(false);
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
            <GhostButton onClick={() => setPrecios(true)}>
              Editar precios
            </GhostButton>
            <PrimaryButton onClick={() => setNueva(true)}>
              + Crear con IA
            </PrimaryButton>
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto scrim p-4 sm:p-8">
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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[12.5px] text-ink/50">{label}</div>
      <div className="rounded-lg border border-ink/12 px-3 py-2.5 text-[13.5px]">
        {children}
      </div>
    </div>
  );
}

interface PropuestaNueva {
  propuesta: {
    titulo: string;
    descripcion: string;
    palabras_clave: string[];
    precio_sugerido: number | null;
  };
  categoria: { id: string; nombre: string } | null;
  atributos_requeridos: Array<{ id: string; nombre: string }>;
}

function NuevaPublicacionModal({
  onClose,
  onCreada,
}: {
  onClose: () => void;
  onCreada: () => void;
}) {
  const [idea, setIdea] = useState("");
  const [precioObj, setPrecioObj] = useState("");
  const [cargando, setCargando] = useState(false);
  const [err, setErr] = useState<string>();
  const [prop, setProp] = useState<PropuestaNueva>();

  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [precio, setPrecio] = useState("");
  const [stock, setStock] = useState("1");
  const [fotos, setFotos] = useState("");
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [publicando, setPublicando] = useState(false);
  const [resultado, setResultado] = useState<{ permalink: string | null }>();

  async function generar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setErr(undefined);
    try {
      const r = await api<PropuestaNueva>("/ia/nueva", {
        method: "POST",
        body: JSON.stringify({
          idea: idea.trim(),
          precio: precioObj ? Number(precioObj) : undefined,
        }),
      });
      setProp(r);
      setTitulo(r.propuesta.titulo);
      setDescripcion(r.propuesta.descripcion);
      setCategoriaId(r.categoria?.id ?? "");
      setPrecio(String(r.propuesta.precio_sugerido ?? precioObj ?? ""));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  async function publicar() {
    if (
      !window.confirm(
        "Se va a crear la publicación en Mercado Libre EN PAUSA. La revisás y activás desde ML. ¿Confirmás?",
      )
    )
      return;
    setPublicando(true);
    setErr(undefined);
    try {
      const r = await api<{ permalink: string | null }>("/ia/publicar", {
        method: "POST",
        body: JSON.stringify({
          titulo,
          descripcion,
          categoria_id: categoriaId,
          precio: Number(precio),
          stock: Number(stock) || 1,
          pictures: fotos
            .split(/\s+/)
            .map((s) => s.trim())
            .filter(Boolean),
          atributos: Object.entries(attrs)
            .filter(([, v]) => v.trim())
            .map(([id, value_name]) => ({ id, value_name })),
        }),
      });
      setResultado(r);
      onCreada();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPublicando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto scrim p-4 sm:p-8">
      <div className="w-full max-w-2xl rounded-[14px] border bg-surface p-6 hairline">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-[16px] font-semibold">Crear publicación con IA</h2>
          <button
            onClick={onClose}
            className="text-[18px] font-bold text-ink/40 hover:text-ink"
          >
            ×
          </button>
        </div>

        {resultado ? (
          <div className="flex flex-col gap-3 text-[13.5px]">
            <div className="rounded-lg bg-ok-bg px-3 py-2 text-ok">
              Publicación creada <b>en pausa</b>. Revisala y activala en Mercado
              Libre.
            </div>
            {resultado.permalink && (
              <a
                href={resultado.permalink}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-accent"
              >
                Abrir en Mercado Libre →
              </a>
            )}
            <PrimaryButton onClick={onClose}>Cerrar</PrimaryButton>
          </div>
        ) : !prop ? (
          <form onSubmit={generar} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] text-ink/50">
                ¿Qué querés vender?
              </span>
              <textarea
                autoFocus
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                rows={3}
                placeholder="ej: llavero 3D con el logo de NewJeans, PLA, 5cm"
                className="rounded-lg border border-ink/12 px-3 py-2.5 text-[13.5px] outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] text-ink/50">
                Precio objetivo (opcional)
              </span>
              <input
                value={precioObj}
                onChange={(e) => setPrecioObj(e.target.value)}
                inputMode="numeric"
                className="rounded-lg border border-ink/12 px-3 py-2.5 text-[13.5px] outline-none focus:border-accent"
              />
            </label>
            {err && <div className="text-[12.5px] text-danger">{err}</div>}
            <PrimaryButton>
              {cargando ? "Generando…" : "Generar propuesta"}
            </PrimaryButton>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <Field label={`Título (${titulo.length}/60)`}>
              <input
                value={titulo}
                maxLength={60}
                onChange={(e) => setTitulo(e.target.value)}
                className="w-full bg-transparent outline-none"
              />
            </Field>
            <Field label="Descripción">
              <textarea
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                rows={7}
                className="w-full resize-y bg-transparent outline-none"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field
                label={`Categoría${prop.categoria ? ` · ${prop.categoria.nombre}` : ""}`}
              >
                <input
                  value={categoriaId}
                  onChange={(e) => setCategoriaId(e.target.value)}
                  className="w-full bg-transparent outline-none"
                />
              </Field>
              <Field label="Precio">
                <input
                  value={precio}
                  onChange={(e) => setPrecio(e.target.value)}
                  inputMode="numeric"
                  className="w-full bg-transparent outline-none"
                />
              </Field>
              <Field label="Stock inicial">
                <input
                  value={stock}
                  onChange={(e) => setStock(e.target.value)}
                  inputMode="numeric"
                  className="w-full bg-transparent outline-none"
                />
              </Field>
            </div>
            <Field label="URLs de fotos (una por línea)">
              <textarea
                value={fotos}
                onChange={(e) => setFotos(e.target.value)}
                rows={2}
                placeholder="https://…"
                className="w-full resize-y bg-transparent outline-none"
              />
            </Field>
            {prop.atributos_requeridos.length > 0 && (
              <div>
                <div className="mb-1.5 text-[12.5px] text-ink/50">
                  Atributos que pide la categoría
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {prop.atributos_requeridos.map((a) => (
                    <Field key={a.id} label={a.nombre}>
                      <input
                        value={attrs[a.id] ?? ""}
                        onChange={(e) =>
                          setAttrs((s) => ({ ...s, [a.id]: e.target.value }))
                        }
                        className="w-full bg-transparent outline-none"
                      />
                    </Field>
                  ))}
                </div>
              </div>
            )}
            {err && <div className="text-[12.5px] text-danger">{err}</div>}
            <div className="flex flex-wrap items-center gap-3 border-t hairline pt-4">
              <button
                onClick={publicar}
                disabled={publicando}
                className="rounded-[9px] bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {publicando ? "Creando…" : "Crear en Mercado Libre (en pausa)"}
              </button>
              <GhostButton onClick={() => setProp(undefined)}>Volver</GhostButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PreciosModal({
  onClose,
  onAplicado,
}: {
  onClose: () => void;
  onAplicado: () => void;
}) {
  const { data } = useApi<Resp>("/publicaciones?estado=active");
  const [nuevos, setNuevos] = useState<Record<string, string>>({});
  const [pct, setPct] = useState("");
  const [aplicando, setAplicando] = useState(false);
  const [msg, setMsg] = useState<string>();

  const lista = data?.publicaciones ?? [];

  function aplicarPct() {
    const p = Number(pct);
    if (!Number.isFinite(p) || p === 0) return;
    const next: Record<string, string> = {};
    for (const it of lista) {
      if (it.precio == null) continue;
      next[it.id] = String(Math.round(it.precio * (1 + p / 100)));
    }
    setNuevos(next);
  }

  const cambios = lista
    .filter((it) => {
      const v = nuevos[it.id];
      return v != null && Number(v) > 0 && Number(v) !== it.precio;
    })
    .map((it) => ({ id: it.id, precio: Number(nuevos[it.id]) }));

  async function aplicar() {
    if (
      !window.confirm(
        `Se van a cambiar ${cambios.length} precios en Mercado Libre. ¿Confirmás?`,
      )
    )
      return;
    setAplicando(true);
    setMsg(undefined);
    try {
      const r = await api<{ actualizados: number; errores: string[] }>(
        "/publicaciones/precios",
        { method: "POST", body: JSON.stringify({ cambios }) },
      );
      setMsg(
        `${r.actualizados} actualizados` +
          (r.errores.length ? ` · ${r.errores.length} errores` : ""),
      );
      if (r.actualizados) onAplicado();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setAplicando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto scrim p-4 sm:p-8">
      <div className="w-full max-w-2xl rounded-[14px] border bg-surface p-6 hairline">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-[16px] font-semibold">Editar precios</h2>
          <button
            onClick={onClose}
            className="text-[18px] font-bold text-ink/40 hover:text-ink"
          >
            ×
          </button>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] text-ink/50">Ajuste masivo:</span>
          <input
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            placeholder="ej: 10 o -5"
            inputMode="numeric"
            className="w-24 rounded-lg border border-ink/12 px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
          />
          <span className="text-[12.5px] text-ink/50">%</span>
          <GhostButton onClick={aplicarPct}>Aplicar a todas</GhostButton>
          {Object.keys(nuevos).length > 0 && (
            <button
              onClick={() => setNuevos({})}
              className="text-[12px] text-ink/40 hover:text-ink"
            >
              limpiar
            </button>
          )}
        </div>

        <div className="max-h-[55vh] overflow-y-auto rounded-[12px] border hairline">
          {lista.map((it) => (
            <div
              key={it.id}
              className="flex items-center gap-3 border-b hairline px-3 py-2 last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {it.titulo}
              </span>
              <span className="w-20 shrink-0 text-right text-[12.5px] text-ink/45">
                {it.precio != null ? formatARS(it.precio) : "—"}
              </span>
              <input
                value={nuevos[it.id] ?? ""}
                onChange={(e) =>
                  setNuevos((s) => ({ ...s, [it.id]: e.target.value }))
                }
                placeholder="nuevo"
                inputMode="numeric"
                className="w-24 shrink-0 rounded-md border border-ink/12 px-2 py-1 text-right text-[13px] outline-none focus:border-accent"
              />
            </div>
          ))}
        </div>

        {msg && <div className="mt-3 text-[12.5px] text-ink/60">{msg}</div>}

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={aplicar}
            disabled={aplicando || cambios.length === 0}
            className="rounded-[9px] bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {aplicando
              ? "Aplicando…"
              : `Aplicar ${cambios.length || ""} a Mercado Libre`}
          </button>
        </div>
      </div>
    </div>
  );
}
