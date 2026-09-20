import { lazy, Suspense, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { MobileBottomNav, MobileDrawer, Sidebar } from "./components/Sidebar";
import { Logo } from "./components/Logo";
import { Gate } from "./components/Gate";
import { IconMenu } from "./components/icons";
const Inicio = lazy(() => import("./pages/Inicio").then(m => ({ default: m.Inicio })));
const Publicaciones = lazy(() => import("./pages/Publicaciones").then(m => ({ default: m.Publicaciones })));
const Pedidos = lazy(() => import("./pages/Pedidos").then(m => ({ default: m.Pedidos })));
const Inventario = lazy(() => import("./pages/Inventario").then(m => ({ default: m.Inventario })));
const Produccion = lazy(() => import("./pages/Produccion").then(m => ({ default: m.Produccion })));
const Preguntas = lazy(() => import("./pages/Preguntas").then(m => ({ default: m.Preguntas })));
const Metricas = lazy(() => import("./pages/Metricas").then(m => ({ default: m.Metricas })));
const Contenido = lazy(() => import("./pages/Contenido").then(m => ({ default: m.Contenido })));
const Configuracion = lazy(() => import("./pages/Configuracion").then(m => ({ default: m.Configuracion })));

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
      <a href="#contenido-principal" className="skip-link">Ir al contenido</a>
      <Sidebar />
      <MobileDrawer open={drawer} onClose={() => setDrawer(false)} />
      <MobileBottomNav />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="workspace-bar hidden lg:flex"><span>INDIGGO STORE <span className="mx-3 opacity-30">/</span> Gestión de la tienda</span><span className="text-ink/50">Tu espacio de trabajo</span></div>
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
          id="contenido-principal"
          key={location.pathname}
          className="mx-auto w-full max-w-[1180px] flex-1 px-5 pb-28 pt-6 sm:px-8 lg:px-12 lg:pb-16 lg:pt-10"
        >
          <Suspense fallback={<div role="status" className="loading-panel">Preparando tu espacio de trabajo…</div>}>
          <Routes>
            <Route path="/" element={<Inicio />} />
            <Route path="/publicaciones" element={<Publicaciones />} />
            <Route path="/pedidos" element={<Pedidos />} />
            <Route path="/stock" element={<Inventario />} />
            <Route path="/produccion" element={<Produccion />} />
            <Route path="/preguntas" element={<Preguntas />} />
            <Route path="/metricas" element={<Metricas />} />
            <Route path="/contenido" element={<Contenido />} />
            <Route path="/configuracion" element={<Configuracion />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
