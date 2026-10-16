import { useEffect, useState } from "react";
import { BrandMark } from "./Brand";

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`spinner ${className}`.trim()} aria-hidden="true" />;
}

// Vira true quando `active` ficou true por `delayMs` -- usado pra só falar
// "o servidor está acordando" quando a espera é longa de verdade, e não a
// cada toque.
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

// "Carregando" de tela cheia, usado enquanto a sessão é restaurada.
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
