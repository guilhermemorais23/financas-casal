import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";

export interface RowAction {
  key: string;
  label: string;
  icon: IconName;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

// Um botão "⋮" só, que mostra num menu as ações menos usadas da linha
// (cancelar recorrência, apagar...), em vez de 3 a 5 botões de ícone lado a
// lado em cada linha -- a ação mais usada de fato (editar) fica fora deste
// menu, sempre a um toque.
// Espaço que a barra de navegação de baixo (celular) ocupa no pé da tela --
// o menu não pode abrir por baixo dela.
const BOTTOM_SAFE_AREA = 90;

export function RowActionsMenu({ actions }: { actions: RowAction[] }) {
  const [open, setOpen] = useState(false);
  const [opensUp, setOpensUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Nas últimas linhas da lista não cabe abrir pra baixo: abre pra cima.
  useLayoutEffect(() => {
    if (!open) {
      setOpensUp(false);
      return;
    }
    const rect = menuRef.current?.getBoundingClientRect();
    if (rect && rect.bottom > window.innerHeight - BOTTOM_SAFE_AREA && rect.top - rect.height > 0) setOpensUp(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <div className="row-actions-menu" ref={rootRef}>
      <button
        type="button"
        className="btn-icon"
        title="Mais ações"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div ref={menuRef} className={`row-actions-dropdown${opensUp ? " opens-up" : ""}`} role="menu">
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              role="menuitem"
              className={`row-actions-item${action.danger ? " danger" : ""}`}
              disabled={action.disabled}
              onClick={() => {
                setOpen(false);
                action.onClick();
              }}
            >
              <Icon name={action.icon} />
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
