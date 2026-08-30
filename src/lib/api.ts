import { useCallback, useEffect, useRef, useState } from "react";
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
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
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
  const body = text ? JSON.parse(text) : null;
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
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(undefined);
    api<T>(path)
      .then((d) => alive.current && setData(d))
      .catch((e: Error) => alive.current && setError(e.message))
      .finally(() => alive.current && setLoading(false));
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}
