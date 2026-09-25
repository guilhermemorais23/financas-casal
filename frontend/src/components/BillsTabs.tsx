import { NavLink } from "react-router-dom";
import { Icon, type IconName } from "./Icon";

// Cartões, Dívidas, Contas fixas e A receber (empréstimos) são um lugar só,
// "Contas", na barra de baixo do celular -- essas abas trocam entre eles sem
// abrir o menu.
export const BILLS_TABS: { to: string; label: string; shortLabel: string; icon: IconName }[] = [
  { to: "/cards", label: "Cartões", shortLabel: "Cartões", icon: "receipt" },
  { to: "/debts", label: "Dívidas", shortLabel: "Dívidas", icon: "card" },
  { to: "/recurring-bills", label: "Contas fixas", shortLabel: "Fixas", icon: "repeat" },
  { to: "/loans", label: "A receber", shortLabel: "Receber", icon: "coin" },
];

export function BillsTabs() {
  return (
    <nav className="bills-tabs" aria-label="Contas">
      {BILLS_TABS.map((tab) => (
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
