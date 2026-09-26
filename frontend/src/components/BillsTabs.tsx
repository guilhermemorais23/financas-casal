import { NavLink } from "react-router-dom";
import { Icon, type IconName } from "./Icon";

// "Contas" é um lugar só: Todas (a lista por vencimento) e as telas de cada
// tipo -- Cartões, A pagar (contas fixas + dívidas) e Empréstimos. Essas abas
// trocam entre eles sem abrir o menu.
export const BILLS_TABS: { to: string; label: string; shortLabel: string; icon: IconName }[] = [
  { to: "/contas", label: "Todas", shortLabel: "Todas", icon: "receipt" },
  { to: "/cards", label: "Cartões", shortLabel: "Cartões", icon: "card" },
  { to: "/a-pagar", label: "A pagar", shortLabel: "A pagar", icon: "repeat" },
  { to: "/loans", label: "Empréstimos", shortLabel: "Emprést.", icon: "coin" },
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
