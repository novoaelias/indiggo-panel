import { Dot, PageHeader } from "@/components/ui";
import { alertas, statsInicio } from "@/data/mock";
import { hoyLargo, saludo } from "@/lib/format";

export function Inicio() {
  return (
    <div>
      <PageHeader
        titulo={saludo()}
        subtitulo={hoyLargo.charAt(0).toUpperCase() + hoyLargo.slice(1)}
      />

      <div className="mb-9 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {statsInicio.map((s) => (
          <div
            key={s.label}
            className="rounded-[12px] border bg-surface p-5 hairline"
          >
            <div className="mb-2 text-[12.5px] text-ink/50">{s.label}</div>
            <div className="font-display text-[22px] font-bold">{s.value}</div>
          </div>
        ))}
      </div>

      <h2 className="mb-3.5 text-[15px] font-semibold">Alertas de hoy</h2>
      <div className="flex flex-col gap-2.5">
        {alertas.map((a, i) => (
          <div
            key={i}
            className="flex items-center gap-3.5 rounded-[12px] border bg-surface p-4 hairline"
          >
            <Dot tono={a.tono} />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold">{a.titulo}</div>
              <div className="mt-0.5 text-[13.5px] text-ink/55">{a.texto}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
