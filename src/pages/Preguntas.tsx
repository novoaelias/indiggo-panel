import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge, Card, EmptyHint, GhostButton, PageHeader, PrimaryButton, cx } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { AvisoPush } from "@/components/AvisoPush";

type Filter = "pendientes" | "necesitan" | "automaticas" | "historial";
interface Question {
  id: string;
  ml_item_id: string;
  pregunta: string;
  respuesta: string | null;
  estado_panel: string;
  sugerencia: string | null;
  motivo_revision: string | null;
  respuesta_usuario: string | null;
  automatico: boolean;
  preguntada_at: string;
  respondida_at: string | null;
  products: { nombre: string; nombre_interno: string | null } | null;
  listing: { titulo: string; thumbnail: string | null; permalink: string | null } | null;
}
interface QuestionsData {
  preguntas: Question[];
  counts: Record<Filter, number>;
}

export function Preguntas() {
  const [params] = useSearchParams();
  const selectedId = params.get("id");
  const [filter, setFilter] = useState<Filter>(selectedId ? "necesitan" : "pendientes");
  const questions = useApi<QuestionsData>(`/preguntas?estado=${filter}`);
  const [syncing, setSyncing] = useState(false);
  const data = questions.data;
  useEffect(() => {
    if (!selectedId || !data) return;
    document.getElementById(`pregunta-${selectedId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedId, data]);

  async function sync() {
    setSyncing(true);
    try { await api("/preguntas/sync", { method: "POST" }); questions.reload(); }
    finally { setSyncing(false); }
  }
  return <div>
    <PageHeader titulo="Preguntas" subtitulo="Respuestas profesionales con tu conocimiento y el historial de la tienda" acciones={<PrimaryButton disabled={syncing} onClick={sync}>{syncing ? "Sincronizando…" : "Buscar preguntas"}</PrimaryButton>} />
    <AvisoPush />
    <div className="mb-5 flex gap-1 overflow-x-auto rounded-lg bg-ink/[0.05] p-1">
      {(["pendientes", "necesitan", "automaticas", "historial"] as Filter[]).map((value) => {
        const labels: Record<Filter, string> = {
          pendientes: "Procesando",
          necesitan: "Necesitan tu respuesta",
          automaticas: "Respondidas automáticamente",
          historial: "Historial",
        };
        return <button key={value} onClick={() => setFilter(value)} className={cx("whitespace-nowrap rounded-md px-3 py-2 text-[13px] font-semibold", filter === value ? "bg-surface shadow-sm" : "text-ink/50")}>{labels[value]} {data && <span className="ml-1 text-[10px] opacity-60">{data.counts[value]}</span>}</button>;
      })}
    </div>
    {questions.loading && <EmptyHint>Cargando preguntas…</EmptyHint>}
    {questions.error && <EmptyHint>No se pudieron cargar: {questions.error}</EmptyHint>}
    <div className="flex flex-col gap-4">
      {data?.preguntas.map((question) => <QuestionCard key={question.id} question={question} selected={question.id === selectedId} onSaved={questions.reload} />)}
      {data && data.preguntas.length === 0 && <EmptyHint>{filter === "pendientes" ? "No hay preguntas pendientes." : "Todavía no hay preguntas en esta vista."}</EmptyHint>}
    </div>
  </div>;
}

function QuestionCard({ question, selected, onSaved }: { question: Question; selected: boolean; onSaved: () => void }) {
  const [context, setContext] = useState(question.respuesta_usuario ?? "");
  const [answer, setAnswer] = useState(question.sugerencia ?? question.respuesta ?? "");
  const [reutilizable, setReutilizable] = useState(
    !question.motivo_revision?.includes("compromiso"),
  );
  const [temporal, setTemporal] = useState(false);
  const [working, setWorking] = useState<"draft" | "literal" | "send" | null>(null);
  const [error, setError] = useState<string>();
  const pending = ["pendiente", "procesando", "necesita_respuesta", "sugerida", "error"].includes(question.estado_panel);
  const productName = question.products?.nombre_interno || question.products?.nombre || question.listing?.titulo || question.ml_item_id;
  const status = useMemo(() => {
    if (question.estado_panel === "respondida_auto") return <Badge tono="ok">Respondida automáticamente</Badge>;
    if (question.estado_panel === "respondida_manual") return <Badge tono="neutral">Respondida por vos</Badge>;
    if (question.estado_panel === "procesando" || question.estado_panel === "pendiente") return <Badge tono="info">Preparando</Badge>;
    if (question.estado_panel === "error") return <Badge tono="danger">Error</Badge>;
    return <Badge tono="warn">Necesita tu ayuda</Badge>;
  }, [question.estado_panel]);
  // literal = tu texto tal cual, sólo firmado. "Redactar mejor" toma tu apunte
  // en crudo y lo reescribe con tono comercial, sin sacarte datos.
  async function draft(literal = false) {
    if (!context.trim()) return;
    setWorking(literal ? "literal" : "draft");
    setError(undefined);
    try {
      const result = await api<{ suggestion: string }>(`/preguntas/${question.id}/draft`, { method: "POST", body: JSON.stringify({ context, literal }) });
      setAnswer(result.suggestion);
    } catch (err) {
      setError((err as Error).message);
    } finally { setWorking(null); }
  }
  async function send() {
    if (!answer.trim()) return;
    setWorking("send");
    setError(undefined);
    try {
      await api(`/preguntas/${question.id}/send`, {
        method: "POST",
        body: JSON.stringify({ answer, reutilizable, temporal }),
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally { setWorking(null); }
  }
  return <Card className={cx(selected && "ring-2 ring-accent")}>
    <div id={`pregunta-${question.id}`} className="scroll-mt-24">
      <div className="flex items-start gap-3">
        {question.listing?.thumbnail && <img src={question.listing.thumbnail} alt="" className="h-12 w-12 rounded-lg object-cover" />}
        <div className="min-w-0 flex-1"><div className="text-[11px] text-ink/40">{productName} · {new Date(question.preguntada_at).toLocaleString("es-AR")}</div><div className="mt-1 text-[15px] font-semibold leading-snug">{question.pregunta}</div></div>{status}
      </div>
      {question.motivo_revision && <div className="mt-3 rounded-lg bg-warn-bg px-3 py-2 text-[11.5px] text-warn">{question.motivo_revision}</div>}
      {pending ? <div className="mt-4 border-t pt-4 hairline">
        <label className="block text-[11.5px] font-semibold">Decime el dato que falta<textarea value={context} onChange={(e) => setContext(e.target.value)} placeholder="Escribilo como te salga, ej.: si lo hacemos en negro tarda 2 dias" className="mt-1 min-h-20 w-full rounded-lg border border-ink/12 px-3 py-2 text-[13px] outline-none focus:border-accent" /></label>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <GhostButton disabled={working !== null || !context.trim()} onClick={() => draft(false)}>{working === "draft" ? "Redactando…" : "Redactar mejor"}</GhostButton>
          <GhostButton disabled={working !== null || !context.trim()} onClick={() => draft(true)}>{working === "literal" ? "Copiando…" : "Usar mi texto"}</GhostButton>
          <span className="text-[10.5px] text-ink/40">"Redactar mejor" lo reescribe con tono comercial y 💜 sin sacar datos; "Usar mi texto" lo manda tal cual. Los dos firman como Indiggo Store.</span>
        </div>
        {error && <div className="mt-3 rounded-lg bg-danger-bg px-3 py-2 text-[11.5px] text-danger">{error}</div>}
        {(answer || question.sugerencia) && <div className="mt-4"><label className="block text-[11.5px] font-semibold">Respuesta final<textarea value={answer} maxLength={2000} onChange={(e) => setAnswer(e.target.value)} className="mt-1 min-h-24 w-full rounded-lg border border-accent/30 bg-accent-soft/40 px-3 py-2 text-[13px] outline-none focus:border-accent" /></label><div className="mt-3 flex flex-wrap gap-4 text-[11.5px] text-ink/55"><label className="flex items-center gap-2"><input type="checkbox" checked={reutilizable} onChange={(e) => setReutilizable(e.target.checked)} />Guardar para responder preguntas parecidas</label>{reutilizable && <label className="flex items-center gap-2"><input type="checkbox" checked={temporal} onChange={(e) => setTemporal(e.target.checked)} />Vale sólo por 24 horas</label>}</div><div className="mt-2 flex items-center justify-between"><span className="text-[10px] text-ink/35">{answer.length}/2000</span><PrimaryButton disabled={working !== null || !answer.trim()} onClick={send}>{working === "send" ? "Enviando…" : "Enviar a Mercado Libre"}</PrimaryButton></div></div>}
      </div> : <div className="mt-4 rounded-lg bg-ink/[0.025] px-4 py-3 text-[13px] leading-relaxed">{question.respuesta}</div>}
    </div>
  </Card>;
}

