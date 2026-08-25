import { useMemo, useState } from "react";
import { formatCurrency } from "../utils/format";

export interface QuoteHistoryPoint {
  date: string;
  close: number;
}

export interface QuoteSeries {
  ticker: string;
  shortName: string;
  currentPrice: number;
  changePercent: number;
  points: QuoteHistoryPoint[];
}

// Fixed categorical order (CVD-validated in this app's palette already) --
// assigned by array position, never reassigned dynamically, so a ticker's
// line always reads the same color.
const SERIES_COLORS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
];

const WIDTH = 720;
const HEIGHT = 280;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;
const PAD_LEFT = 48;
const PAD_RIGHT = 16;

function niceStep(range: number): number {
  const rough = range / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough || 1));
  const normalized = rough / magnitude;
  const step = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
  return step * magnitude;
}

function formatDateLabel(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

export function QuotesLineChart({ series }: { series: QuoteSeries[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const pointCount = series[0]?.points.length ?? 0;

  const { normalized, xFor, yFor, gridLines } = useMemo(() => {
    const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
    const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;

    // Index every series to "% change since the first point in range" so
    // wildly different scales (Ibovespa's ~130k vs a stock's ~R$30) sit on
    // one shared axis instead of needing a second one.
    const normalizedSeries = series.map((s) => {
      const base = s.points[0]?.close ?? 1;
      return {
        ticker: s.ticker,
        values: s.points.map((p) => ((p.close - base) / base) * 100),
      };
    });

    const allValues = normalizedSeries.flatMap((s) => s.values);
    const rawMin = Math.min(0, ...allValues);
    const rawMax = Math.max(0, ...allValues);
    const span = rawMax - rawMin || 1;
    const min = rawMin - span * 0.1;
    const max = rawMax + span * 0.1;

    const xForIndex = (i: number) => (pointCount > 1 ? PAD_LEFT + (i / (pointCount - 1)) * plotWidth : PAD_LEFT);
    const yForValue = (value: number) => PAD_TOP + plotHeight - ((value - min) / (max - min)) * plotHeight;

    const step = niceStep(max - min);
    const lines: number[] = [];
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
      lines.push(v);
    }

    return { normalized: normalizedSeries, xFor: xForIndex, yFor: yForValue, gridLines: lines };
  }, [series, pointCount]);

  if (pointCount === 0) return null;

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const relativeX = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
    const ratio = (relativeX - PAD_LEFT) / plotWidth;
    const index = Math.round(ratio * (pointCount - 1));
    setHoverIndex(Math.min(pointCount - 1, Math.max(0, index)));
  }

  const hoveredDate = hoverIndex !== null ? series[0]?.points[hoverIndex]?.date : null;

  return (
    <div className="quotes-chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Variação percentual das cotações no período"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        {gridLines.map((value) => (
          <g key={value}>
            <line
              x1={PAD_LEFT}
              y1={yFor(value)}
              x2={WIDTH - PAD_RIGHT}
              y2={yFor(value)}
              stroke="var(--color-border)"
              strokeWidth={1}
            />
            <text x={PAD_LEFT - 8} y={yFor(value)} textAnchor="end" dominantBaseline="middle" className="quotes-chart-axis-label">
              {value.toFixed(0)}%
            </text>
          </g>
        ))}

        <text x={PAD_LEFT} y={HEIGHT - 6} textAnchor="start" className="quotes-chart-axis-label">
          {formatDateLabel(series[0].points[0].date)}
        </text>
        <text x={WIDTH - PAD_RIGHT} y={HEIGHT - 6} textAnchor="end" className="quotes-chart-axis-label">
          {formatDateLabel(series[0].points[pointCount - 1].date)}
        </text>

        {normalized.map((s, seriesIndex) => (
          <path
            key={s.ticker}
            d={s.values.map((v, i) => `${i === 0 ? "M" : "L"}${xFor(i)},${yFor(v)}`).join(" ")}
            fill="none"
            stroke={SERIES_COLORS[seriesIndex % SERIES_COLORS.length]}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {normalized.map((s, seriesIndex) => {
          const lastIndex = s.values.length - 1;
          return (
            <circle
              key={s.ticker}
              cx={xFor(lastIndex)}
              cy={yFor(s.values[lastIndex])}
              r={4}
              fill={SERIES_COLORS[seriesIndex % SERIES_COLORS.length]}
              stroke="var(--tan-card)"
              strokeWidth={2}
            />
          );
        })}

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

      {hoverIndex !== null && hoveredDate && (
        <div className="quotes-chart-tooltip">
          <p className="quotes-chart-tooltip-day">{formatDateLabel(hoveredDate)}</p>
          {series.map((s, i) => (
            <p key={s.ticker}>
              <span className="identity-dot" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
              {s.shortName}
              <strong>{normalized[i].values[hoverIndex].toFixed(1)}%</strong>
            </p>
          ))}
        </div>
      )}

      <ul className="quotes-legend">
        {series.map((s, i) => (
          <li key={s.ticker}>
            <span className="identity-dot" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
            <span className="quotes-legend-name">{s.shortName}</span>
            <span className="quotes-legend-price">{formatCurrency(s.currentPrice)}</span>
            <span className={`quotes-legend-change ${s.changePercent >= 0 ? "good" : "bad"}`}>
              {s.changePercent >= 0 ? "+" : ""}
              {s.changePercent.toFixed(2)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
