import { useEffect, useRef, useState } from "react";
import { currentMonthParam, monthYearLabel } from "../utils/format";

const MONTH_ABBREVIATIONS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

interface MonthPickerProps {
  value: string; // "YYYY-MM"
  onChange: (month: string) => void;
}

// Replaces the browser's native <input type="month"> -- its popup renders
// with the OS/browser's own chrome (plain white box, default font, "Limpar"
// that doesn't even make sense here since a month is always selected), which
// looks out of place next to the rest of the app's styling. Same
// toggle-panel-with-outside-click pattern as EmojiPicker.
export function MonthPicker({ value, onChange }: MonthPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => Number(value.slice(0, 4)));
  const containerRef = useRef<HTMLDivElement>(null);

  const [selectedYear, selectedMonthNum] = value.split("-").map(Number);

  // Re-center the year grid on whatever month is actually selected each
  // time the panel opens, rather than staying wherever it was last left.
  useEffect(() => {
    if (isOpen) setViewYear(Number(value.slice(0, 4)));
  }, [isOpen, value]);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  function selectMonth(monthIndex: number) {
    onChange(`${viewYear}-${String(monthIndex + 1).padStart(2, "0")}`);
    setIsOpen(false);
  }

  return (
    <div className="month-picker" ref={containerRef}>
      <button type="button" className="month-picker-trigger" onClick={() => setIsOpen((current) => !current)}>
        {monthYearLabel(value)}
        <span className="month-picker-caret">▾</span>
      </button>
      {isOpen && (
        <div className="month-picker-panel">
          <div className="month-picker-year-row">
            <button
              type="button"
              className="month-picker-year-nav"
              onClick={() => setViewYear((year) => year - 1)}
              aria-label="Ano anterior"
            >
              ◀
            </button>
            <span className="month-picker-year-label">{viewYear}</span>
            <button
              type="button"
              className="month-picker-year-nav"
              onClick={() => setViewYear((year) => year + 1)}
              aria-label="Próximo ano"
            >
              ▶
            </button>
          </div>
          <div className="month-picker-grid">
            {MONTH_ABBREVIATIONS.map((label, index) => {
              const isSelected = viewYear === selectedYear && index + 1 === selectedMonthNum;
              return (
                <button
                  key={label}
                  type="button"
                  className={`month-picker-month${isSelected ? " selected" : ""}`}
                  onClick={() => selectMonth(index)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="month-picker-today"
            onClick={() => {
              onChange(currentMonthParam());
              setIsOpen(false);
            }}
          >
            Este mês
          </button>
        </div>
      )}
    </div>
  );
}
