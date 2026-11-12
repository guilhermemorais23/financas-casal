import { useEffect, useRef, useState } from "react";
import { formatCurrency } from "../utils/format";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

// Conta subindo (ou descendo) do último valor mostrado até o novo, pra uma
// troca de mês ou um carregamento parecer movimento, e não um número que
// simplesmente aparece. Curto (250ms): é resposta a um toque, e uma contagem
// longa parecia o app demorando pra reagir -- com prefers-reduced-motion,
// pula direto pro valor final.
// countUp: os números principais do Painel começam do zero ao abrir a tela
// (uma contagem um pouco mais longa, 600ms). O valor final sempre chega no
// DOM; sem movimento, ele aparece direto.
export function AnimatedNumber({ value, countUp = false }: { value: number; countUp?: boolean }) {
  const [start] = useState(() => (countUp && !prefersReducedMotion() ? 0 : value));
  const [display, setDisplay] = useState(start);
  const fromRef = useRef(start);
  const firstRef = useRef(true);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const isFirst = firstRef.current;
    firstRef.current = false;
    if (prefersReducedMotion()) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }

    // Uma contagem interrompida no meio continua de onde estava.
    const from = fromRef.current;
    const to = value;
    if (from === to) return;

    const duration = isFirst && countUp ? 600 : 250;
    const startedAt = performance.now();

    function step(now: number) {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = from + (to - from) * eased;
      fromRef.current = current;
      setDisplay(current);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = to;
        setDisplay(to);
      }
    }

    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
    // countUp só vale pra primeira contagem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <>{formatCurrency(display)}</>;
}
