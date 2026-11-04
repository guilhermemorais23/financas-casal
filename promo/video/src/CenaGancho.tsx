// Gancho (primeiros segundos): "POV: você pagou a conta de novo" e as
// mensagens da galera prometendo o Pix que nunca chega.
import { Audio } from "@remotion/media";
import { AbsoluteFill, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { COR, fontFamily } from "./marca";

const MENSAGENS = [
  { quem: "Lucas", texto: "amanhã te mando o pix 🙏" },
  { quem: "Bia", texto: "pago semana que vem, juro" },
  { quem: "Ana", texto: "quanto deu mesmo? kkkk" },
];

export const CenaGancho = ({ voz }: { voz: string | null }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const titulo = spring({ frame, fps, config: { damping: 11, stiffness: 140 } });
  return (
    <AbsoluteFill style={{ background: COR.verdeEscuro, fontFamily, color: COR.cremeClaro }}>
      {voz && <Audio src={staticFile(voz)} />}
      <div style={{ position: "absolute", left: 90, right: 90, top: 260, scale: String(0.7 + titulo * 0.3), opacity: titulo }}>
        <p style={{ margin: 0, fontSize: 56, fontWeight: 700, color: COR.ambar, letterSpacing: 2 }}>POV:</p>
        <h1 style={{ margin: "12px 0 0", fontSize: 128, lineHeight: 0.98, fontWeight: 800, letterSpacing: -3 }}>
          você pagou a conta de novo
        </h1>
      </div>
      <div style={{ position: "absolute", left: 90, right: 90, top: 1020, display: "flex", flexDirection: "column", gap: 34 }}>
        {MENSAGENS.map((mensagem, i) => {
          const entra = spring({ frame: frame - 14 - i * 12, fps, config: { damping: 13 } });
          return (
            <div
              key={mensagem.quem}
              style={{
                alignSelf: i % 2 ? "flex-end" : "flex-start",
                maxWidth: 760,
                padding: "26px 34px",
                borderRadius: 36,
                background: COR.cremeClaro,
                color: COR.tinta,
                opacity: entra,
                translate: `${(1 - entra) * (i % 2 ? 120 : -120)}px 0`,
                boxShadow: "0 18px 40px rgba(0,0,0,0.25)",
              }}
            >
              <div style={{ fontSize: 34, fontWeight: 700, color: COR.verde }}>{mensagem.quem}</div>
              <div style={{ fontSize: 52, fontWeight: 600, marginTop: 4 }}>{mensagem.texto}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
