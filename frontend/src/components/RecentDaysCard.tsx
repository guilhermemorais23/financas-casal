// "Últimos 7 dias": quanto saiu hoje e nos 6 dias antes, por categoria. A
// janela anda sozinha -- o gasto de 7 dias atrás some no dia seguinte, e a
// categoria que ficou sem nada na janela sai da lista. Só pra controle: não
// mexe no extrato nem nos totais do mês.
import { formatCurrency } from "../utils/format";

export interface RecentDaysSummary {
  from: string;
  to: string;
  total: string;
  byCategory: { categoryId: string | null; categoryName: string | null; categoryEmoji: string | null; total: string }[];
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function shortDate(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}

export function RecentDaysCard({ data }: { data: RecentDaysSummary }) {
  const max = Math.max(1, ...data.byCategory.map((row) => Number(row.total)));
  return (
    <section className="card" aria-label="Últimos 7 dias">
      <div className="section-header">
        <p className="card-title">Últimos 7 dias</p>
        <span className="painel-cat-value">{formatCurrency(Number(data.total))}</span>
      </div>
      <p className="card-subtitle">
        De {shortDate(data.from)} até hoje.
      </p>
      {data.byCategory.length === 0 ? (
        <p className="empty-state">Nenhum gasto nos últimos 7 dias.</p>
      ) : (
        <ul className="painel-cat-list">
          {data.byCategory.map((row) => {
            const value = Number(row.total);
            return (
              <li key={row.categoryId ?? "none"}>
                <span className="painel-cat-name">
                  {row.categoryEmoji ? `${row.categoryEmoji} ` : ""}
                  {row.categoryName ?? "Sem categoria"}
                </span>
                <span className="painel-cat-track" aria-hidden="true">
                  <span style={{ width: `${Math.max(2, (value / max) * 100)}%` }} />
                </span>
                <span className="painel-cat-value">{formatCurrency(value)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
