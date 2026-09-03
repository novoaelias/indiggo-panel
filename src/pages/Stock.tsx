import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Card, Dot, EmptyHint, PageHeader, cx } from "@/components/ui";
import { api, useApi } from "@/lib/api";

type Tono = "ok" | "warn" | "danger";

interface Pieza {
  kind: "componente" | "variante";
  id: string;
  tipo: string;
  grupo: string;
  nombre: string;
  contexto: string | null;
  stock_real: number;
  stock_minimo: number;
  producir: number;
  estado_tono: Tono;
}
interface ProdResumen {
  product_id: string;
  nombre: string;
  grupo: string | null;
  vendibles: number;
  sin_stock_de: string[];
  estado_tono: Tono;
}
interface StockResp {
  piezas: Pieza[];
  productos: ProdResumen[];
  resumen: {
    piezas_a_producir: number;
    ml_desincronizado: number;
    sin_catalogo: boolean;
  };
}
interface Tarea {
  nombre: string;
  contexto: string | null;
  origen: string;
  cantidad: number;
  ya_tengo?: number;
  cobertura_dias: number;
  minutos: number;
  placas?: number | null;
  placas_label?: string;
  tipo: "insumo" | "directo";
}
interface Plan {
  imprimir_3d: Tarea[];
  imprenta: Tarea[];
  otros: Tarea[];
  variantes_criticas: number;
  sin_bom: boolean;
  minutos: { impresora3d: number; imprenta: number; otros: number };
}

const GRUPOS_ORDEN = [
  "Photocards",
  "Cuerpos 3D",
  "Llaveros 3D",
  "Mostacillas",
  "Otros",
];
const ORIGEN_LABEL: Record<string, string> = {
  imprenta: "Pedir a la imprenta",
  impresora3d: "Imprimir en 3D",
  mixto: "Otros",
  externo: "Otros",
};

function fmtHoras(min: number): string {
  if (!min) return "";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h && m) return `~${h} h ${m} min`;
  if (h) return `~${h} h`;
  return `~${m} min`;
}

const ordGrupo = (g: string) => {
  const i = GRUPOS_ORDEN.indexOf(g);
  return i < 0 ? 99 : i;
};

