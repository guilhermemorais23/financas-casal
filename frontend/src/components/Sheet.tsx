import { useEffect, useRef, type ReactNode } from "react";
import { useSwipeDownToClose } from "../hooks/useSwipeDownToClose";
import { Icon } from "./Icon";

// Janela padrão do app (editar lançamento, nova meta, empréstimo...). Fecha
// de três jeitos, igual em todo lugar: X no canto, Esc no PC e arrastando
// pra baixo no celular (pelo puxador ou com o conteúdo no topo). Clicar fora
// também fecha.
export function Sheet({
  onClose,
  children,
  className = "",
  labelledBy,
}: {
  onClose: () => void;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useSwipeDownToClose(panelRef, onClose);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Com uma confirmação aberta por cima, o Esc é dela.
      if (event.key !== "Escape" || document.querySelector(".confirm-panel")) return;
      onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={panelRef}
        className={`modal-panel sheet-card${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        <span className="sheet-handle" data-swipe-handle aria-hidden="true" />
        <button type="button" className="sheet-close sheet-close-floating" onClick={onClose} aria-label="Fechar" title="Fechar (Esc)">
          <Icon name="x" />
        </button>
        {children}
      </div>
    </div>
  );
}
