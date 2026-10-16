import { formatCurrency } from "../utils/format";
import type { PieSlice } from "./CategoryPieChart";
import { initialOf } from "../utils/initial";

interface CategoryBarsProps {
  slices: PieSlice[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
}

// Barras em ranking em vez de pizza: nome e valor ficam lado a lado (sem
// legenda pra decifrar), a maior categoria vem primeiro, e tocar numa filtra
// o extrato abaixo -- o mesmo combinado do CategoryPieChart.
export function CategoryBars({ slices, selectedId = null, onSelect }: CategoryBarsProps) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const ranked = slices.slice().sort((a, b) => b.value - a.value);

  return (
    <div className="category-bars">
      {ranked.map((slice) => {
        const share = total > 0 ? (slice.value / total) * 100 : 0;
        const isSelected = selectedId === slice.id;
        return (
          <button
            key={slice.id}
            type="button"
            className={`category-bar${isSelected ? " selected" : ""}`}
            aria-pressed={isSelected}
            onClick={() => onSelect?.(isSelected ? null : slice.id)}
          >
            <span className="category-bar-icon">
              {initialOf(slice.label)}
            </span>
            <span className="category-bar-name">{slice.label}</span>
            <span className="category-bar-value">
              {formatCurrency(slice.value)} · {Math.round(share)}%
            </span>
            <span className="category-bar-track">
              <span className="category-bar-fill" style={{ width: `${Math.max(share, 2)}%`, background: slice.color }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
