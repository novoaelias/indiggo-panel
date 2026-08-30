import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { clearPanelToken, setPanelToken } from "@/lib/auth";
import { Logo } from "./Logo";

type Estado = "verificando" | "abierto" | "bloqueado";

export function Gate({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>("verificando");

  useEffect(() => {
    api<{ ok: boolean }>("/session")
      .then(() => setEstado("abierto"))
      .catch(() => setEstado("bloqueado"));
  }, []);

  if (estado === "verificando") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper text-[13px] text-ink/40">
        …
      </div>
    );
  }

  if (estado === "bloqueado") {
    return <Login onOk={() => setEstado("abierto")} />;
  }

  return <>{children}</>;
}

function Login({ onOk }: { onOk: () => void }) {
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string>();
  const [probando, setProbando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    if (!clave.trim()) return;
    setProbando(true);
    setError(undefined);
    setPanelToken(clave.trim());
    try {
      await api<{ ok: boolean }>("/session");
      onOk();
    } catch {
      clearPanelToken();
      setError("Clave incorrecta");
    } finally {
      setProbando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <form
        onSubmit={entrar}
        className="w-full max-w-xs rounded-[14px] border bg-surface p-6 hairline"
      >
        <div className="mb-5">
          <Logo />
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] text-ink/50">Clave del panel</span>
          <input
            type="password"
            autoFocus
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            className="rounded-lg border border-ink/12 px-3 py-2.5 text-[14px] outline-none focus:border-accent"
          />
        </label>
        {error && <div className="mt-2 text-[12.5px] text-danger">{error}</div>}
        <button
          disabled={probando}
          className="mt-4 w-full rounded-[9px] bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {probando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
