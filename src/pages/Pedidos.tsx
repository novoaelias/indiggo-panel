import { useMemo, useState } from "react";
import { Badge, Card, EmptyHint, GhostButton, PageHeader, PrimaryButton, cx } from "@/components/ui";
import { MensajesVenta } from "@/components/MensajesVenta";
import { api, useApi } from "@/lib/api";
import { diaCorto, formatARS } from "@/lib/format";

interface ItemPedido {
  id: string;
  titulo: string;
  producto: string;
  variante: string | null;
  thumbnail: string | null;
  contenido: Array<{ nombre: string; cantidad: number }>;
  cantidad: number;
  reservado: number;
  faltante: number;
  mapeado: boolean;
  opciones: Array<{ id: string; etiqueta: string }>;
}
interface Paquete {
  key: string;
  comprador: string | null;
  fecha: string;
  total: number;
  items: ItemPedido[];
  faltantes: number;
  estado_envio: string | null;
  envio_substatus: string | null;
  etiqueta_logistica: string;
  a_imprimir: boolean;
  limite_despacho: string | null;
  urgencia: "vencido" | "hoy" | "despues" | "sin_fecha";
  entrega_acordada: boolean;
  ml_order_ids: string[];
  pack_id: string;
  mensaje_nuevo: boolean;
}
interface PedidosResp {
  paquetes: Paquete[];
  conteos: Record<string, number>;
  total: number;
}

const ORDEN = ["Flex", "Mercado Envíos", "A acordar", "Full", "Otro"];

/** Dentro de cada sección, un bloque por tipo de logística (Flex primero). */
function agruparPorLogistica(paquetes: Paquete[]): Array<[string, Paquete[]]> {
  const m = new Map<string, Paquete[]>();
  for (const p of paquetes) {
    if (!m.has(p.etiqueta_logistica)) m.set(p.etiqueta_logistica, []);
    m.get(p.etiqueta_logistica)!.push(p);
  }
  return [...m.entries()].sort((a, b) => ORDEN.indexOf(a[0]) - ORDEN.indexOf(b[0]));
}

/** Lo vencido y lo que vence hoy sale hoy sí o sí: si no, ML penaliza la
 *  reputación. Lo demás puede esperar al día que marca ML. */
function esUrgente(p: Paquete): boolean {
  return !p.entrega_acordada && (p.urgencia === "vencido" || p.urgencia === "hoy");
}

function Plazo({ paquete: p }: { paquete: Paquete }) {
  if (p.entrega_acordada) return <Badge tono="info">Acordar entrega</Badge>;
  if (p.urgencia === "vencido")
    return (
      <Badge tono="danger">
        Demorado{p.limite_despacho ? ` · vencía el ${diaCorto(p.limite_despacho)}` : ""}
      </Badge>
    );
  if (p.urgencia === "hoy") return <Badge tono="warn">Vence hoy</Badge>;
  if (p.urgencia === "despues" && p.limite_despacho)
    return <Badge tono="neutral">Hasta el {diaCorto(p.limite_despacho)}</Badge>;
  return <span className="text-[11.5px] text-ink/45">Sin plazo de ML</span>;
}

const ENVIO_LABEL: Record<string, string> = {
  pending: "Pendiente",
  handling: "En preparación",
  ready_to_ship: "Listo para despachar",
  shipped: "Despachado",
  delivered: "Entregado",
};

function haceCuanto(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "recién";
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}

/** Registrar la variante que eligió el comprador, sin salir del pedido. */
function ElegirVariante({
  item,
  onListo,
}: {
  item: { id: string; opciones: Array<{ id: string; etiqueta: string }> };
  onListo: () => void;
}) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string>();
  if (!item.opciones.length)
    return <span className="ml-1 text-warn">(elegir variante)</span>;
  return (
    <span className="ml-1 inline-flex items-center gap-1 align-middle">
      <select
        className="rounded-md border hairline bg-surface px-1.5 py-0.5 text-[11.5px]"
        defaultValue=""
        disabled={guardando}
        onChange={async (e) => {
          const variante = e.target.value;
          if (!variante) return;
          setGuardando(true);
          setError(undefined);
          try {
            await api(`/pedidos/items/${item.id}/variante`, {
              method: "POST",
              body: JSON.stringify({ product_variant_id: variante }),
            });
            onListo();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setGuardando(false);
          }
        }}
      >
        <option value="">Elegir variante…</option>
        {item.opciones.map((o) => (
          <option key={o.id} value={o.id}>
            {o.etiqueta}
          </option>
        ))}
      </select>
      {error && <span className="text-danger">{error}</span>}
    </span>
  );
}

