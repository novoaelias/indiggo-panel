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
import { enablePush } from "@/lib/push";

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
  const [seccion, setSeccion] = useState("conexion");
  return (
    <div>
      <PageHeader
        titulo="Configuración"
        subtitulo="Administrá las conexiones y preferencias de tu tienda"
      />
      <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Secciones de configuración">
        {[["conexion", "Conexiones"], ["reglas", "Reglas comerciales"], ["notificaciones", "Notificaciones"], ["envios", "Envíos"], ["catalogo", "Catálogo"], ["grupos", "Grupos e integrantes"]].map(([id, label]) => <button key={id} aria-pressed={seccion === id} onClick={() => setSeccion(id)} className={seccion === id ? "rounded-lg bg-accent-soft px-4 py-2 text-accent font-semibold" : "rounded-lg px-4 py-2 text-ink/60"}>{label}</button>)}
      </div>
      <div className="flex flex-col gap-8">
        {seccion === "conexion" && <><MercadoLibreSection /><ConexionesSection /></>}
        {seccion === "reglas" && <><EstiloSection /><ReglasSection /></>}
        {seccion === "notificaciones" && <NotificacionesSection />}
        {seccion === "envios" && <><FlexSection /><PlanillaRepartoSection /></>}
        {seccion === "catalogo" && <><CatalogoSection /><details className="secondary-section"><summary>Unir publicaciones del mismo producto</summary><UnirPublicacionesSection /></details></>}
        {seccion === "grupos" && <GruposSection />}
      </div>
    </div>
  );
}

interface Regla {
  id: string;
  clave: string;
  valor: string;
  temporal: boolean;
  product_id: string | null;
  producto: string;
}

/** "firma" y "tono" se guardan como reglas, pero no son datos que la IA pueda
 *  afirmar: definen cómo escribe. Por eso tienen su propia ficha y salen de la
 *  lista de abajo. */
const CLAVES_DE_ESTILO = ["firma", "tono"];
const FIRMA_DEFECTO = "Saludos, equipo de Indiggo Store.";