export function Stock() {
  const stock = useApi<StockResp>("/stock");
  const plan = useApi<Plan>("/produccion");
  const [q, setQ] = useState("");
  const [mlEstado, setMlEstado] = useState<"idle" | "sync" | "ok">("idle");
  const syncTimer = useRef<number | undefined>(undefined);

  const d = stock.data;

  function recargar() {
    stock.reload();
    plan.reload();
  }

  async function correrSync() {
    setMlEstado("sync");
    try {
      await api("/stock/sincronizar-ml", { method: "POST" });
      setMlEstado("ok");
    } catch {
      setMlEstado("idle");
    }
    recargar();
  }

  // tras editar: espera y sincroniza ML solo
  function programarSync() {
    setMlEstado("sync");
    window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(correrSync, 3500);
  }
  useEffect(() => () => window.clearTimeout(syncTimer.current), []);

  async function sincronizarYa() {
    window.clearTimeout(syncTimer.current);
    await correrSync();
  }

  async function guardarPieza(p: Pieza, _campo: "stock_real", valor: number) {
    const path = p.kind === "componente" ? `/componentes/${p.id}` : `/stock/${p.id}`;
    await api(path, {
      method: "PATCH",
      body: JSON.stringify({ stock_real: valor }),
    });
    stock.reload();
    programarSync();
  }

  const piezasFiltradas = useMemo(() => {
    if (!d) return [];
    const t = q.trim().toLowerCase();
    if (!t) return d.piezas;
    return d.piezas.filter((p) =>
      `${p.nombre} ${p.contexto ?? ""}`.toLowerCase().includes(t),
    );
  }, [d, q]);

  const grupos = useMemo(() => {
    const m = new Map<string, Pieza[]>();
    for (const p of piezasFiltradas) {
      if (!m.has(p.grupo)) m.set(p.grupo, []);
      m.get(p.grupo)!.push(p);
    }
    return [...m.entries()].sort((a, b) => ordGrupo(a[0]) - ordGrupo(b[0]));
  }, [piezasFiltradas]);

  const nadaQueProducir =
    plan.data &&
    plan.data.imprimir_3d.length === 0 &&
    plan.data.imprenta.length === 0 &&
    plan.data.otros.length === 0;

  return (
    <div>
      <PageHeader
        titulo="Stock"
        subtitulo={
          d && !d.resumen.sin_catalogo
            ? d.resumen.piezas_a_producir > 0
              ? `${d.resumen.piezas_a_producir} ${d.resumen.piezas_a_producir === 1 ? "pieza" : "piezas"} para producir`
              : "Cargá acá lo que vas produciendo — el resto es automático"
            : "Tu stock real, por pieza"
        }
        acciones={
          d && !d.resumen.sin_catalogo ? (
            <MlPill
              estado={mlEstado}
              desync={d.resumen.ml_desincronizado}
              onSync={sincronizarYa}
            />
          ) : undefined
        }
      />

      {stock.loading && <EmptyHint>Cargando stock…</EmptyHint>}
      {stock.error && <EmptyHint>No se pudo cargar: {stock.error}</EmptyHint>}

      {d?.resumen.sin_catalogo && (
        <EmptyHint>
          Todavía no hay catálogo. Andá a <b>Configuración → Catálogo</b> y tocá
          “Derivar desde publicaciones”.
        </EmptyHint>
      )}

      {d && !d.resumen.sin_catalogo && (
        <>
          {d.productos.length > 0 && <PuedoVender productos={d.productos} />}

          <div className="grid gap-5 lg:grid-cols-[1.55fr_1fr]">
            <div>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar pieza…"
                className="mb-3 w-full rounded-lg border border-ink/12 px-3 py-2 text-[13px] outline-none focus:border-accent"
              />
              <div className="flex flex-col gap-3">
                {grupos.map(([grupo, piezas]) => (
                  <GrupoPiezas
                    key={grupo}
                    grupo={grupo}
                    piezas={piezas}
                    onGuardar={guardarPieza}
                  />
                ))}
                {grupos.length === 0 && (
                  <EmptyHint>Nada coincide con “{q}”.</EmptyHint>
                )}
              </div>
            </div>

            <Card>
              <div className="text-[15px] font-semibold">A producir</div>
              <div className="mb-4 mt-1 text-[12.5px] text-ink/50">
                Según tus ventas de las últimas 2 semanas
              </div>
              {plan.loading && (
                <div className="text-[13px] text-ink/40">Calculando…</div>
              )}
              {plan.data?.sin_bom && (
                <div className="mb-3 rounded-lg bg-warn-bg px-3 py-2 text-[12px] text-warn">
                  No hay lista de materiales. Andá a Configuración → Catálogo →
                  “Armar lista de materiales”.
                </div>
              )}
              {plan.data &&
                (
                  [
                    ["imprenta", plan.data.imprenta, plan.data.minutos.imprenta],
                    [
                      "impresora3d",
                      plan.data.imprimir_3d,
                      plan.data.minutos.impresora3d,
                    ],
                    ["mixto", plan.data.otros, plan.data.minutos.otros],
                  ] as const
                ).map(([org, tareas, mins]) =>
                  tareas.length === 0 ? null : (
                    <div key={org} className="mb-4 last:mb-0">
                      <div className="mb-1.5 flex items-baseline justify-between">
                        <span className="text-[12px] font-semibold text-ink/55">
                          {ORIGEN_LABEL[org]}
                        </span>
                        {mins > 0 && (
                          <span className="text-[11px] text-ink/40">
                            {fmtHoras(mins)}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col">
                        {tareas.map((t, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-2 border-b hairline py-2 last:border-b-0"
                          >
                            <span className="min-w-0 flex-1 text-[13px] leading-snug [overflow-wrap:anywhere]">
                              {t.nombre}
                              {t.contexto && (
                                <span className="text-ink/45"> · {t.contexto}</span>
                              )}
                              {(t.ya_tengo != null ||
                                t.minutos > 0 ||
                                t.placas != null) && (
                                <span className="block text-[10.5px] text-ink/35">
                                  {t.ya_tengo != null && `tenés ${t.ya_tengo}`}
                                  {t.ya_tengo != null &&
                                    (t.minutos > 0 || t.placas != null) &&
                                    " · "}
                                  {t.placas != null && `${t.cantidad} u.`}
                                  {t.placas != null && t.minutos > 0 && " · "}
                                  {t.minutos > 0 && fmtHoras(t.minutos)}
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 text-right text-[13px] font-bold text-accent">
                              {t.placas_label && !t.placas_label.startsWith("×") ? (
                                <>
                                  {t.placas_label}
                                  <span className="block text-[10px] font-medium text-ink/35">
                                    {t.cantidad} u.
                                  </span>
                                </>
                              ) : (
                                `${t.cantidad} u.`
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ),
                )}
              {nadaQueProducir && (
                <div className="text-[13px] text-ink/45">
                  Nada para producir. 🎉
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function MlPill({
  estado,
  desync,
  onSync,
}: {
  estado: "idle" | "sync" | "ok";
  desync: number;
  onSync: () => void;
}) {
  if (estado === "sync")
    return (
      <span className="rounded-full bg-warn-bg px-3 py-2 text-[12.5px] font-semibold text-warn">
        Sincronizando Mercado Libre…
      </span>
    );
  if (estado === "idle" && desync > 0)
    return (
      <button
        onClick={onSync}
        className="rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-accent-hover"
      >
        Sincronizar Mercado Libre ({desync})
      </button>
    );
  return (
    <span className="rounded-full bg-ok-bg px-3 py-2 text-[12.5px] font-semibold text-ok">
      Mercado Libre al día
    </span>
  );
}

function PuedoVender({ productos }: { productos: ProdResumen[] }) {
  const problemas = productos.filter((p) => p.estado_tono !== "ok").length;
  const [open, setOpen] = useState(problemas > 0);
  return (
    <Card padding={false} className="mb-5 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ink/[0.02]"
      >
        <span
          className={cx(
            "text-ink/35 transition-transform",
            open && "rotate-90",
          )}
        >
          ▸
        </span>
        <span className="flex-1">
          <span className="text-[13.5px] font-semibold">
            Qué puedo despachar hoy
          </span>
          <span className="block text-[11px] text-ink/40">
            Unidades listas por producto — en holders sale de las piezas que cargás
          </span>
        </span>
        <span className="text-[11.5px] text-ink/45">
          {problemas > 0
            ? `${problemas} con problema`
            : `${productos.length} productos`}
        </span>
      </button>
      {open && (
        <div className="border-t hairline">
          {productos.map((p) => (
            <div
              key={p.product_id}
              className="flex items-center gap-3 border-b hairline px-4 py-2.5 last:border-b-0"
            >
              <Dot tono={p.estado_tono} />
              <span className="min-w-0 flex-1 text-[13px] font-medium [overflow-wrap:anywhere]">
                {p.nombre}
                {p.grupo && <span className="text-ink/40"> · {p.grupo}</span>}
              </span>
              {p.sin_stock_de.length > 0 && (
                <span className="hidden shrink-0 text-[11px] text-warn sm:block">
                  sin {p.sin_stock_de.slice(0, 3).join(", ")}
                  {p.sin_stock_de.length > 3 && "…"}
                </span>
              )}
              <span
                className={cx(
                  "shrink-0 text-[16px] font-bold tabular-nums",
                  p.vendibles === 0 && "text-danger",
                )}
              >
                {p.vendibles}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function GrupoPiezas({
  grupo,
  piezas,
  onGuardar,
}: {
  grupo: string;
  piezas: Pieza[];
  onGuardar: (
    p: Pieza,
    campo: "stock_real",
    valor: number,
  ) => Promise<void>;
}) {
  const aProducir = piezas.filter((p) => p.producir > 0).length;
  const [open, setOpen] = useState(false);

  // sub-agrupar variantes del mismo producto (ej. 8 colores de un clicker)
  const bloques: Array<{ nombre: string; items: Pieza[] }> = [];
  const idx = new Map<string, number>();
  for (const p of piezas) {
    if (!idx.has(p.nombre)) {
      idx.set(p.nombre, bloques.length);
      bloques.push({ nombre: p.nombre, items: [] });
    }
    bloques[idx.get(p.nombre)!].items.push(p);
  }

  return (
    <Card padding={false} className="overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ink/[0.02]"
      >
        <span
          className={cx("text-ink/35 transition-transform", open && "rotate-90")}
        >
          ▸
        </span>
        <span className="flex-1 text-[13.5px] font-semibold">{grupo}</span>
        {aProducir > 0 && (
          <span className="rounded-full bg-warn-bg px-2 py-0.5 text-[11px] font-bold text-warn">
            {aProducir} para producir
          </span>
        )}
        <span className="text-[11.5px] text-ink/40">{piezas.length}</span>
      </button>
      {open && (
        <div className="border-t hairline">
          {bloques.map((b) =>
            b.items.length === 1 ? (
              <PiezaFila
                key={`${b.items[0].kind}:${b.items[0].id}`}
                pieza={b.items[0]}
                label={b.items[0].nombre}
                sub={b.items[0].contexto}
                onGuardar={onGuardar}
              />
            ) : (
              <SubGrupo
                key={b.nombre}
                nombre={b.nombre}
                items={b.items}
                onGuardar={onGuardar}
              />
            ),
          )}
        </div>
      )}
    </Card>
  );
}

function SubGrupo({
  nombre,
  items,
  onGuardar,
}: {
  nombre: string;
  items: Pieza[];
  onGuardar: (
    p: Pieza,
    campo: "stock_real",
    valor: number,
  ) => Promise<void>;
}) {
  const aProducir = items.filter((p) => p.producir > 0).length;
  const [open, setOpen] = useState(false);
  const total = items.reduce((s, p) => s + p.stock_real, 0);
  return (
    <div className="border-b hairline last:border-b-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-ink/[0.02]"
      >
        <span
          className={cx(
            "text-[11px] text-ink/30 transition-transform",
            open && "rotate-90",
          )}
        >
          ▸
        </span>
        <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug [overflow-wrap:anywhere]">
          {nombre}
        </span>
        {aProducir > 0 && (
          <span className="shrink-0 rounded-full bg-warn-bg px-1.5 py-0.5 text-[10px] font-bold text-warn">
            {aProducir}
          </span>
        )}
        <span className="shrink-0 text-[11px] text-ink/40">
          {items.length} · {total} en total
        </span>
      </button>
      {open && (
        <div className="bg-ink/[0.015]">
          {items.map((p) => (
            <PiezaFila
              key={`${p.kind}:${p.id}`}
              pieza={p}
              label={p.contexto ?? p.nombre}
              sub={null}
              indent
              onGuardar={onGuardar}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PiezaFila({
  pieza,
  label,
  sub,
  indent,
  onGuardar,
}: {
  pieza: Pieza;
  label: string;
  sub: string | null;
  indent?: boolean;
  onGuardar: (
    p: Pieza,
    campo: "stock_real",
    valor: number,
  ) => Promise<void>;
}) {
  const badge =
    pieza.producir > 0 ? (
      <Badge tono="warn">Hacer {pieza.producir}</Badge>
    ) : pieza.stock_real <= 0 && pieza.stock_minimo > 0 ? (
      <Badge tono="danger">Sin stock</Badge>
    ) : null;

  return (
    <div
      className={cx(
        "border-b hairline py-2.5 pr-4 last:border-b-0",
        indent ? "pl-9" : "pl-4",
      )}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium leading-snug [overflow-wrap:anywhere]">
            {label}
          </div>
          {sub && <div className="text-[11px] text-ink/40">{sub}</div>}
        </div>
        {badge}
        <Stepper
          value={pieza.stock_real}
          onSave={(v) => onGuardar(pieza, "stock_real", v)}
        />
      </div>

      {pieza.stock_minimo > 0 && (
        <div className="mt-0.5 text-[10.5px] text-ink/30" title="Calculado por tus ventas">
          mín. {pieza.stock_minimo}
        </div>
      )}
    </div>
  );
}

function Stepper({
  value,
  onSave,
  small,
}: {
  value: number;
  onSave: (v: number) => Promise<void> | void;
  small?: boolean;
}) {
  const [txt, setTxt] = useState(String(value));
  const [dirty, setDirty] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!dirty) setTxt(String(value));
  }, [value, dirty]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function commit(nextStr: string) {
    setTxt(nextStr);
    setDirty(true);
    const n = Math.max(0, Math.round(Number(nextStr) || 0));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      await onSave(n);
      setDirty(false);
    }, 700);
  }
  const cur = () => Math.max(0, Math.round(Number(txt) || 0));

  const btn = cx(
    "grid place-items-center rounded-lg border border-ink/12 font-bold text-ink/55 transition-transform hover:bg-ink/[0.04] active:scale-90",
    small ? "h-7 w-7 text-[14px]" : "h-9 w-9 text-[17px]",
  );

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button className={btn} onClick={() => commit(String(cur() - 1))}>
        −
      </button>
      <input
        inputMode="numeric"
        value={txt}
        onChange={(e) => commit(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={() => setTxt(String(cur()))}
        className={cx(
          "rounded-lg border border-ink/12 text-center font-bold tabular-nums outline-none focus:border-accent",
          small ? "h-7 w-10 text-[13px]" : "h-9 w-12 text-[15px]",
        )}
      />
      <button className={btn} onClick={() => commit(String(cur() + 1))}>
        +
      </button>
    </div>
  );
}
