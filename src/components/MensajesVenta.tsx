import { useState } from "react";
import { GhostButton, PrimaryButton, cx } from "@/components/ui";
import { api, useApi } from "@/lib/api";

interface Mensaje {
  id: string;
  mio: boolean;
  texto: string;
  fecha: string;
}
interface OpcionInicio {
  id: string;
  tipo: "plantilla" | "libre";
  texto: string | null;
  plantilla_id: string | null;
  disponibles: number;
  limite: number | null;
}
interface Conversacion {
  estado: "activa" | "bloqueada" | "cerrada";
  motivo: string | null;
  mensajes: Mensaje[];
  max_largo: number;
  opciones: OpcionInicio[];
}

const AR_TZ = "America/Argentina/Buenos_Aires";
const hora = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: AR_TZ });
const diaHora = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: AR_TZ,
});
const diaAR = new Intl.DateTimeFormat("en-CA", { timeZone: AR_TZ });

function cuando(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return diaAR.format(d) === diaAR.format(new Date()) ? hora.format(d) : diaHora.format(d);
}

/** Chat posventa de un paquete: se abre a pedido para no consultar a ML por
 *  cada pedido de la lista. Con un mensaje nuevo arranca abierto. */
export function MensajesVenta({
  packId,
  comprador,
  nuevo,
}: {
  packId: string;
  comprador: string | null;
  nuevo: boolean;
}) {
  const [abierto, setAbierto] = useState(nuevo);
  if (!abierto)
    return (
      <li className="pt-1">
        <GhostButton onClick={() => setAbierto(true)}>Ver mensajes</GhostButton>
      </li>
    );
  return (
    <li>
      <Chat packId={packId} comprador={comprador} />
    </li>
  );
}

