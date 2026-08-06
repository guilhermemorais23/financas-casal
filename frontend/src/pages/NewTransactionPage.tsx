import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmojiPicker } from "../components/EmojiPicker";
import { AppLayout } from "../layouts/AppLayout";

interface AccountRow {
  id: string;
  type: "personal" | "joint";
  name: string;
  emoji: string | null;
  ownerUserId: string | null;
}

interface MemberRow {
  id: string;
  displayName: string;
}

interface CategoryRow {
  id: string;
  name: string;
  emoji: string | null;
}

export function NewTransactionPage() {
  const { user, token } = useAuth();
  const navigate = useNavigate();

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);

  const [transactionType, setTransactionType] = useState<"expense" | "income">("expense");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [payerId, setPayerId] = useState(user?.id ?? "");
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [splitType, setSplitType] = useState<"none" | "equal">("none");
  const [isPrivate, setIsPrivate] = useState(false);

  const isIncome = transactionType === "income";

  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryEmoji, setNewCategoryEmoji] = useState("");
  const [isSavingCategory, setIsSavingCategory] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadCategories() {
    const categoriesRes = await apiRequest<CategoryRow[]>("/categories", { token });
    setCategories(categoriesRes);
    return categoriesRes;
  }

  useEffect(() => {
    async function load() {
      const [groupRes] = await Promise.all([
        apiRequest<{ accounts: AccountRow[]; members: MemberRow[] }>("/groups/me", { token }),
        loadCategories(),
      ]);
      setAccounts(groupRes.accounts);
      setMembers(groupRes.members);
      setAccountId(
        (current) =>
          current ||
          groupRes.accounts.find((a) => a.type === "personal" && a.ownerUserId === user?.id)?.id ||
          groupRes.accounts.find((a) => a.type === "joint")?.id ||
          ""
      );
      setPayerId((current) => current || user?.id || "");
    }
    load();
  }, [token, user?.id]);

  async function handleAddCategory() {
    if (!newCategoryName.trim()) return;
    setError(null);
    setIsSavingCategory(true);
    try {
      const created = await apiRequest<CategoryRow>("/categories", {
        method: "POST",
        token,
        body: { name: newCategoryName.trim(), emoji: newCategoryEmoji.trim() || null },
      });
      await loadCategories();
      setCategoryId(created.id);
      setNewCategoryName("");
      setNewCategoryEmoji("");
      setIsAddingCategory(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível criar a categoria");
    } finally {
      setIsSavingCategory(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsedAmount = Number(amount.replace(",", "."));
    if (!description.trim() || !accountId || !payerId || !occurredAt || !(parsedAmount > 0)) {
      setError("Preencha descrição, valor, conta e pagador.");
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest("/transactions", {
        method: "POST",
        token,
        body: {
          description: description.trim(),
          amount: parsedAmount,
          accountId,
          categoryId: categoryId || null,
          payerId,
          transactionType,
          occurredAt,
          splitType: isIncome ? "none" : splitType,
          isPrivate: isIncome ? false : isPrivate,
        },
      });
      navigate("/dashboard");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : `Não foi possível salvar ${isIncome ? "a entrada" : "a despesa"}`
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AppLayout>
      <div className="card form-card">
        <h1>{isIncome ? "Nova entrada" : "Nova despesa"}</h1>
        <p className="card-subtitle">
          {isIncome ? "Registre um valor recebido pelo grupo ou pessoal." : "Registre um gasto do grupo ou pessoal."}
        </p>

        <div className="segmented">
          <button
            type="button"
            className={`segmented-option${!isIncome ? " active" : ""}`}
            onClick={() => setTransactionType("expense")}
          >
            Despesa
          </button>
          <button
            type="button"
            className={`segmented-option${isIncome ? " active" : ""}`}
            onClick={() => setTransactionType("income")}
          >
            Receita
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="description">Descrição</label>
            <input id="description" value={description} onChange={(e) => setDescription(e.target.value)} required />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="amount">Valor (R$)</label>
              <input
                id="amount"
                inputMode="decimal"
                placeholder="0,00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="occurredAt">Data</label>
              <input
                id="occurredAt"
                type="date"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="account">Conta</label>
            <select id="account" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
              <option value="" disabled>
                Selecione
              </option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.emoji ? `${account.emoji} ` : ""}
                  {account.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <div className="field-label-row">
              <label htmlFor="category">Categoria</label>
              <button
                type="button"
                className="link-button"
                onClick={() => setIsAddingCategory((current) => !current)}
              >
                {isAddingCategory ? "Cancelar" : "+ Nova categoria"}
              </button>
            </div>
            <select id="category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Sem categoria</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.emoji ? `${category.emoji} ` : ""}
                  {category.name}
                </option>
              ))}
            </select>
            {isAddingCategory && (
              <div className="inline-add-row">
                <input
                  placeholder="Nome"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                />
                <EmojiPicker value={newCategoryEmoji} onChange={setNewCategoryEmoji} />
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={isSavingCategory || !newCategoryName.trim()}
                  onClick={handleAddCategory}
                >
                  {isSavingCategory ? "..." : "Adicionar"}
                </button>
              </div>
            )}
          </div>

          <div className="field">
            <label htmlFor="payer">{isIncome ? "Quem recebeu" : "Quem pagou"}</label>
            <select id="payer" value={payerId} onChange={(e) => setPayerId(e.target.value)} required>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.id === user?.id ? "Você" : member.displayName}
                </option>
              ))}
            </select>
          </div>

          {!isIncome && (
            <>
              <div className="field">
                <label htmlFor="split">Divisão</label>
                <select
                  id="split"
                  value={splitType}
                  onChange={(e) => setSplitType(e.target.value as "none" | "equal")}
                >
                  <option value="none">Não dividir</option>
                  <option value="equal">Dividir igualmente entre o grupo</option>
                </select>
              </div>

              <label className="checkbox-field">
                <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
                Despesa privada (só você vê a descrição)
              </label>
            </>
          )}

          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
            {isSubmitting ? "Salvando..." : isIncome ? "Salvar entrada" : "Salvar despesa"}
          </button>
        </form>
      </div>
    </AppLayout>
  );
}
