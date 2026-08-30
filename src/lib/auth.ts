const KEY = "indiggo_panel_token";

export function getPanelToken(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setPanelToken(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    /* ignore */
  }
  // Cookie para navegaciones top-level (ej. /api/ml/connect), no accesible por JS
  // de otros orígenes; el Worker la lee como fallback del header.
  document.cookie = `panel_token=${encodeURIComponent(token)}; path=/; max-age=${60 * 60 * 24 * 90}; samesite=lax`;
}

export function clearPanelToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  document.cookie = "panel_token=; path=/; max-age=0";
}
