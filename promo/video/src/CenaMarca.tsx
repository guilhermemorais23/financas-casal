// "Calma. Baixa o PAR." (a logo entra batendo) e o fechamento com a chamada
// pra compartilhar.
import { Audio } from "@remotion/media";
import { AbsoluteFill, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Logo } from "./Logo";
import { COR, fontFamily } from "./marca";

type Props = { chamada?: string; frase: string; rodape?: string; voz: string | null };

export const CenaMarca = ({ chamada, frase, rodape, voz }: Props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Batida: a logo chega grande e assenta, com um tremidinho.
  const batida = spring({ frame, fps, config: { damping: 8, stiffness: 180 } });
  const texto = interpolate(frame, [16, 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill
      style={{
        background: COR.verde,
        fontFamily,
        color: COR.cremeClaro,
        alignItems: "center",
        justifyContent: "center",
        gap: 70,
        padding: "0 90px",
        textAlign: "center",
      }}
    >
      {voz && <Audio src={staticFile(voz)} />}
      {chamada && (
        <h1 style={{ margin: 0, fontSize: 112, lineHeight: 1, fontWeight: 800, letterSpacing: -3, opacity: batida }}>{chamada}</h1>
      )}
      <div style={{ scale: String(1.6 - batida * 0.6) }}>
        <Logo tamanho={220} />
      </div>
      <p style={{ margin: 0, fontSize: 64, fontWeight: 700, opacity: texto, translate: `0 ${(1 - texto) * 24}px` }}>{frase}</p>
      {rodape && <p style={{ margin: 0, fontSize: 46, color: COR.ambar, fontWeight: 700, opacity: texto }}>{rodape}</p>}
    </AbsoluteFill>
  );
};
