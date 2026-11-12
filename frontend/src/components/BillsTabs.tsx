import { NavLink } from "react-router-dom";
import { Icon, type IconName } from "./Icon";
import { useModules } from "../hooks/useModules";
import type { ModuleKey } from "../utils/preferences";

// "Contas" é um lugar só: Todas (a lista por vencimento) e as telas de cada
// tipo -- Cartões, A pagar (contas fixas + dívidas) e Empréstimos. Essas abas
// trocam entre eles sem abrir o menu.
// Cada aba some quando a função dela está desligada (A pagar junta contas
// fixas e dívidas: aparece se qualquer uma das duas estiver ligada).
export const BILLS_TABS: { to: string; label: string; shortLabel: string; icon: IconName; modules?: ModuleKey[] }[] = [
  { to: "/contas", label: "Todas", shortLabel: "Todas", icon: "receipt" },
  { to: "/cards", label: "Cartões", shortLabel: "Cartões", icon: "card", modules: ["cards"] },
  { to: "/a-pagar", label: "A pagar", shortLabel: "A pagar", icon: "repeat", modules: ["payables", "debts"] },
  { to: "/loans", label: "Empréstimos", shortLabel: "Emprést.", icon: "coin", modules: ["loans"] },
];

export function BillsTabs() {
  const moduleOn = useModules();
  return (
    <nav className="bills-tabs" aria-label="Contas">
      {BILLS_TABS.filter((tab) => !tab.modules || tab.modules.some(moduleOn)).map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          replace
          className={({ isActive }) => `bills-tab${isActive ? " active" : ""}`}
        >
          <Icon name={tab.icon} />
          <span className="bills-tab-label">{tab.label}</span>
          <span className="bills-tab-short">{tab.shortLabel}</span>
        </NavLink>
      ))}
    </nav>
  );
}
