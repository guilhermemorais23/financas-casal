import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface ToastItem {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  durationMs: number;
}

export interface ToastOptions {
  // A button on the toast ("Desfazer"). Clicking it runs onAction and
  // dismisses the toast right away.
  actionLabel?: string;
  onAction?: () => void;
  // How long the toast stays. Toasts with an action get a longer default so
  // there is time to actually reach for the button.
  durationMs?: number;
}

interface ToastContextValue {
  showToast: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;
// The CSS `.toast` animation reads --toast-ms (fade-in 0.25s, hold, fade-out
// 0.25s) -- both use the same per-toast duration, so the toast is only
// unmounted after its own fade-out has finished.
const DEFAULT_DURATION_MS = 2600;
const ACTION_DURATION_MS = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, options?: ToastOptions) => {
      const id = nextId++;
      const durationMs = options?.durationMs ?? (options?.actionLabel ? ACTION_DURATION_MS : DEFAULT_DURATION_MS);
      setToasts((prev) => [
        ...prev,
        { id, message, actionLabel: options?.actionLabel, onAction: options?.onAction, durationMs },
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
          <p
            key={toast.id}
            className={`toast${toast.actionLabel ? " has-action" : ""}`}
            style={{ ["--toast-ms" as string]: `${toast.durationMs}ms` }}
          >
            <span className="toast-dot" aria-hidden="true" />
            {toast.message}
            {toast.actionLabel && (
              <>
                <button
                  type="button"
                  className="toast-action"
                  onClick={() => {
                    toast.onAction?.();
                    dismiss(toast.id);
                  }}
                >
                  {toast.actionLabel}
                </button>
                <span className="toast-timer" aria-hidden="true" />
              </>
            )}
          </p>
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
