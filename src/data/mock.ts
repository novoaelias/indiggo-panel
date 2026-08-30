// Datos de muestra que quedan para los módulos todavía no conectados
// (Stock y Contenido). Inicio, Métricas y Publicaciones ya usan datos reales.

import type { ContenidoRedes, ItemStock, TareaProduccion } from "@/lib/types";

export const stockItems: ItemStock[] = [
  { id: "s1", nombre: "Holder acrílico Jimin ver.2", categoria: "Holders", stockReal: 2, stockMl: 6, minimo: 5, origen: "impresora3d" },
  { id: "s2", nombre: "Set mostacillas NewJeans", categoria: "Mostacillas", stockReal: 0, stockMl: 0, minimo: 4, origen: "impresora3d" },
  { id: "s3", nombre: "Clicker LED Seventeen", categoria: "Clickers", stockReal: 8, stockMl: 12, minimo: 6, origen: "impresora3d" },
  { id: "s4", nombre: "Holder doble Aespa", categoria: "Holders", stockReal: 24, stockMl: 28, minimo: 8, origen: "impresora3d" },
  { id: "s5", nombre: "Llavero Stray Kids logo", categoria: "Llaveros", stockReal: 21, stockMl: 25, minimo: 6, origen: "impresora3d" },
  { id: "s6", nombre: "Holder Karina IVE", categoria: "Holders", stockReal: 6, stockMl: 10, minimo: 8, origen: "impresora3d" },
  { id: "s7", nombre: "Photocard Jimin (lote)", categoria: "Photocards", stockReal: 40, stockMl: 40, minimo: 20, origen: "imprenta" },
];

export const colaProduccion: TareaProduccion[] = [
  { id: "q1", nombre: "Holder acrílico Jimin ver.2", cantidad: 8, origen: "impresora3d" },
  { id: "q2", nombre: "Set mostacillas NewJeans", cantidad: 15, origen: "impresora3d" },
  { id: "q3", nombre: "Clicker LED Seventeen", cantidad: 5, origen: "impresora3d" },
  { id: "q4", nombre: "Holder Karina IVE", cantidad: 6, origen: "impresora3d" },
  { id: "q5", nombre: "Photocards NewJeans (tanda)", cantidad: 30, origen: "imprenta" },
];

export const contenidoRedes: ContenidoRedes[] = [
  {
    id: "c1",
    plataforma: "Instagram",
    caption: "Nuevo holder de Jimin, edición ver.2, ya disponible",
    hashtags: "#kpop #jimin #holder #photocard",
  },
  {
    id: "c2",
    plataforma: "TikTok",
    caption: "Unboxing del set de mostacillas NewJeans",
    hashtags: "#newjeans #mostacillas #kpopmerch",
  },
  {
    id: "c3",
    plataforma: "Instagram",
    caption: "Así se ve el clicker LED andando",
    hashtags: "#seventeen #clicker #kpop3d",
  },
];
