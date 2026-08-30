import { useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { MobileDrawer, Sidebar } from "./components/Sidebar";
import { Logo } from "./components/Logo";
import { Gate } from "./components/Gate";
import { IconMenu } from "./components/icons";
import { Inicio } from "./pages/Inicio";
import { Publicaciones } from "./pages/Publicaciones";
import { Stock } from "./pages/Stock";
import { Metricas } from "./pages/Metricas";
import { Contenido } from "./pages/Contenido";
import { Configuracion } from "./pages/Configuracion";

export function App() {
  return (
    <Gate>
      <Panel />
    </Gate>
  );
}

function Panel() {
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();

  return (
    <div className="flex min-h-screen bg-paper">
      <Sidebar />
      <MobileDrawer open={drawer} onClose={() => setDrawer(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar solo mobile */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b hairline bg-surface/80 px-4 py-3 backdrop-blur lg:hidden">
          <button
            onClick={() => setDrawer(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-ink/[0.04]"
            aria-label="Abrir menú"
          >
            <IconMenu />
          </button>
          <Logo />
        </header>

        <main
          key={location.pathname}
          className="mx-auto w-full max-w-[1180px] flex-1 px-5 pb-16 pt-6 sm:px-8 lg:px-12 lg:pt-10"
        >
          <Routes>
            <Route path="/" element={<Inicio />} />
            <Route path="/publicaciones" element={<Publicaciones />} />
            <Route path="/stock" element={<Stock />} />
            <Route path="/metricas" element={<Metricas />} />
            <Route path="/contenido" element={<Contenido />} />
            <Route path="/configuracion" element={<Configuracion />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
