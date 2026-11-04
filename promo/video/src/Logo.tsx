// A marca do PAR.: quadrado cheio e quadrado em contorno (como o ícone do app).
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COR, fontFamily } from "./marca";

type Props = { tamanho: number; cor?: string; contorno?: string; comNome?: boolean };

export const Logo = ({ tamanho, cor = COR.cremeClaro, contorno = COR.ambar, comNome = true }: Props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Os dois quadrados chegam e se encaixam; o nome aparece logo depois.
  const encaixe = spring({ frame, fps, config: { damping: 14, mass: 0.8 } });
  const nome = interpolate(frame, [12, 28], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const passo = tamanho / 512;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: tamanho * 0.28 }}>
      <svg width={tamanho} height={tamanho} viewBox="0 0 512 512">
        <rect x={100 - (1 - encaixe) * 60} y={100 - (1 - encaixe) * 60} width={190} height={190} fill={cor} />
        <rect
          x={220 + (1 - encaixe) * 60}
          y={220 + (1 - encaixe) * 60}
          width={190}
          height={190}
          fill="none"
          stroke={contorno}
          strokeWidth={30}
        />
      </svg>
      {comNome && (
        <span
          style={{
            fontFamily,
            fontWeight: 800,
            fontSize: 360 * passo,
            letterSpacing: -6 * passo,
            color: cor,
            opacity: nome,
            translate: `${(1 - nome) * -30 * passo}px 0`,
          }}
        >
          PAR<span style={{ color: contorno }}>.</span>
        </span>
      )}
    </div>
  );
};
