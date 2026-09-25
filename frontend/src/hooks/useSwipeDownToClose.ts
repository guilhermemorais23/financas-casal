import { useEffect, useRef, type RefObject } from "react";

// Arrastar pra baixo fecha a tela, como os painéis do iPhone. Vale pelo
// puxador (data-swipe-handle) a qualquer momento, e pelo resto do card só
// quando a página já está no topo -- senão o gesto é só rolar a tela. Tocar
// num campo (input, select, textarea) nunca começa o arrasto, pra não brigar
// com a seleção de texto.
export function useSwipeDownToClose(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  threshold = 110
) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let dy = 0;
    let tracking = false;
    let dragging = false;

    const reset = () => {
      el.style.transform = "";
      el.style.opacity = "";
    };

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const target = event.target as HTMLElement;
      const fromHandle = Boolean(target.closest("[data-swipe-handle]"));
      if (!fromHandle && (window.scrollY > 0 || target.closest("input, textarea, select, [data-no-swipe]"))) return;
      tracking = true;
      dragging = false;
      dy = 0;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    };

    const onMove = (event: TouchEvent) => {
      if (!tracking) return;
      const deltaY = event.touches[0].clientY - startY;
      const deltaX = event.touches[0].clientX - startX;
      if (!dragging) {
        if (Math.abs(deltaY) < 8) return;
        // Subindo ou indo pro lado: é rolagem normal, não fechar.
        if (deltaY < 0 || Math.abs(deltaX) > Math.abs(deltaY)) {
          tracking = false;
          return;
        }
        dragging = true;
        el.style.transition = "none";
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
      // Precisa do listener não passivo: impede o "elástico" do Safari de
      // puxar a página junto.
      event.preventDefault();
      dy = Math.max(0, deltaY);
      el.style.transform = `translateY(${dy}px)`;
      el.style.opacity = String(1 - Math.min(dy / 600, 0.4));
    };

    const onEnd = () => {
      if (!tracking) return;
      tracking = false;
      if (!dragging) return;
      el.style.transition = "transform 0.22s ease, opacity 0.22s ease";
      if (dy > threshold) {
        el.style.transform = "translateY(100vh)";
        el.style.opacity = "0";
        window.setTimeout(() => onCloseRef.current(), 180);
      } else {
        reset();
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [ref, threshold]);
}
