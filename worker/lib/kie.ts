// Cliente de kie.ai (https://kie.ai) para generación de imágenes.
// Flujo: createTask -> polling recordInfo hasta success/fail.
import type { Env } from "../env";

const BASE = "https://api.kie.ai/api/v1/jobs";

// Costo ESTIMADO por generación, en USD. La verdad está en el dashboard de
// kie.ai (https://kie.ai) — esto es sólo para tener una referencia en el panel.
// Ajustado con la pantalla de uso del 2026-08-29 (veo3 ≈ 0.325, nano-banana ≈ 0.02).
// TUNEABLE.
export const COSTO_USD: Record<string, number> = {
  "google/nano-banana": 0.02,
  "google/nano-banana-edit": 0.02,
  // 1K y 2K cuestan lo mismo en kie.ai; 4K, 0.12.
  "nano-banana-pro": 0.09,
  veo3_fast: 0.35,
  veo3: 0.45,
  veo3_lite: 0.2,
};

export function costoUsd(modelo: string): number {
  return COSTO_USD[modelo] ?? 0;
}

interface CreateResp {
  code: number;
  msg?: string;
  data?: { taskId?: string };
}
interface RecordResp {
  code: number;
  data?: {
    state?: "waiting" | "queuing" | "generating" | "success" | "fail";
    resultJson?: string;
    failMsg?: string;
    progress?: number;
  };
}

export interface ImagenOpts {
  prompt: string;
  aspectRatio?: "1:1" | "4:5" | "9:16" | "16:9" | "3:4";
  model?: string;
  /** Fotos de referencia (usa nano-banana-edit si hay al menos una). */
  imageUrls?: string[];
}

/** Genera una imagen y devuelve la URL temporal de kie.ai (expira ~24 h). */
export async function generarImagen(
  env: Env,
  opts: ImagenOpts,
): Promise<{ url: string; taskId: string; model: string }> {
  const headers = {
    authorization: `Bearer ${env.KIE_API_KEY}`,
    "content-type": "application/json",
  };

  const refs = (opts.imageUrls ?? []).filter(Boolean).slice(0, 10);
  const model =
    opts.model ?? (refs.length ? "google/nano-banana-edit" : "google/nano-banana");

  const crear = await fetch(`${BASE}/createTask`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      input: {
        prompt: opts.prompt.slice(0, 5000),
        ...(refs.length ? { image_urls: refs } : {}),
        output_format: "png",
        aspect_ratio: opts.aspectRatio ?? "4:5",
        nsfw_checker: false,
      },
    }),
  });
  const cj = (await crear.json()) as CreateResp;
  const taskId = cj.data?.taskId;
  if (!crear.ok || !taskId) {
    throw new Error(`kie createTask: ${cj.msg ?? crear.status}`);
  }

  // polling (hasta ~75 s)
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const rec = await fetch(
      `${BASE}/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      { headers },
    );
    const rj = (await rec.json()) as RecordResp;
    const state = rj.data?.state;
    if (state === "success") {
      const parsed = JSON.parse(rj.data?.resultJson ?? "{}") as {
        resultUrls?: string[];
      };
      const url = parsed.resultUrls?.[0];
      if (!url) throw new Error("kie: success sin resultUrls");
      return { url, taskId, model };
    }
    if (state === "fail") {
      throw new Error(`kie falló: ${rj.data?.failMsg ?? "sin detalle"}`);
    }
  }
  throw new Error("kie: timeout esperando la imagen");
}

// ---------- edición fiel (Nano Banana Pro) ----------
// nano-banana-edit sale a 896x1152 y, al pedirle que borre algo chico, se llevó
// medio producto en la prueba. Pro respeta el resto de la foto y sale en 2K; lo
// usa el editor de fotos en lote. Tarda de 30 s a varios minutos según la cola
// de kie.ai, así que se encarga y se consulta aparte (no se espera en el request).

export type AspectoKie =
  | "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9";

export const MODELO_EDICION = "nano-banana-pro";

export async function encargarEdicionPro(
  env: Env,
  opts: { prompt: string; imageUrls: string[]; aspectRatio?: AspectoKie },
): Promise<string> {
  const crear = await fetch(`${BASE}/createTask`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.KIE_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODELO_EDICION,
      input: {
        prompt: opts.prompt.slice(0, 10000),
        image_input: opts.imageUrls.filter(Boolean).slice(0, 8),
        aspect_ratio: opts.aspectRatio ?? "auto",
        resolution: "2K",
        // jpg: ML acepta hasta 10 MB por foto y el png de 2K pesa ~6 MB.
        output_format: "jpg",
      },
    }),
  });
  const cj = (await crear.json()) as CreateResp;
  const taskId = cj.data?.taskId;
  if (!crear.ok || !taskId) throw new Error(`kie createTask: ${cj.msg ?? crear.status}`);
  return taskId;
}

export type EstadoTarea =
  | { estado: "generando" }
  | { estado: "listo"; url: string }
  | { estado: "error"; detalle: string };

export async function estadoTarea(env: Env, taskId: string): Promise<EstadoTarea> {
  const rec = await fetch(`${BASE}/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
    headers: { authorization: `Bearer ${env.KIE_API_KEY}` },
  });
  const rj = (await rec.json()) as RecordResp;
  const state = rj.data?.state;
  if (state === "success") {
    const parsed = JSON.parse(rj.data?.resultJson ?? "{}") as { resultUrls?: string[] };
    const url = parsed.resultUrls?.[0];
    return url ? { estado: "listo", url } : { estado: "error", detalle: "kie: success sin resultUrls" };
  }
  if (state === "fail") return { estado: "error", detalle: `kie falló: ${rj.data?.failMsg ?? "sin detalle"}` };
  return { estado: "generando" };
}

