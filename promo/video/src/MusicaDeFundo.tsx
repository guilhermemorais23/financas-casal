// Trilha de fundo: entra com fade, fica baixinha por baixo da voz e sai com
// fade no fim. O arquivo é public/musica/fundo.mp3 (gerado pela ElevenLabs
// com `npm run musica`, ou qualquer música com licença pra usar no vídeo).
import { Audio } from "@remotion/media";
import { interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

export const ARQUIVO_MUSICA = "musica/fundo.mp3";
// Volume da trilha: alto o bastante pra dar ritmo, baixo o bastante pra voz
// ficar na frente (a voz é 1.0).
const VOLUME = 0.16;

export const MusicaDeFundo = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const volume = interpolate(
    frame,
    [0, 0.4 * fps, durationInFrames - 1 * fps, durationInFrames],
    [0, VOLUME, VOLUME, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  return <Audio name="Música de fundo" src={staticFile(ARQUIVO_MUSICA)} volume={volume} loop />;
};
