import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export interface ConfirmOptions {
  title?: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // "danger" (default) paints the confirm button red -- for anything that
  // deletes or is hard to reverse. "primary" is for a plain "are you sure?".
  tone?: "danger" | "primary";
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface OpenDialog extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

const EXIT_MS = 180;

// Replaces window.confirm everywhere: same "await it, get a boolean" shape,
// but rendered by the app (themed, animated, keyboard-safe) instead of the
// browser's native alert box.
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setIsClosing(false);
      setDialog({ ...options, resolve });
    });
  }, []);

  const finish = useCallback(
    (result: boolean) => {
      if (!dialog) return;
      dialog.resolve(result);
      setIsClosing(true);
      window.setTimeout(() => {
        setDialog(null);
        setIsClosing(false);
        openerRef.current?.focus?.();
      }, EXIT_MS);
    },
    [dialog]
  );

  useEffect(() => {
    if (!dialog) return;
    // Cancel gets the initial focus: an accidental Enter never destroys data.
    cancelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      } else if (event.key === "Tab") {
        // Two buttons only -- keep focus cycling between them.
        const order = [cancelRef.current, confirmRef.current].filter(Boolean) as HTMLButtonElement[];
        const index = order.indexOf(document.activeElement as HTMLButtonElement);
        event.preventDefault();
        order[(index + (event.shiftKey ? -1 : 1) + order.length) % order.length]?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [dialog, finish]);

  const value = useMemo(() => confirm, [confirm]);
  const tone = dialog?.tone ?? "danger";

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {dialog && (
        <div
          className={`confirm-backdrop${isClosing ? " is-closing" : ""}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) finish(false);
          }}
        >
          <div
            className={`confirm-panel ${tone}`}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-body"
          >
            <div className="confirm-icon" aria-hidden="true">
              {tone === "danger" ? (
                <svg viewBox="0 0 24 24" className="icon">
                  <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="icon">
                  <path d="M12 8v5M12 16.5v.01M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                </svg>
              )}
            </div>
            <h3 id="confirm-title">{dialog.title ?? (tone === "danger" ? "Tem certeza?" : "Confirmar")}</h3>
            <p id="confirm-body">{dialog.body}</p>
            <div className="confirm-actions">
              <button ref={cancelRef} type="button" className="btn btn-outline" onClick={() => finish(false)}>
                {dialog.cancelLabel ?? "Cancelar"}
              </button>
              <button
                ref={confirmRef}
                type="button"
                className={`btn ${tone === "danger" ? "btn-danger" : "btn-primary"}`}
                onClick={() => finish(true)}
              >
                {dialog.confirmLabel ?? (tone === "danger" ? "Excluir" : "Confirmar")}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error("useConfirm must be used within a ConfirmProvider");
  }
  return context;
}
