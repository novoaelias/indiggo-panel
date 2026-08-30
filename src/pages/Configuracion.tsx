import { Card, PageHeader } from "@/components/ui";
import { gruposKpop } from "@/data/mock";

export function Configuracion() {
  return (
    <div>
      <PageHeader
        titulo="Configuración"
        subtitulo="Catálogo base, grupos de kpop e integrantes, conexiones"
      />

      <div className="flex flex-col gap-8">
        <section>
          <h2 className="mb-3.5 text-[15px] font-semibold">Grupos e integrantes</h2>
          <p className="mb-4 max-w-prose text-[13.5px] text-ink/55">
            Cada holder se publica en Mercado Libre con una variante por
            integrante. Estos grupos alimentan esas variantes y el stock de
            photocards.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {gruposKpop.map((g) => (
              <Card key={g.id}>
                <div className="mb-2 text-[14px] font-semibold">{g.nombre}</div>
                <div className="flex flex-wrap gap-1.5">
                  {g.integrantes.map((m) => (
                    <span
                      key={m.nombre}
                      className="rounded-full bg-ink/[0.05] px-2.5 py-1 text-[12px] text-ink/70"
                    >
                      {m.nombre}
                    </span>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3.5 text-[15px] font-semibold">Conexiones</h2>
          <div className="flex flex-col gap-2.5">
            <ConexionRow nombre="Mercado Libre" detalle="OAuth2 · site MLA" />
            <ConexionRow nombre="Supabase" detalle="Base de datos del panel" />
            <ConexionRow nombre="Claude API" detalle="Generación de textos y análisis" />
            <ConexionRow nombre="kie.ai" detalle="Generación de imágenes y video" />
          </div>
        </section>
      </div>
    </div>
  );
}

function ConexionRow({ nombre, detalle }: { nombre: string; detalle: string }) {
  return (
    <div className="flex items-center justify-between rounded-[12px] border bg-surface px-4 py-3.5 hairline">
      <div>
        <div className="text-[14px] font-semibold">{nombre}</div>
        <div className="mt-0.5 text-[12.5px] text-ink/50">{detalle}</div>
      </div>
      <span className="rounded-full bg-ink/[0.06] px-2.5 py-1 text-[12px] font-semibold text-ink/55">
        Sin conectar
      </span>
    </div>
  );
}
