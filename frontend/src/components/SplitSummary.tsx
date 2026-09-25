import { Link } from "react-router-dom";
import { formatCurrency } from "../utils/format";

export interface SplitPayer {
  id: string;
  displayName: string;
  total: number;
  color: string;
}

export interface SplitSettlement {
  fromUserId: string;
  toUserId: string;
  amount: number;
}

interface SplitSummaryProps {
  payers: SplitPayer[];
  accountName: string;
  currentUserId: string | undefined;
  memberName: (userId: string) => string;
  // Acertos em aberto que envolvem quem está vendo. Sem `settleHref`, a
  // linha aparece sem o link (já estamos na tela do acerto).
  settlements?: SplitSettlement[];
  settleHref?: string;
  title?: string;
  totalSuffix?: string;
}

// "Quem pagou o quê": uma barra com a parte de cada um na conta conjunta,
// a legenda com os valores e, embaixo, quem deve pra quem.
export function SplitSummary({
  payers,
  accountName,
  currentUserId,
  memberName,
  settlements = [],
  settleHref,
  title = "Quem pagou o quê",
  totalSuffix = "juntos",
}: SplitSummaryProps) {
  const total = payers.reduce((sum, payer) => sum + payer.total, 0);

  return (
    <section className="split-summary" aria-label={title}>
      <div className="section-header">
        <h2 className="section-title">{title}</h2>
        <span className="split-summary-total">
          {formatCurrency(total)} {totalSuffix}
        </span>
      </div>
      {total > 0 ? (
        <div
          className="split-bar"
          role="img"
          aria-label={payers.map((payer) => `${payer.displayName}: ${formatCurrency(payer.total)}`).join(", ")}
        >
          {payers
            .filter((payer) => payer.total > 0)
            .map((payer) => (
              <span key={payer.id} style={{ flexGrow: payer.total, background: payer.color }} />
            ))}
        </div>
      ) : (
        <p className="empty-state">Nada lançado na {accountName} este mês.</p>
      )}
      <ul className="split-legend">
        {payers.map((payer) => (
          <li key={payer.id}>
            <span className="identity-dot" style={{ background: payer.color }} />
            {payer.displayName} <strong>{formatCurrency(payer.total)}</strong>
          </li>
        ))}
      </ul>
      {settlements
        .filter((row) => row.fromUserId === currentUserId || row.toUserId === currentUserId)
        .map((row) => (
          <div className="split-settle" key={`${row.fromUserId}-${row.toUserId}`}>
            <span>
              {row.toUserId === currentUserId ? (
                <>
                  {memberName(row.fromUserId)} te deve <strong>{formatCurrency(row.amount)}</strong>
                </>
              ) : (
                <>
                  Você deve <strong>{formatCurrency(row.amount)}</strong> pra {memberName(row.toUserId)}
                </>
              )}
            </span>
            {settleHref && (
              <Link to={settleHref} className="link">
                Ver acerto
              </Link>
            )}
          </div>
        ))}
    </section>
  );
}
