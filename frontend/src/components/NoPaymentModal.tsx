import { useEffect, useMemo, useState } from "react";
import { ApiError, apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatCurrency } from "../utils/format";
import { PAYMENT_METHOD_OPTIONS, type PaymentMethod } from "../utils/paymentMethod";
import { Sheet } from "./Sheet";
import { useToast } from "./ToastProvider";

interface NoPaymentGroup {
  key: string;
  label: string;
  transactionType: "expense" | "income";
  count: number;
  total: string;
  transactionIds: string[];
  suggestedPaymentMethod: PaymentMethod | null;
}

// "Sem forma de pagamento": um nome por linha (todos os lançamentos com ele de
// uma vez), um toque em Pix/Crédito/Débito/Dinheiro e salva. Com "Sempre
// assim", a próxima importação já traz esse nome com a forma marcada.
export function NoPaymentModal({ month, onClose, onSaved }: { month: string; onClose: () => void; onSaved: () => void }) {
  const { token } = useAuth();
  const { showToast } = useToast();
  const [groups, setGroups] = useState<NoPaymentGroup[] | null>(null);
  const [choice, setChoice] = useState<Record<string, PaymentMethod>>({});
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    apiRequest<{ groups: NoPaymentGroup[] }>(`/transactions/no-payment-method?month=${month}`, { token })
      .then((list) => {
        setGroups(list.groups);
        setChoice(
          Object.fromEntries(
            list.groups.filter((g) => g.suggestedPaymentMethod).map((g) => [`${g.transactionType}:${g.key}`, g.suggestedPaymentMethod!])
          )
        );
      })
      .catch(() => setError("Não deu pra carregar os lançamentos."));
  }, [month, token]);

  const idOf = (group: NoPaymentGroup) => `${group.transactionType}:${group.key}`;
  const chosen = useMemo(() => (groups ?? []).filter((g) => choice[idOf(g)]), [groups, choice]);

  async function save() {
    setIsSaving(true);
    setError(null);
    let updated = 0;
    try {
      for (const group of chosen) {
        const res = await apiRequest<{ updated: number }>("/transactions/payment-method", {
          method: "POST",
          token,
          body: { transactionIds: group.transactionIds, paymentMethod: choice[idOf(group)], remember, label: group.label },
        });
        updated += res.updated;
      }
      showToast(`${updated} ${updated === 1 ? "lançamento organizado" : "lançamentos organizados"}`, {
        description: remember ? "Na próxima importação, esses nomes já vêm com a forma de pagamento." : undefined,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não deu pra salvar.");
      if (updated > 0) onSaved();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Sheet onClose={onClose} className="uncat-sheet" labelledBy="nopay-title">
      <h1 id="nopay-title">Sem forma de pagamento</h1>
      <p className="card-subtitle">
        Sem a forma, o lançamento não aparece nos filtros de Pix, Crédito e Débito. Escolha uma vez por nome: vale pra todos os
        lançamentos com ele.
      </p>

      {!groups && !error && <p className="field-hint">Carregando...</p>}
      {groups && groups.length === 0 && <p className="field-hint">Tudo com forma de pagamento neste mês.</p>}

      {groups && groups.length > 0 && (
        <ul className="uncat-list">
          {groups.map((group) => (
            <li key={idOf(group)} className="uncat-row nopay-row">
              <div className="uncat-row-text">
                <strong>{group.label}</strong>
                <small>
                  {group.transactionType === "income" ? "Entrada · " : ""}
                  {group.count} {group.count === 1 ? "lançamento" : "lançamentos"} · {formatCurrency(Number(group.total))}
                </small>
              </div>
              <div className="chip-row" role="group" aria-label={`Forma de pagamento de ${group.label}`}>
                {PAYMENT_METHOD_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`filter-chip${choice[idOf(group)] === option.value ? " active" : ""}`}
                    aria-pressed={choice[idOf(group)] === option.value}
                    onClick={() =>
                      setChoice((prev) => {
                        const next = { ...prev };
                        if (next[idOf(group)] === option.value) delete next[idOf(group)];
                        else next[idOf(group)] = option.value;
                        return next;
                      })
                    }
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {groups && groups.length > 0 && (
        <label className="uncat-remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Sempre assim (na próxima importação já vem marcado)
        </label>
      )}

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <div className="modal-actions">
        <button type="button" className="btn btn-outline" onClick={onClose}>
          Depois
        </button>
        <button type="button" className="btn btn-primary" disabled={isSaving || chosen.length === 0} onClick={() => void save()}>
          {isSaving ? "Salvando..." : chosen.length > 0 ? `Salvar ${chosen.length} ${chosen.length === 1 ? "nome" : "nomes"}` : "Salvar"}
        </button>
      </div>
    </Sheet>
  );
}
