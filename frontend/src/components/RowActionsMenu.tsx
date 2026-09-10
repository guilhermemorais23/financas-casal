import { useEffect, useRef, useState } from "react";

export interface RowAction {
  key: string;
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

// A single "⋮" button that reveals the less-common row actions (cancel
// recurring, delete, ...) in a dropdown, instead of 3-5 icon buttons sitting
// side by side on every row -- the one action people actually reach for
// most (edit) stays outside this menu, always one tap away.
export function RowActionsMenu({ actions }: { actions: RowAction[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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
        ⋮
      </button>
      {open && (
        <div className="row-actions-dropdown" role="menu">
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
              <span aria-hidden="true">{action.icon}</span>
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
