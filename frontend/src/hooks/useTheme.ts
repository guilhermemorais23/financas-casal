import { useCallback, useEffect, useMemo, useState } from "react";

type Theme = "light" | "dark";
// "system" = segue o celular/computador (nada gravado).
export type ThemeMode = Theme | "system";
const STORAGE_KEY = "fincae_theme";
const CHANGE_EVENT = "par:theme";

function readStored(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function applyTheme(theme: Theme | null) {
  if (theme) {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

// O botão do menu e a escolha na Conta usam o mesmo tema: quem muda avisa os
// outros (evento), pra o ícone do menu não ficar desatualizado.
export function useTheme() {
  const [theme, setTheme] = useState<Theme | null>(readStored);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const sync = () => setTheme(readStored());
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);

  const setMode = useCallback((mode: ThemeMode) => {
    try {
      if (mode === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Sem armazenamento: vale só nesta visita.
    }
    setTheme(mode === "system" ? null : mode);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const toggle = useCallback(() => {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const current = theme ?? (prefersDark ? "dark" : "light");
    setMode(current === "dark" ? "light" : "dark");
  }, [theme, setMode]);

  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const effective: Theme = theme ?? (prefersDark ? "dark" : "light");
  const mode: ThemeMode = theme ?? "system";

  return useMemo(() => ({ theme: effective, mode, toggle, setMode }), [effective, mode, toggle, setMode]);
}