// Las tildes de "ya lo metí en la bolsa" son una ayuda para armar, de este
// navegador nomás: no tocan stock ni pedidos. Si el storage no está, la
// pantalla funciona igual sin recordarlas.
const CLAVE_ARMADOS = "pedidos:armados";

function leerArmados(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(CLAVE_ARMADOS) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function guardarArmados(armados: Set<string>) {
  try {
    localStorage.setItem(CLAVE_ARMADOS, JSON.stringify([...armados]));
  } catch {
    /* sin storage: la tilde dura hasta recargar */
  }
}

export function Pedidos() {
  const { data, error, loading, reload } = useApi<PedidosResp>("/pedidos-activos");
  const [abiertos, setAbiertos] = useState<Set<string>>(() => new Set());
  const [armados, setArmados] = useState<Set<string>>(leerArmados);

  const secciones = useMemo(() => {
    const paquetes = data?.paquetes ?? [];
    const urgentes = paquetes.filter(esUrgente);
    const acordar = paquetes.filter((p) => p.entrega_acordada);
    const resto = paquetes.filter((p) => !p.entrega_acordada && !esUrgente(p));
    return {
      urgentes,
      grupos: [
        {
          id: "hoy",
          titulo: "Despachar hoy sí o sí",
          detalle: "Si no salen hoy, Mercado Libre los cuenta como demorados.",
          grupos: agruparPorLogistica(urgentes),
        },
        {
          id: "despues",
          titulo: "Pueden esperar",
          detalle: "Vencen otro día: se pueden despachar hoy o hasta la fecha que marca cada uno.",
          grupos: agruparPorLogistica(resto),
        },
        {
          id: "acordar",
          titulo: "Retiro o entrega a acordar",
          detalle:
            "El comprador eligió acordar con vos: ML no pone plazo ni hay etiqueta. Cuando lo entregues, marcalo para descontar el stock.",
          grupos: agruparPorLogistica(acordar),
        },
      ].filter((s) => s.grupos.length > 0),
    };
  }, [data]);

  const todosAbiertos =
    !!data && data.paquetes.length > 0 && data.paquetes.every((p) => abiertos.has(p.key));

  function alternar(key: string) {
    setAbiertos((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function marcar(itemId: string) {
    setArmados((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      // Se guardan sólo los de pedidos que siguen activos, para que la lista
      // no crezca con paquetes que ya salieron.
      const vigentes = new Set(data?.paquetes.flatMap((p) => p.items.map((it) => it.id)) ?? []);
      guardarArmados(new Set([...next].filter((id) => vigentes.has(id))));
      return next;
    });
  }

  return (
    <div>
      <PageHeader
        titulo="Pedidos"
        subtitulo={
          data
            ? data.total === 0
              ? "Nada pendiente de despacho"
              : `${data.total} ${data.total === 1 ? "paquete" : "paquetes"} sin despachar · ${
                  secciones.urgentes.length
                } para hoy`
            : "Pagados y sin despachar"
        }
        acciones={
          data && data.total > 0 ? (
            <GhostButton
              onClick={() =>
                setAbiertos(todosAbiertos ? new Set() : new Set(data.paquetes.map((p) => p.key)))
              }
            >
              {todosAbiertos ? "Plegar todos" : "Desplegar todos"}
            </GhostButton>
          ) : undefined
        }
      />

      {loading && <EmptyHint>Cargando pedidos…</EmptyHint>}
      {error && <EmptyHint>No se pudo cargar: {error}</EmptyHint>}
      {data && data.total === 0 && (
        <EmptyHint>Todo despachado. 🎉</EmptyHint>
      )}

      {data && data.total > 0 && secciones.urgentes.length === 0 && (
        <EmptyHint>Nada vence hoy: todo lo pendiente puede esperar.</EmptyHint>
      )}

      <div className="flex flex-col gap-10">
        {secciones.grupos.map((seccion) => {
          const cantidad = seccion.grupos.reduce((sum, [, ps]) => sum + ps.length, 0);
          return (
            <section key={seccion.id}>
              <div
                className={cx(
                  "mb-4 border-l-[3px] pl-3",
                  seccion.id === "hoy"
                    ? "border-danger"
                    : seccion.id === "acordar"
                      ? "border-accent"
                      : "border-ink/15",
                )}
              >
                <div className="flex items-center gap-2.5">
                  <h2 className="text-[17px] font-bold">{seccion.titulo}</h2>
                  <span
                    className={cx(
                      "rounded-full px-2 py-0.5 text-[11.5px] font-bold",
                      seccion.id === "hoy" ? "bg-danger-bg text-danger" : "bg-ink/[0.06] text-ink/55",
                    )}
                  >
                    {cantidad}
                  </span>
                </div>
                <p className="mt-0.5 text-[12px] text-ink/55">{seccion.detalle}</p>
              </div>
              <div className="flex flex-col gap-6">
                {seccion.grupos.map(([etiqueta, paquetes]) => (
                  <div key={etiqueta}>
                    <div className="mb-2.5 flex items-center gap-2.5">
                      <h3 className="text-[14px] font-semibold">{etiqueta}</h3>
                      <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-[11.5px] font-bold text-ink/55">
                        {paquetes.length}
                      </span>
                    </div>
                    <Card padding={false} className="overflow-hidden">
                      {paquetes.map((p) => (
                        <FilaPaquete
                          key={p.key}
                          paquete={p}
                          abierto={abiertos.has(p.key)}
                          armados={armados}
                          onAlternar={() => alternar(p.key)}
                          onMarcar={marcar}
                          onRecargar={reload}
                        />
                      ))}
                    </Card>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function FilaPaquete({
  paquete: p,
  abierto,
  armados,
  onAlternar,
  onMarcar,
  onRecargar,
}: {
  paquete: Paquete;
  abierto: boolean;
  armados: Set<string>;
  onAlternar: () => void;
  onMarcar: (itemId: string) => void;
  onRecargar: () => void;
}) {
  const unidades = p.items.reduce((sum, it) => sum + it.cantidad, 0);
  const listos = p.items.filter((it) => armados.has(it.id)).length;
  const armado = p.items.length > 0 && listos === p.items.length;
  return (
    <div className="border-b hairline last:border-b-0">
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={abierto}
        className="flex w-full flex-col gap-1.5 px-4 py-3 text-left hover:bg-ink/[0.025] sm:flex-row sm:items-center sm:gap-4"
      >
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <svg
            viewBox="0 0 16 16"
            aria-hidden
            className={cx(
              "mt-1 h-3.5 w-3.5 shrink-0 text-ink/40 transition-transform",
              abierto && "rotate-90",
            )}
          >
            <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-[13.5px] font-semibold">{p.comprador ?? "—"}</span>
              <span className="text-[11.5px] text-ink/40">{haceCuanto(p.fecha)}</span>
              <span className="text-[11.5px] text-ink/55">
                · {p.items.length} {p.items.length === 1 ? "producto" : "productos"} ·{" "}
                {unidades} {unidades === 1 ? "unidad" : "unidades"}
              </span>
              {listos > 0 && (
                <span className={cx("text-[11.5px] font-semibold", armado ? "text-ok" : "text-ink/55")}>
                  · {armado ? "Armado" : `${listos}/${p.items.length} en la bolsa`}
                </span>
              )}
            </div>
            {!abierto && (
              <div className="mt-0.5 text-[12px] text-ink/55 [overflow-wrap:anywhere]">
                {p.items.map((it) => (
                  <span key={it.id} className="mr-2 inline-block">
                    {it.cantidad > 1 ? `${it.cantidad}× ` : ""}{it.producto}
                    {it.variante && <span className="text-ink/80"> · {it.variante}</span>}
                    {!it.mapeado && <span className="ml-1 text-warn">(elegir variante)</span>}
                    {it.faltante > 0 && <span className="ml-1 text-danger">(falta {it.faltante})</span>}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 pl-6 sm:gap-4 sm:pl-0">
          {p.mensaje_nuevo && <Badge tono="info">Mensaje nuevo</Badge>}
          <Plazo paquete={p} />
          {p.faltantes > 0 ? (
            <Badge tono="danger">Completar {p.faltantes}</Badge>
          ) : (
            <Badge tono="ok">Stock reservado</Badge>
          )}
          {p.entrega_acordada ? null : p.a_imprimir ? (
            <Badge tono="warn">Imprimir etiqueta</Badge>
          ) : (
            <span
              className={cx(
                "text-[11.5px]",
                p.estado_envio === "ready_to_ship" ? "text-ok" : "text-ink/45",
              )}
            >
              {ENVIO_LABEL[p.estado_envio ?? ""] ?? p.estado_envio ?? "Sin datos de envío"}
            </span>
          )}
          <div className="text-[13.5px] font-bold tabular-nums">{formatARS(p.total)}</div>
        </div>
      </button>

      {abierto && (
        <ul className="flex flex-col gap-2 px-4 pb-4 sm:pl-10">
          {p.items.map((it) => (
            <ItemDelPaquete
              key={it.id}
              item={it}
              enBolsa={armados.has(it.id)}
              onMarcar={() => onMarcar(it.id)}
              onRecargar={onRecargar}
            />
          ))}
          {p.entrega_acordada && <MarcarEntregado paquete={p} onListo={onRecargar} />}
          <MensajesVenta packId={p.pack_id} comprador={p.comprador} nuevo={p.mensaje_nuevo} />
        </ul>
      )}
    </div>
  );
}

function ItemDelPaquete({
  item: it,
  enBolsa,
  onMarcar,
  onRecargar,
}: {
  item: ItemPedido;
  enBolsa: boolean;
  onMarcar: () => void;
  onRecargar: () => void;
}) {
  return (
    <li
      className={cx(
        "flex gap-3 rounded-lg border hairline px-3 py-2.5",
        enBolsa ? "bg-ok/[0.06]" : "bg-ink/[0.02]",
      )}
    >
      <label className="flex shrink-0 cursor-pointer items-start pt-1" title="Ya lo metí en la bolsa">
        <input type="checkbox" checked={enBolsa} onChange={onMarcar} className="h-4 w-4 accent-[var(--color-ok)]" />
      </label>
      {it.thumbnail ? (
        <img src={it.thumbnail} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
      ) : (
        <div className="h-12 w-12 shrink-0 rounded-md bg-ink/[0.06]" />
      )}
      <div className={cx("min-w-0 flex-1", enBolsa && "opacity-60")}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-[13px] font-extrabold tabular-nums text-accent">
            {it.cantidad}×
          </span>
          <span className="text-[13.5px] font-semibold [overflow-wrap:anywhere]">{it.producto}</span>
          {it.variante && (
            <span className="rounded-full bg-ink/[0.08] px-2 py-0.5 text-[11.5px] font-bold">
              {it.variante}
            </span>
          )}
          {!it.mapeado && <ElegirVariante item={it} onListo={onRecargar} />}
        </div>
        {it.producto !== it.titulo && (
          <div className="mt-0.5 text-[11px] text-ink/40 [overflow-wrap:anywhere]">{it.titulo}</div>
        )}
        {it.contenido.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {it.contenido.map((pieza) => (
              <span
                key={pieza.nombre}
                className="rounded-md border hairline bg-surface px-2 py-0.5 text-[11.5px]"
              >
                <b className="tabular-nums">{pieza.cantidad}</b> × {pieza.nombre}
              </span>
            ))}
          </div>
        )}
        {it.faltante > 0 && (
          <div className="mt-1.5 text-[11.5px] font-semibold text-danger">
            Faltan {it.faltante} {it.faltante === 1 ? "unidad" : "unidades"} por armar
          </div>
        )}
      </div>
    </li>
  );
}

/** Los pedidos "a acordar" no tienen envío en ML: los da por entregados Elias,
 *  y eso descuenta el stock de la venta (una sola vez, igual que un despacho). */
function MarcarEntregado({ paquete: p, onListo }: { paquete: Paquete; onListo: () => void }) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <li className="flex flex-wrap items-center gap-3 pt-1">
      <PrimaryButton
        disabled={guardando}
        onClick={async () => {
          if (!confirm(`¿Ya le entregaste el pedido a ${p.comprador ?? "este comprador"}? Se descuenta el stock.`))
            return;
          setGuardando(true);
          setError(undefined);
          try {
            for (const id of p.ml_order_ids)
              await api(`/pedidos/${id}/despachar`, { method: "POST" });
            onListo();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setGuardando(false);
          }
        }}
      >
        {guardando ? "Guardando…" : "Ya lo entregué"}
      </PrimaryButton>
      {error && <span className="text-[12px] text-danger">{error}</span>}
    </li>
  );
}
