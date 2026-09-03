import type { ComponentType } from "react";
import {
  IconConfig,
  IconContenido,
  IconInicio,
  IconMetricas,
  IconPedidos,
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
  { to: "/publicaciones", label: "Publicaciones", icon: IconPublicaciones },
  { to: "/pedidos", label: "Pedidos", icon: IconPedidos },
  { to: "/stock", label: "Stock y producción", icon: IconStock },
  { to: "/metricas", label: "Métricas", icon: IconMetricas },
  { to: "/contenido", label: "Contenido", icon: IconContenido },
  { to: "/configuracion", label: "Configuración", icon: IconConfig },
];
