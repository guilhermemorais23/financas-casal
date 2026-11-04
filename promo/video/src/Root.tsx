import { Composition } from "remotion";
import { calcularDuracao, FPS } from "./duracao";
import { VideoPar } from "./VideoPar";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="VideoPar"
      component={VideoPar}
      durationInFrames={1800}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{ duracoes: [], comVoz: [], comMusica: false }}
      calculateMetadata={calcularDuracao}
    />
  );
};
