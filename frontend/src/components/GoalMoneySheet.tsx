import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatCurrency } from "../utils/format";
import { Sheet } from "./Sheet";
import { useToast } from "./ToastProvider";

export interface GoalForMoney {
  id: string;
  name: string;
  currentAmount: string;
  // "Guarde no mínimo X/mês" (quando tem prazo): vira um atalho de valor.
  monthlyMinimum: number | null;
  items: { id: string; name: string; missing: number; saved: number }[];
}

interface AccountRow {
  id: string;
  type: "personal" | "joint";
  name: string;
  ownerUserId: string | null;
}

function parseMoney(value: string): number {
  const clean = value.trim().replace(/\s|R\$/g, "");
  return Number(clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean);
}

const asInput = (value: number) => value.toFixed(2).replace(".", ",");

// Guardar na meta (ou retirar dela). "Tirar da conta" (ligado por padrão):
// o valor sai da conta escolhida e aparece no extrato como transferência --
// mexe no saldo, não conta como gasto. Desligado, só soma na meta (dinheiro
// que já estava guardado em outro lugar).
export function GoalMoneySheet({
  goal,
  direction,
  onClose,
  onDone,
}: {
  goal: GoalForMoney;
  direction: "deposit" | "withdraw";
  onClose: () => void;
  onDone: (updated: unknown) => void;
}) {
  const { user, token } = useAuth();
  const { showToast } = useToast();
  const deposit = direction === "deposit";
  const pickable = deposit ? goal.items.filter((item) => item.missing > 0) : goal.items.filter((item) => item.saved > 0);
  const [amount, setAmount] = useState(deposit && goal.monthlyMinimum ? asInput(goal.monthlyMinimum) : "");
  const [itemId, setItemId] = useState(pickable[0]?.id ?? "");
  const [useAccount, setUseAccount] = useState(true);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    apiRequest<{ accounts: AccountRow[] }>("/groups/me", { token })
      .then((res) => {
        setAccounts(res.accounts);
        setAccountId(
          (current) =>
            current ||
            res.accounts.find((a) => a.type === "personal" && a.ownerUserId === user?.id)?.id ||
            res.accounts.find((a) => a.type === "joint")?.id ||
            ""
        );
      })
      .catch(() => setAccounts([]));
  }, [token, user?.id]);

  const quick = [
    ...(deposit && goal.monthlyMinimum ? [{ label: `Mínimo do mês ${formatCurrency(goal.monthlyMinimum)}`, value: goal.monthlyMinimum }] : []),
    { label: "R$ 50", value: 50 },
    { label: "R$ 100", value: 100 },
    ...(!deposit && Number(goal.currentAmount) > 0 ? [{ label: "Tudo", value: Number(goal.currentAmount) }] : []),
  ];

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const value = parseMoney(amount);
    if (!(value > 0)) {
      setError("Digite o valor.");
      return;
    }
    if (useAccount && !accountId) {
      setError("Escolha a conta.");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const updated = await apiRequest(`/goals/${goal.id}/money`, {
        method: "POST",
        token,
        body: { direction, amount: value, itemId: itemId || null, accountId: useAccount ? accountId : null },
      });
      const where = goal.items.find((item) => item.id === itemId)?.name ?? goal.name;
      const account = accounts.find((a) => a.id === accountId)?.name;
      showToast(
        deposit ? `${formatCurrency(value)} guardado em ${where}` : `${formatCurrency(value)} retirado de ${where}`,
        useAccount && account ? { description: deposit ? `Saiu de ${account}` : `Voltou pra ${account}` } : undefined
      );
      onDone(updated);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Sheet onClose={onClose} labelledBy="goal-money-title">
      <h1 id="goal-money-title">{deposit ? `Guardar em ${goal.name}` : `Retirar de ${goal.name}`}</h1>
      <p className="card-subtitle">
        {deposit ? "Quanto vai guardar?" : `Guardado agora: ${formatCurrency(Number(goal.currentAmount))}`}
      </p>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="goal-money-amount">Valor (R$)</label>
          <input id="goal-money-amount" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </div>
        <div className="chip-row">
          {quick.map((option) => (
            <button key={option.label} type="button" className="filter-chip" onClick={() => setAmount(asInput(option.value))}>
              {option.label}
            </button>
          ))}
        </div>

        {pickable.length > 0 && (
          <div className="field">
            <label htmlFor="goal-money-item">{deposit ? "Pra qual submeta" : "De qual submeta"}</label>
            <select id="goal-money-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
              {pickable.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({deposit ? `faltam ${formatCurrency(item.missing)}` : `${formatCurrency(item.saved)} guardado`})
                </option>
              ))}
            </select>
          </div>
        )}

        <label className="checkbox-field">
          <input type="checkbox" checked={useAccount} onChange={(e) => setUseAccount(e.target.checked)} />
          {deposit ? "Tirar da conta" : "Voltar pra conta"}
        </label>
        {useAccount && (
          <div className="field">
            <label htmlFor="goal-money-account">{deposit ? "De qual conta" : "Pra qual conta"}</label>
            <select id="goal-money-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts
                .filter((account) => account.type === "joint" || account.ownerUserId === user?.id)
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
            </select>
          </div>
        )}
        <p className="field-hint">
          {useAccount
            ? `Aparece no extrato como “${deposit ? "Guardado na" : "Retirado da"} meta ${goal.name}”. Mexe no saldo, mas não conta como gasto.`
            : "Só muda o valor da meta. Use quando o dinheiro já está guardado em outro lugar."}
        </p>

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={isSaving}>
            {isSaving ? "Salvando..." : deposit ? "Guardar" : "Retirar"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
