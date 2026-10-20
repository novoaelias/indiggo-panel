import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { SubirFotos } from "@/components/SubirFotos";
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

interface CategoriaCand {
  id: string;
  nombre: string;
  path: string;
  usos?: number;
  fuente?: "propia" | "ml";
}
interface CategoriaAnalisis {
  actual_id: string;
  actual_path: string;
  sugerida_id: string;
  sugerida_path: string;
  coincide: boolean;
  confianza: "alta" | "media" | "baja";
  motivo: string;
  candidatas: CategoriaCand[];
  chequeado_at: string;
}
interface PublicacionApi {
  id: string;
  product_id: string | null;
  producto_nombre: string;
  ml_item_id: string;
  titulo: string;
  estado: string;
  precio: number | null;
  moneda: string;
  permalink: string | null;
  thumbnail: string | null;
  variantes: number;
  stock_ml: number;
  categoria_sugerida: string | null;
  categoria_analisis: CategoriaAnalisis | null;
  reemplazada_por: string | null;
  familia: boolean;
  descontinuada: boolean;
}
interface Resp {
  publicaciones: PublicacionApi[];
  conteo: Record<string, number>;
}

interface AuditoriaContenido {
  analizados: number;
  grupos: Array<{
    product_id: string;
    producto: string;
    diferencias_relevantes: string[];
    contradicciones: string[];
    listing_id_a_corregir: string | null;
    objetivo_correccion: string;
    publicaciones: Array<{ id: string; ml_item_id: string; titulo: string }>;
  }>;
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
  { key: "descontinuadas", label: "Descontinuadas" },
];

