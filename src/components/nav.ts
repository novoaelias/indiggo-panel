import type { ComponentType } from "react";
import {
  IconConfig,
  IconContenido,
  IconInicio,
  IconMetricas,
  IconPedidos,
  IconPreguntas,
  IconProduccion,
  IconPublicaciones,
  IconStock,
} from "./icons";

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export const NAV: NavItem[] = [
  { to: "/", label: "Inicio", icon: IconInicio },
  { to: "/pedidos", label: "Pedidos", icon: IconPedidos },
  { to: "/preguntas", label: "Preguntas", icon: IconPreguntas },
  { to: "/stock", label: "Inventario", icon: IconStock },
  { to: "/produccion", label: "Producción", icon: IconProduccion },
  { to: "/publicaciones", label: "Publicaciones", icon: IconPublicaciones },
  { to: "/metricas", label: "Métricas", icon: IconMetricas },
  { to: "/contenido", label: "Contenido", icon: IconContenido },
  { to: "/configuracion", label: "Configuración", icon: IconConfig },
];
