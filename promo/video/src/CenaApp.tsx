// Cena com uma tela do app, em pé: frase grande em cima, celular embaixo e
// um destaque que salta por cima (o número que importa).
import { Audio } from "@remotion/media";
import { AbsoluteFill, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Celular } from "./Celular";
import { COR, fontFamily } from "./marca";

type Props = { assunto: string; titulo: string; telas: string[]; destaque?: string; voz: string | null };

export const CenaApp = ({ assunto, titulo, telas, destaque, voz }: Props) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const entrada = spring({ frame, fps, config: { damping: 14 } });
  const celular = spring({ frame: frame - 4, fps, config: { damping: 15 } });
  // O destaque entra quando a fala chega no ponto (um pouco antes do meio).
  const pop = spring({ frame: frame - Math.round(durationInFrames * 0.38), fps, config: { damping: 9, stiffness: 160 } });
  return (
    <AbsoluteFill style={{ background: COR.creme, fontFamily, color: COR.tinta }}>
      {voz && <Audio src={staticFile(voz)} />}
      <div
        style={{
          position: "absolute",
          left: 90,
          right: 90,
          top: 130,
          display: "flex",
          flexDirection: "column",
          gap: 26,
          opacity: entrada,
          translate: `0 ${(1 - entrada) * -50}px`,
        }}
      >
        <span
          style={{
            alignSelf: "flex-start",
            padding: "10px 28px",
            borderRadius: 999,
            background: COR.verde,
            color: COR.cremeClaro,
            fontSize: 38,
            fontWeight: 700,
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          {assunto}
        </span>
        <h1 style={{ margin: 0, fontSize: 96, lineHeight: 1.02, fontWeight: 800, letterSpacing: -2 }}>{titulo}</h1>
      </div>
      <div
        style={{
          position: "absolute",
          left: "50%",
          // Logo abaixo da frase (que ocupa até ~y 450), sem vão nem corte.
          top: 500,
          translate: `-50% ${(1 - celular) * 400}px`,
          rotate: `${(1 - celular) * 6}deg`,
        }}
      >
        <Celular telas={telas} escala={1.42} />
      </div>
      {destaque && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 1180,
            translate: "-50% 0",
            scale: String(pop),
            rotate: `${(1 - pop) * -8 - 2}deg`,
            padding: "26px 44px",
            borderRadius: 32,
            background: COR.ambar,
            color: COR.tinta,
            fontSize: 72,
            fontWeight: 800,
            whiteSpace: "nowrap",
            boxShadow: "0 24px 60px rgba(6, 43, 40, 0.35)",
          }}
        >
          {destaque}
        </div>
      )}
    </AbsoluteFill>
  );
};
