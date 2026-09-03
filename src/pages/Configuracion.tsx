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
        <FlexSection />
        <PlanillaRepartoSection />
        <CatalogoSection />
        <UnirPublicacionesSection />
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

interface FlexEstado {
  oculto: boolean;
  desde: string | null;
  con_flex: number;
  activas: number;
}

function FlexSection() {
  const { data, loading, reload } = useApi<FlexEstado>("/ml/flex");
  const [confirmar, setConfirmar] = useState(false);
  const [corriendo, setCorriendo] = useState(false);
  const [msg, setMsg] = useState<string>();

  const ocultar = !data?.oculto; // si hoy está visible, la acción es ocultar

  async function ejecutar() {
    setCorriendo(true);
    setMsg(undefined);
    try {
      const r = await api<{ tocados: number; pendientes: number; errores: string[] }>(
        "/ml/flex",
        { method: "POST", body: JSON.stringify({ ocultar }) },
      );
      setMsg(
        `${r.tocados} publicación(es) actualizada(s)` +
          (r.errores.length ? ` · ${r.errores.length} con error` : ""),
      );
      setConfirmar(false);
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setCorriendo(false);
    }
  }

  return (
    <section>
      <h2 className="mb-3.5 text-[15px] font-semibold">Envío Flex</h2>
      <Card>
        {loading && <div className="text-[13.5px] text-ink/50">Cargando…</div>}
        {data && (
          <div className="flex flex-col gap-4">
            <p className="max-w-prose text-[13.5px] text-ink/55">
              Saca (o vuelve a poner) <b>Envío Flex</b> como opción de envío en{" "}
              <b>todas</b> tus publicaciones activas, de una. No desactiva Flex en
              tu cuenta — sólo deja de ofrecerse a los compradores hasta que lo
              vuelvas a activar acá.
            </p>
            <p className="max-w-prose rounded-[10px] bg-warn-bg px-3 py-2 text-[12px] text-warn">
              Ojo: Mercado Libre sólo deja hacer esto por API si la app tiene el
              permiso del producto <b>“Mercado Envíos Flex”</b> (se pide una vez en
              developers.mercadolibre.com.ar). Si el botón da error de permiso, todavía
              falta ese paso. Alternativa inmediata: pausar Flex desde el panel de{" "}
              <a
                href="https://envios.mercadolibre.com.ar/flex"
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline"
              >
                Mercado Envíos Flex
              </a>{" "}
              de tu cuenta.
            </p>

            <div className="flex items-center gap-2.5 text-[13px]">
              <span
                className={
                  "inline-block h-2.5 w-2.5 rounded-full " +
                  (data.oculto ? "bg-warn" : "bg-ok")
                }
              />
              {data.oculto ? (
                <span>
                  Flex <b>oculto</b>
                  {data.desde &&
                    ` desde el ${new Date(data.desde).toLocaleDateString("es-AR")}`}
                  {data.con_flex > 0 &&
                    ` · ${data.con_flex} publicación(es) todavía lo tienen`}
                </span>
              ) : (
                <span>
                  Flex <b>visible</b> en {data.con_flex} de {data.activas}{" "}
                  publicaciones
                </span>
              )}
            </div>

            {msg && <div className="text-[12.5px] text-ink/60">{msg}</div>}

            {!confirmar ? (
              <div>
                <button
                  onClick={() => {
                    setConfirmar(true);
                    setMsg(undefined);
                  }}
                  className={
                    "rounded-[9px] px-4 py-2.5 text-[13.5px] font-bold text-white " +
                    (ocultar
                      ? "bg-warn hover:opacity-90"
                      : "bg-accent hover:bg-accent-hover")
                  }
                >
                  {ocultar
                    ? "Ocultar Flex de todas las publicaciones"
                    : "Volver a mostrar Flex en todas"}
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2.5 rounded-[10px] bg-ink/[0.03] p-3">
                <span className="text-[13px] font-semibold">
                  {ocultar
                    ? `¿Ocultar Flex de ${data.con_flex} publicación(es)?`
                    : `¿Volver a mostrar Flex en ${data.activas - data.con_flex} publicación(es)?`}
                </span>
                <button
                  onClick={ejecutar}
                  disabled={corriendo}
                  className={
                    "rounded-[9px] px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50 " +
                    (ocultar ? "bg-warn" : "bg-accent")
                  }
                >
                  {corriendo ? "Aplicando…" : "Sí, confirmar"}
                </button>
                <button
                  onClick={() => setConfirmar(false)}
                  disabled={corriendo}
                  className="rounded-[9px] border border-ink/12 px-4 py-2 text-[13px] font-semibold text-ink/60"
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}

interface PlanillaEstado {
  configurado: boolean;
  sheet_url: string | null;
  escritos_total: number;
  pendientes: number;
  ultimo: string | null;
}

function PlanillaRepartoSection() {
  const { data, loading, reload } = useApi<PlanillaEstado>("/pedidos/planilla");
  const [corriendo, setCorriendo] = useState(false);
  const [msg, setMsg] = useState<string>();

  async function sincronizar() {
    setCorriendo(true);
    setMsg(undefined);
    try {
      const r = await api<{
        escritos: number;
        revisados: number;
        errores: string[];
      }>("/pedidos/planilla/sync", { method: "POST" });
      setMsg(
        `${r.escritos} pedido(s) Flex escritos en la planilla` +
          (r.errores.length ? ` · ${r.errores.length} con error` : ""),
      );
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setCorriendo(false);
    }
  }

  return (
    <section>
      <h2 className="mb-3.5 text-[15px] font-semibold">Planilla de reparto</h2>
      <Card>
        {loading && <div className="text-[13.5px] text-ink/50">Cargando…</div>}
        {data && (
          <div className="flex flex-col gap-4">
            <p className="max-w-prose text-[13.5px] text-ink/55">
              Cada pedido <b>Flex</b> que entra pagado se agrega solo como una
              fila en la planilla{" "}
              {data.sheet_url ? (
                <a
                  href={data.sheet_url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold underline"
                >
                  INDIGGO
                </a>
              ) : (
                <b>INDIGGO</b>
              )}{" "}
              (dirección, localidad y CHICO/MEDIANO tildado). Lo que se vende{" "}
              <b>a partir de las 10:00</b> va al bloque del día siguiente. Los
              pedidos de un mismo envío se cargan en una sola fila.
            </p>

            {!data.configurado && (
              <p className="max-w-prose rounded-[10px] bg-warn-bg px-3 py-2 text-[12px] text-warn">
                Falta cargar el Service Account de Google
                (<code>GOOGLE_SA_EMAIL</code> y <code>GOOGLE_SA_PRIVATE_KEY</code>).
                Hasta entonces no se escribe nada.
              </p>
            )}

            <div className="flex items-center gap-2.5 text-[13px]">
              <span
                className={
                  "inline-block h-2.5 w-2.5 rounded-full " +
                  (data.configurado ? "bg-ok" : "bg-warn")
                }
              />
              <span>
                {data.escritos_total} pedido(s) escritos
                {data.pendientes > 0 && ` · ${data.pendientes} pendiente(s)`}
                {data.ultimo &&
                  ` · último ${new Date(data.ultimo).toLocaleString("es-AR")}`}
              </span>
            </div>

            {msg && <div className="text-[12.5px] text-ink/60">{msg}</div>}

            <div>
              <button
                onClick={sincronizar}
                disabled={corriendo || !data.configurado}
                className="rounded-[9px] bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {corriendo
                  ? "Sincronizando…"
                  : "Sincronizar pedidos Flex recientes"}
              </button>
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

function CatalogoSection() {
  const { data, loading, reload } = useApi<{
    productos: number;
    variantes: number;
    publicaciones: number;
    insumos: number;
  }>("/catalogo/resumen");
  const [corriendo, setCorriendo] = useState(false);
  const [msg, setMsg] = useState<string>();
  const [bom, setBom] = useState(false);
  const [bomMsg, setBomMsg] = useState<string>();

  async function armarBom() {
    setBom(true);
    setBomMsg(undefined);
    try {
      const r = await api<{
        cuerpos: number;
        llaveros: number;
        photocards: number;
        packs: number;
        vinculos: number;
      }>("/catalogo/derivar-bom", { method: "POST" });
      setBomMsg(
        `${r.cuerpos} cuerpos 3D + ${r.llaveros} llaveros 3D + ${r.photocards} photocards + ${r.packs} packs, ${r.vinculos} vínculos`,
      );
      reload();
    } catch (e) {
      setBomMsg((e as Error).message);
    } finally {
      setBom(false);
    }
  }

  async function derivar() {
    setCorriendo(true);
    setMsg(undefined);
    try {
      const r = await api<{
        productos_nuevos: number;
        productos_total: number;
        productos_agrupados: number;
        variantes_nuevas: number;
        con_integrante: number;
        sin_integrante: number;
        grupos_detectados: Record<string, number>;
        sin_categoria: string[];
      }>("/catalogo/derivar", { method: "POST" });
      setMsg(
        `${r.productos_total} productos (+${r.productos_nuevos} nuevos${
          r.productos_agrupados
            ? `, ${r.productos_agrupados} publicaciones agrupadas`
            : ""
        }), +${r.variantes_nuevas} variantes · ` +
          `${r.con_integrante} variantes con integrante, ${r.sin_integrante} sin. ` +
          `Grupos: ${Object.entries(r.grupos_detectados)
            .map(([g, n]) => `${g} (${n})`)
            .join(", ")}` +
          (r.sin_categoria.length
            ? ` · ${r.sin_categoria.length} sin categoría`
            : ""),
      );
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setCorriendo(false);
    }
  }

  return (
    <section>
      <h2 className="mb-3.5 text-[15px] font-semibold">Catálogo</h2>
      <Card>
        <p className="mb-4 max-w-prose text-[13.5px] text-ink/55">
          El catálogo interno (productos y variantes con su stock) se arma a
          partir de tus publicaciones de Mercado Libre. Volvé a correrlo cuando
          agregues publicaciones nuevas: no pisa el stock que ya cargaste.
        </p>
        <div className="mb-4 flex flex-wrap gap-4">
          <Mini label="Publicaciones" value={String(data?.publicaciones ?? "—")} />
          <Mini label="Productos" value={String(data?.productos ?? "—")} />
          <Mini label="Variantes" value={String(data?.variantes ?? "—")} />
          <Mini label="Insumos" value={String(data?.insumos ?? "—")} />
        </div>
        {msg && <div className="mb-3 text-[12.5px] text-ink/60">{msg}</div>}
        {bomMsg && <div className="mb-3 text-[12.5px] text-ink/60">{bomMsg}</div>}
        <div className="flex flex-wrap gap-2.5">
          <PrimaryButton onClick={derivar}>
            {corriendo ? "Derivando…" : "Derivar desde publicaciones"}
          </PrimaryButton>
          <GhostButton onClick={armarBom}>
            {bom ? "Armando…" : "Armar lista de materiales"}
          </GhostButton>
        </div>
        <p className="mt-3 text-[11.5px] text-ink/40">
          La lista de materiales asume 1 cuerpo impreso en 3D + 1 photocard de
          imprenta por cada variante de holder. Ajustá las cantidades reales en
          Stock → Insumos.
        </p>
        {loading && (
          <span className="ml-3 text-[12.5px] text-ink/40">cargando…</span>
        )}
      </Card>
    </section>
  );
}

interface PubAgrupable {
  id: string;
  ml_item_id: string;
  titulo: string;
  thumbnail: string | null;
  estado: string;
  precio: number | null;
  tiene_variantes: boolean;
  grupo_id: string | null;
}
interface ListingGroup {
  id: string;
  nombre: string | null;
  canonical_listing_id: string;
}

function UnirPublicacionesSection() {
  const { data, loading, error, reload } = useApi<{
    publicaciones: PubAgrupable[];
    grupos: ListingGroup[];
    sugerencias: string[][];
  }>("/catalogo/agrupables");

  const [sel, setSel] = useState<Set<string>>(new Set());
  const [principal, setPrincipal] = useState<string>("");
  const [nombre, setNombre] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();

  const pubs = data?.publicaciones ?? [];
  const byId = new Map(pubs.map((p) => [p.id, p]));
  const sueltas = pubs.filter((p) => !p.grupo_id);

  function toggle(id: string) {
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      if (!n.has(principal)) setPrincipal(n.size ? [...n][0] : "");
      return n;
    });
  }

  async function unir(ids: string[], canonId: string, label?: string) {
    setBusy(true);
    setMsg(undefined);
    try {
      const r = await api<{ resumen?: { productos_total: number } }>(
        "/catalogo/agrupables",
        {
          method: "POST",
          body: JSON.stringify({
            listing_ids: ids,
            canonical_listing_id: canonId,
            nombre: label || undefined,
          }),
        },
      );
      setMsg(
        `Unidas ${ids.length} publicaciones. Ahora hay ${r.resumen?.productos_total ?? "?"} productos. Corré “Armar lista de materiales” si tocaste holders.`,
      );
      setSel(new Set());
      setPrincipal("");
      setNombre("");
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function separar(id: string) {
    setBusy(true);
    setMsg(undefined);
    try {
      await api(`/catalogo/agrupables/${id}`, { method: "DELETE" });
      setMsg("Grupo deshecho.");
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="mb-3.5 text-[15px] font-semibold">Unir publicaciones</h2>
      <Card>
        <p className="mb-4 max-w-prose text-[13.5px] text-ink/55">
          Si tenés varias publicaciones que son el <b>mismo producto físico</b>{" "}
          (por planes de cuotas, títulos distintos…), unilas: el stock real pasa
          a ser uno solo y el buffer de ML se publica a todas.
        </p>

        {loading && <EmptyHint>Cargando publicaciones…</EmptyHint>}
        {error && <EmptyHint>No se pudo cargar: {error}</EmptyHint>}
        {msg && (
          <div className="mb-3 rounded-lg bg-accent-soft px-3 py-2 text-[12.5px] text-accent">
            {msg}
          </div>
        )}

        {/* grupos existentes */}
        {data && data.grupos.length > 0 && (
          <div className="mb-5 flex flex-col gap-2">
            <div className="text-[12px] font-semibold uppercase tracking-[0.03em] text-ink/45">
              Grupos armados
            </div>
            {data.grupos.map((g) => {
              const miembros = pubs.filter((p) => p.grupo_id === g.id);
              const canon = byId.get(g.canonical_listing_id);
              return (
                <div
                  key={g.id}
                  className="rounded-[10px] border border-ink/10 p-3"
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold">
                      {g.nombre || canon?.titulo || "Grupo"}
                    </span>
                    <button
                      onClick={() => separar(g.id)}
                      disabled={busy}
                      className="rounded-md border border-ink/12 px-2 py-1 text-[11.5px] font-semibold hover:bg-ink/[0.03] disabled:opacity-50"
                    >
                      Separar
                    </button>
                  </div>
                  <ul className="flex flex-col gap-0.5">
                    {miembros.map((m) => (
                      <li
                        key={m.id}
                        className="text-[12px] text-ink/60 [overflow-wrap:anywhere]"
                      >
                        {m.id === g.canonical_listing_id ? "★ " : "· "}
                        {m.titulo}
                        {m.precio != null && (
                          <span className="text-ink/35">
                            {" "}
                            — ${Math.round(m.precio).toLocaleString("es-AR")}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}

        {/* sugerencias */}
        {data && data.sugerencias.length > 0 && (
          <div className="mb-5 flex flex-col gap-2">
            <div className="text-[12px] font-semibold uppercase tracking-[0.03em] text-ink/45">
              Parecidas — ¿son el mismo producto?
            </div>
            {data.sugerencias.map((ids, i) => (
              <div
                key={i}
                className="rounded-[10px] border border-dashed border-accent/40 bg-accent-soft/40 p-3"
              >
                <ul className="mb-2 flex flex-col gap-0.5">
                  {ids.map((id) => (
                    <li
                      key={id}
                      className="text-[12px] text-ink/70 [overflow-wrap:anywhere]"
                    >
                      · {byId.get(id)?.titulo}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => {
                    setSel(new Set(ids));
                    setPrincipal(
                      ids.find((id) => byId.get(id)?.estado === "active") ??
                        ids[0],
                    );
                    setMsg(undefined);
                  }}
                  disabled={busy}
                  className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-bold text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  Seleccionar estas {ids.length} ↓
                </button>
              </div>
            ))}
          </div>
        )}

        {/* selección manual */}
        {data && sueltas.length > 0 && (
          <>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.03em] text-ink/45">
              Elegí a mano ({sel.size} seleccionadas)
            </div>
            <div className="max-h-[320px] overflow-y-auto rounded-[10px] border border-ink/10">
              {sueltas.map((p) => (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-center gap-2.5 border-b border-ink/8 px-3 py-2 last:border-b-0 hover:bg-ink/[0.02]"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0"
                    checked={sel.has(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium leading-snug [overflow-wrap:anywhere]">
                      {p.titulo}
                    </span>
                    <span className="text-[11px] text-ink/40">
                      {p.estado}
                      {p.precio != null &&
                        ` · $${Math.round(p.precio).toLocaleString("es-AR")}`}
                      {p.tiene_variantes ? " · con variantes" : ""}
                    </span>
                  </span>
                  {sel.has(p.id) && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        setPrincipal(p.id);
                      }}
                      className={
                        "shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-bold " +
                        (principal === p.id
                          ? "bg-accent text-white"
                          : "bg-accent-soft text-accent")
                      }
                    >
                      {principal === p.id ? "★ principal" : "hacer principal"}
                    </button>
                  )}
                </label>
              ))}
            </div>

            {sel.size >= 2 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Nombre del producto (opcional)"
                  className="rounded-lg border border-ink/12 px-3 py-2 text-[13px] outline-none focus:border-accent"
                />
                <button
                  onClick={() => unir([...sel], principal || [...sel][0], nombre)}
                  disabled={busy}
                  className="rounded-[9px] bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  {busy ? "Uniendo…" : `Unir ${sel.size} publicaciones`}
                </button>
              </div>
            )}
          </>
        )}
        {data && sueltas.length === 0 && data.grupos.length === 0 && (
          <EmptyHint>No hay publicaciones para agrupar.</EmptyHint>
        )}
      </Card>
    </section>
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
