// Wrapper mínimo sobre la Messages API de Claude (raw HTTP — el Worker no
// necesita el SDK para una sola llamada). Modelo por defecto: Sonnet.
import type { Env } from "../env";

const API = "https://api.anthropic.com/v1/messages";

export type ClaudeModel = "claude-sonnet-5" | "claude-haiku-4-5";

interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

interface ClaudeOpts {
  system?: string;
  messages: ClaudeMessage[];
  model?: ClaudeModel;
  maxTokens?: number;
}

interface ClaudeResponse {
  content: Array<{ type: string; text?: string }>;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

export async function claude(
  env: Env,
  opts: ClaudeOpts,
): Promise<{ texto: string; usage: ClaudeResponse["usage"] }> {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model ?? "claude-sonnet-5",
      max_tokens: opts.maxTokens ?? 1500,
      system: opts.system,
      messages: opts.messages,
    }),
  });

  if (!res.ok) {
    const detalle = await res.text();
    throw new Error(`Claude ${res.status}: ${detalle.slice(0, 300)}`);
  }

  const json = (await res.json()) as ClaudeResponse;
  if (json.stop_reason === "refusal") {
    throw new Error("Claude rechazó la solicitud");
  }
  const texto = json.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
  return { texto, usage: json.usage };
}

/** Extrae el primer objeto JSON de una respuesta (tolera fences ```json). */
export function parseJsonLaxo<T>(texto: string): T {
  const limpio = texto
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const desde = limpio.indexOf("{");
  const hasta = limpio.lastIndexOf("}");
  if (desde === -1 || hasta === -1) throw new Error("respuesta sin JSON");
  return JSON.parse(limpio.slice(desde, hasta + 1)) as T;
}