export function Publicaciones() {
  const [filtro, setFiltro] = useState("todas");
  const [busqueda, setBusqueda] = useState("");
  const [consulta, setConsulta] = useState("");
  useEffect(() => { const timer = setTimeout(() => setConsulta(busqueda), 300); return () => clearTimeout(timer); }, [busqueda]);
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    // "categoria" no es un estado de ML: traemos todas y filtramos en el cliente
    if (filtro !== "todas" && filtro !== "categoria") p.set("estado", filtro);
    if (consulta.trim()) p.set("q", consulta.trim());
    return p.toString();
  }, [filtro, consulta]);

  const { data, error, loading, reload } = useApi<Resp>(
    `/publicaciones${qs ? `?${qs}` : ""}`,
  );
  const [iaPara, setIaPara] = useState<PublicacionApi | null>(null);
  const [iaObjetivo, setIaObjetivo] = useState("");
  const [varPara, setVarPara] = useState<PublicacionApi | null>(null);
  const [catPara, setCatPara] = useState<PublicacionApi | null>(null);
  const [nueva, setNueva] = useState(false);
  const [precios, setPrecios] = useState(false);
  const [analizando, setAnalizando] = useState(false);
  const [analisisMsg, setAnalisisMsg] = useState<string>();
  const [auditandoContenido, setAuditandoContenido] = useState(false);
  const [auditoriaContenido, setAuditoriaContenido] = useState<AuditoriaContenido>();

  async function alternarDescontinuada(p: PublicacionApi) {
    const descontinuar = !p.descontinuada;
    if (
      !window.confirm(
        descontinuar
          ? `"${p.titulo}" va a dejar de aparecer en el panel (no se toca en Mercado Libre). ¿Confirmás?`
          : `¿Volver a mostrar "${p.titulo}" en el panel?`,
      )
    )
      return;
    await api(`/publicaciones/${p.id}/descontinuar`, {
      method: "POST",
      body: JSON.stringify({ descontinuado: descontinuar }),
    });
    reload();
  }

  async function analizarCategorias() {
    setAnalizando(true);
    setAnalisisMsg(undefined);
    try {
      const r = await api<{
        analizadas: number;
        grupos?: number;
        con_problema: number;
        ok: number;
        errores: string[];
      }>("/seo/analizar", { method: "POST" });
      setAnalisisMsg(
        `${r.analizadas} publicaciones en ${r.grupos ?? "?"} grupos · ${r.con_problema} para revisar · ${r.ok} OK` +
          (r.errores.length ? ` · ${r.errores.length} errores` : ""),
      );
      if (r.con_problema > 0) setFiltro("categoria");
      reload();
    } catch (e) {
      setAnalisisMsg((e as Error).message);
    } finally {
      setAnalizando(false);
    }
  }

  async function analizarContenido() {
    setAuditandoContenido(true);
    setAnalisisMsg(undefined);
    try {
      const resultado = await api<AuditoriaContenido>("/seo/contenido/analizar", {
        method: "POST",
      });
      setAuditoriaContenido(resultado);
      setAnalisisMsg(
        `${resultado.analizados} producto(s) comparados · ${resultado.grupos.length} con diferencias para revisar`,
      );
    } catch (e) {
      setAnalisisMsg((e as Error).message);
    } finally {
      setAuditandoContenido(false);
    }
  }

  const problemas = (data?.publicaciones ?? []).filter(
    (p) => p.categoria_analisis && !p.categoria_analisis.coincide,
  );
  const publicacionesVisibles =
    filtro === "categoria" ? problemas : (data?.publicaciones ?? []);
  const gruposVisibles = useMemo(() => {
    const grupos = new Map<string, PublicacionApi[]>();
    for (const publicacion of publicacionesVisibles) {
      const key = publicacion.product_id ?? `sin:${publicacion.id}`;
      const grupo = grupos.get(key) ?? [];
      grupo.push(publicacion);
      grupos.set(key, grupo);
    }
    return [...grupos.entries()].map(([id, publicaciones]) => ({
      id,
      nombre: publicaciones[0]?.producto_nombre ?? "Sin agrupar",
      publicaciones,
    }));
  }, [publicacionesVisibles]);

  return (
    <div>
      {iaPara && (
        <SugerenciaModal
          publicacion={iaPara}
          objetivoInicial={iaObjetivo}
          onClose={() => { setIaPara(null); setIaObjetivo(""); }}
          onAplicado={() => {
            setIaPara(null);
            setIaObjetivo("");
            reload();
          }}
        />
      )}
      {varPara &&
        (varPara.familia ? (
          <DuplicarModal
            publicacion={varPara}
            onClose={() => setVarPara(null)}
            onCreada={() => {
              reload();
            }}
          />
        ) : (
          <VariantesModal
            publicacion={varPara}
            onClose={() => setVarPara(null)}
            onAplicado={() => {
              setVarPara(null);
              reload();
            }}
          />
        ))}
      {nueva && (
        <NuevaPublicacionModal
          onClose={() => setNueva(false)}
          onCreada={() => {
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
      {catPara && (
        <CategoriaModal
          publicacion={catPara}
          onClose={() => setCatPara(null)}
          onHecho={() => reload()}
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
            <details className="action-menu"><summary>Herramientas</summary><div>
              <button disabled={analizando} onClick={analizarCategorias}>{analizando ? "Revisando…" : "Revisar categorías"}</button>
              <button disabled={auditandoContenido} onClick={analizarContenido}>{auditandoContenido ? "Comparando…" : "Comparar contenido entre publicaciones"}</button>
              <button onClick={() => setPrecios(true)}>Actualizar precios en lote</button>
            </div></details>
            <Link
              to="/publicaciones/fotos"
              className="rounded-[9px] border border-ink/12 px-4 py-2.5 text-[13.5px] font-semibold text-ink transition-colors hover:bg-ink/[0.03]"
            >
              Editar fotos con IA
            </Link>
            <PrimaryButton onClick={() => setNueva(true)}>+ Nueva publicación</PrimaryButton>
          </>
        }
      />

      {analisisMsg && (
        <div className="mb-4 rounded-[12px] bg-accent-soft px-4 py-2.5 text-[12.5px] text-accent">
          {analisisMsg}
        </div>
      )}

      {auditoriaContenido && auditoriaContenido.grupos.length > 0 && (
        <Card className="mb-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[14px] font-semibold">Diferencias de contenido para revisar</h2>
            <button className="text-[12px] text-ink/45" onClick={() => setAuditoriaContenido(undefined)}>Cerrar</button>
          </div>
          <div className="flex flex-col gap-3">
            {auditoriaContenido.grupos.map((group) => {
              const targetId = group.listing_id_a_corregir || group.publicaciones[0]?.id;
              const target = data?.publicaciones.find((item) => item.id === targetId);
              return (
                <div key={group.product_id} className="rounded-lg border border-ink/10 p-3">
                  <div className="text-[13px] font-semibold">{group.producto}</div>
                  {group.contradicciones?.length > 0 && (
                    <ul className="mt-2 list-disc pl-5 text-[12px] text-danger">
                      {group.contradicciones.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  )}
                  {group.diferencias_relevantes?.length > 0 && (
                    <ul className="mt-2 list-disc pl-5 text-[12px] text-ink/55">
                      {group.diferencias_relevantes.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  )}
                  {group.objetivo_correccion && <p className="mt-2 text-[11.5px] text-ink/45">Corrección preparada: {group.objetivo_correccion}</p>}
                  {target && (
                    <div className="mt-3">
                      <GhostButton onClick={() => { setIaObjetivo(group.objetivo_correccion); setIaPara(target); }}>
                        Preparar corrección para revisar
                      </GhostButton>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

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
        {(filtro === "categoria" || problemas.length > 0) && (
          <button
            onClick={() => setFiltro("categoria")}
            className={cx(
              "rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors",
              filtro === "categoria"
                ? "bg-danger-bg text-danger"
                : "text-danger/70 hover:bg-danger-bg/60",
            )}
          >
            Revisar categoría
            {problemas.length > 0 && (
              <span className="ml-1.5 opacity-60">{problemas.length}</span>
            )}
          </button>
        )}
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          aria-label="Buscar publicaciones por nombre"
          placeholder="Buscar una publicación…"
          className="ml-auto w-full sm:w-64 rounded-lg border border-ink/12 px-3 py-2 text-[13px] outline-none focus:border-accent"
        />
      </div>

      {loading && <EmptyHint>Cargando publicaciones…</EmptyHint>}
      {error && <EmptyHint>No se pudieron cargar: {error}</EmptyHint>}

      {data && (
        <Card padding={false} className="listing-list">
          {gruposVisibles.map((grupo) => (
            <Fragment key={grupo.id}>
              <div className="border-b hairline bg-ink/[0.025] px-4 py-2.5">
                <div className="text-[13px] font-bold text-ink/80">{grupo.nombre}</div>
                <div className="text-[11.5px] text-ink/45">
                  {grupo.publicaciones.length} {grupo.publicaciones.length === 1 ? "publicación vinculada" : "publicaciones vinculadas"}
                </div>
              </div>
              {grupo.publicaciones.map((p) => {
            const meta = ESTADO_META[p.estado] ?? {
              label: p.estado,
              tono: "neutral" as EstadoTono,
            };
            const cat = p.categoria_analisis;
            return (
              <div
                key={p.id}
                className="listing-row flex items-center gap-4 border-b hairline px-4 py-3 last:border-b-0"
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
                  <div title={p.titulo} className="line-clamp-2 text-[14px] font-semibold">
                    {p.titulo}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-ink/50">
                    Stock ML: {p.stock_ml}
                    {p.variantes > 0 && ` · ${p.variantes} variantes`}
                  </div>
                  {p.reemplazada_por ? (
                    <div className="mt-1 text-[11.5px] text-ink/40">
                      → re-publicada en otra categoría ({p.reemplazada_por})
                    </div>
                  ) : cat && !cat.coincide ? (
                    <button
                      onClick={() => setCatPara(p)}
                      className="mt-1 flex flex-wrap items-center gap-1.5 text-left text-[11.5px] text-danger hover:underline"
                    >
                      <Badge tono="danger">Revisar categoría</Badge>
                    </button>
                  ) : null}
                </div>
                <div className="listing-price shrink-0 text-right text-[14px] font-bold sm:w-24">
                  {p.precio != null ? formatARS(p.precio) : "—"}
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge tono={meta.tono}>{meta.label}</Badge>
                  {p.descontinuada && <Badge tono="neutral">Descontinuada</Badge>}
                </div>
                <details className="action-menu listing-actions"><summary aria-label={`Acciones para ${p.titulo}`}>Gestionar</summary><div>
                  {!p.descontinuada && (
                    <>
                      <button onClick={() => setVarPara(p)}>{p.familia ? "Crear otro color" : "Agregar variantes"}</button>
                      <button onClick={() => setIaPara(p)}>Mejorar título y descripción</button>
                      <button onClick={() => setCatPara(p)}>Revisar categoría</button>
                    </>
                  )}
                  {p.permalink && <a href={p.permalink} target="_blank" rel="noreferrer">Ver en Mercado Libre ↗</a>}
                  <button onClick={() => alternarDescontinuada(p)}>
                    {p.descontinuada ? "Volver a mostrar en el panel" : "Descontinuar (dejar de ver en el panel)"}
                  </button>
                </div></details>
              </div>
            );
              })}
            </Fragment>
          ))}
          {publicacionesVisibles.length === 0 && (
            <div className="px-4 py-8 text-center text-[13.5px] text-ink/45">
              {filtro === "categoria"
                ? "No hay publicaciones con la categoría marcada como incorrecta. Corré “Analizar categorías”."
                : "No hay publicaciones con este filtro."}
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
  objetivoInicial = "",
  onClose,
  onAplicado,
}: {
  publicacion: PublicacionApi;
  objetivoInicial?: string;
  onClose: () => void;
  onAplicado: () => void;
}) {
  const [objetivo, setObjetivo] = useState(objetivoInicial);
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

interface PropuestaVariante {
  valor: string;
  imagen_url: string | null;
  error?: string;
}
interface RevisVariante {
  valor: string;
  imagenes: string[];
  stock: string;
}

function VariantesModal({
  publicacion,
  onClose,
  onAplicado,
}: {
  publicacion: PublicacionApi;
  onClose: () => void;
  onAplicado: () => void;
}) {
  const [nombres, setNombres] = useState<string[]>([""]);
  const [cargando, setCargando] = useState<"ia" | "manual">();
  const [err, setErr] = useState<string>();
  const [atributoId, setAtributoId] = useState<string | null>(null);
  const [atributoNombre, setAtributoNombre] = useState<string | null>(null);
  const [ejeManual, setEjeManual] = useState("");
  const [revis, setRevis] = useState<RevisVariante[]>([]);
  const [regenerando, setRegenerando] = useState<string>();
  const [aplicando, setAplicando] = useState(false);
  const [resultado, setResultado] = useState<{ agregadas: number; avisos: string[] }>();

  async function generar(modo: "ia" | "manual") {
    const valores = [...new Set(nombres.map((n) => n.trim()).filter(Boolean))];
    if (valores.length === 0) return;
    setCargando(modo);
    setErr(undefined);
    try {
      const r = await api<{
        atributo_id: string | null;
        atributo_nombre: string | null;
        propuestas: PropuestaVariante[];
      }>(`/ia/publicacion/${publicacion.id}/variantes/proponer`, {
        method: "POST",
        body: JSON.stringify({ valores, generar_fotos: modo === "ia" }),
      });
      setAtributoId(r.atributo_id);
      setAtributoNombre(r.atributo_nombre);
      if (!r.atributo_id && !r.atributo_nombre) setEjeManual("Color");
      setRevis(
        r.propuestas.map((p) => ({
          valor: p.valor,
          imagenes: p.imagen_url ? [p.imagen_url] : [],
          stock: "1",
        })),
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCargando(undefined);
    }
  }

  async function regenerar(valor: string) {
    setRegenerando(valor);
    setErr(undefined);
    try {
      const r = await api<{ propuestas: PropuestaVariante[] }>(
        `/ia/publicacion/${publicacion.id}/variantes/proponer`,
        { method: "POST", body: JSON.stringify({ valores: [valor] }) },
      );
      const p = r.propuestas[0];
      setRevis((s) =>
        s.map((x) =>
          x.valor === valor
            ? { ...x, imagenes: p?.imagen_url ? [p.imagen_url] : x.imagenes }
            : x,
        ),
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRegenerando(undefined);
    }
  }

  const faltaEje = !atributoId && !atributoNombre && !ejeManual.trim();

  async function aplicar() {
    if (
      !window.confirm(
        `Se van a agregar ${revis.length} variante(s) nueva(s) a esta publicación en Mercado Libre. ¿Confirmás?`,
      )
    )
      return;
    setAplicando(true);
    setErr(undefined);
    try {
      const r = await api<{ agregadas: number; avisos: string[] }>(
        `/ia/publicacion/${publicacion.id}/variantes/aplicar`,
        {
          method: "POST",
          body: JSON.stringify({
            atributo_id: atributoId ?? undefined,
            atributo_nombre: atributoId ? undefined : atributoNombre ?? ejeManual.trim(),
            items: revis.map((v) => ({
              value_name: v.valor,
              imagenes: v.imagenes,
              stock: Number(v.stock) || 1,
            })),
          }),
        },
      );
      setResultado(r);
      onAplicado();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAplicando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto scrim p-4 sm:p-8">
      <div className="w-full max-w-2xl rounded-[14px] border bg-surface p-6 hairline">
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 className="text-[16px] font-semibold">Agregar variante con IA</h2>
          <button
            onClick={onClose}
            className="text-[18px] font-bold text-ink/40 hover:text-ink"
          >
            ×
          </button>
        </div>
        <p className="mb-4 text-[12.5px] text-ink/50">{publicacion.titulo}</p>

        {resultado ? (
          <div className="flex flex-col gap-3 text-[13.5px]">
            <div className="rounded-lg bg-ok-bg px-3 py-2 text-ok">
              Se agregaron {resultado.agregadas} variante(s) a la publicación.
            </div>
            {resultado.avisos.length > 0 && (
              <ul className="list-disc rounded-lg bg-warn-bg px-5 py-2 text-[12px] text-warn">
                {resultado.avisos.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            )}
            <PrimaryButton onClick={onClose}>Cerrar</PrimaryButton>
          </div>
        ) : revis.length === 0 ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-[12.5px] text-ink/50">
                Colores / valores nuevos a agregar
              </span>
              {nombres.map((n, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={n}
                    onChange={(e) =>
                      setNombres((s) => s.map((x, j) => (j === i ? e.target.value : x)))
                    }
                    placeholder="ej: Azul"
                    className="min-w-0 flex-1 rounded-lg border border-ink/12 px-3 py-2 text-[13px] outline-none focus:border-accent"
                  />
                  {nombres.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setNombres((s) => s.filter((_, j) => j !== i))}
                      className="text-[16px] font-bold text-ink/35 hover:text-danger"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => setNombres((s) => [...s, ""])}
                className="self-start text-[12.5px] font-semibold text-accent hover:text-accent-hover"
              >
                + agregar valor
              </button>
            </div>
            {err && <div className="text-[12.5px] text-danger">{err}</div>}
            <div className="flex flex-wrap items-center gap-3">
              <PrimaryButton onClick={() => !cargando && generar("ia")}>
                {cargando === "ia" ? "Generando fotos…" : "Generar fotos con IA"}
              </PrimaryButton>
              <GhostButton onClick={() => !cargando && generar("manual")}>
                {cargando === "manual" ? "Cargando…" : "Ya tengo las fotos"}
              </GhostButton>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {!atributoId && !atributoNombre && (
              <label className="flex flex-col gap-1.5">
                <span className="text-[12.5px] text-ink/50">
                  Esta publicación no tiene variantes todavía: ¿por qué van a variar?
                </span>
                <input
                  value={ejeManual}
                  onChange={(e) => setEjeManual(e.target.value)}
                  placeholder="ej: Color"
                  className="rounded-lg border border-ink/12 px-3 py-2.5 text-[13.5px] outline-none focus:border-accent"
                />
              </label>
            )}
            {revis.map((v, i) => (
              <div
                key={v.valor}
                className="flex flex-col gap-2 border-t hairline pt-3 first:border-t-0 first:pt-0"
              >
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-[13.5px] font-semibold">{v.valor}</span>
                  <input
                    value={v.stock}
                    onChange={(e) =>
                      setRevis((s) =>
                        s.map((x, j) => (j === i ? { ...x, stock: e.target.value } : x)),
                      )
                    }
                    inputMode="numeric"
                    title="Stock"
                    className="w-16 rounded-lg border border-ink/12 px-2 py-2 text-center text-[13px] outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={() => regenerar(v.valor)}
                    disabled={regenerando === v.valor}
                    className="text-[12px] font-semibold text-accent hover:text-accent-hover disabled:opacity-50"
                  >
                    {regenerando === v.valor ? "Generando…" : "Regenerar"}
                  </button>
                </div>
                <SubirFotos
                  fotos={v.imagenes}
                  onChange={(f) =>
                    setRevis((s) => s.map((x, j) => (j === i ? { ...x, imagenes: f } : x)))
                  }
                  max={6}
                />
              </div>
            ))}
            {err && <div className="text-[12.5px] text-danger">{err}</div>}
            {faltaEje && (
              <div className="text-[12.5px] text-danger">
                Completá "¿por qué van a variar?" arriba para poder aplicar.
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 border-t hairline pt-4">
              <button
                onClick={aplicar}
                disabled={aplicando || faltaEje}
                className="rounded-[9px] bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {aplicando ? "Aplicando…" : "Aplicar a Mercado Libre"}
              </button>
              <span className="text-[11.5px] text-ink/40">
                Agrega estas variantes a la publicación real, sin tocar las que ya tiene.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface AtributoDup {
  id: string;
  nombre: string;
  valor: string;
  requerido: boolean;
}
interface PropuestaDuplicado {
  titulo: string;
  descripcion: string;
  categoria_id: string;
  precio: number | null;
  imagenes: string[];
  atributos: AtributoDup[];
  family_name: string | null;
  avisos: string[];
}

// Para publicaciones de categoría "familia de producto" (ML no admite
// variaciones por API): arma el borrador de una publicación NUEVA a partir de
// una existente, cambiando sólo el color, y la publica con el mismo endpoint
// que "Crear con IA" (/ia/publicar) — como ya son sus publicaciones hermanas.
function DuplicarModal({
  publicacion,
  onClose,
  onCreada,
}: {
  publicacion: PublicacionApi;
  onClose: () => void;
  onCreada: () => void;
}) {
  const [valor, setValor] = useState("");
  const [cargando, setCargando] = useState<"ia" | "manual">();
  const [err, setErr] = useState<string>();
  const [prop, setProp] = useState<{ avisos: string[] }>();

  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [precio, setPrecio] = useState("");
  const [stock, setStock] = useState("1");
  const [imagenes, setImagenes] = useState<string[]>([]);
  const [atributos, setAtributos] = useState<AtributoDup[]>([]);
  const [familyName, setFamilyName] = useState("");

  const [publicando, setPublicando] = useState(false);
  const [resultado, setResultado] =
    useState<{
      permalink: string | null;
      pausada?: boolean;
      envio_verificado?: boolean;
      avisos: string[];
    }>();

  const faltanRequeridos = atributos.filter((a) => a.requerido && !a.valor.trim());

  async function generar(modo: "ia" | "manual") {
    if (!valor.trim()) return;
    setCargando(modo);
    setErr(undefined);
    try {
      const r = await api<PropuestaDuplicado>(
        `/ia/publicacion/${publicacion.id}/duplicar/proponer`,
        {
          method: "POST",
          body: JSON.stringify({ valor: valor.trim(), generar_fotos: modo === "ia" }),
        },
      );
      setTitulo(r.titulo);
      setDescripcion(r.descripcion);
      setCategoriaId(r.categoria_id);
      setPrecio(r.precio != null ? String(r.precio) : "");
      setImagenes(r.imagenes);
      setAtributos(r.atributos);
      setFamilyName(r.family_name ?? publicacion.titulo);
      setProp({ avisos: r.avisos });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCargando(undefined);
    }
  }

  async function publicar() {
    if (faltanRequeridos.length > 0) return;
    if (
      !window.confirm(
        "Se va a crear una publicación NUEVA en Mercado Libre EN PAUSA (no toca la original). ¿Confirmás?",
      )
    )
      return;
    setPublicando(true);
    setErr(undefined);
    try {
      const r = await api<{
        permalink: string | null;
        pausada?: boolean;
        envio_verificado?: boolean;
        avisos: string[];
      }>(
        "/ia/publicar",
        {
          method: "POST",
          body: JSON.stringify({
            titulo,
            descripcion,
            categoria_id: categoriaId,
            precio: Number(precio),
            stock: Number(stock) || 1,
            imagenes,
            atributos: atributos
              .filter((a) => a.valor.trim())
              .map((a) => ({ id: a.id, value_name: a.valor.trim() })),
            family_name: familyName.trim() || undefined,
          }),
        },
      );
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
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 className="text-[16px] font-semibold">Crear otro color</h2>
          <button
            onClick={onClose}
            className="text-[18px] font-bold text-ink/40 hover:text-ink"
          >
            ×
          </button>
        </div>
        <p className="mb-4 text-[12.5px] text-ink/50">{publicacion.titulo}</p>

        {resultado ? (
          <div className="flex flex-col gap-3 text-[13.5px]">
            <div className="rounded-lg bg-ok-bg px-3 py-2 text-ok">
              Publicación creada. <b>{resultado.pausada ? "En pausa, lista para revisar." : "Revisá su estado en Mercado Libre."}</b>
              {resultado.envio_verificado && " Mercado Envíos sin Flex verificado."}
            </div>
            {resultado.avisos?.length > 0 && (
              <ul className="list-disc rounded-lg bg-warn-bg px-5 py-2 text-[12px] text-warn">
                {resultado.avisos.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            )}
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
          <div className="flex flex-col gap-4">
            <div className="rounded-lg bg-warn-bg px-3 py-2.5 text-[12.5px] text-warn">
              Creá un nuevo color usando los datos de este producto. Primero elegí el color y las fotos; después revisá y confirmá la publicación.
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] text-ink/50">Color / valor nuevo</span>
              <input
                autoFocus
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="ej: Azul"
                className="rounded-lg border border-ink/12 px-3 py-2.5 text-[13.5px] outline-none focus:border-accent"
              />
            </label>
            {err && <div className="text-[12.5px] text-danger">{err}</div>}
            <div className="flex flex-wrap items-center gap-3">
              <PrimaryButton disabled={Boolean(cargando) || !valor.trim()} onClick={() => generar("manual")}>
                {cargando === "manual" ? "Preparando…" : "Continuar con mis fotos"}
              </PrimaryButton>
              <GhostButton disabled={Boolean(cargando) || !valor.trim()} onClick={() => generar("ia")}>
                {cargando === "ia" ? "Generando…" : "Crear foto con IA (opcional)"}
              </GhostButton>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {prop.avisos.length > 0 && (
              <ul className="list-disc rounded-lg bg-warn-bg px-5 py-2 text-[12px] text-warn">
                {prop.avisos.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-col gap-1.5">
              <span className="text-[12.5px] text-ink/50">Fotos</span>
              <SubirFotos fotos={imagenes} onChange={setImagenes} max={10} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Categoría (id)">
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
              <Field label="Stock">
                <input
                  value={stock}
                  onChange={(e) => setStock(e.target.value)}
                  inputMode="numeric"
                  className="w-full bg-transparent outline-none"
                />
              </Field>
            </div>
            <details className="secondary-section"><summary>Revisar nombre y descripción copiados</summary>
            <Field label={familyName ? "Título de referencia · Mercado Libre genera el definitivo" : `Título (${titulo.length}/60)`}>
              <input
                value={titulo}
                readOnly={Boolean(familyName)}
                maxLength={60}
                onChange={(e) => setTitulo(e.target.value)}
                className="w-full bg-transparent outline-none"
              />
            </Field>
            <Field label="Descripción">
              <textarea
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                rows={6}
                className="w-full resize-y bg-transparent outline-none"
              />
            </Field>
            <Field label="Nombre base del producto">
              <input
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
                className="w-full bg-transparent outline-none"
              />
            </Field>
            </details>
            {atributos.length > 0 && (
              <details className="secondary-section" open={faltanRequeridos.length > 0 ? true : undefined}><summary>Características del producto{faltanRequeridos.length > 0 ? ` · ${faltanRequeridos.length} por completar` : ""}</summary>
              <div className="flex flex-col gap-2">
                <span className="text-[12.5px] text-ink/50">Atributos</span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {atributos.map((a, i) => {
                    const vacio = a.requerido && !a.valor.trim();
                    return (
                      <label key={a.id} className="flex flex-col gap-1">
                        <span className="text-[11.5px] text-ink/45">
                          {a.nombre}
                          {a.requerido && <span className="text-danger"> · obligatorio</span>}
                        </span>
                        <input
                          value={a.valor}
                          onChange={(e) =>
                            setAtributos((s) =>
                              s.map((x, j) =>
                                j === i ? { ...x, valor: e.target.value } : x,
                              ),
                            )
                          }
                          className={cx(
                            "rounded-lg border px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent",
                            vacio ? "border-danger" : "border-ink/12",
                          )}
                        />
                      </label>
                    );
                  })}
                </div>
              </div></details>
            )}
            {err && <div className="text-[12.5px] text-danger">{err}</div>}
            {faltanRequeridos.length > 0 && (
              <div className="text-[12.5px] text-danger">
                Completá los atributos obligatorios para poder publicar:{" "}
                {faltanRequeridos.map((a) => a.nombre).join(", ")}.
              </div>
            )}
            {!imagenes.length && <p className="text-[13px] text-ink/60">Cargá al menos una foto del nuevo color para publicar.</p>}
            <PrimaryButton disabled={publicando || !imagenes.length || faltanRequeridos.length > 0} onClick={publicar}>
              {publicando ? "Publicando…" : "Publicar en pausa"}
            </PrimaryButton>
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

interface AtributoCat {
  id: string;
  nombre: string;
  valores: string[];
}
interface PropuestaNueva {
  propuesta: {
    titulo: string;
    descripcion: string;
    palabras_clave: string[];
    precio_sugerido: number | null;
    atributos_sugeridos: Array<{ id?: string; nombre: string; valor: string }>;
  };
  categoria: { id: string; nombre: string } | null;
  atributos_requeridos: AtributoCat[];
  variacion: { atributos: AtributoCat[]; sugerido_id: string | null } | null;
}

interface VarianteRow {
  nombre: string;
  fotos: string[];
  stock: string;
  // id de la fila de la guía de talles asignada a esta variante (moda)
  talleFila?: string;
}

interface GuiaTalles {
  id: string;
  nombre: string;
  filas: Array<{ id: string; talle: string }>;
}
interface GuiasResp {
  requiere: boolean;
  dominio?: string;
  guias: GuiaTalles[];
  equivalencias: Array<{ id: string; name: string }>;
  aviso?: string;
}
interface FilaGuiaForm {
  talle: string;
  equivalencia: string;
  pecho: string;
  ancho: string;
  largo: string;
}

const GENERO_DEFECTO = "Sin género";
const MARCA_DEFECTO = "Indiggo Store";
const VARS_INICIAL = (): VarianteRow[] => [{ nombre: "", fotos: [], stock: "1" }];

// Borrador del modal, guardado en el servidor (bucket privado "borradores").
// Sólo el estado que carga el dueño: nada transitorio (cargando, err, gen...).
interface BorradorNueva {
  v: 1;
  desc: string;
  precioObj: string;
  fotos: string[];
  tieneVar: boolean;
  eje: string;
  vars: VarianteRow[]; // incluye talleFila por variante
  prop?: PropuestaNueva;
  titulo: string;
  descripcion: string;
  categoriaId: string;
  precio: string;
  stock: string;
  attrs: Record<string, string>;
  varAttrId: string;
  guiaId: string; // guía de talles elegida
  talleUnico: string; // fila de la guía para el caso sin variantes
}

const horaAR = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  });
};

const numCm = (s: string) => Number(s.trim().replace(",", "."));

const inputChico =
  "rounded-md border border-ink/12 px-2 py-1 text-[13px] outline-none focus:border-accent";
const celdaGuia = "flex min-w-0 flex-col gap-0.5";
const rotuloGuia = "text-[10.5px] text-ink/45";

// Sección "Guía de talles": ML la pide para ropa. Elegir una existente o crear
// una nueva, y asignar el talle de cada variante (o uno solo si no hay variantes).
function GuiaTallesSeccion({
  categoria,
  genero,
  marca,
  info,
  cargando,
  guiaId,
  onElegir,
  onCreada,
  variantes,
  talleUnico,
  onTalleUnico,
  onTalleVariante,
}: {
  categoria: string;
  genero: string;
  marca: string;
  info: GuiasResp;
  cargando: boolean;
  guiaId: string;
  onElegir: (id: string) => void;
  onCreada: (g: GuiaTalles) => void;
  variantes: Array<{ idx: number; nombre: string; talleFila?: string }> | null;
  talleUnico: string;
  onTalleUnico: (id: string) => void;
  onTalleVariante: (idx: number, id: string) => void;
}) {
  const sel = info.guias.find((g) => g.id === guiaId);
  const [creando, setCreando] = useState(false);
  const [nombre, setNombre] = useState("Guía de talles");
  const filaVacia = (): FilaGuiaForm => ({
    talle: "",
    equivalencia: "",
    pecho: "",
    ancho: "",
    largo: "",
  });
  const [filas, setFilas] = useState<FilaGuiaForm[]>([filaVacia()]);
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string>();

  const cambiarFila = (i: number, cambio: Partial<FilaGuiaForm>) =>
    setFilas((s) => s.map((f, j) => (j === i ? { ...f, ...cambio } : f)));

  async function crear() {
    setErr(undefined);
    const nombreLimpio = nombre.trim();
    if (!nombreLimpio) return setErr("Ponele un nombre a la guía.");
    for (const [i, f] of filas.entries()) {
      if (!f.talle.trim()) return setErr(`Falta el talle de la fila ${i + 1}.`);
      if (!f.equivalencia) return setErr(`Elegí la equivalencia del talle ${f.talle.trim()}.`);
      if (!(numCm(f.ancho) > 0))
        return setErr(`Cargá el ancho de pecho de la prenda (cm) del talle ${f.talle.trim()}.`);
      if (f.largo.trim() && !(numCm(f.largo) > 0))
        return setErr(`El largo del talle ${f.talle.trim()} tiene que ser mayor a cero.`);
      if (f.pecho.trim() && !(numCm(f.pecho) > 0))
        return setErr(`El contorno de pecho del talle ${f.talle.trim()} tiene que ser mayor a cero.`);
    }
    // ML no acepta una guía con medidas del cuerpo en algunos talles y no en otros.
    const conPecho = filas.filter((f) => f.pecho.trim()).length;
    if (conPecho > 0 && conPecho < filas.length)
      return setErr(
        "El contorno de pecho de la persona es opcional, pero si lo cargás tiene que ir en todos los talles.",
      );
    if (
      !window.confirm(
        `Se va a crear la guía "${nombreLimpio}" con ${filas.length} talle${filas.length === 1 ? "" : "s"} en tu cuenta de Mercado Libre. ¿Confirmás?`,
      )
    )
      return;
    setGuardando(true);
    try {
      const g = await api<GuiaTalles>("/ia/guias-talles", {
        method: "POST",
        body: JSON.stringify({
          categoria,
          genero,
          marca,
          nombre: nombreLimpio,
          filas: filas.map((f) => ({
            talle: f.talle.trim(),
            equivalencia_id: f.equivalencia,
            ancho_prenda_cm: numCm(f.ancho),
            largo_prenda_cm: f.largo.trim() ? numCm(f.largo) : undefined,
            pecho_persona_cm: f.pecho.trim() ? numCm(f.pecho) : undefined,
          })),
        }),
      });
      onCreada(g);
      setCreando(false);
      setFilas([filaVacia()]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  const selectTalle = (valor: string | undefined, onChange: (id: string) => void) => (
    <select
      value={sel?.filas.some((f) => f.id === valor) ? valor : ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={!sel}
      className={inputChico}
    >
      <option value="">Elegí el talle…</option>
      {sel?.filas.map((f) => (
        <option key={f.id} value={f.id}>
          {f.talle}
        </option>
      ))}
    </select>
  );

  return (
    <div className="rounded-lg border border-ink/10 p-3">
      <div className="mb-2 text-[12.5px] font-semibold text-ink/70">
        Guía de talles (la pide Mercado Libre para ropa)
      </div>
      {info.aviso && <div className="mb-2 text-[11.5px] text-ink/50">{info.aviso}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={creando ? "__nueva" : guiaId}
          onChange={(e) => {
            if (e.target.value === "__nueva") setCreando(true);
            else {
              setCreando(false);
              onElegir(e.target.value);
            }
          }}
          className={`${inputChico} min-w-0 flex-1`}
        >
          <option value="">{cargando ? "Buscando guías…" : "Elegí una guía…"}</option>
          {info.guias.map((g) => (
            <option key={g.id} value={g.id}>
              {g.nombre} ({g.filas.map((f) => f.talle).join(", ")})
            </option>
          ))}
          <option value="__nueva">+ Crear guía nueva</option>
        </select>
      </div>

      {creando && (
        <div className="mt-3 flex flex-col gap-2 rounded-lg bg-ink/[0.03] p-3">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-ink/50">Nombre de la guía</span>
            <input
              value={nombre}
              maxLength={60}
              onChange={(e) => setNombre(e.target.value)}
              className={inputChico}
            />
          </label>
          <div className="text-[11.5px] text-ink/45">
            Medidas de la remera en cm, apoyada plana: ancho de axila a axila y largo desde el hombro.
            Tienen que crecer de un talle al siguiente. El contorno de pecho de la persona es opcional.
          </div>
          {filas.map((f, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 border-t hairline pt-2 sm:grid-cols-6">
              <label className={celdaGuia}>
                <span className={rotuloGuia}>Talle</span>
                <input
                  value={f.talle}
                  onChange={(e) => cambiarFila(i, { talle: e.target.value })}
                  placeholder="ej: M"
                  className={inputChico}
                />
              </label>
              <label className={celdaGuia}>
                <span className={rotuloGuia}>Equivale a</span>
                <select
                  value={f.equivalencia}
                  onChange={(e) => cambiarFila(i, { equivalencia: e.target.value })}
                  className={inputChico}
                >
                  <option value="">Elegí…</option>
                  {info.equivalencias.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={celdaGuia}>
                <span className={rotuloGuia}>Ancho remera</span>
                <input
                  value={f.ancho}
                  onChange={(e) => cambiarFila(i, { ancho: e.target.value })}
                  inputMode="decimal"
                  placeholder="axila a axila"
                  className={inputChico}
                />
              </label>
              <label className={celdaGuia}>
                <span className={rotuloGuia}>Largo remera</span>
                <input
                  value={f.largo}
                  onChange={(e) => cambiarFila(i, { largo: e.target.value })}
                  inputMode="decimal"
                  placeholder="opcional"
                  className={inputChico}
                />
              </label>
              <label className={celdaGuia}>
                <span className={rotuloGuia}>Pecho persona</span>
                <input
                  value={f.pecho}
                  onChange={(e) => cambiarFila(i, { pecho: e.target.value })}
                  inputMode="decimal"
                  placeholder="opcional"
                  className={inputChico}
                />
              </label>
              {filas.length > 1 && (
                <button
                  type="button"
                  onClick={() => setFilas((s) => s.filter((_, j) => j !== i))}
                  className="self-center text-[16px] font-bold text-ink/35 hover:text-danger"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setFilas((s) => [...s, filaVacia()])}
            className="self-start text-[12.5px] font-semibold text-accent hover:text-accent-hover"
          >
            + agregar talle
          </button>
          {err && <div className="text-[12px] text-danger">{err}</div>}
          <div className="flex flex-wrap items-center gap-2">
            <PrimaryButton onClick={() => void crear()} disabled={guardando}>
              {guardando ? "Creando…" : "Crear guía en Mercado Libre"}
            </PrimaryButton>
            <GhostButton onClick={() => setCreando(false)} disabled={guardando}>
              Cancelar
            </GhostButton>
          </div>
        </div>
      )}

      {sel && (
        <div className="mt-3 flex flex-col gap-2 text-[13px]">
          {variantes ? (
            variantes.map((v) => (
              <div key={v.idx} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{v.nombre}</span>
                {selectTalle(v.talleFila, (id) => onTalleVariante(v.idx, id))}
              </div>
            ))
          ) : (
            <div className="flex items-center gap-2">
              <span className="flex-1">Talle</span>
              {selectTalle(talleUnico, onTalleUnico)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const normNombre = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z]/g, "");

interface ResultadoPublicar {
  permalink: string | null;
  pausada?: boolean;
  envio_verificado?: boolean;
  avisos: string[];
  items?: Array<{
    variante: string;
    ml_item_id: string;
    permalink: string | null;
    pausada: boolean;
    envio_verificado: boolean;
  }>;
}

// Sube fotos al bucket "publicaciones" (una por archivo) y devuelve sus URLs.
function NuevaPublicacionModal({
  onClose,
  onCreada,
}: {
  onClose: () => void;
  onCreada: () => void;
}) {
  // paso 1 — entrada
  const [desc, setDesc] = useState("");
  const [precioObj, setPrecioObj] = useState("");
  const [fotos, setFotos] = useState<string[]>([]);
  const [tieneVar, setTieneVar] = useState(false);
  const [eje, setEje] = useState("");
  const [vars, setVars] = useState<VarianteRow[]>(VARS_INICIAL());

  const [cargando, setCargando] = useState(false);
  const [err, setErr] = useState<string>();
  const [prop, setProp] = useState<PropuestaNueva>();

  // paso 2 — revisión
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [precio, setPrecio] = useState("");
  const [stock, setStock] = useState("1");
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [varAttrId, setVarAttrId] = useState("");
  const [publicando, setPublicando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoPublicar>();

  // guía de talles (moda): la elegida y el talle del caso sin variantes
  // (el de cada variante viaja dentro de su VarianteRow.talleFila)
  const [guiaId, setGuiaId] = useState("");
  const [talleUnico, setTalleUnico] = useState("");
  const [guiasInfo, setGuiasInfo] = useState<GuiasResp>();
  const [guiasCargando, setGuiasCargando] = useState(false);
  const [guiasErr, setGuiasErr] = useState<string>();
  // guías creadas en esta sesión: ML puede tardar en listarlas, se mezclan al refrescar
  const guiasCreadas = useRef<GuiaTalles[]>([]);

  // borrador en el servidor
  const [borradorListo, setBorradorListo] = useState(false);
  const [recuperado, setRecuperado] = useState<string>();
  const [borradorErr, setBorradorErr] = useState(false);
  // serializa PUT/DELETE del borrador para que un guardado tardío no pise un borrado
  const colaBorrador = useRef<Promise<unknown>>(Promise.resolve());
  // se incrementa al "Empezar de cero": frena las fotos con IA que siguen en curso
  const epoca = useRef(0);

  // fotos profesionales con IA: progreso/error por variante ("general" si no hay)
  const [gen, setGen] = useState<
    Record<string, { activo: boolean; texto?: string; err?: string }>
  >({});
  // Corta el polling al cerrar el modal (sin setState después de desmontar).
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);
  // Última versión del estado, para que el polling no lea valores viejos.
  const ult = useRef({ vars, fotos, titulo, desc });
  ult.current = { vars, fotos, titulo, desc };

  const varsListas = vars.filter((v) => v.nombre.trim());

  // ---- borrador: recuperar al abrir, guardar al cambiar ----
  const encolarBorrador = (fn: () => Promise<unknown>) => {
    const p = colaBorrador.current.then(fn);
    colaBorrador.current = p.catch(() => undefined);
    return p;
  };

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const r = await api<{ borrador: Partial<BorradorNueva> | null; guardado_at?: string }>(
          "/ia/borrador",
        );
        const b = r.borrador;
        if (cancelado || !b || b.v !== 1) return;
        setDesc(typeof b.desc === "string" ? b.desc : "");
        setPrecioObj(typeof b.precioObj === "string" ? b.precioObj : "");
        setFotos(Array.isArray(b.fotos) ? b.fotos : []);
        setTieneVar(!!b.tieneVar);
        setEje(typeof b.eje === "string" ? b.eje : "");
        setVars(Array.isArray(b.vars) && b.vars.length ? b.vars : VARS_INICIAL());
        setProp(b.prop ?? undefined);
        setTitulo(typeof b.titulo === "string" ? b.titulo : "");
        setDescripcion(typeof b.descripcion === "string" ? b.descripcion : "");
        setCategoriaId(typeof b.categoriaId === "string" ? b.categoriaId : "");
        setPrecio(typeof b.precio === "string" ? b.precio : "");
        setStock(typeof b.stock === "string" ? b.stock : "1");
        setAttrs(b.attrs && typeof b.attrs === "object" ? b.attrs : {});
        setVarAttrId(typeof b.varAttrId === "string" ? b.varAttrId : "");
        setGuiaId(typeof b.guiaId === "string" ? b.guiaId : "");
        setTalleUnico(typeof b.talleUnico === "string" ? b.talleUnico : "");
        setRecuperado(horaAR(r.guardado_at) || "antes");
      } catch {
        /* sin borrador o sin red: se arranca de cero */
      } finally {
        if (!cancelado) setBorradorListo(true);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  // Autosave con debounce. No guarda antes de terminar de cargar (pisaría el
  // borrador con el estado vacío) ni si no hay nada que valga la pena.
  useEffect(() => {
    if (!borradorListo || resultado) return;
    const hayAlgo =
      desc.trim() !== "" || fotos.length > 0 || vars.some((v) => v.fotos.length > 0) || !!prop;
    if (!hayAlgo) return;
    const t = setTimeout(() => {
      const borrador: BorradorNueva = {
        v: 1,
        desc,
        precioObj,
        fotos,
        tieneVar,
        eje,
        vars,
        prop,
        titulo,
        descripcion,
        categoriaId,
        precio,
        stock,
        attrs,
        varAttrId,
        guiaId,
        talleUnico,
      };
      encolarBorrador(() =>
        api("/ia/borrador", { method: "PUT", body: JSON.stringify(borrador) }),
      )
        .then(() => vivo.current && setBorradorErr(false))
        .catch(() => vivo.current && setBorradorErr(true));
    }, 1500);
    return () => clearTimeout(t);
  }, [
    borradorListo,
    resultado,
    desc,
    precioObj,
    fotos,
    tieneVar,
    eje,
    vars,
    prop,
    titulo,
    descripcion,
    categoriaId,
    precio,
    stock,
    attrs,
    varAttrId,
    guiaId,
    talleUnico,
  ]);

  function empezarDeCero() {
    epoca.current++;
    setDesc("");
    setPrecioObj("");
    setFotos([]);
    setTieneVar(false);
    setEje("");
    setVars(VARS_INICIAL());
    setProp(undefined);
    setTitulo("");
    setDescripcion("");
    setCategoriaId("");
    setPrecio("");
    setStock("1");
    setAttrs({});
    setVarAttrId("");
    setGuiaId("");
    setTalleUnico("");
    setGuiasInfo(undefined);
    guiasCreadas.current = [];
    setGen({});
    setErr(undefined);
    setRecuperado(undefined);
    setBorradorErr(false);
    encolarBorrador(() => api("/ia/borrador", { method: "DELETE" })).catch(() => undefined);
  }

  // ---- guía de talles: consulta cuando se conoce la categoría ----
  const generoSel = attrs["GENDER"]?.trim() || GENERO_DEFECTO;
  const marcaSel = attrs["BRAND"]?.trim() || MARCA_DEFECTO;
  const hayProp = !!prop;
  useEffect(() => {
    const cat = categoriaId.trim();
    if (!hayProp || !cat) {
      setGuiasInfo(undefined);
      return;
    }
    let cancelado = false;
    const t = setTimeout(async () => {
      setGuiasCargando(true);
      setGuiasErr(undefined);
      try {
        const r = await api<GuiasResp>(
          `/ia/guias-talles?categoria=${encodeURIComponent(cat)}&genero=${encodeURIComponent(generoSel)}&marca=${encodeURIComponent(marcaSel)}`,
        );
        if (cancelado) return;
        const extra = guiasCreadas.current.filter((g) => !r.guias.some((x) => x.id === g.id));
        setGuiasInfo({ ...r, guias: [...r.guias, ...extra] });
      } catch (e) {
        if (!cancelado) {
          setGuiasInfo(undefined);
          setGuiasErr((e as Error).message);
        }
      } finally {
        if (!cancelado) setGuiasCargando(false);
      }
    }, 600);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [hayProp, categoriaId, generoSel, marcaSel]);

  const guiaSel = guiasInfo?.guias.find((g) => g.id === guiaId);
  // Con una guía de una sola fila, todos los talles vacíos o inválidos van a esa.
  useEffect(() => {
    if (!guiaSel || guiaSel.filas.length !== 1) return;
    const f = guiaSel.filas[0].id;
    setTalleUnico((t) => (guiaSel.filas.some((x) => x.id === t) ? t : f));
    setVars((s) =>
      s.some((v) => !guiaSel.filas.some((x) => x.id === v.talleFila))
        ? s.map((v) =>
            guiaSel.filas.some((x) => x.id === v.talleFila) ? v : { ...v, talleFila: f },
          )
        : s,
    );
  }, [guiaSel]);

  const conVarPub = tieneVar && varsListas.length > 0;
  const guiaIncompleta =
    !!guiasInfo?.requiere &&
    (!guiaSel ||
      (conVarPub
        ? varsListas.some((v) => !guiaSel.filas.some((x) => x.id === v.talleFila))
        : !guiaSel.filas.some((x) => x.id === talleUnico)));
  const talleDe = (filaId: string | undefined) =>
    guiaSel?.filas.find((x) => x.id === filaId);

  // Encarga 3 fotos profesionales (portada, detalle, ambiente) y las va
  // consultando cada 5 s. Las listas se ponen AL FRENTE de las fotos de esa
  // variante (o de las generales si no hay variantes).
  async function generarFotosPro(clave: number | "general") {
    const k = String(clave);
    const ep = epoca.current;
    const activo = () => vivo.current && ep === epoca.current;
    const { vars: vs, fotos: fg, titulo: t, desc: d } = ult.current;
    const v = clave === "general" ? undefined : vs[clave];
    const imagenes = [...new Set([...(v?.fotos ?? []), ...fg])].slice(0, 8);
    if (!imagenes.length) return;
    const marca = (x: { activo: boolean; texto?: string; err?: string }) => {
      if (activo()) setGen((g) => ({ ...g, [k]: x }));
    };
    marca({ activo: true, texto: "Encargando fotos…" });
    try {
      const enc = await api<{
        tareas: Array<{ tipo: string; taskId: string }>;
        costo_usd: number;
      }>("/ia/fotos-pro/encargar", {
        method: "POST",
        body: JSON.stringify({
          imagenes,
          producto: t.trim() || d.trim(),
          variante: v?.nombre.trim() || undefined,
        }),
      });
      const listas: Array<string | undefined> = enc.tareas.map(() => undefined);
      const fallos: string[] = [];
      const pendientes = new Set(enc.tareas.map((_, i) => i));
      const limite = Date.now() + 6 * 60_000;
      let vencio = false;
      while (pendientes.size && activo()) {
        if (Date.now() > limite) {
          vencio = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 5000));
        if (!activo()) return;
        await Promise.all(
          [...pendientes].map(async (i) => {
            try {
              const r = await api<{ estado: string; url?: string; detalle?: string }>(
                `/ia/fotos-pro/${encodeURIComponent(enc.tareas[i].taskId)}`,
              );
              if (r.estado === "listo" && r.url) {
                listas[i] = r.url;
                pendientes.delete(i);
              } else if (r.estado === "error") {
                fallos.push(`${enc.tareas[i].tipo}: ${r.detalle ?? "falló"}`);
                pendientes.delete(i);
              }
            } catch {
              /* error de red puntual: se reintenta en la próxima vuelta */
            }
          }),
        );
        const hechas = enc.tareas.length - pendientes.size - fallos.length;
        marca({
          activo: true,
          texto: `Generando fotos… ${hechas}/${enc.tareas.length} listas`,
        });
      }
      if (!activo()) return;
      const nuevas = listas.filter((u): u is string => !!u);
      if (nuevas.length) {
        const alFrente = (act: string[]) => [
          ...nuevas,
          ...act.filter((u) => !nuevas.includes(u)),
        ];
        if (clave === "general") setFotos(alFrente);
        else
          setVars((s) =>
            s.map((x, j) => (j === clave ? { ...x, fotos: alFrente(x.fotos) } : x)),
          );
      }
      const problemas = [
        ...(vencio ? ["se agotó el tiempo de espera (6 min); reintentá en un rato"] : []),
        ...fallos,
      ];
      marca({
        activo: false,
        texto: nuevas.length
          ? `Listo: ${nuevas.length} foto${nuevas.length === 1 ? "" : "s"} nueva${nuevas.length === 1 ? "" : "s"} al principio.`
          : undefined,
        err: problemas.length ? problemas.join(" · ") : undefined,
      });
    } catch (e) {
      marca({ activo: false, err: (e as Error).message });
    }
  }

  function generarTodas() {
    ult.current.vars.forEach((v, i) => {
      if (v.nombre.trim() && v.fotos.length > 0 && !gen[String(i)]?.activo)
        void generarFotosPro(i);
    });
  }

  const botonFotosPro = (clave: number | "general", sinFotos: boolean) => {
    const g = gen[String(clave)];
    return (
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <GhostButton
            onClick={() => void generarFotosPro(clave)}
            disabled={!!g?.activo || sinFotos}
          >
            {g?.activo ? "Generando…" : "Generar 3 fotos profesionales con IA"}
          </GhostButton>
          {g?.texto && <span className="text-[12px] text-ink/60">{g.texto}</span>}
        </div>
        {g?.err && <div className="text-[12px] text-danger">{g.err}</div>}
      </div>
    );
  };

  async function generar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setErr(undefined);
    try {
      const r = await api<PropuestaNueva>("/ia/nueva", {
        method: "POST",
        body: JSON.stringify({
          descripcion: desc.trim(),
          precio: precioObj ? Number(precioObj) : undefined,
          imagenes: fotos,
          variantes:
            tieneVar && varsListas.length
              ? {
                  eje: eje.trim() || "Variante",
                  valores: varsListas.map((v) => v.nombre.trim()),
                }
              : undefined,
        }),
      });
      setProp(r);
      setTitulo(r.propuesta.titulo);
      setDescripcion(r.propuesta.descripcion);
      setCategoriaId(r.categoria?.id ?? "");
      setPrecio(String(r.propuesta.precio_sugerido ?? precioObj ?? ""));
      setVarAttrId(r.variacion?.sugerido_id ?? "");
      // prefill de atributos requeridos con lo que la IA dedujo
      const pre: Record<string, string> = {};
      for (const req of r.atributos_requeridos) {
        const m = r.propuesta.atributos_sugeridos.find(
          (s) => normNombre(s.nombre) === normNombre(req.nombre),
        );
        if (m) pre[req.id] = m.valor;
      }
      setAttrs(pre);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  async function publicar() {
    if (guiaIncompleta) return;
    const hayVar = tieneVar && varsListas.length > 0;
    if (
      !window.confirm(
        hayVar
          ? `Se van a crear ${varsListas.length} publicaciones en Mercado Libre, una por variante, todas EN PAUSA. ML las agrupa en la misma familia. Las revisás y activás desde ML. ¿Confirmás?`
          : "Se va a crear la publicación en Mercado Libre EN PAUSA. La revisás y activás desde ML. ¿Confirmás?",
      )
    )
      return;
    setPublicando(true);
    setErr(undefined);
    try {
      const conVar = tieneVar && varsListas.length > 0;
      const ejeNombre =
        prop?.variacion?.atributos.find((a) => a.id === varAttrId)?.nombre ||
        eje.trim() ||
        "Variante";
      const r = await api<ResultadoPublicar>(
        "/ia/publicar",
        {
          method: "POST",
          body: JSON.stringify({
            titulo,
            descripcion,
            categoria_id: categoriaId,
            precio: Number(precio),
            stock: Number(stock) || 1,
            imagenes: fotos,
            guia_talles: guiasInfo?.requiere && guiaSel ? { id: guiaSel.id } : undefined,
            talle_fila:
              guiasInfo?.requiere && !conVar && talleDe(talleUnico)
                ? talleDe(talleUnico)
                : undefined,
            atributos: Object.entries(attrs)
              .filter(([, v]) => v.trim())
              .map(([id, value_name]) => ({ id, value_name: value_name.trim() })),
            variantes: conVar
              ? {
                  atributo_id: varAttrId || undefined,
                  atributo_nombre: ejeNombre,
                  items: varsListas.map((v) => ({
                    value_name: v.nombre.trim(),
                    imagenes: v.fotos,
                    stock: Number(v.stock) || 1,
                    talle_fila:
                      guiasInfo?.requiere && talleDe(v.talleFila)
                        ? talleDe(v.talleFila)
                        : undefined,
                  })),
                }
              : undefined,
          }),
        },
      );
      setResultado(r);
      // publicada: el borrador ya no hace falta (cerrar con × NO lo borra)
      encolarBorrador(() => api("/ia/borrador", { method: "DELETE" })).catch(() => undefined);
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

        {!resultado && recuperado && (
          <div className="mb-3 flex flex-wrap items-center gap-x-2 text-[12px] text-ink/55">
            <span>Recuperé el borrador guardado ({recuperado}).</span>
            <button
              type="button"
              onClick={empezarDeCero}
              className="font-semibold text-accent hover:text-accent-hover"
            >
              Empezar de cero
            </button>
          </div>
        )}
        {borradorErr && !resultado && (
          <div className="mb-2 text-[11px] text-ink/40">No se pudo guardar el borrador</div>
        )}

        {!borradorListo ? (
          <div className="py-6 text-center text-[12.5px] text-ink/45">Buscando borrador…</div>
        ) : resultado ? (
          <div className="flex flex-col gap-3 text-[13.5px]">
            <div className="rounded-lg bg-ok-bg px-3 py-2 text-ok">
              Publicación creada. <b>{resultado.pausada ? "En pausa." : "Revisá su estado en Mercado Libre."}</b>
              {resultado.envio_verificado
                ? " Mercado Envíos sin Flex verificado."
                : " Revisá el envío antes de activarla."}
            </div>
            {resultado.avisos?.length > 0 && (
              <ul className="list-disc rounded-lg bg-warn-bg px-5 py-2 text-[12px] text-warn">
                {resultado.avisos.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            )}
            {resultado.items && resultado.items.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {resultado.items.map((it) => (
                  <li key={it.ml_item_id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{it.variante}</span>
                    {it.permalink ? (
                      <a
                        href={it.permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-accent"
                      >
                        Abrir en Mercado Libre →
                      </a>
                    ) : (
                      <span className="text-[12px] text-ink/40">{it.ml_item_id}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              resultado.permalink && (
                <a
                  href={resultado.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-accent"
                >
                  Abrir en Mercado Libre →
                </a>
              )
            )}
            <PrimaryButton onClick={onClose}>Cerrar</PrimaryButton>
          </div>
        ) : !prop ? (
          <form onSubmit={generar} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] text-ink/50">
                ¿Qué es el producto?
              </span>
              <textarea
                autoFocus
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={3}
                placeholder="ej: llavero 3D con el logo de NewJeans, PLA, 5 cm, varios colores"
                className="rounded-lg border border-ink/12 px-3 py-2.5 text-[13.5px] outline-none focus:border-accent"
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-[12.5px] text-ink/50">
                Fotos del producto
              </span>
              <SubirFotos fotos={fotos} onChange={setFotos} max={10} />
            </div>

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

            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={tieneVar}
                onChange={(e) => setTieneVar(e.target.checked)}
              />
              <span>La publicación tiene variantes</span>
            </label>

            {tieneVar && (
              <div className="flex flex-col gap-3 rounded-lg border border-ink/10 p-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12.5px] text-ink/50">
                    ¿Por qué varían? (eje)
                  </span>
                  <input
                    value={eje}
                    onChange={(e) => setEje(e.target.value)}
                    placeholder="ej: Personaje, Color, Modelo"
                    className="rounded-lg border border-ink/12 px-3 py-2 text-[13px] outline-none focus:border-accent"
                  />
                </label>
                {vars.map((v, i) => (
                  <div
                    key={i}
                    className="flex flex-col gap-2 border-t hairline pt-3 first:border-t-0 first:pt-0"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        value={v.nombre}
                        onChange={(e) =>
                          setVars((s) =>
                            s.map((x, j) =>
                              j === i ? { ...x, nombre: e.target.value } : x,
                            ),
                          )
                        }
                        placeholder={`Variante ${i + 1} (ej: Jimin)`}
                        className="min-w-0 flex-1 rounded-lg border border-ink/12 px-3 py-2 text-[13px] outline-none focus:border-accent"
                      />
                      <input
                        value={v.stock}
                        onChange={(e) =>
                          setVars((s) =>
                            s.map((x, j) =>
                              j === i ? { ...x, stock: e.target.value } : x,
                            ),
                          )
                        }
                        inputMode="numeric"
                        className="w-16 rounded-lg border border-ink/12 px-2 py-2 text-center text-[13px] outline-none focus:border-accent"
                        title="Stock"
                      />
                      {vars.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setVars((s) => s.filter((_, j) => j !== i))
                          }
                          className="text-[16px] font-bold text-ink/35 hover:text-danger"
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <SubirFotos
                      fotos={v.fotos}
                      onChange={(f) =>
                        setVars((s) =>
                          s.map((x, j) => (j === i ? { ...x, fotos: f } : x)),
                        )
                      }
                      max={6}
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setVars((s) => [...s, { nombre: "", fotos: [], stock: "1" }])
                  }
                  className="self-start text-[12.5px] font-semibold text-accent hover:text-accent-hover"
                >
                  + agregar variante
                </button>
              </div>
            )}

            {err && <div className="text-[12.5px] text-danger">{err}</div>}
            <PrimaryButton type="submit" disabled={cargando}>
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
              {(!tieneVar || varsListas.length === 0) && (
                <Field label="Stock inicial">
                  <input
                    value={stock}
                    onChange={(e) => setStock(e.target.value)}
                    inputMode="numeric"
                    className="w-full bg-transparent outline-none"
                  />
                </Field>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-[12.5px] text-ink/50">
                {tieneVar && varsListas.length > 0
                  ? "Fotos generales (se agregan al final de cada variante)"
                  : "Fotos del producto"}
              </span>
              <SubirFotos fotos={fotos} onChange={setFotos} max={10} />
              {!(tieneVar && varsListas.length > 0) && (
                <>
                  {botonFotosPro("general", fotos.length === 0)}
                  <span className="text-[11.5px] text-ink/40">
                    Usa 3 imágenes de IA (≈ US$ 0,27)
                  </span>
                </>
              )}
            </div>

            {tieneVar && varsListas.length > 0 && (
              <div className="rounded-lg border border-ink/10 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[12.5px] text-ink/50">
                  <span className="flex-1">
                    Variantes ({varsListas.length}) · precio y stock por fila
                  </span>
                  <GhostButton
                    onClick={generarTodas}
                    disabled={
                      !varsListas.some((v) => v.fotos.length > 0) ||
                      Object.values(gen).some((g) => g.activo)
                    }
                  >
                    Generar fotos para todas las variantes
                  </GhostButton>
                </div>
                <div className="mb-2 text-[11.5px] text-ink/40">
                  Cada variante usa 3 imágenes de IA (≈ US$ 0,27)
                </div>
                {prop.variacion && prop.variacion.atributos.length > 0 && (
                  <label className="mb-3 flex flex-col gap-1">
                    <span className="text-[12px] text-ink/50">
                      Atributo de Mercado Libre para el eje
                    </span>
                    <select
                      value={varAttrId}
                      onChange={(e) => setVarAttrId(e.target.value)}
                      className="rounded-lg border border-ink/12 px-2 py-1.5 text-[12.5px] outline-none focus:border-accent"
                    >
                      <option value="">Texto libre ({eje || "Variante"})</option>
                      {prop.variacion.atributos.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.nombre}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="flex flex-col gap-2">
                  {varsListas.map((v) => {
                    const idx = vars.indexOf(v);
                    return (
                      <div
                        key={idx}
                        className="flex flex-col gap-2 border-t hairline pt-3 text-[13px] first:border-t-0 first:pt-0"
                      >
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate font-semibold">
                            {v.nombre}
                          </span>
                          <input
                            value={v.stock}
                            onChange={(e) =>
                              setVars((s) =>
                                s.map((x, j) =>
                                  j === idx ? { ...x, stock: e.target.value } : x,
                                ),
                              )
                            }
                            inputMode="numeric"
                            title="Stock"
                            className="w-16 rounded-md border border-ink/12 px-2 py-1 text-center outline-none focus:border-accent"
                          />
                        </div>
                        <SubirFotos
                          fotos={v.fotos}
                          onChange={(f) =>
                            setVars((s) =>
                              s.map((x, j) => (j === idx ? { ...x, fotos: f } : x)),
                            )
                          }
                          max={10}
                        />
                        {botonFotosPro(idx, v.fotos.length === 0 && fotos.length === 0)}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {guiasErr && (
              <div className="text-[12px] text-ink/50">
                No pude consultar las guías de talles: {guiasErr}
              </div>
            )}
            {guiasInfo?.requiere && (
              <GuiaTallesSeccion
                categoria={categoriaId.trim()}
                genero={generoSel}
                marca={marcaSel}
                info={guiasInfo}
                cargando={guiasCargando}
                guiaId={guiaId}
                onElegir={setGuiaId}
                onCreada={(g) => {
                  guiasCreadas.current = [...guiasCreadas.current, g];
                  setGuiasInfo((i) => (i ? { ...i, guias: [...i.guias, g] } : i));
                  setGuiaId(g.id);
                }}
                variantes={
                  conVarPub
                    ? varsListas.map((v) => ({
                        idx: vars.indexOf(v),
                        nombre: v.nombre,
                        talleFila: v.talleFila,
                      }))
                    : null
                }
                talleUnico={talleUnico}
                onTalleUnico={setTalleUnico}
                onTalleVariante={(idx, id) =>
                  setVars((s) => s.map((x, j) => (j === idx ? { ...x, talleFila: id } : x)))
                }
              />
            )}

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
                        list={`nv-${a.id}`}
                        className="w-full bg-transparent outline-none"
                      />
                      {a.valores.length > 0 && (
                        <datalist id={`nv-${a.id}`}>
                          {a.valores.map((v) => (
                            <option key={v} value={v} />
                          ))}
                        </datalist>
                      )}
                    </Field>
                  ))}
                </div>
              </div>
            )}
            {err && <div className="text-[12.5px] text-danger">{err}</div>}
            {guiaIncompleta && (
              <div className="text-[12.5px] text-warn">
                Esta categoría (moda) pide una guía de talles: elegí o creá una y asigná el talle
                de cada variante.
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 border-t hairline pt-4">
              <button
                onClick={publicar}
                disabled={publicando || guiaIncompleta}
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
  const [monto, setMonto] = useState("");
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

  function aplicarMonto() {
    const m = Number(monto);
    if (!Number.isFinite(m) || m === 0) return;
    const next: Record<string, string> = {};
    for (const it of lista) {
      if (it.precio == null) continue;
      next[it.id] = String(Math.max(0, Math.round(it.precio + m)));
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

        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="w-28 shrink-0 text-[12.5px] text-ink/50">
            Ajuste por %:
          </span>
          <input
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            placeholder="ej: 10 o -5"
            inputMode="numeric"
            className="w-24 rounded-lg border border-ink/12 px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
          />
          <span className="text-[12.5px] text-ink/50">%</span>
          <GhostButton onClick={aplicarPct}>Aplicar a todas</GhostButton>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="w-28 shrink-0 text-[12.5px] text-ink/50">
            Ajuste por monto:
          </span>
          <span className="text-[12.5px] text-ink/50">$</span>
          <input
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            placeholder="ej: 1000 o -500"
            inputMode="numeric"
            className="w-24 rounded-lg border border-ink/12 px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
          />
          <GhostButton onClick={aplicarMonto}>Aplicar a todas</GhostButton>
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

interface PlanResp {
  categoria_actual: { id: string; path: string };
  categoria_nueva: { id: string; path: string };
  atributos_faltantes: Array<{ id: string; nombre: string; valores: string[] }>;
  preview: {
    titulo: string;
    precio: number | null;
    moneda: string;
    listing_type_id: string;
    condicion: string;
    fotos: number;
    variaciones: number;
    atributos: number;
  };
}
interface RepubResp {
  nuevo_item_id: string;
  permalink: string | null;
  cerrada_vieja: boolean;
  envio_verificado: boolean;
  avisos: string[];
}

function CategoriaModal({
  publicacion,
  onClose,
  onHecho,
}: {
  publicacion: PublicacionApi;
  onClose: () => void;
  onHecho: () => void;
}) {
  const analisis = publicacion.categoria_analisis;
  const [catId, setCatId] = useState(
    analisis?.sugerida_id ?? analisis?.actual_id ?? "",
  );
  const [otra, setOtra] = useState("");
  const [plan, setPlan] = useState<PlanResp>();
  const [cargandoPlan, setCargandoPlan] = useState(false);
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string>();
  const [ejecutando, setEjecutando] = useState(false);
  const [resultado, setResultado] = useState<RepubResp>();

  const [busq, setBusq] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [extra, setExtra] = useState<CategoriaCand[]>([]); // resultados de búsqueda + "mis categorías"

  async function buscarCat(q: string) {
    setBuscando(true);
    try {
      const r = await api<{ resultados: CategoriaCand[] }>(
        `/seo/categorias?q=${encodeURIComponent(q)}`,
      );
      setExtra(r.resultados.map((x) => ({ ...x, fuente: "ml" as const })));
    } catch {
      setExtra([]);
    } finally {
      setBuscando(false);
    }
  }

  async function verMisCategorias() {
    setBuscando(true);
    try {
      const r = await api<{ propias: CategoriaCand[] }>("/seo/categorias");
      setExtra(r.propias.map((x) => ({ ...x, fuente: "propia" as const })));
    } catch {
      setExtra([]);
    } finally {
      setBuscando(false);
    }
  }

  const candBase = analisis?.candidatas ?? [];
  const candidatas: CategoriaCand[] = [
    ...candBase,
    ...extra.filter((e) => !candBase.some((b) => b.id === e.id)),
  ];

  const objetivo = otra.trim() || catId;

  useEffect(() => {
    let vivo = true;
    setCargandoPlan(true);
    setErr(undefined);
    const t = setTimeout(() => {
      api<PlanResp>(`/seo/publicacion/${publicacion.id}/plan`, {
        method: "POST",
        body: JSON.stringify({ categoria_id: objetivo || undefined }),
      })
        .then((r) => {
          if (!vivo) return;
          setPlan(r);
          setAttrs({});
        })
        .catch((e: Error) => vivo && setErr(e.message))
        .finally(() => vivo && setCargandoPlan(false));
    }, 500);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [publicacion.id, objetivo]);

  const faltanAttrs =
    plan?.atributos_faltantes.some((a) => !(attrs[a.id] ?? "").trim()) ?? false;
  const tieneVariantes = (plan?.preview.variaciones ?? 0) > 0;

  async function republicar() {
    if (
      !window.confirm(
        "Se va a CREAR una publicación nueva EN PAUSA en la categoría elegida y CERRAR la actual en Mercado Libre. La nueva pierde historial, preguntas y posición de búsqueda. ¿Confirmás?",
      )
    )
      return;
    setEjecutando(true);
    setErr(undefined);
    try {
      const r = await api<RepubResp>(
        `/seo/publicacion/${publicacion.id}/republicar`,
        {
          method: "POST",
          body: JSON.stringify({
            categoria_id: plan?.categoria_nueva.id ?? objetivo,
            atributos_extra: Object.entries(attrs)
              .filter(([, v]) => v.trim())
              .map(([id, value_name]) => ({ id, value_name: value_name.trim() })),
          }),
        },
      );
      setResultado(r);
      onHecho();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setEjecutando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto scrim p-4 sm:p-8">
      <div className="w-full max-w-2xl rounded-[14px] border bg-surface p-6 hairline">
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 className="text-[16px] font-semibold">Mover a la categoría correcta</h2>
          <button
            onClick={onClose}
            className="text-[18px] font-bold text-ink/40 hover:text-ink"
          >
            ×
          </button>
        </div>
        <p className="mb-4 text-[12.5px] text-ink/50">{publicacion.titulo}</p>

        {resultado ? (
          <div className="flex flex-col gap-3 text-[13.5px]">
            <div className="rounded-lg bg-ok-bg px-3 py-2 text-ok">
              Publicación nueva creada <b>en pausa</b> (#{resultado.nuevo_item_id}).
              {resultado.cerrada_vieja
                ? " La vieja quedó cerrada."
                : " Ojo: la vieja NO se pudo cerrar, hacelo a mano."}
              {resultado.envio_verificado && " Mercado Envíos sin Flex verificado."}
            </div>
            {resultado.permalink && (
              <a
                href={resultado.permalink}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-accent"
              >
                Abrir la nueva en Mercado Libre →
              </a>
            )}
            {resultado.avisos.length > 0 && (
              <ul className="list-disc rounded-lg bg-warn-bg px-5 py-2 text-[12px] text-warn">
                {resultado.avisos.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            )}
            <p className="text-[12px] text-ink/45">
              Revisá la nueva en Mercado Libre y activala cuando esté OK. Después
              corré Configuración → Catálogo → “Derivar” si tocaste holders.
            </p>
            <PrimaryButton onClick={onClose}>Cerrar</PrimaryButton>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {analisis && (
              <div className="rounded-lg bg-ink/[0.03] px-3 py-2.5 text-[12.5px] text-ink/70">
                <div className="mb-1">
                  <b>Ahora:</b> {analisis.actual_path}
                </div>
                <div className="text-ink/55">
                  {analisis.motivo} · confianza {analisis.confianza}
                </div>
              </div>
            )}

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[12.5px] text-ink/50">Categoría nueva</span>
                <button
                  onClick={verMisCategorias}
                  className="text-[12px] font-semibold text-accent hover:text-accent-hover"
                >
                  ver todas las que uso
                </button>
              </div>
              <div className="flex max-h-[240px] flex-col gap-0.5 overflow-y-auto rounded-lg border border-ink/10 p-1">
                {candidatas.map((cand) => (
                  <label
                    key={cand.id}
                    className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-[12.5px] hover:bg-ink/[0.03]"
                  >
                    <input
                      type="radio"
                      className="mt-0.5"
                      checked={!otra.trim() && catId === cand.id}
                      onChange={() => {
                        setOtra("");
                        setCatId(cand.id);
                      }}
                    />
                    <span className="min-w-0">
                      {cand.fuente === "propia" && (
                        <span className="mr-1.5 rounded bg-accent-soft px-1 py-0.5 text-[10px] font-bold text-accent">
                          {cand.usos ? `usás ×${cand.usos}` : "la usás"}
                        </span>
                      )}
                      {cand.path}{" "}
                      <span className="text-ink/35">({cand.id})</span>
                    </span>
                  </label>
                ))}
                {candidatas.length === 0 && (
                  <div className="px-2 py-1.5 text-[12px] text-ink/40">
                    Sin candidatas. Buscá abajo.
                  </div>
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={busq}
                  onChange={(e) => setBusq(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && busq.trim()) buscarCat(busq.trim());
                  }}
                  placeholder="Buscar otra categoría (ej: mostacillas)"
                  className="min-w-0 flex-1 rounded border border-ink/12 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent"
                />
                <button
                  onClick={() => busq.trim() && buscarCat(busq.trim())}
                  disabled={buscando}
                  className="rounded bg-accent-soft px-2.5 py-1.5 text-[12px] font-semibold text-accent disabled:opacity-50"
                >
                  {buscando ? "…" : "Buscar"}
                </button>
              </div>

              <label className="mt-1.5 flex items-center gap-2 px-1 text-[12px] text-ink/55">
                <input
                  type="radio"
                  checked={!!otra.trim()}
                  onChange={() => setOtra(analisis?.actual_id ?? "MLA")}
                />
                <span>Pegar ID a mano:</span>
                <input
                  value={otra}
                  onChange={(e) => setOtra(e.target.value)}
                  placeholder="MLA…"
                  className="w-32 rounded border border-ink/12 px-2 py-1 outline-none focus:border-accent"
                />
              </label>
            </div>

            {cargandoPlan && (
              <div className="text-[12.5px] text-ink/40">Calculando…</div>
            )}

            {plan && !cargandoPlan && (
              <>
                <div className="rounded-lg border border-ink/10 px-3 py-2.5 text-[12.5px]">
                  <div className="mb-1 font-semibold text-ink/70">
                    Se va a re-crear con:
                  </div>
                  <div className="text-ink/60">
                    {plan.categoria_nueva.path}{" "}
                    <span className="text-ink/35">
                      ({plan.categoria_nueva.id})
                    </span>
                  </div>
                  <div className="mt-1 text-ink/45">
                    {plan.preview.fotos} fotos · {plan.preview.variaciones}{" "}
                    variaciones · {plan.preview.atributos} atributos ·{" "}
                    {plan.preview.listing_type_id}
                  </div>
                </div>

                {plan.atributos_faltantes.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-[12.5px] text-ink/50">
                      La categoría nueva pide estos atributos (obligatorios)
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {plan.atributos_faltantes.map((a) => (
                        <label key={a.id} className="flex flex-col gap-1">
                          <span className="text-[12px] text-ink/50">
                            {a.nombre}
                          </span>
                          <input
                            value={attrs[a.id] ?? ""}
                            onChange={(e) =>
                              setAttrs((s) => ({ ...s, [a.id]: e.target.value }))
                            }
                            list={`vals-${a.id}`}
                            className="rounded border border-ink/12 px-2 py-1.5 text-[12.5px] outline-none focus:border-accent"
                          />
                          {a.valores.length > 0 && (
                            <datalist id={`vals-${a.id}`}>
                              {a.valores.map((v) => (
                                <option key={v} value={v} />
                              ))}
                            </datalist>
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {err && <div className="text-[12.5px] text-danger">{err}</div>}

            {tieneVariantes ? (
              <div className="rounded-lg bg-danger-bg px-3 py-2 text-[12px] text-danger">
                Esta publicación tiene <b>{plan?.preview.variaciones} variantes</b>.
                Mercado Libre cambió el modelo de publicación (User Products) y
                recrearlas por API rompería el stock del catálogo. Cambiale la
                categoría <b>desde la web de Mercado Libre</b> (Editar → mover /
                re-publicar).
              </div>
            ) : (
              <div className="rounded-lg bg-warn-bg px-3 py-2 text-[12px] text-warn">
                Crea una publicación nueva (en pausa) y cierra la actual. La nueva
                arranca sin historial, preguntas ni posición de búsqueda. El
                título y el envío los define Mercado Libre — revisalos.
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 border-t hairline pt-4">
              <button
                onClick={republicar}
                disabled={
                  ejecutando ||
                  cargandoPlan ||
                  !plan ||
                  faltanAttrs ||
                  tieneVariantes
                }
                className="rounded-[9px] bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {ejecutando ? "Re-publicando…" : "Re-publicar en esta categoría"}
              </button>
              <GhostButton onClick={onClose}>Cancelar</GhostButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
