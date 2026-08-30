import { Card, PageHeader, PrimaryButton } from "@/components/ui";
import { contenidoRedes } from "@/data/mock";

export function Contenido() {
  return (
    <div>
      <PageHeader
        titulo="Contenido para redes"
        subtitulo="Imágenes, videos, textos y hashtags para Instagram y TikTok"
        acciones={<PrimaryButton>+ Generar contenido</PrimaryButton>}
      />

      <div className="mb-6 rounded-[12px] bg-warn-bg px-4 py-3 text-[13px] text-warn">
        Datos de ejemplo. La generación con IA (kie.ai + Claude) se conecta más
        adelante.
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {contenidoRedes.map((c) => (
          <Card key={c.id} padding={false} className="overflow-hidden">
            <div className="flex aspect-[4/5] items-center justify-center bg-[repeating-linear-gradient(45deg,rgba(16,24,32,0.07)_0_8px,rgba(16,24,32,0.02)_8px_16px)] font-mono text-[11px] uppercase tracking-[0.03em] text-ink/40">
              imagen / video
            </div>
            <div className="p-4">
              <span className="inline-block rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-bold text-accent">
                {c.plataforma}
              </span>
              <p className="my-2.5 text-[13.5px] leading-snug">{c.caption}</p>
              <p className="text-[12px] text-accent">{c.hashtags}</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
