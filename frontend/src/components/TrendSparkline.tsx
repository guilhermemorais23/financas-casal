import { useMemo } from "react";

export interface MonthlyNetPoint {
  month: string; // "YYYY-MM"
  net: number;
}

const WIDTH = 120;
const HEIGHT = 32;
const PAD = 4;

// Small enough to sit inside the hero card (dark gradient background) next
// to the big "Você tem no mês" number -- answers "melhorando ou piorando?"
// without needing to open Relatórios for the full picture. Deliberately no
// axis/labels/hover: a sparkline is a glance, not a chart someone reads.
export function TrendSparkline({ points }: { points: MonthlyNetPoint[] }) {
  const { path, areaPath, lastDot } = useMemo(() => {
    const values = points.map((p) => p.net);
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);
    const range = max - min || 1;
    const plotWidth = WIDTH - PAD * 2;
    const plotHeight = HEIGHT - PAD * 2;
    const xStep = values.length > 1 ? plotWidth / (values.length - 1) : 0;
    const xFor = (i: number) => PAD + i * xStep;
    const yFor = (value: number) => PAD + plotHeight - ((value - min) / range) * plotHeight;

    const linePath = values.map((v, i) => `${i === 0 ? "M" : "L"}${xFor(i)},${yFor(v)}`).join(" ");
    const areaClosePath =
      values.length > 0
        ? `${linePath} L${xFor(values.length - 1)},${HEIGHT - PAD} L${xFor(0)},${HEIGHT - PAD} Z`
        : "";
    const last = values[values.length - 1];

    return {
      path: linePath,
      areaPath: areaClosePath,
      lastDot: values.length > 0 ? { x: xFor(values.length - 1), y: yFor(last) } : null,
    };
  }, [points]);

  if (points.length === 0) return null;

  const trendingUp = points[points.length - 1].net >= points[0].net;

  return (
    <svg
      className="hero-trend-svg"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      role="img"
      aria-label={`Tendência dos últimos ${points.length} meses: ${trendingUp ? "melhorando" : "piorando"}.`}
    >
      <defs>
        <linearGradient id="hero-trend-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--cream)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--cream)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#hero-trend-fill)" stroke="none" />
      <path d={path} fill="none" stroke="var(--cream)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      {lastDot && <circle cx={lastDot.x} cy={lastDot.y} r={2.5} fill="var(--cream)" />}
    </svg>
  );
}
