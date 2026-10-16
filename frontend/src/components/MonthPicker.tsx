import { useEffect, useRef, useState } from "react";
import { currentMonthParam, monthYearLabel } from "../utils/format";

const MONTH_ABBREVIATIONS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

interface MonthPickerProps {
  value: string; // "YYYY-MM"
  onChange: (month: string) => void;
  isLoading?: boolean;
}

// Substitui o <input type="month"> nativo do navegador -- o popup dele vem
// com a cara do sistema/navegador (caixa branca simples, fonte padrão, um
// "Limpar" que nem faz sentido aqui, já que sempre tem um mês escolhido), o
// que destoa do resto do visual do app. O mesmo padrão de painel que abre e
// fecha clicando fora usado nos menus do app.
export function MonthPicker({ value, onChange, isLoading = false }: MonthPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => Number(value.slice(0, 4)));
  const containerRef = useRef<HTMLDivElement>(null);

  const [selectedYear, selectedMonthNum] = value.split("-").map(Number);

  // Centraliza de novo a grade do ano no mês que está escolhido toda vez que
  // o painel abre, em vez de ficar onde parou da última vez.
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
        {isLoading ? (
          <span className="month-picker-spinner" aria-hidden="true" />
        ) : (
          <span className="month-picker-caret">▾</span>
        )}
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
