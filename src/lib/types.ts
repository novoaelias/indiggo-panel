// Tipos del dominio Indiggo. El esqueleto usa datos mock (src/data/mock.ts);
// cada módulo se irá conectando a la API real (worker + Supabase + MercadoLibre).

export type EstadoTono = "ok" | "warn" | "danger" | "info" | "neutral";

export interface StatCard {
  label: string;
  value: string;
}

export interface Alerta {
  tono: Extract<EstadoTono, "ok" | "warn" | "danger" | "info">;
  titulo: string;
  texto: string;
}

export type EstadoPublicacion = "activa" | "pausada" | "borrador";

export interface Publicacion {
  id: string;
  titulo: string;
  precio: number;
  estado: EstadoPublicacion;
  stockMl: number;
}

export type OrigenProduccion = "impresora3d" | "imprenta";

export interface ItemStock {
  id: string;
  nombre: string;
  categoria: string;
  stockReal: number;
  stockMl: number;
  minimo: number;
  origen: OrigenProduccion;
}

export interface TareaProduccion {
  id: string;
  nombre: string;
  cantidad: number;
  origen: OrigenProduccion;
}

export interface MetricaDia {
  dia: string;
  monto: number;
}

export interface ProductoTop {
  nombre: string;
  porcentaje: number;
}

export interface Metricas {
  rango: "7d" | "30d";
  ventasTotales: number;
  ticketPromedio: number;
  pedidos: number;
  porDia: MetricaDia[];
  top: ProductoTop[];
}

export type Plataforma = "Instagram" | "TikTok";

export interface ContenidoRedes {
  id: string;
  plataforma: Plataforma;
  caption: string;
  hashtags: string;
}

export interface IntegranteGrupo {
  nombre: string;
}

export interface GrupoKpop {
  id: string;
  nombre: string;
  integrantes: IntegranteGrupo[];
}
