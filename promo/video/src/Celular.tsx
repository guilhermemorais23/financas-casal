// Um celular com uma tela real do app. Com duas capturas, a tela "rola" da
// primeira pra segunda no meio da cena.
import { Img, interpolate, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";

// As capturas têm 430x844 (pontos do celular) em 2x.
const LARGURA = 430;
const ALTURA = 844;

export const Celular = ({ telas, escala }: { telas: string[]; escala: number }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const rolar =
    telas.length > 1
      ? interpolate(frame, [durationInFrames * 0.45, durationInFrames * 0.45 + 24], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.inOut(Easing.cubic),
        })
      : 0;
  const borda = 14 * escala;
  return (
    <div
      style={{
        width: LARGURA * escala + borda * 2,
        height: ALTURA * escala + borda * 2,
        padding: borda,
        borderRadius: 64 * escala,
        background: "#111c1b",
        boxShadow: "0 40px 80px rgba(6, 43, 40, 0.35)",
      }}
    >
      <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 50 * escala, overflow: "hidden" }}>
        {telas.map((tela, i) => (
          <Img
            key={tela}
            src={staticFile(tela)}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "top",
              // A segunda entra de baixo enquanto a primeira sobe: parece rolagem.
              translate: `0 ${(i - rolar) * 100}%`,
            }}
          />
        ))}
      </div>
    </div>
  );
};
