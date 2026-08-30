import type { ReactNode } from "react";
import type { EstadoTono } from "@/lib/types";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function Card({
  children,
  className,
  padding = true,
}: {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}) {
  return (
    <div
      className={cx(
        "rounded-[12px] border bg-surface hairline",
        padding && "p-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  titulo,
  subtitulo,
  acciones,
}: {
  titulo: string;
  subtitulo?: string;
  acciones?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-display text-[30px] font-extrabold tracking-[-0.01em]">
          {titulo}
        </h1>
        {subtitulo && (
          <p className="mt-1 text-[14.5px] text-ink/50">{subtitulo}</p>
        )}
      </div>
      {acciones && <div className="flex flex-wrap gap-2.5">{acciones}</div>}
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-[9px] bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-accent-hover"
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-[9px] border border-ink/12 px-4 py-2.5 text-[13.5px] font-semibold text-ink transition-colors hover:bg-ink/[0.03]"
    >
      {children}
    </button>
  );
}

const tonoClases: Record<EstadoTono, string> = {
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  danger: "bg-danger-bg text-danger",
  info: "bg-accent-soft text-accent",
  neutral: "bg-ink/[0.06] text-ink/55",
};

export function Badge({
  tono,
  children,
}: {
  tono: EstadoTono;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-block rounded-full px-2.5 py-1 text-center text-[12px] font-bold",
        tonoClases[tono],
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tono }: { tono: EstadoTono }) {
  const color: Record<EstadoTono, string> = {
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
    info: "bg-accent",
    neutral: "bg-ink/30",
  };
  return (
    <span
      className={cx("h-2.5 w-2.5 shrink-0 rounded-full", color[tono])}
      aria-hidden
    />
  );
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[12px] border border-dashed hairline px-5 py-8 text-center text-[13.5px] text-ink/45">
      {children}
    </div>
  );
}
