import { useState } from "react";
import { api } from "@/lib/api";

/** Sube fotos al bucket público "publicaciones" (vía /ia/imagen) y devuelve
 *  sus URLs. Lo usan Publicaciones y el editor de fotos. */
export function SubirFotos({
  fotos,
  onChange,
  max = 10,
}: {
  fotos: string[];
  onChange: (f: string[]) => void;
  max?: number;
}) {
  const [subiendo, setSubiendo] = useState(false);
  const [err, setErr] = useState<string>();

  async function agregar(files: FileList | null) {
    if (!files?.length) return;
    setErr(undefined);
    setSubiendo(true);
    const nuevas: string[] = [];
    try {
      for (const file of Array.from(files).slice(0, max - fotos.length)) {
        const fd = new FormData();
        fd.append("file", file);
        const r = await api<{ url: string }>("/ia/imagen", {
          method: "POST",
          body: fd,
        });
        nuevas.push(r.url);
      }
      onChange([...fotos, ...nuevas]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {fotos.map((url, i) => (
          <div
            key={url}
            className="group relative h-16 w-16 overflow-hidden rounded-lg border border-ink/12"
          >
            <img src={url} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => onChange(fotos.filter((_, j) => j !== i))}
              className="absolute right-0.5 top-0.5 rounded bg-ink/70 px-1 text-[11px] font-bold text-white opacity-0 group-hover:opacity-100"
            >
              ×
            </button>
          </div>
        ))}
        {fotos.length < max && (
          <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-lg border border-dashed border-ink/25 text-[11px] text-ink/45 hover:border-accent hover:text-accent">
            {subiendo ? "…" : "+ foto"}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                agregar(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>
      {err && <div className="mt-1 text-[11.5px] text-danger">{err}</div>}
    </div>
  );
}
