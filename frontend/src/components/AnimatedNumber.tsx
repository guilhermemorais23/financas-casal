import { useEffect, useRef, useState } from "react";
import { formatCurrency } from "../utils/format";

// Conta subindo (ou descendo) do último valor mostrado até o novo, pra uma
// troca de mês ou um carregamento parecer movimento, e não um número que
// simplesmente aparece. Curto (250ms): é resposta a um toque, e uma contagem
// longa parecia o app demorando pra reagir -- com prefers-reduced-motion,
// pula direto pro valor final.
export function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }

    const from = fromRef.current;
    const to = value;
    if (from === to) return;

    const duration = 250;
    const start = performance.now();

    function step(now: number) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (to - from) * eased);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = to;
      }
    }

    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [value]);

  return <>{formatCurrency(display)}</>;
}
