import { useAuth } from "../auth/AuthContext";
import { isModuleOn, type ModuleKey } from "../utils/preferences";

// Quais partes do app aparecem no menu e no Painel (utils/preferences.ts).
export function useModules(): (key: ModuleKey) => boolean {
  const { user } = useAuth();
  const preferences = user?.preferences;
  return (key) => isModuleOn(preferences, key);
}
