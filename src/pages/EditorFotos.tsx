import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Badge,
  Card,
  EmptyHint,
  GhostButton,
  PageHeader,
  PrimaryButton,
  cx,
} from "@/components/ui";
import { SubirFotos } from "@/components/SubirFotos";
import { api, useApi } from "@/lib/api";

// Costo por foto editada con Nano Banana Pro en kie.ai (2K). Referencia: la
// verdad está en el dashboard de kie.ai.
const USD_POR_FOTO = 0.09;
// kie.ai encola del lado de ellos: con 6 encargos a la vez la tanda avanza
// rápido sin mandar las 90 fotos de golpe.
const EDICIONES_EN_PARALELO = 6;
const CONSULTA_MS = 5000;

type Modo = "borrar" | "agregar";
type EstadoItem =
  | "pendiente"
  | "descartada"
  | "para_editar"
  | "editando"
  | "revisar"
  | "aprobada"
  | "rechazada"
  | "error";

interface PublicacionFotos {
  id: string;
  ml_item_id: string;
  titulo: string;
  estado: string;
  thumbnail: string | null;
  foto_ids: string[];
}

interface LoteResumen {
  id: string;
  modo: Modo;
  descripcion: string;
  created_at: string;
  ml_item_ids: string[];
  conteo: Partial<Record<EstadoItem, number>>;
  publicaciones_aplicadas: number;
}

interface ItemFoto {
  id: string;
  ml_picture_id: string;
  original_url: string;
  ml_item_ids: string[];
  estado: EstadoItem;
  deteccion: { aplica?: boolean; donde?: string; motivo?: string } | null;
  nota: string | null;
  editada_url: string | null;
  intentos: number;
  kie_task_id: string | null;
  nuevo_ml_picture_id: string | null;
  error: string | null;
}

interface Aplicada {
  ml_item_id: string;
  estado: "aplicada" | "deshecha" | "error";
  error: string | null;
  reemplazos: Record<string, string>;
}

interface LoteDetalle {
  lote: {
    id: string;
    modo: Modo;
    descripcion: string;
    ubicacion: string | null;
    referencias: string[];
    ml_item_ids: string[];
    created_at: string;
  };
  items: ItemFoto[];
  aplicadas: Aplicada[];
  publicaciones: Array<{ id: string; ml_item_id: string; titulo: string; thumbnail: string | null; estado: string }>;
}

interface PropuestaTexto {
  listing_id: string;
  ml_item_id: string;
  titulo_actual: string;
  titulo_nuevo: string | null;
  descripcion_actual: string;
  descripcion_nueva: string | null;
  motivo: string;
}

const usd = (n: number) => `USD ${n.toFixed(2).replace(".", ",")}`;

