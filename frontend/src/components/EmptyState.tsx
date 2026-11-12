import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

// Lista vazia que ensina: um desenho simples, uma frase curta e, quando
// houver, o botão que resolve ("Lançar um gasto", "Criar meta"). Reusado em
// todo lugar pra manter o mesmo visual. O desenho é SVG próprio (nada de
// emoji), pega as cores do tema e some pra leitor de tela.
export function EmptyState({
  children,
  art = "receipt",
  action,
}: {
  children: ReactNode;
  art?: IconName;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state-friendly">
      <span className="empty-art" aria-hidden="true">
        <svg viewBox="0 0 120 80" className="empty-art-svg" focusable="false">
          <ellipse cx="60" cy="72" rx="34" ry="4" className="empty-art-shadow" />
          <circle cx="60" cy="38" r="30" className="empty-art-blob" />
          <circle cx="98" cy="16" r="5" className="empty-art-dot" />
          <circle cx="22" cy="26" r="3.5" className="empty-art-dot" />
          <circle cx="104" cy="50" r="2.5" className="empty-art-dot" />
        </svg>
        <Icon name={art} className="icon empty-art-icon" />
      </span>
      <p>{children}</p>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
