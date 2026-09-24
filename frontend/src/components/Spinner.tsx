import { useEffect, useState } from "react";
import { BrandMark } from "./Brand";

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`spinner ${className}`.trim()} aria-hidden="true" />;
}

// True once `active` has stayed true for `delayMs` -- used to only mention
// "o servidor está acordando" when a wait is actually long, not on every tap.
export function useSlowFlag(active: boolean, delayMs = 4000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return slow;
}

export function SlowServerHint({ active }: { active: boolean }) {
  const slow = useSlowFlag(active);
  if (!slow) return null;
  return (
    <p className="slow-server-hint" role="status">
      Só um instante -- o servidor está acordando. Na primeira vez do dia pode levar alguns segundos.
    </p>
  );
}

// Full-screen "carregando" used while the session is being restored.
export function LoadingScreen({ label = "Carregando..." }: { label?: string }) {
  return (
    <div className="loading-page" role="status" aria-live="polite">
      <div className="loading-page-inner">
        <BrandMark size={40} />
        <Spinner className="spinner-lg" />
        <span>{label}</span>
        <SlowServerHint active />
      </div>
    </div>
  );
}
