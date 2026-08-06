import { formatCurrency } from "../utils/format";

export interface PieSlice {
  id: string;
  label: string;
  emoji: string | null;
  value: number;
  color: string;
}

interface CategoryPieChartProps {
  slices: PieSlice[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
}

const SIZE = 160;
const RADIUS = 58;
const STROKE = 22;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP = 5;

export function CategoryPieChart({ slices, selectedId = null, onSelect }: CategoryPieChartProps) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);

  let cumulativeFraction = 0;
  const arcs = slices.map((slice) => {
    const fraction = total > 0 ? slice.value / total : 0;
    const arcLength = Math.max(fraction * CIRCUMFERENCE - GAP, 0);
    const offset = -(cumulativeFraction * CIRCUMFERENCE);
    cumulativeFraction += fraction;
    return { ...slice, fraction, arcLength, offset };
  });

  function toggle(id: string) {
    onSelect?.(selectedId === id ? null : id);
  }

  return (
    <div className="donut-chart">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} role="img" aria-label="Gastos por categoria">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="var(--color-border)" strokeWidth={STROKE} />
        {arcs.map((arc) => (
          <circle
            key={arc.id}
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={arc.color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${arc.arcLength} ${CIRCUMFERENCE}`}
            strokeDashoffset={arc.offset}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            opacity={selectedId && selectedId !== arc.id ? 0.3 : 1}
            style={{ cursor: onSelect ? "pointer" : undefined, transition: "opacity 0.15s" }}
            onClick={onSelect ? () => toggle(arc.id) : undefined}
          />
        ))}
        <text x="50%" y="46%" textAnchor="middle" className="donut-center-value">
          {formatCurrency(total)}
        </text>
        <text x="50%" y="61%" textAnchor="middle" className="donut-center-label">
          total
        </text>
      </svg>
      <ul className="pie-legend">
        {arcs.map((arc) => (
          <li key={arc.id}>
            <button
              type="button"
              className={`pie-legend-button${selectedId === arc.id ? " selected" : ""}`}
              onClick={() => toggle(arc.id)}
            >
              <span className="category-row-header">
                <span className="category-name">
                  <span className="identity-dot" style={{ background: arc.color }} />
                  {arc.emoji ?? "✨"} {arc.label}
                </span>
                <span className="value">
                  {formatCurrency(arc.value)}{" "}
                  <span className="donut-legend-percent">({Math.round(arc.fraction * 100)}%)</span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