function Chat({ packId, comprador }: { packId: string; comprador: string | null }) {
  const { data, error, loading, reload } = useApi<Conversacion>(`/mensajes/${packId}`);
  return (
    <div className="rounded-lg border hairline bg-surface px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-semibold">Mensajes con {comprador ?? "el comprador"}</span>
        <button type="button" onClick={reload} className="text-[11.5px] text-accent hover:underline">
          Actualizar
        </button>
      </div>
      {loading && !data && <div className="text-[12px] text-ink/45">Cargando mensajes…</div>}
      {error && <div className="text-[12px] text-danger">No se pudieron leer: {error}</div>}
      {data && (
        <>
          {data.mensajes.length > 0 ? (
            <div className="mb-3 flex max-h-80 flex-col gap-1.5 overflow-y-auto pr-1">
              {data.mensajes.map((m) => (
                <div
                  key={m.id}
                  className={cx(
                    "max-w-[85%] rounded-lg px-3 py-1.5 text-[12.5px]",
                    m.mio ? "self-end bg-accent-soft" : "self-start bg-ink/[0.05]",
                  )}
                >
                  <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.texto}</div>
                  <div className="mt-0.5 text-right text-[10px] text-ink/40">{cuando(m.fecha)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mb-3 text-[12px] text-ink/45">Todavía no hay mensajes en esta venta.</div>
          )}

          {data.estado === "activa" && (
            <Redactor
              packId={packId}
              limite={data.max_largo}
              accion="Enviar"
              onEnviar={(texto) =>
                api(`/mensajes/${packId}/enviar`, { method: "POST", body: JSON.stringify({ texto }) })
              }
              onListo={reload}
            />
          )}

          {data.estado === "bloqueada" && (
            <IniciarConversacion packId={packId} opciones={data.opciones} onListo={reload} />
          )}

          {data.estado === "cerrada" && (
            <div className="text-[12px] text-ink/55">
              Mercado Libre no deja escribir en esta venta ({data.motivo ?? "conversación cerrada"}).
            </div>
          )}
        </>
      )}
    </div>
  );
}

function IniciarConversacion({
  packId,
  opciones,
  onListo,
}: {
  packId: string;
  opciones: OpcionInicio[];
  onListo: () => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string>();
  const plantilla = opciones.find((o) => o.tipo === "plantilla");
  const libre = opciones.find((o) => o.tipo === "libre");
  const iniciar = (opcion: string, texto?: string) =>
    api(`/mensajes/${packId}/iniciar`, { method: "POST", body: JSON.stringify({ opcion, texto }) });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-ink/55">
        Mercado Libre bloquea el chat hasta que escriba el comprador. Para abrirlo vos:
      </p>
      {!plantilla && !libre && (
        <p className="text-[12px] text-ink/55">
          En esta venta ya no quedan formas de iniciarlo: hay que esperar a que escriba el comprador.
        </p>
      )}
      {plantilla && (
        <div className="rounded-lg bg-ink/[0.03] px-3 py-2.5">
          <div className="text-[11.5px] font-semibold">Pedir que confirme la variante (plantilla de ML)</div>
          {plantilla.texto && <div className="mt-1 text-[12.5px] text-ink/70">“{plantilla.texto}”</div>}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <GhostButton
              disabled={enviando}
              onClick={async () => {
                if (!confirm("¿Mandar la plantilla de Mercado Libre al comprador?")) return;
                setEnviando(true);
                setError(undefined);
                try {
                  await iniciar(plantilla.id);
                  onListo();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setEnviando(false);
                }
              }}
            >
              {enviando ? "Enviando…" : "Enviar plantilla"}
            </GhostButton>
            {error && <span className="text-[12px] text-danger">{error}</span>}
          </div>
        </div>
      )}
      {libre && (
        <div className="rounded-lg bg-ink/[0.03] px-3 py-2.5">
          <div className="mb-2 text-[11.5px] font-semibold">
            Mensaje libre ({libre.disponibles === 1 ? "te queda 1" : `te quedan ${libre.disponibles}`} en esta
            venta, hasta {libre.limite ?? 350} caracteres)
          </div>
          <Redactor
            packId={packId}
            limite={libre.limite ?? 350}
            inicio
            accion="Enviar y abrir el chat"
            onEnviar={(texto) => iniciar(libre.id, texto)}
            onListo={onListo}
          />
        </div>
      )}
    </div>
  );
}

/** Escribís como te salga, "Redactar mejor" lo pasa en limpio con IA, lo
 *  revisás y recién ahí se envía. */
function Redactor({
  packId,
  limite,
  inicio = false,
  accion,
  onEnviar,
  onListo,
}: {
  packId: string;
  limite: number;
  inicio?: boolean;
  accion: string;
  onEnviar: (texto: string) => Promise<unknown>;
  onListo: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [original, setOriginal] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState<"redactar" | "enviar" | null>(null);
  const [error, setError] = useState<string>();
  const largo = texto.trim().length;
  const pasado = largo > limite;

  async function redactar() {
    setTrabajando("redactar");
    setError(undefined);
    try {
      const r = await api<{ texto: string }>(`/mensajes/${packId}/redactar`, {
        method: "POST",
        body: JSON.stringify({ borrador: texto, inicio }),
      });
      setOriginal(texto);
      setTexto(r.texto);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTrabajando(null);
    }
  }

  async function enviar() {
    setTrabajando("enviar");
    setError(undefined);
    try {
      await onEnviar(texto.trim());
      setTexto("");
      setOriginal(null);
      onListo();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTrabajando(null);
    }
  }

  return (
    <div>
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Escribilo como te salga, ej.: hola gracias por la compra el holder de suga sale el lunes"
        className="min-h-20 w-full rounded-lg border border-ink/12 bg-surface px-3 py-2 text-[13px] outline-none focus:border-accent"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <GhostButton disabled={trabajando !== null || !largo} onClick={redactar}>
          {trabajando === "redactar" ? "Redactando…" : "Redactar mejor"}
        </GhostButton>
        {original !== null && (
          <button
            type="button"
            className="text-[11.5px] text-ink/55 hover:underline"
            onClick={() => {
              setTexto(original);
              setOriginal(null);
            }}
          >
            Volver a mi texto
          </button>
        )}
        <span className={cx("ml-auto text-[10.5px] tabular-nums", pasado ? "font-bold text-danger" : "text-ink/35")}>
          {largo}/{limite}
        </span>
        <PrimaryButton disabled={trabajando !== null || !largo || pasado} onClick={enviar}>
          {trabajando === "enviar" ? "Enviando…" : accion}
        </PrimaryButton>
      </div>
      {error && <div className="mt-1.5 text-[12px] text-danger">{error}</div>}
    </div>
  );
}