export function EditorFotos() {
  const [params, setParams] = useSearchParams();
  const loteId = params.get("lote");
  return (
    <div>
      <PageHeader
        titulo="Editor de fotos"
        subtitulo="Borrá o agregá un objeto en todas las fotos publicadas. Nada llega a Mercado Libre sin que lo apruebes."
        acciones={
          <Link
            to={loteId ? "/publicaciones/fotos" : "/publicaciones"}
            className="rounded-[9px] border border-ink/12 px-4 py-2.5 text-[13.5px] font-semibold text-ink transition-colors hover:bg-ink/[0.03]"
          >
            {loteId ? "← Lotes" : "← Publicaciones"}
          </Link>
        }
      />
      {loteId ? (
        <VistaLote id={loteId} />
      ) : (
        <>
          <NuevoLote onCreado={(id) => setParams({ lote: id })} />
          <LotesAnteriores onAbrir={(id) => setParams({ lote: id })} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nuevo lote
// ---------------------------------------------------------------------------

function NuevoLote({ onCreado }: { onCreado: (id: string) => void }) {
  const { data, error, loading } = useApi<{ publicaciones: PublicacionFotos[] }>("/fotos/publicaciones");
  const [modo, setModo] = useState<Modo>("borrar");
  const [descripcion, setDescripcion] = useState("");
  const [ubicacion, setUbicacion] = useState("");
  const [referencias, setReferencias] = useState<string[]>([]);
  const [filtro, setFiltro] = useState("");
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [creando, setCreando] = useState(false);
  const [err, setErr] = useState<string>();

  const pubs = data?.publicaciones ?? [];
  const visibles = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    return f ? pubs.filter((p) => p.titulo.toLowerCase().includes(f)) : pubs;
  }, [pubs, filtro]);
  const fotosDistintas = useMemo(() => {
    const ids = new Set<string>();
    for (const p of pubs) if (elegidas.has(p.ml_item_id)) p.foto_ids.forEach((id) => ids.add(id));
    return ids.size;
  }, [pubs, elegidas]);

  const alternar = (id: string) =>
    setElegidas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const faltante = !descripcion.trim()
    ? "Describí el objeto."
    : modo === "agregar" && !referencias.length
      ? "Subí una foto del objeto nuevo."
      : !elegidas.size
        ? "Elegí al menos una publicación."
        : null;

  async function crear() {
    if (faltante) return;
    setErr(undefined);
    setCreando(true);
    try {
      const r = await api<{ id: string }>("/fotos/lotes", {
        method: "POST",
        body: JSON.stringify({
          modo,
          descripcion,
          ubicacion,
          referencias,
          ml_item_ids: [...elegidas],
        }),
      });
      onCreado(r.id);
    } catch (e) {
      setErr((e as Error).message);
      setCreando(false);
    }
  }

  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-[15px] font-semibold">Nuevo lote</h2>

      <div className="mb-5 inline-flex gap-1 rounded-[9px] bg-ink/[0.05] p-[3px]">
        {(["borrar", "agregar"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setModo(m)}
            className={cx(
              "rounded-[7px] px-3.5 py-1.5 text-[13px] font-semibold transition-colors",
              modo === m ? "bg-surface shadow-sm" : "text-ink/50",
            )}
          >
            {m === "borrar" ? "Borrar un objeto" : "Agregar un objeto"}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-semibold text-ink/60">
              {modo === "borrar" ? "¿Qué hay que borrar?" : "¿Qué hay que agregar?"}
            </span>
            <textarea
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              rows={3}
              placeholder={
                modo === "borrar"
                  ? "Ej: la tira de cuentas rojas y blancas con corazones que termina en una estrella, colgada del aro al lado del holder"
                  : "Ej: el charm nuevo de la estrella plateada"
              }
              className="w-full rounded-[9px] border border-ink/12 px-3 py-2 text-[13.5px]"
            />
          </label>
          {modo === "agregar" && (
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-semibold text-ink/60">¿Dónde va?</span>
              <input
                value={ubicacion}
                onChange={(e) => setUbicacion(e.target.value)}
                placeholder="Ej: colgando del aro, a la izquierda del mosquetón"
                className="w-full rounded-[9px] border border-ink/12 px-3 py-2 text-[13.5px]"
              />
            </label>
          )}
          <div>
            <span className="mb-1.5 block text-[12.5px] font-semibold text-ink/60">
              {modo === "borrar" ? "Foto de referencia marcada" : "Foto del objeto nuevo"}
            </span>
            <SubirFotos fotos={referencias} onChange={setReferencias} max={4} />
            <p className="mt-1.5 text-[11.5px] text-ink/45">
              {modo === "borrar"
                ? "Una foto con el objeto encerrado en un círculo o trazo, como la que marcaste en azul. Ayuda a que la IA no lo confunda con otro accesorio."
                : "La foto real del objeto, sobre fondo liso si podés. La IA lo copia tal cual con la luz y la escala de cada foto."}
            </p>
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-semibold text-ink/60">Publicaciones</span>
            <div className="flex gap-3 text-[12px]">
              <button
                type="button"
                className="text-accent"
                onClick={() =>
                  setElegidas((prev) => new Set([...prev, ...visibles.map((p) => p.ml_item_id)]))
                }
              >
                Elegir {filtro.trim() ? "las filtradas" : "todas"}
              </button>
              <button type="button" className="text-ink/45" onClick={() => setElegidas(new Set())}>
                Limpiar
              </button>
            </div>
          </div>
          <input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder='Filtrar por título, ej. "Arirang"'
            className="mb-2 w-full rounded-[9px] border border-ink/12 px-3 py-2 text-[13.5px]"
          />
          <div className="max-h-[340px] overflow-y-auto rounded-[9px] border border-ink/10">
            {loading && <div className="p-4 text-[13px] text-ink/45">Cargando publicaciones…</div>}
            {error && <div className="p-4 text-[13px] text-danger">{error}</div>}
            {visibles.map((p) => (
              <label
                key={p.ml_item_id}
                className="flex cursor-pointer items-center gap-3 border-b border-ink/[0.06] px-3 py-2 last:border-0 hover:bg-ink/[0.02]"
              >
                <input
                  type="checkbox"
                  checked={elegidas.has(p.ml_item_id)}
                  onChange={() => alternar(p.ml_item_id)}
                />
                {p.thumbnail ? (
                  <img src={p.thumbnail} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
                ) : (
                  <div className="h-9 w-9 shrink-0 rounded bg-ink/[0.06]" />
                )}
                <span className="min-w-0 flex-1 truncate text-[13px]">{p.titulo}</span>
                <span className="shrink-0 text-[11.5px] text-ink/45">{p.foto_ids.length} fotos</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-ink/[0.06] pt-4">
        <p className="text-[12.5px] text-ink/55">
          {elegidas.size
            ? `${elegidas.size} publicaciones · ${fotosDistintas} fotos distintas. Buscar el objeto casi no cuesta; editar cuesta ${usd(USD_POR_FOTO)} por foto donde aparezca (${usd(fotosDistintas * USD_POR_FOTO)} como máximo).`
            : "Elegí las publicaciones. Una foto compartida por varias publicaciones o variantes se edita una sola vez."}
        </p>
        <div className="flex items-center gap-3">
          {(err || faltante) && (
            <span className={cx("text-[12px]", err ? "text-danger" : "text-ink/45")}>{err ?? faltante}</span>
          )}
          <PrimaryButton onClick={crear} disabled={Boolean(faltante) || creando}>
            {creando ? "Creando…" : `Buscar en ${fotosDistintas || ""} fotos`.replace("  ", " ")}
          </PrimaryButton>
        </div>
      </div>
    </Card>
  );
}

function LotesAnteriores({ onAbrir }: { onAbrir: (id: string) => void }) {
  const { data } = useApi<{ lotes: LoteResumen[] }>("/fotos/lotes");
  if (!data?.lotes.length) return null;
  return (
    <>
      <h2 className="mb-3.5 text-[15px] font-semibold">Lotes anteriores</h2>
      <Card className="flex flex-col divide-y divide-ink/[0.06]" padding={false}>
        {data.lotes.map((l) => {
          const c = l.conteo;
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => onAbrir(l.id)}
              className="flex flex-wrap items-center gap-3 px-5 py-3.5 text-left hover:bg-ink/[0.02]"
            >
              <Badge tono={l.modo === "borrar" ? "danger" : "info"}>{l.modo === "borrar" ? "Borrar" : "Agregar"}</Badge>
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{l.descripcion}</span>
              <span className="text-[12px] text-ink/50">
                {[
                  c.revisar && `${c.revisar} para revisar`,
                  c.aprobada && `${c.aprobada} aprobadas`,
                  l.publicaciones_aplicadas && `${l.publicaciones_aplicadas} publicaciones actualizadas`,
                ]
                  .filter(Boolean)
                  .join(" · ") || `${l.ml_item_ids.length} publicaciones`}
              </span>
              <span className="text-[11.5px] text-ink/40">
                {new Date(l.created_at).toLocaleDateString("es-AR")}
              </span>
            </button>
          );
        })}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Un lote: detectar → editar → revisar → aplicar
// ---------------------------------------------------------------------------

function VistaLote({ id }: { id: string }) {
  const [det, setDet] = useState<LoteDetalle>();
  const [err, setErr] = useState<string>();
  const [detectando, setDetectando] = useState(false);
  const [editando, setEditando] = useState<Set<string>>(new Set());
  const [aplicando, setAplicando] = useState<string>();
  const [comparar, setComparar] = useState<ItemFoto>();
  const [enCola, setEnCola] = useState<Set<string>>(new Set());
  const vivo = useRef(true);
  const cola = useRef<string[]>([]);
  const trabajando = useRef(0);
  const buscando = useRef(false);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const cargar = useCallback(async () => {
    try {
      const d = await api<LoteDetalle>(`/fotos/lotes/${id}`);
      if (vivo.current) setDet(d);
      return d;
    } catch (e) {
      if (vivo.current) setErr((e as Error).message);
      return undefined;
    }
  }, [id]);

  const actualizarItem = (item: ItemFoto) =>
    setDet((d) => d && { ...d, items: d.items.map((it) => (it.id === item.id ? item : it)) });

  const detectar = useCallback(async () => {
    // Una sola búsqueda a la vez (React monta dos veces en desarrollo).
    if (buscando.current) return;
    buscando.current = true;
    setDetectando(true);
    setErr(undefined);
    try {
      for (;;) {
        const r = await api<{ restantes: number }>(`/fotos/lotes/${id}/detectar`, { method: "POST" });
        if (!vivo.current) return;
        await cargar();
        if (r.restantes === 0) break;
      }
    } catch (e) {
      if (vivo.current) setErr((e as Error).message);
    } finally {
      buscando.current = false;
      if (vivo.current) setDetectando(false);
    }
  }, [id, cargar]);

  // Al abrir un lote recién creado arranca solo la búsqueda, y las ediciones
  // que quedaron encargadas (pestaña cerrada a mitad de camino) se retoman.
  const retomadas = useRef(false);
  useEffect(() => {
    cargar().then((d) => {
      if (d?.items.some((it) => it.estado === "pendiente")) detectar();
      if (retomadas.current || !d) return;
      retomadas.current = true;
      for (const it of d.items.filter((x) => x.estado === "editando" && x.kie_task_id)) {
        setEditando((s) => new Set(s).add(it.id));
        esperarEdicion(it.id)
          .catch(() => {})
          .finally(() =>
            setEditando((s) => {
              const n = new Set(s);
              n.delete(it.id);
              return n;
            }),
          );
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargar, detectar]);

  /** Espera a que termine una edición ya encargada (Pro tarda de 30 s a
   *  varios minutos, según la cola de kie.ai). */
  async function esperarEdicion(itemId: string) {
    while (vivo.current) {
      await new Promise((r) => setTimeout(r, CONSULTA_MS));
      if (!vivo.current) return;
      const r = await api<{ item: ItemFoto }>(`/fotos/items/${itemId}/consultar`, { method: "POST" });
      if (vivo.current) actualizarItem(r.item);
      if (r.item.estado !== "editando") return;
    }
  }

  async function editarUna(itemId: string, nota?: string) {
    setEditando((s) => new Set(s).add(itemId));
    try {
      const r = await api<{ item: ItemFoto }>(`/fotos/items/${itemId}/editar`, {
        method: "POST",
        body: JSON.stringify(nota !== undefined ? { nota } : {}),
      });
      if (vivo.current) actualizarItem(r.item);
      if (r.item.estado === "editando") await esperarEdicion(itemId);
    } catch (e) {
      if (vivo.current) {
        setErr((e as Error).message);
        await cargar();
      }
    } finally {
      if (vivo.current)
        setEditando((s) => {
          const n = new Set(s);
          n.delete(itemId);
          return n;
        });
    }
  }

  /** Edita varias, nunca más de EDICIONES_EN_PARALELO a la vez (cada una
   *  tarda ~1 min). Si ya hay una tanda corriendo, las nuevas se suman a la cola. */
  async function editarVarias(ids: string[]) {
    const nuevas = ids.filter((x) => !cola.current.includes(x) && !editando.has(x));
    cola.current.push(...nuevas);
    setEnCola((s) => new Set([...s, ...nuevas]));
    const trabajador = async () => {
      trabajando.current++;
      try {
        while (vivo.current && cola.current.length) {
          const siguiente = cola.current.shift()!;
          setEnCola((s) => {
            const n = new Set(s);
            n.delete(siguiente);
            return n;
          });
          await editarUna(siguiente);
        }
      } finally {
        trabajando.current--;
      }
    };
    const libres = Math.max(0, EDICIONES_EN_PARALELO - trabajando.current);
    await Promise.all(Array.from({ length: Math.min(libres, cola.current.length) }, trabajador));
  }

  async function cambiarEstado(itemId: string, estado: EstadoItem) {
    try {
      const r = await api<{ item: ItemFoto }>(`/fotos/items/${itemId}/estado`, {
        method: "POST",
        body: JSON.stringify({ estado }),
      });
      actualizarItem(r.item);
    } catch (e) {
      setErr((e as Error).message);
      await cargar();
    }
  }

  /** Las que fallaron al buscar vuelven a la búsqueda (no cuesta casi nada);
   *  las que fallaron al editar se vuelven a editar. */
  async function reintentarErrores(conError: ItemFoto[]) {
    const sinDetectar = conError.filter((it) => !it.deteccion);
    for (const it of sinDetectar) await cambiarEstado(it.id, "pendiente");
    const aEditar = conError.filter((it) => it.deteccion).map((it) => it.id);
    if (sinDetectar.length) detectar();
    if (aEditar.length) editarVarias(aEditar);
  }

  async function aprobarTodas() {
    await api(`/fotos/lotes/${id}/aprobar-todas`, { method: "POST" }).catch((e: Error) => setErr(e.message));
    await cargar();
  }

  async function aplicarEn(mlItemIds: string[], accion: "aplicar" | "deshacer") {
    setErr(undefined);
    for (const mlItemId of mlItemIds) {
      if (!vivo.current) return;
      setAplicando(mlItemId);
      try {
        await api(`/fotos/lotes/${id}/${accion}`, {
          method: "POST",
          body: JSON.stringify({ ml_item_id: mlItemId }),
        });
      } catch (e) {
        setErr(`${mlItemId}: ${(e as Error).message}`);
      }
    }
    if (vivo.current) setAplicando(undefined);
    await cargar();
  }

  if (!det) return err ? <EmptyHint>{err}</EmptyHint> : <EmptyHint>Cargando lote…</EmptyHint>;

  const { lote, items } = det;
  const por = (e: EstadoItem) => items.filter((it) => it.estado === e);
  const pendientes = por("pendiente");
  const paraEditar = por("para_editar");
  const enRevision = por("revisar");
  const aprobadas = por("aprobada");
  const conError = por("error");
  const descartadas = por("descartada");
  const rechazadas = por("rechazada");
  const enCurso = items.filter((it) => it.estado === "editando" || editando.has(it.id));
  const faltanEditar = paraEditar.filter((it) => !editando.has(it.id));
  const sinEncolar = faltanEditar.filter((it) => !enCola.has(it.id));

  return (
    <div>
      <Card className="mb-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex items-center gap-2">
              <Badge tono={lote.modo === "borrar" ? "danger" : "info"}>
                {lote.modo === "borrar" ? "Borrar" : "Agregar"}
              </Badge>
              <span className="text-[12px] text-ink/45">
                {lote.ml_item_ids.length} publicaciones · {items.length} fotos distintas
              </span>
            </div>
            <p className="text-[14px] font-semibold">{lote.descripcion}</p>
            {lote.ubicacion && <p className="mt-1 text-[12.5px] text-ink/55">Dónde: {lote.ubicacion}</p>}
          </div>
          <div className="flex gap-2">
            {lote.referencias.map((u) => (
              <a key={u} href={u} target="_blank" rel="noreferrer">
                <img src={u} alt="Referencia" className="h-16 w-16 rounded-lg border border-ink/10 object-cover" />
              </a>
            ))}
          </div>
        </div>
      </Card>

      {err && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-[12px] bg-danger-bg px-4 py-2.5 text-[12.5px] text-danger">
          <span>{err}</span>
          <button type="button" onClick={() => setErr(undefined)} className="shrink-0 font-semibold">
            Cerrar
          </button>
        </div>
      )}

      {(pendientes.length > 0 || detectando) && (
        <Card className="mb-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[14px] font-semibold">
                {detectando ? "Buscando el objeto en las fotos…" : "Búsqueda en pausa"}
              </div>
              <div className="text-[12.5px] text-ink/50">
                {items.length - pendientes.length} de {items.length} fotos revisadas
              </div>
            </div>
            {!detectando && <PrimaryButton onClick={detectar}>Seguir buscando</PrimaryButton>}
          </div>
          <Progreso hecho={items.length - pendientes.length} total={items.length} />
        </Card>
      )}

      {(paraEditar.length > 0 || enCurso.length > 0) && (
        <Seccion
          titulo={`Para editar (${new Set([...paraEditar, ...enCurso].map((it) => it.id)).size})`}
          nota={
            lote.modo === "borrar"
              ? "La IA encontró el objeto en estas fotos. Sacá las que no quieras tocar antes de editar."
              : "Fotos donde se puede agregar el objeto. Sacá las que no quieras tocar antes de editar."
          }
          accion={
            sinEncolar.length > 0 && (
              <PrimaryButton onClick={() => editarVarias(sinEncolar.map((it) => it.id))}>
                Editar {sinEncolar.length} {sinEncolar.length === 1 ? "foto" : "fotos"} (≈ {usd(sinEncolar.length * USD_POR_FOTO)})
              </PrimaryButton>
            )
          }
        >
          {enCurso.length > 0 && (
            <p className="mb-3 text-[12.5px] text-accent">
              Editando {enCurso.length} {enCurso.length === 1 ? "foto" : "fotos"}
              {enCola.size > 0 && ` (${enCola.size} en cola)`}: cada una tarda entre medio minuto y unos minutos. Si cerrás la pestaña, las que ya empezaron siguen y se retoman al volver.
            </p>
          )}
          <Grilla>
            {[...enCurso, ...faltanEditar].map((it) => (
              <Tarjeta key={it.id} item={it} onAbrir={() => setComparar(it)}>
                {editando.has(it.id) || it.estado === "editando" ? (
                  <span className="text-[12px] font-semibold text-accent">Editando…</span>
                ) : enCola.has(it.id) ? (
                  <span className="text-[12px] text-ink/50">En cola</span>
                ) : (
                  <>
                    <BotonChico onClick={() => editarVarias([it.id])}>Editar</BotonChico>
                    <BotonChico onClick={() => cambiarEstado(it.id, "descartada")} tenue>
                      Sacar
                    </BotonChico>
                  </>
                )}
              </Tarjeta>
            ))}
          </Grilla>
        </Seccion>
      )}

      {enRevision.length > 0 && (
        <Seccion
          titulo={`Para revisar (${enRevision.length})`}
          nota="Tocá una foto para compararla grande. Rechazá la que no quede bien o reintentala con una corrección."
          accion={<PrimaryButton onClick={aprobarTodas}>Aprobar las {enRevision.length}</PrimaryButton>}
        >
          <Grilla>
            {enRevision.map((it) => (
              <Tarjeta key={it.id} item={it} antesDespues onAbrir={() => setComparar(it)}>
                <BotonChico onClick={() => cambiarEstado(it.id, "aprobada")}>Aprobar</BotonChico>
                <BotonChico onClick={() => cambiarEstado(it.id, "rechazada")} tenue>
                  Rechazar
                </BotonChico>
                <BotonChico onClick={() => setComparar(it)} tenue>
                  Reintentar
                </BotonChico>
              </Tarjeta>
            ))}
          </Grilla>
        </Seccion>
      )}

      {conError.length > 0 && (
        <Seccion
          titulo={`Con error (${conError.length})`}
          accion={
            <GhostButton onClick={() => reintentarErrores(conError)}>
              Reintentar {conError.length}
            </GhostButton>
          }
        >
          <Grilla>
            {conError.map((it) => (
              <Tarjeta key={it.id} item={it} onAbrir={() => setComparar(it)}>
                <span className="line-clamp-3 text-[11.5px] text-danger">{it.error}</span>
              </Tarjeta>
            ))}
          </Grilla>
        </Seccion>
      )}

      {(aprobadas.length > 0 || det.aplicadas.length > 0) && (
        <AplicarEnMl det={det} aplicando={aplicando} onAplicar={aplicarEn} />
      )}

      {aprobadas.length > 0 && (
        <Seccion titulo={`Aprobadas (${aprobadas.length})`} plegable>
          <Grilla>
            {aprobadas.map((it) => (
              <Tarjeta key={it.id} item={it} antesDespues onAbrir={() => setComparar(it)}>
                {it.nuevo_ml_picture_id ? (
                  <span className="text-[11.5px] font-semibold text-ok">Subida a ML</span>
                ) : (
                  <BotonChico onClick={() => cambiarEstado(it.id, "revisar")} tenue>
                    Volver a revisar
                  </BotonChico>
                )}
              </Tarjeta>
            ))}
          </Grilla>
        </Seccion>
      )}

      {rechazadas.length > 0 && (
        <Seccion titulo={`Rechazadas (${rechazadas.length})`} plegable>
          <Grilla>
            {rechazadas.map((it) => (
              <Tarjeta key={it.id} item={it} antesDespues onAbrir={() => setComparar(it)}>
                <BotonChico onClick={() => setComparar(it)}>Reintentar</BotonChico>
                <BotonChico onClick={() => cambiarEstado(it.id, "descartada")} tenue>
                  Dejar como está
                </BotonChico>
              </Tarjeta>
            ))}
          </Grilla>
        </Seccion>
      )}

      {descartadas.length > 0 && (
        <Seccion
          titulo={`Sin cambios (${descartadas.length})`}
          nota={
            lote.modo === "borrar"
              ? "La IA no vio el objeto en estas fotos. Si alguna lo tiene, incluila."
              : "La IA consideró que en estas fotos no corresponde agregarlo. Podés incluir cualquiera."
          }
          plegable
        >
          <Grilla>
            {descartadas.map((it) => (
              <Tarjeta key={it.id} item={it} onAbrir={() => setComparar(it)}>
                <BotonChico onClick={() => cambiarEstado(it.id, "para_editar")}>Incluir</BotonChico>
              </Tarjeta>
            ))}
          </Grilla>
        </Seccion>
      )}

      {!detectando && pendientes.length === 0 && <Textos loteId={id} />}

      {comparar && (
        <Comparar
          item={items.find((it) => it.id === comparar.id) ?? comparar}
          onCerrar={() => setComparar(undefined)}
          onReintentar={(nota) => {
            setComparar(undefined);
            editarUna(comparar.id, nota);
          }}
        />
      )}
    </div>
  );
}

function AplicarEnMl({
  det,
  aplicando,
  onAplicar,
}: {
  det: LoteDetalle;
  aplicando: string | undefined;
  onAplicar: (ids: string[], accion: "aplicar" | "deshacer") => void;
}) {
  const aprobadas = det.items.filter((it) => it.estado === "aprobada");
  const filas = det.publicaciones
    .map((p) => {
      const suyas = aprobadas.filter((it) => it.ml_item_ids.includes(p.ml_item_id));
      const aplicada = det.aplicadas.find((a) => a.ml_item_id === p.ml_item_id);
      const hechas = new Set(
        aplicada?.estado === "aplicada" ? Object.keys(aplicada.reemplazos ?? {}) : [],
      );
      const pendientes = suyas.filter((it) => !hechas.has(it.ml_picture_id)).length;
      return { p, suyas: suyas.length, pendientes, aplicada };
    })
    .filter((f) => f.suyas > 0 || f.aplicada);
  const porAplicar = filas.filter((f) => f.pendientes > 0).map((f) => f.p.ml_item_id);
  const ocupado = Boolean(aplicando);

  return (
    <Seccion
      titulo="Subir a Mercado Libre"
      nota="Se cambia cada foto en su mismo lugar, también en las variantes. Las originales quedan guardadas: podés deshacer por publicación."
      accion={
        porAplicar.length > 0 && (
          <PrimaryButton onClick={() => onAplicar(porAplicar, "aplicar")} disabled={ocupado}>
            {ocupado ? "Subiendo…" : `Subir a ${porAplicar.length} ${porAplicar.length === 1 ? "publicación" : "publicaciones"}`}
          </PrimaryButton>
        )
      }
    >
      <Card padding={false} className="divide-y divide-ink/[0.06]">
        {filas.map(({ p, suyas, pendientes, aplicada }) => (
          <div key={p.ml_item_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            {p.thumbnail ? (
              <img src={p.thumbnail} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
            ) : (
              <div className="h-9 w-9 shrink-0 rounded bg-ink/[0.06]" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">{p.titulo}</div>
              <div className="text-[11.5px] text-ink/50">
                {suyas} {suyas === 1 ? "foto aprobada" : "fotos aprobadas"}
                {aplicada?.error && <span className="text-danger"> · {aplicada.error}</span>}
              </div>
            </div>
            {aplicando === p.ml_item_id ? (
              <span className="text-[12px] font-semibold text-accent">Subiendo…</span>
            ) : (
              <>
                {aplicada?.estado === "aplicada" && <Badge tono="ok">Actualizada</Badge>}
                {aplicada?.estado === "deshecha" && <Badge tono="neutral">Deshecha</Badge>}
                {pendientes > 0 && (
                  <BotonChico onClick={() => onAplicar([p.ml_item_id], "aplicar")} disabled={ocupado}>
                    Subir {pendientes}
                  </BotonChico>
                )}
                {aplicada?.estado === "aplicada" && (
                  <BotonChico onClick={() => onAplicar([p.ml_item_id], "deshacer")} disabled={ocupado} tenue>
                    Deshacer
                  </BotonChico>
                )}
              </>
            )}
          </div>
        ))}
      </Card>
    </Seccion>
  );
}

function Textos({ loteId }: { loteId: string }) {
  const [props, setProps] = useState<PropuestaTexto[]>();
  const [cargando, setCargando] = useState(false);
  const [err, setErr] = useState<string>();
  const [hechas, setHechas] = useState<Record<string, string>>({});

  async function proponer() {
    setCargando(true);
    setErr(undefined);
    try {
      const r = await api<{ propuestas: PropuestaTexto[] }>(`/fotos/lotes/${loteId}/textos`, { method: "POST" });
      setProps(r.propuestas);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  async function aplicar(p: PropuestaTexto) {
    try {
      const r = await api<{ aplicado: string[]; errores: string[] }>(
        `/ia/publicacion/${p.listing_id}/aplicar`,
        {
          method: "POST",
          body: JSON.stringify({
            ...(p.titulo_nuevo ? { titulo: p.titulo_nuevo } : {}),
            ...(p.descripcion_nueva ? { descripcion: p.descripcion_nueva } : {}),
          }),
        },
      );
      setHechas((h) => ({
        ...h,
        [p.ml_item_id]: [
          r.aplicado.length ? `Aplicado: ${r.aplicado.join(" y ")}` : "",
          ...r.errores,
        ]
          .filter(Boolean)
          .join(" · "),
      }));
    } catch (e) {
      setHechas((h) => ({ ...h, [p.ml_item_id]: (e as Error).message }));
    }
  }

  const editar = (i: number, cambio: Partial<PropuestaTexto>) =>
    setProps((ps) => ps?.map((p, j) => (j === i ? { ...p, ...cambio } : p)));

  return (
    <Seccion
      titulo="Títulos y descripciones"
      nota="La IA busca menciones del objeto en los textos de estas publicaciones y propone el cambio mínimo. Nada se aplica sin tu OK."
      accion={
        <GhostButton onClick={proponer} disabled={cargando}>
          {cargando ? "Leyendo los textos…" : props ? "Volver a proponer" : "Revisar textos"}
        </GhostButton>
      }
    >
      {err && <p className="mb-3 text-[12.5px] text-danger">{err}</p>}
      {props && props.length === 0 && <EmptyHint>Ningún título ni descripción menciona el objeto.</EmptyHint>}
      <div className="flex flex-col gap-3">
        {props?.map((p, i) => (
          <Card key={p.ml_item_id}>
            <div className="mb-2 text-[12px] text-ink/50">{p.motivo}</div>
            {p.titulo_nuevo !== null && (
              <label className="mb-3 block">
                <span className="mb-1 block text-[12px] text-ink/45 line-through">{p.titulo_actual}</span>
                <input
                  value={p.titulo_nuevo}
                  maxLength={60}
                  onChange={(e) => editar(i, { titulo_nuevo: e.target.value })}
                  className="w-full rounded-[9px] border border-ink/12 px-3 py-2 text-[13.5px] font-semibold"
                />
              </label>
            )}
            {p.titulo_nuevo === null && <div className="mb-3 text-[13.5px] font-semibold">{p.titulo_actual}</div>}
            {p.descripcion_nueva !== null && (
              <textarea
                value={p.descripcion_nueva}
                rows={8}
                onChange={(e) => editar(i, { descripcion_nueva: e.target.value })}
                className="w-full rounded-[9px] border border-ink/12 px-3 py-2 text-[12.5px]"
              />
            )}
            <div className="mt-3 flex items-center justify-end gap-3">
              {hechas[p.ml_item_id] && <span className="text-[12px] text-ink/55">{hechas[p.ml_item_id]}</span>}
              <PrimaryButton onClick={() => aplicar(p)}>Aplicar en ML</PrimaryButton>
            </div>
          </Card>
        ))}
      </div>
    </Seccion>
  );
}

// ---------------------------------------------------------------------------
// Piezas chicas
// ---------------------------------------------------------------------------

function Seccion({
  titulo,
  nota,
  accion,
  plegable,
  children,
}: {
  titulo: string;
  nota?: string;
  accion?: ReactNode;
  plegable?: boolean;
  children: ReactNode;
}) {
  const [abierta, setAbierta] = useState(!plegable);
  return (
    <section className="mb-7">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">
            {plegable ? (
              <button type="button" onClick={() => setAbierta((a) => !a)} className="flex items-center gap-1.5">
                <span className="text-ink/40">{abierta ? "▾" : "▸"}</span>
                {titulo}
              </button>
            ) : (
              titulo
            )}
          </h2>
          {nota && abierta && <p className="mt-0.5 text-[12.5px] text-ink/50">{nota}</p>}
        </div>
        {abierta && accion}
      </div>
      {abierta && children}
    </section>
  );
}

function Grilla({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
}

function Tarjeta({
  item,
  antesDespues,
  onAbrir,
  children,
}: {
  item: ItemFoto;
  antesDespues?: boolean;
  onAbrir: () => void;
  children: ReactNode;
}) {
  const conEdicion = antesDespues && item.editada_url;
  return (
    <div className="overflow-hidden rounded-[12px] border hairline bg-surface">
      <button type="button" onClick={onAbrir} className="block w-full">
        {conEdicion ? (
          <div className="grid grid-cols-2 gap-px bg-ink/10">
            <img src={item.original_url} alt="Antes" loading="lazy" className="aspect-[4/5] w-full bg-surface object-contain" />
            <img src={item.editada_url!} alt="Después" loading="lazy" className="aspect-[4/5] w-full bg-surface object-contain" />
          </div>
        ) : (
          <img src={item.original_url} alt="" loading="lazy" className="aspect-[4/5] w-full object-contain" />
        )}
      </button>
      <div className="p-2.5">
        {item.deteccion?.donde && !conEdicion && (
          <p className="mb-2 line-clamp-2 text-[11px] text-ink/50">{item.deteccion.donde}</p>
        )}
        {item.estado === "descartada" && item.deteccion?.motivo && (
          <p className="mb-2 line-clamp-2 text-[11px] text-ink/50">{item.deteccion.motivo}</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">{children}</div>
      </div>
    </div>
  );
}

function BotonChico({
  children,
  onClick,
  tenue,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  tenue?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "rounded-[7px] px-2.5 py-1 text-[12px] font-semibold transition-colors disabled:opacity-40",
        tenue ? "text-ink/55 hover:bg-ink/[0.05]" : "bg-accent-soft text-accent hover:bg-accent/15",
      )}
    >
      {children}
    </button>
  );
}

function Progreso({ hecho, total }: { hecho: number; total: number }) {
  return (
    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
      <div
        className="h-full rounded-full bg-accent transition-[width]"
        style={{ width: `${total ? (hecho / total) * 100 : 0}%` }}
      />
    </div>
  );
}

function Comparar({
  item,
  onCerrar,
  onReintentar,
}: {
  item: ItemFoto;
  onCerrar: () => void;
  onReintentar: (nota: string) => void;
}) {
  const [nota, setNota] = useState(item.nota ?? "");
  const [ver, setVer] = useState<"antes" | "despues">(item.editada_url ? "despues" : "antes");
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onCerrar]);
  const puedeReintentar = !item.nuevo_ml_picture_id && item.estado !== "editando";

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-3 sm:p-6"
      onClick={onCerrar}
    >
      <div
        className="flex max-h-full w-full max-w-[1100px] flex-col overflow-hidden rounded-[14px] bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b hairline px-4 py-3">
          {item.editada_url ? (
            <div className="flex gap-1 rounded-[9px] bg-ink/[0.05] p-[3px] sm:hidden">
              {(["antes", "despues"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVer(v)}
                  className={cx(
                    "rounded-[7px] px-3 py-1 text-[12.5px] font-semibold",
                    ver === v ? "bg-surface shadow-sm" : "text-ink/50",
                  )}
                >
                  {v === "antes" ? "Antes" : "Después"}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-[13px] font-semibold">Foto original</span>
          )}
          <span className="hidden text-[12px] text-ink/45 sm:block">
            {item.editada_url ? "Antes · Después" : ""}
            {item.intentos > 1 ? ` · intento ${item.intentos}` : ""}
          </span>
          <button type="button" onClick={onCerrar} className="text-[13px] font-semibold text-ink/55">
            Cerrar
          </button>
        </div>
        <div className="grid min-h-0 flex-1 gap-2 overflow-auto bg-ink/[0.03] p-2 sm:grid-cols-2">
          <img
            src={item.original_url}
            alt="Antes"
            className={cx("max-h-[70vh] w-full object-contain", item.editada_url && ver !== "antes" && "hidden sm:block")}
          />
          {item.editada_url && (
            <img
              src={item.editada_url}
              alt="Después"
              className={cx("max-h-[70vh] w-full object-contain", ver !== "despues" && "hidden sm:block")}
            />
          )}
        </div>
        {puedeReintentar && (
          <div className="flex flex-wrap items-center gap-2 border-t hairline px-4 py-3">
            <input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Corrección para la IA (opcional), ej: no borres la borla roja"
              className="min-w-0 flex-1 rounded-[9px] border border-ink/12 px-3 py-2 text-[13px]"
            />
            <PrimaryButton onClick={() => onReintentar(nota)}>
              {item.editada_url ? "Reintentar" : "Editar"} ({usd(USD_POR_FOTO)})
            </PrimaryButton>
          </div>
        )}
      </div>
    </div>
  );
}
