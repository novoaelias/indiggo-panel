const KEY = "indiggo_theme";
export type Tema = "light" | "dark";

export function initTema(): void {
  try {
    const t = localStorage.getItem(KEY);
    if (t === "dark") document.documentElement.dataset.theme = "dark";
  } catch {
    /* ignore */
  }
}

export function temaActual(): Tema {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function alternarTema(): Tema {
  const next: Tema = temaActual() === "dark" ? "light" : "dark";
  if (next === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* ignore */
  }
  return next;
}