// ---------- video (Veo3) ----------
const VEO = "https://api.kie.ai/api/v1/veo";

export interface VideoOpts {
  prompt: string;
  aspectRatio?: "16:9" | "9:16" | "Auto";
  imageUrls?: string[];
  model?: "veo3" | "veo3_fast" | "veo3_lite";
}

/** Encola un video y devuelve el taskId (Veo3 tarda 1-3 min, se poolea aparte). */
export async function encolarVideo(
  env: Env,
  opts: VideoOpts,
): Promise<{ taskId: string; model: string }> {
  const model = opts.model ?? "veo3_fast";
  const res = await fetch(`${VEO}/generate`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.KIE_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      prompt: opts.prompt.slice(0, 5000),
      model,
      aspect_ratio: opts.aspectRatio ?? "9:16",
      ...(opts.imageUrls?.length ? { imageUrls: opts.imageUrls.slice(0, 2) } : {}),
      resolution: "1080p",
    }),
  });
  const j = (await res.json()) as {
    code: number;
    msg?: string;
    data?: { taskId?: string };
  };
  if (!res.ok || !j.data?.taskId) {
    throw new Error(`kie veo generate: ${j.msg ?? res.status}`);
  }
  return { taskId: j.data.taskId, model };
}

export type EstadoVideo =
  | { estado: "generando" }
  | { estado: "listo"; url: string }
  | { estado: "error"; detalle: string };

export async function estadoVideo(
  env: Env,
  taskId: string,
): Promise<EstadoVideo> {
  const res = await fetch(
    `${VEO}/record-info?taskId=${encodeURIComponent(taskId)}`,
    { headers: { authorization: `Bearer ${env.KIE_API_KEY}` } },
  );
  const j = (await res.json()) as {
    data?: {
      successFlag?: number;
      response?: { resultUrls?: string[]; fullResultUrls?: string[] };
      errorMessage?: string;
    };
  };
  const flag = j.data?.successFlag;
  if (flag === 1) {
    const url =
      j.data?.response?.resultUrls?.[0] ??
      j.data?.response?.fullResultUrls?.[0];
    return url
      ? { estado: "listo", url }
      : { estado: "error", detalle: "sin resultUrls" };
  }
  if (flag === 2 || flag === 3) {
    return { estado: "error", detalle: j.data?.errorMessage ?? "falló" };
  }
  return { estado: "generando" };
}
