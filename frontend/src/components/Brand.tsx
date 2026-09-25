import { useLayoutEffect, useRef, type Ref } from "react";

type BrandMarkProps = {
  size?: number;
  // Refs opcionais pros dois quadrados -- usados pela animacao do Brand.
  filledRef?: Ref<SVGRectElement>;
  outlineRef?: Ref<SVGRectElement>;
};

export function BrandMark({ size = 28, filledRef, outlineRef }: BrandMarkProps) {
  return (
    <svg
      className="brand-icon"
      viewBox="0 0 94 104"
      width={size}
      height={(size * 104) / 94}
      aria-hidden="true"
    >
      <rect ref={filledRef} x="6" y="14" width="46" height="46" fill="var(--color-brand-accent)" />
      <rect
        ref={outlineRef}
        x="34"
        y="42"
        width="46"
        height="46"
        fill="none"
        stroke="var(--color-text)"
        strokeWidth="8"
      />
    </svg>
  );
}

// Duracoes da animacao de entrada (ms).
const OPEN_MS = 380;
const EMERGE_MS = 420;
const SLIDE_MS = 560;
// Tamanho do nome (relativo ao final) enquanto esta entre os quadrados.
const EMERGE_SCALE = 0.55;

export function Brand({ animated = false }: { animated?: boolean }) {
  const lockupRef = useRef<HTMLSpanElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const filledRef = useRef<SVGRectElement>(null);
  const outlineRef = useRef<SVGRectElement>(null);

  // useLayoutEffect: o nome ja comeca escondido antes do primeiro paint,
  // sem "piscar" na posicao final.
  useLayoutEffect(() => {
    if (!animated) return;
    const lockup = lockupRef.current;
    const name = nameRef.current;
    const filled = filledRef.current;
    const outline = outlineRef.current;
    if (!lockup || !name || !filled || !outline || typeof name.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    // Distancia do centro do nome ate o centro dos quadrados: o nome nasce
    // ali dentro e depois desliza ate o lugar dele.
    const svg = lockup.querySelector<SVGSVGElement>(".brand-icon")!;
    const icon = svg.getBoundingClientRect();
    const text = name.getBoundingClientRect();
    const dx = icon.left + icon.width / 2 - (text.left + text.width / 2);
    const dy = icon.top + icon.height / 2 - (text.top + text.height / 2);

    const ease = "cubic-bezier(0.22, 1, 0.36, 1)";
    const total = OPEN_MS + EMERGE_MS + SLIDE_MS;
    const openAt = OPEN_MS / total;
    const emergedAt = (OPEN_MS + EMERGE_MS) / total;

    // 1) Os quadrados se afastam ("abrem") -- mais pros lados que na
    //    vertical, pra caber o nome no meio --, seguram aberto enquanto o
    //    nome sai e fecham de volta quando ele vai pro lado.
    const squareFrames = (dist: number): Keyframe[] => {
      const opened = `translate(${dist}px, ${dist * 0.35}px) rotate(${dist > 0 ? 8 : -8}deg)`;
      return [
        { transform: "translate(0, 0)", offset: 0, easing: ease },
        { transform: opened, offset: openAt },
        { transform: opened, offset: emergedAt, easing: ease },
        { transform: "translate(0, 0)", offset: 1 },
      ];
    };
    const squareTiming: KeyframeAnimationOptions = { duration: total };
    // O translate dentro do SVG e em unidades do viewBox (94 de largura):
    // converte pra que cada quadrado se afaste meia largura do nome (no
    // tamanho em que ele aparece) + uma folga.
    const open = ((text.width * EMERGE_SCALE) / 2 + 6) * (94 / icon.width);
    // Deixa os quadrados sairem da caixa do SVG enquanto estao abertos.
    svg.style.overflow = "visible";
    filled.style.transformBox = "fill-box";
    filled.style.transformOrigin = "center";
    outline.style.transformBox = "fill-box";
    outline.style.transformOrigin = "center";

    // 2) O nome aparece pequeno no meio dos quadrados, cresce e 3) desliza
    //    pro lado ate a posicao final.
    const at = (scale: number) => `translate(${dx}px, ${dy}px) scale(${scale})`;
    const animations = [
      filled.animate(squareFrames(-open), squareTiming),
      outline.animate(squareFrames(open), squareTiming),
      name.animate(
        [
          { transform: at(0.1), opacity: 0, offset: 0 },
          { transform: at(0.1), opacity: 0, offset: openAt * 0.7, easing: ease },
          { transform: at(EMERGE_SCALE), opacity: 1, offset: emergedAt, easing: ease },
          { transform: "translate(0, 0) scale(1)", opacity: 1, offset: 1 },
        ],
        { duration: total, fill: "backwards" },
      ),
    ];

    return () => {
      animations.forEach((a) => a.cancel());
      svg.style.overflow = "";
    };
  }, [animated]);

  return (
    <span ref={lockupRef} className="brand-lockup">
      <BrandMark filledRef={filledRef} outlineRef={outlineRef} />
      <span ref={nameRef} className="brand">
        PAR<span className="brand-dot">.</span>
      </span>
    </span>
  );
}
