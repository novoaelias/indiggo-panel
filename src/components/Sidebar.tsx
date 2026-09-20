import { Fragment, useState } from "react";
import { NavLink } from "react-router-dom";
import { NAV } from "./nav";
import { Logo } from "./Logo";
import { cx } from "./ui";
import { alternarTema, temaActual } from "@/lib/theme";

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map(({ to, label, icon: Icon }, index) => (
        <Fragment key={to}>
        {(index === 0 || index === 6) && <div className="nav-section">{index === 0 ? "Tu día a día" : "Herramientas"}</div>}
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          onClick={onNavigate}
          className={({ isActive }) =>
            cx(
              "flex items-center gap-[11px] rounded-[9px] px-3 py-2.5 text-[13.5px] font-semibold transition-colors",
              isActive
                ? "bg-accent-soft text-accent"
                : "text-ink/[0.62] hover:bg-ink/[0.03]",
            )
          }
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center">
            <Icon />
          </span>
          <span>{label}</span>
        </NavLink>
        </Fragment>
      ))}
    </nav>
  );
}

function Footer() {
  const [tema, setTema] = useState(temaActual());
  return (
    <div className="mt-auto flex items-end justify-between border-t hairline px-2.5 pt-3">
      <div className="flex flex-col gap-0.5">
        <div className="text-[12.5px] font-semibold">Indiggo Store</div>
        <div className="text-[11.5px] text-ink/45">Panel privado</div>
      </div>
      <button
        onClick={() => setTema(alternarTema())}
        title="Cambiar tema"
        className="rounded-md p-1.5 text-[13px] text-ink/45 hover:bg-ink/[0.05] hover:text-ink"
      >
        {tema === "dark" ? "☀" : "☾"}
      </button>
    </div>
  );
}

/** Sidebar fijo — visible en desktop (>= lg). */
export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-[236px] shrink-0 flex-col gap-7 border-r hairline bg-surface px-4 py-7 lg:flex">
      <Logo />
      <NavItems />
      <Footer />
    </aside>
  );
}

/** Drawer para mobile. */
export function MobileDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className={cx(
        "fixed inset-0 z-50 lg:hidden",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
      aria-hidden={!open}
      inert={!open}
    >
      <div
        onClick={onClose}
        className={cx(
          "absolute inset-0 scrim transition-opacity",
          open ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        className={cx(
          "absolute left-0 top-0 flex h-full w-[248px] flex-col gap-7 border-r hairline bg-surface px-4 py-7 transition-transform",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between"><Logo /><button aria-label="Cerrar menú" onClick={onClose}>×</button></div>
        <NavItems onNavigate={onClose} />
        <Footer />
      </div>
    </div>
  );
}

/** Accesos principales para operar desde el teléfono con una sola mano. */
export function MobileBottomNav() {
  const principales = NAV.filter((item) =>
    ["/", "/pedidos", "/preguntas", "/stock"].includes(item.to),
  );
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t bg-surface/95 px-1 pb-[max(6px,env(safe-area-inset-bottom))] pt-1 backdrop-blur hairline lg:hidden">
      {principales.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          className={({ isActive }) =>
            cx(
              "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-semibold",
              isActive ? "text-accent" : "text-ink/45",
            )
          }
        >
          <Icon />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
