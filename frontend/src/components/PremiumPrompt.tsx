import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "./Icon";

// Aparece quando o servidor responde "isso é do Premium" (402, ver
// api/client.ts) -- em qualquer tela, sem cada uma ter que tratar.
export function PremiumPrompt() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("par:premium-required", show);
    return () => window.removeEventListener("par:premium-required", show);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop welcome-tour-backdrop" onClick={() => setOpen(false)}>
      <div className="modal-panel welcome-tour" role="dialog" aria-modal="true" aria-labelledby="premium-title" onClick={(e) => e.stopPropagation()}>
        <div className="welcome-tour-slide announcement-slide">
          <div className="welcome-tour-icon" aria-hidden="true">
            <Icon name="spark" className="icon" />
          </div>
          <p className="welcome-tour-step">
            <span className="welcome-tour-tag">Premium</span>
          </p>
          <h2 id="premium-title">Isso é do Premium</h2>
          <p className="welcome-tour-text">
            Assistente com IA, importar extrato, exportar e link de relatório fazem parte do Premium. Uma assinatura
            vale pro grupo todo.
          </p>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>
            Agora não
          </button>
          <button
            type="button"
            className="btn btn-primary"
            autoFocus
            onClick={() => {
              setOpen(false);
              navigate("/plano");
            }}
          >
            Ver o Premium
          </button>
        </div>
      </div>
    </div>
  );
}
