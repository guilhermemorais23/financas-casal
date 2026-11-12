import { useSearchParams } from "react-router-dom";
import { BillsTabs } from "../components/BillsTabs";
import { AppLayout } from "../layouts/AppLayout";
import { useModules } from "../hooks/useModules";
import { DebtsPage } from "./DebtsPage";
import { RecurringBillsPage } from "./RecurringBillsPage";

// "A pagar": contas fixas (todo mês) e dívidas/parceladas num lugar só. Pra
// quem usa são a mesma pergunta ("o que vence e quanto"); as duas telas
// continuam inteiras, só dividem a mesma aba. A aba fica na URL (?aba=).
export function PayablesPage() {
  const [params, setParams] = useSearchParams();
  const moduleOn = useModules();
  // Uma das duas desligada: a outra abre direto, sem a troca de cima (o
  // endereço com ?aba= continua abrindo qualquer uma).
  const showFixed = moduleOn("payables");
  const showDebts = moduleOn("debts");
  const asked = params.get("aba");
  const tab = asked === "dividas" || (!asked && !showFixed && showDebts) ? "dividas" : "fixas";

  return (
    <AppLayout>
      <div className="page-stack">
        <BillsTabs />
        {showFixed && showDebts && (
        <div className="segmented payables-switch" role="tablist" aria-label="O que ver">
          {(
            [
              ["fixas", "Contas"],
              ["dividas", "Parceladas"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`segmented-option${tab === id ? " active" : ""}`}
              onClick={() => setParams({ aba: id }, { replace: true })}
            >
              {label}
            </button>
          ))}
        </div>
        )}
        {tab === "dividas" ? <DebtsPage embedded /> : <RecurringBillsPage embedded />}
      </div>
    </AppLayout>
  );
}
