import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

// Opções do botão de lançar (o + flutuante e o + da barra de baixo): fica em
// todas as telas e abre Despesa, Receita, Importar extrato e Guardar na meta.
const OPTIONS: { key: string; label: string; to: string; dot: string; tone: string }[] = [
  { key: "expense", label: "Despesa", to: "/transactions/new", dot: "−", tone: "out" },
  { key: "income", label: "Receita", to: "/transactions/new?tipo=receita", dot: "+", tone: "in" },
  { key: "import", label: "Importar extrato", to: "/dashboard?importar=extrato", dot: "↓", tone: "imp" },
  { key: "goal", label: "Guardar na meta", to: "/goals", dot: "★", tone: "save" },
];

export function LaunchMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!ref.current?.contains(target) && !target.closest("[data-launch-toggle]")) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="launch-menu" ref={ref} role="menu" aria-label="Lançar">
      {OPTIONS.map((option) => (
        <button
          key={option.key}
          type="button"
          role="menuitem"
          className="launch-option"
          onClick={() => {
            onClose();
            navigate(option.to);
          }}
        >
          <span className={`launch-dot ${option.tone}`} aria-hidden="true">
            {option.dot}
          </span>
          {option.label}
        </button>
      ))}
    </div>
  );
}
