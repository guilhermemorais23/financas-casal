import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export type ToastVariant = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  description?: string;
  variant: ToastVariant;
  actionLabel?: string;
  onAction?: () => void;
  durationMs: number;
}

export interface ToastOptions {
  // success (padrão) = check verde, error = alerta vermelho, info = neutro.
  variant?: ToastVariant;
  // Segunda linha menor embaixo da mensagem -- deixa a linha principal curta
  // pra nunca quebrar no celular.
  description?: string;
  // Um botão no aviso ("Desfazer"). Tocar nele roda onAction e fecha o aviso
  // na hora.
  actionLabel?: string;
  onAction?: () => void;
  // Quanto tempo o aviso fica. Avisos com botão ficam mais tempo por padrão,
  // pra dar tempo de alcançar o botão.
  durationMs?: number;
}

interface ToastContextValue {
  showToast: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;
// A animação `.toast` do CSS lê --toast-ms (entra, segura, some) -- as duas
// usam a mesma duração por aviso, então ele só sai da tela depois que o
// próprio fade-out terminou.
const DEFAULT_DURATION_MS = 3000;
const ACTION_DURATION_MS = 6000;
const MAX_VISIBLE = 3;

const ICONS: Record<ToastVariant, IconName> = {
  success: "check",
  error: "alert",
  info: "info",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, options?: ToastOptions) => {
      const id = nextId++;
      const variant = options?.variant ?? "success";
      const durationMs =
        options?.durationMs ??
        (options?.actionLabel ? ACTION_DURATION_MS : variant === "error" ? 4500 : DEFAULT_DURATION_MS);
      setToasts((prev) => [
        ...prev.slice(-(MAX_VISIBLE - 1)),
        {
          id,
          message,
          description: options?.description,
          variant,
          actionLabel: options?.actionLabel,
          onAction: options?.onAction,
          durationMs,
        },
      ]);
      setTimeout(() => dismiss(id), durationMs);
    },
    [dismiss]
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast toast-${toast.variant}`}
            style={{ ["--toast-ms" as string]: `${toast.durationMs}ms` }}
            onClick={() => dismiss(toast.id)}
          >
            <span className="toast-icon" aria-hidden="true">
              <Icon name={ICONS[toast.variant]} className="icon" />
            </span>
            <span className="toast-body">
              <span className="toast-message">{toast.message}</span>
              {toast.description && <span className="toast-description">{toast.description}</span>}
            </span>
            {toast.actionLabel && (
              <button
                type="button"
                className="toast-action"
                onClick={(event) => {
                  event.stopPropagation();
                  toast.onAction?.();
                  dismiss(toast.id);
                }}
              >
                {toast.actionLabel}
              </button>
            )}
            <span className="toast-timer" aria-hidden="true" />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
