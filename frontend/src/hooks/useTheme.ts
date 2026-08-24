import { useCallback, useEffect, useMemo, useState } from "react";

type Theme = "light" | "dark";
const STORAGE_KEY = "fincae_theme";

function applyTheme(theme: Theme | null) {
  if (theme) {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme | null>(
    () => (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? null
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const current = theme ?? (prefersDark ? "dark" : "light");
    const next: Theme = current === "dark" ? "light" : "dark";
    localStorage.setItem(STORAGE_KEY, next);
    setTheme(next);
  }, [theme]);

  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const effective: Theme = theme ?? (prefersDark ? "dark" : "light");

  return useMemo(() => ({ theme: effective, toggle }), [effective, toggle]);
}
