// Datos de muestra para el esqueleto navegable. Provienen del diseño
// `Panel Indiggo.dc.html`. Se reemplazan módulo por módulo con datos reales.

import type {
  Alerta,
  ContenidoRedes,
  GrupoKpop,
  ItemStock,
  Metricas,
  Publicacion,
  StatCard,
  TareaProduccion,
} from "@/lib/types";

export const statsInicio: StatCard[] = [
  { label: "Ventas hoy", value: "$18.400" },
  { label: "Pedidos pendientes", value: "5" },
  { label: "Publicaciones activas", value: "23" },
  { label: "Stock bajo", value: "3 productos" },
];

export const alertas: Alerta[] = [
  {
    tono: "danger",
    titulo: "Stock crítico",
    texto: "Holder Jimin ver. 2 — quedan 2 unidades",
  },
  {
    tono: "warn",
    titulo: "Publicación pausada",
    texto: "Set de mostacillas NewJeans — pausada hace 3 días",
  },
  {
    tono: "info",
    titulo: "Producción de hoy",
    texto: "Tenés 5 pedidos para imprimir",
  },
  {
    tono: "ok",
    titulo: "Buena semana",
    texto: "Vendiste 12 clickers, +20% vs. la semana pasada",
  },
];

export const publicaciones: Publicacion[] = [
  { id: "MLA1", titulo: "Holder acrílico Jimin — ver. 2", precio: 4200, estado: "activa", stockMl: 14 },
  { id: "MLA2", titulo: "Set mostacillas NewJeans (5u)", precio: 6800, estado: "pausada", stockMl: 0 },
  { id: "MLA3", titulo: "Clicker LED Seventeen", precio: 5400, estado: "activa", stockMl: 8 },
  { id: "MLA4", titulo: "Holder doble Aespa", precio: 4900, estado: "borrador", stockMl: 0 },
  { id: "MLA5", titulo: "Llavero Stray Kids logo", precio: 3100, estado: "activa", stockMl: 21 },
];

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

export const metricas: Metricas = {
  rango: "7d",
  ventasTotales: 142300,
  ticketPromedio: 4850,
  pedidos: 29,
  porDia: [
    { dia: "Lun", monto: 40 },
    { dia: "Mar", monto: 65 },
    { dia: "Mié", monto: 52 },
    { dia: "Jue", monto: 80 },
    { dia: "Vie", monto: 95 },
    { dia: "Sáb", monto: 70 },
    { dia: "Dom", monto: 58 },
  ],
  top: [
    { nombre: "Holder acrílico Jimin ver.2", porcentaje: 82 },
    { nombre: "Clicker LED Seventeen", porcentaje: 64 },
    { nombre: "Llavero Stray Kids logo", porcentaje: 47 },
  ],
};

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

export const gruposKpop: GrupoKpop[] = [
  {
    id: "g1",
    nombre: "BTS",
    integrantes: ["RM", "Jin", "SUGA", "j-hope", "Jimin", "V", "Jung Kook"].map((n) => ({ nombre: n })),
  },
  {
    id: "g2",
    nombre: "NewJeans",
    integrantes: ["Minji", "Hanni", "Danielle", "Haerin", "Hyein"].map((n) => ({ nombre: n })),
  },
  {
    id: "g3",
    nombre: "aespa",
    integrantes: ["Karina", "Giselle", "Winter", "NingNing"].map((n) => ({ nombre: n })),
  },
];
