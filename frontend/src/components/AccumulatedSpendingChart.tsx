import { useMemo, useState } from "react";
import { formatCurrency } from "../utils/format";

export interface DailyTrendPoint {
  day: string;
  income: string;
  expense: string;
}

const WIDTH = 640;
const HEIGHT = 200;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;
const PAD_LEFT = 8;
const PAD_RIGHT = 8;

// Single series -- the card title already names it, so no legend box is
// needed here (dataviz rule: a legend is only mandatory for >=2 series).
const EXPENSE_COLOR = "var(--series-2)";

function dayOfMonth(iso: string): number {
  return Number(iso.slice(8, 10));
}

export function AccumulatedSpendingChart({ points }: { points: DailyTrendPoint[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const { path, areaPath, dot, xFor, maxValue, tickIndexes } = useMemo(() => {
    const values = points.map((p) => Number(p.expense));
    const max = Math.max(1, ...values);
    const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
    const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
    const xStep = points.length > 1 ? plotWidth / (points.length - 1) : 0;
    const xForIndex = (i: number) => PAD_LEFT + i * xStep;
    const yForValue = (value: number) => PAD_TOP + plotHeight - (value / max) * plotHeight;

    const linePath = values.map((v, i) => `${i === 0 ? "M" : "L"}${xForIndex(i)},${yForValue(v)}`).join(" ");
    const areaClosePath =
      values.length > 0
        ? `${linePath} L${xForIndex(values.length - 1)},${HEIGHT - PAD_BOTTOM} L${xForIndex(0)},${HEIGHT - PAD_BOTTOM} Z`
        : "";

    const last = values[values.length - 1];
    const step = Math.max(1, Math.floor((points.length - 1) / 4));
    const ticks: number[] = [];
    for (let i = 0; i < points.length; i += step) ticks.push(i);
    if (ticks[ticks.length - 1] !== points.length - 1) ticks.push(points.length - 1);

    return {
      path: linePath,
      areaPath: areaClosePath,
      dot: points.length > 0 ? { x: xForIndex(values.length - 1), y: yForValue(last) } : null,
      xFor: xForIndex,
      yFor: yForValue,
      maxValue: max,
      tickIndexes: ticks,
    };
  }, [points]);

  if (points.length === 0) return null;

  const hovered = hoverIndex !== null ? points[hoverIndex] : null;

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const relativeX = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
    const ratio = (relativeX - PAD_LEFT) / plotWidth;
    const index = Math.round(ratio * (points.length - 1));
    setHoverIndex(Math.min(points.length - 1, Math.max(0, index)));
  }

  return (
    <div className="accumulated-chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Gasto acumulado no mês: ${formatCurrency(Number(points[points.length - 1].expense))}, maior valor no período ${formatCurrency(maxValue)}.`}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <line
          x1={PAD_LEFT}
          y1={HEIGHT - PAD_BOTTOM}
          x2={WIDTH - PAD_RIGHT}
          y2={HEIGHT - PAD_BOTTOM}
          stroke="var(--color-border)"
          strokeWidth={1}
        />

        <defs>
          <linearGradient id="accumulated-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={EXPENSE_COLOR} stopOpacity="0.18" />
            <stop offset="100%" stopColor={EXPENSE_COLOR} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#accumulated-fill)" stroke="none" />
        <path d={path} fill="none" stroke={EXPENSE_COLOR} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {dot && <circle cx={dot.x} cy={dot.y} r={4} fill={EXPENSE_COLOR} stroke="var(--tan-card)" strokeWidth={2} />}

        {tickIndexes.map((i) => (
          <text key={i} x={xFor(i)} y={HEIGHT - 6} textAnchor="middle" className="accumulated-chart-axis-label">
            {String(dayOfMonth(points[i].day)).padStart(2, "0")}
          </text>
        ))}

        {hoverIndex !== null && (
          <line
            x1={xFor(hoverIndex)}
            y1={PAD_TOP}
            x2={xFor(hoverIndex)}
            y2={HEIGHT - PAD_BOTTOM}
            stroke="var(--color-text-muted)"
            strokeWidth={1}
          />
        )}
      </svg>

      {hovered && hoverIndex !== null && (
        <div className="accumulated-chart-tooltip">
          dia {dayOfMonth(hovered.day)} · <strong>{formatCurrency(Number(hovered.expense))}</strong>
        </div>
      )}
    </div>
  );
}
