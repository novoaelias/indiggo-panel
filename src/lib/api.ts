import { useCallback, useEffect, useState } from "react";
import { clearPanelToken, getPanelToken } from "./auth";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getPanelToken();
  const esForm = init?.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      // con FormData deja que el browser ponga el boundary
      ...(esForm ? {} : { "content-type": "application/json" }),
      ...(token ? { "x-panel-token": token } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401 && !path.startsWith("/session")) {
    clearPanelToken();
    window.location.reload();
    throw new ApiError(401, "sesión expirada");
  }
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; }
  catch { throw new ApiError(res.status, "No pudimos conectar con el panel. Volvé a intentar en unos segundos."); }
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? res.statusText);
  }
  return body as T;
}

interface AsyncState<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  reload: () => void;
}

/** GET simple con estados de carga/error y recarga manual. */
export function useApi<T>(path: string): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(undefined);
    api<T>(path, { signal: controller.signal })
      .then((d) => active && setData(d))
      .catch((e: Error) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; controller.abort(); };
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}