/** Cómo cierra y cómo trata cada respuesta pública. */
function EstiloSection() {
  const { data, reload } = useApi<{ reglas: Regla[] }>("/preguntas/reglas");
  const guardadas = data?.reglas ?? [];
  const firmaGuardada =
    guardadas.find((r) => r.clave === "firma" && !r.product_id)?.valor ?? "";
  const tonoGuardado =
    guardadas.find((r) => r.clave === "tono" && !r.product_id)?.valor ?? "vos";
  const [firma, setFirma] = useState<string | null>(null);
  const [tono, setTono] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [listo, setListo] = useState(false);

  const firmaActual = firma ?? firmaGuardada;
  const tonoActual = tono ?? tonoGuardado;

  async function guardar() {
    setGuardando(true);
    setListo(false);
    try {
      for (const [clave, valor] of [
        ["firma", firmaActual.trim() || FIRMA_DEFECTO],
        ["tono", tonoActual],
      ]) {
        await api("/preguntas/reglas", {
          method: "POST",
          body: JSON.stringify({ clave, valor, product_id: null, temporal: false }),
        });
      }
      setListo(true);
      reload();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section>
      <h2 className="mb-3.5 text-[15px] font-semibold">Estilo de las respuestas</h2>
      <Card>
        <div className="max-w-2xl space-y-4 text-[13.5px]">
          <p className="text-ink/65">
            Vale para las respuestas automáticas y para las que redactás vos:
            ninguna sale sin este cierre.
          </p>
          <label className="block">
            <span className="text-[11.5px] font-semibold">Firma</span>
            <input
              className="mt-1 w-full rounded-lg border hairline bg-surface px-3 py-2"
              placeholder={FIRMA_DEFECTO}
              value={firmaActual}
              onChange={(e) => setFirma(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-[11.5px] font-semibold">Trato</span>
            <select
              className="mt-1 w-full rounded-lg border hairline bg-surface px-3 py-2"
              value={tonoActual.includes("usted") ? "usted" : "vos"}
              onChange={(e) => setTono(e.target.value)}
            >
              <option value="vos">De vos, cordial y profesional</option>
              <option value="usted">De usted, formal</option>
            </select>
          </label>
          <div className="flex items-center gap-3">
            <PrimaryButton onClick={guardar} disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar estilo"}
            </PrimaryButton>
            {listo && <span className="text-[11.5px] text-ink/50">Guardado.</span>}
          </div>
        </div>
      </Card>
    </section>
  );
}

/** Datos que la IA puede dar por ciertos al responder una pregunta. */
function ReglasSection() {
  const { data, reload } = useApi<{
    reglas: Regla[];
    productos: Array<{ id: string; nombre: string }>;
  }>("/preguntas/reglas");
  const [clave, setClave] = useState("");
  const [valor, setValor] = useState("");
  const [producto, setProducto] = useState("");
  const [temporal, setTemporal] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string>();
  const reglas = (data?.reglas ?? []).filter((r) => !CLAVES_DE_ESTILO.includes(r.clave));

  async function guardar() {
    if (!clave.trim() || !valor.trim()) return;
    setGuardando(true);
    setError(undefined);
    try {
      await api("/preguntas/reglas", {
        method: "POST",
        body: JSON.stringify({
          clave: clave.trim(),
          valor: valor.trim(),
          product_id: producto || null,
          temporal,
        }),
      });
      setClave("");
      setValor("");
      setTemporal(false);
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section>
      <h2 className="mb-3.5 text-[15px] font-semibold">Reglas comerciales</h2>
      <Card>
        <div className="max-w-2xl space-y-4 text-[13.5px]">
          <p className="text-ink/65">
            Lo que la IA puede afirmar sin consultarte: qué incluye un pack, cómo
            se envía, qué no hacés. Marcá “temporal” para algo que vale por hoy
            (una promo, una demora): deja de usarse solo a las 24 horas.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="rounded-lg border hairline bg-surface px-3 py-2"
              placeholder="Tema (ej. envíos)"
              value={clave}
              onChange={(e) => setClave(e.target.value)}
            />
            <select
              className="rounded-lg border hairline bg-surface px-3 py-2"
              value={producto}
              onChange={(e) => setProducto(e.target.value)}
            >
              <option value="">Todos los productos</option>
              {(data?.productos ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
          <textarea
            className="w-full rounded-lg border hairline bg-surface px-3 py-2"
            rows={2}
            placeholder="Qué decir (ej. Despacho dentro de las 24 h hábiles por Mercado Envíos)"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
          />
          <label className="flex items-center gap-2 text-ink/65">
            <input
              type="checkbox"
              checked={temporal}
              onChange={(e) => setTemporal(e.target.checked)}
            />
            Es temporal (vale 24 horas)
          </label>
          {error && <div className="rounded-lg bg-warn-bg px-3 py-2 text-warn">{error}</div>}
          <PrimaryButton onClick={guardar} disabled={guardando}>
            {guardando ? "Guardando…" : "Agregar regla"}
          </PrimaryButton>

          <div className="divide-y hairline border-t hairline pt-1">
            {reglas.length === 0 && (
              <div className="py-3 text-ink/50">Todavía no cargaste reglas.</div>
            )}
            {reglas.map((r) => (
              <div key={r.id} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">
                    {r.clave}
                    {r.temporal && <span className="ml-2 text-[11.5px] text-warn">temporal</span>}
                  </div>
                  <div className="text-ink/65 [overflow-wrap:anywhere]">{r.valor}</div>
                  <div className="text-[11.5px] text-ink/45">{r.producto}</div>
                </div>
                <GhostButton
                  onClick={async () => {
                    await api(`/preguntas/reglas/${r.id}`, { method: "DELETE" });
                    reload();
                  }}
                >
                  Borrar
                </GhostButton>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </section>
  );
}

function NotificacionesSection() {
  const { data } = useApi<{ configured: boolean }>("/preguntas/push/config");
  const [mensaje, setMensaje] = useState<string>();
  const [activando, setActivando] = useState(false);

  async function activar() {
    setActivando(true);
    try {
      const estado = await enablePush();
      setMensaje(
        estado === "enabled"
          ? "Notificaciones activadas en este dispositivo."
          : "Falta configurar Web Push en el servidor.",
      );
    } catch (error) {
      setMensaje((error as Error).message);
    } finally {
      setActivando(false);
    }
  }

  return (
    <section>
      <h2 className="mb-3.5 text-[15px] font-semibold">Notificaciones en el iPhone</h2>
      <Card>
        <div className="max-w-2xl space-y-3 text-[13.5px] text-ink/65">
          <p>
            Recibí avisos cuando una pregunta necesite tu intervención o cuando falle una respuesta automática.
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Abrí este panel en Safari.</li>
            <li>Tocá Compartir y elegí “Agregar a Inicio”.</li>
            <li>Abrí Indiggo desde el icono y activá las notificaciones.</li>
          </ol>
          {data && !data.configured && (
            <div className="rounded-lg bg-warn-bg px-3 py-2 text-warn">
              El servidor todavía no tiene las claves Web Push configuradas.
            </div>
          )}
          {mensaje && <div className="rounded-lg bg-accent-soft px-3 py-2 text-accent">{mensaje}</div>}
          <PrimaryButton onClick={activar} disabled={activando || data?.configured === false}>
            {activando ? "Activando…" : "Activar notificaciones"}
          </PrimaryButton>
        </div>
      </Card>
    </section>
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

  async function ejecutar() {
    setCorriendo(true);
    setMsg(undefined);
    try {
      const r = await api<{ tocados: number; pendientes: number; errores: string[] }>(
        "/ml/flex",
        { method: "POST", body: JSON.stringify({ ocultar: true }) },
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
              La política de Indiggo es <b>Mercado Envíos sin Flex</b>. El panel
              quita Flex de las publicaciones actuales, lo verifica al crear o
              republicar y vuelve a controlarlo en cada sincronización.
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
                  (data.oculto && data.con_flex === 0 ? "bg-ok" : "bg-warn")
                }
              />
              {data.oculto && data.con_flex === 0 ? (
                <span>
                  Flex <b>deshabilitado</b> en todas las publicaciones activas
                  {data.desde &&
                    ` desde el ${new Date(data.desde).toLocaleDateString("es-AR")}`}
                </span>
              ) : (
                <span>
                  Hay <b>{data.con_flex}</b> de {data.activas} publicaciones
                  activas que todavía requieren quitar Flex
                </span>
              )}
            </div>

            {msg && <div className="text-[12.5px] text-ink/60">{msg}</div>}

            {data.oculto && data.con_flex === 0 ? (
              <div className="text-[12px] font-semibold text-ok">
                Política activa y verificada.
              </div>
            ) : !confirmar ? (
              <div>
                <button
                  onClick={() => {
                    setConfirmar(true);
                    setMsg(undefined);
                  }}
                  className={
                    "rounded-[9px] px-4 py-2.5 text-[13.5px] font-bold text-white " +
                    "bg-warn hover:opacity-90"
                  }
                >
                  Quitar Flex y dejar la política activa
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2.5 rounded-[10px] bg-ink/[0.03] p-3">
                <span className="text-[13px] font-semibold">
                  ¿Quitar Flex de {data.con_flex} publicación(es) y mantenerlo
                  deshabilitado en las nuevas?
                </span>
                <button
                  onClick={ejecutar}
                  disabled={corriendo}
                  className={
                    "rounded-[9px] px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50 " +
                    "bg-warn"
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
  suspendido?: boolean;
  sheet_url: string | null;
  escritos_total: number;
  pendientes: number;
  ultimo: string | null;
}

function PlanillaRepartoSection() {
  const { data, loading, reload } = useApi<PlanillaEstado>("/pedidos/planilla");
  const [corriendo, setCorriendo] = useState(false);
  const [msg, setMsg] = useState<string>();

  if (data?.suspendido) {
    return (
      <section>
        <h2 className="mb-3.5 text-[15px] font-semibold">Planilla de reparto</h2>
        <Card>
          <p className="max-w-prose text-[13.5px] text-ink/55">
            Módulo <b>suspendido</b>. Ya no se escribe ningún pedido Flex en la
            planilla de Google Sheets. Los {data.escritos_total} pedidos que ya
            se habían cargado siguen en la planilla; nada se borró. Para
            reactivarlo hay que volver a habilitarlo en el código
            (<code>SHEETS_SUSPENDIDO</code> en <code>worker/lib/sheets.ts</code>).
          </p>
        </Card>
      </section>
    );
  }

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
        <div className="flex flex-wrap gap-2.5">
          <PrimaryButton onClick={derivar}>
            {corriendo ? "Derivando…" : "Derivar desde publicaciones"}
          </PrimaryButton>
        </div>
        <p className="mt-3 text-[11.5px] text-ink/40">
          Los nombres internos y las recetas quedan protegidos. Podés editar cada
          receta desde Inventario → Productos terminados.
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
        `Unidas ${ids.length} publicaciones. Ahora hay ${r.resumen?.productos_total ?? "?"} productos. Revisá las recetas desde Inventario si tocaste holders.`,
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
