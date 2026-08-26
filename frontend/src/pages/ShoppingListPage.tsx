import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/ToastProvider";
import { AppLayout } from "../layouts/AppLayout";
import { readCache, writeCache } from "../utils/pageCache";

interface AccountRow {
  id: string;
  type: "personal" | "joint";
  name: string;
  ownerUserId: string | null;
}

interface CategoryRow {
  id: string;
  name: string;
  emoji: string | null;
}

interface MemberRow {
  id: string;
  displayName: string;
}

interface ShoppingItemRow {
  id: string;
  name: string;
  isChecked: boolean;
  checkedBy: string | null;
}

export function ShoppingListPage() {
  const { user, token } = useAuth();
  const { showToast } = useToast();
  const cacheKey = `shopping:${user?.id ?? "anon"}`;

  const [items, setItems] = useState<ShoppingItemRow[] | null>(() => readCache(cacheKey));
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [newItemName, setNewItemName] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [checkAmount, setCheckAmount] = useState("");
  const [checkAccountId, setCheckAccountId] = useState("");
  const [checkCategoryId, setCheckCategoryId] = useState("");
  const [isSubmittingCheck, setIsSubmittingCheck] = useState(false);

  async function loadItems() {
    const result = await apiRequest<ShoppingItemRow[]>("/shopping", { token });
    setItems(result);
    writeCache(cacheKey, result);
  }

  useEffect(() => {
    loadItems();
    apiRequest<{ accounts: AccountRow[]; members: MemberRow[] }>("/groups/me", { token }).then((res) => {
      setAccounts(res.accounts);
      setMembers(res.members);
      setCheckAccountId((current) => current || res.accounts[0]?.id || "");
    });
    apiRequest<CategoryRow[]>("/categories", { token }).then(setCategories);
  }, [token]);

  async function handleAddItem(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!newItemName.trim()) return;

    setIsAdding(true);
    try {
      await apiRequest("/shopping", { method: "POST", token, body: { name: newItemName.trim() } });
      setNewItemName("");
      await loadItems();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível adicionar o item");
    } finally {
      setIsAdding(false);
    }
  }

  function startChecking(item: ShoppingItemRow) {
    setCheckingId(item.id);
    setCheckAmount("");
    setCheckCategoryId("");
  }

  async function handleConfirmCheck(event: FormEvent, itemId: string) {
    event.preventDefault();
    setError(null);
    const parsedAmount = Number(checkAmount.replace(",", "."));
    if (!(parsedAmount > 0) || !checkAccountId) {
      setError("Informe o valor e a conta.");
      return;
    }

    setIsSubmittingCheck(true);
    try {
      await apiRequest(`/shopping/${itemId}/check`, {
        method: "PATCH",
        token,
        body: {
          isChecked: true,
          amount: parsedAmount,
          accountId: checkAccountId,
          categoryId: checkCategoryId || null,
        },
      });
      setCheckingId(null);
      showToast("Item comprado e lançado no extrato");
      await loadItems();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível marcar como comprado");
    } finally {
      setIsSubmittingCheck(false);
    }
  }

  async function handleUncheck(itemId: string) {
    try {
      await apiRequest(`/shopping/${itemId}/check`, { method: "PATCH", token, body: { isChecked: false } });
      await loadItems();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível desfazer");
    }
  }

  async function handleDelete(itemId: string) {
    const confirmed = window.confirm("Remover esse item da lista?");
    if (!confirmed) return;
    try {
      await apiRequest(`/shopping/${itemId}`, { method: "DELETE", token });
      if (checkingId === itemId) setCheckingId(null);
      await loadItems();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível remover o item");
    }
  }

  function memberName(userId: string | null) {
    if (!userId) return "";
    if (userId === user?.id) return "Você";
    return members.find((m) => m.id === userId)?.displayName ?? "Alguém do grupo";
  }

  const pendingItems = items?.filter((item) => !item.isChecked) ?? [];
  const checkedItems = items?.filter((item) => item.isChecked) ?? [];

  return (
    <AppLayout>
      <div className="page-stack">
        <div className="card form-card">
          <h1>Lista de compras</h1>
          <p className="card-subtitle">
            Uma lista só, compartilhada pelo grupo todo. Marcar um item como comprado já lança a
            despesa pra você.
          </p>
          <form onSubmit={handleAddItem} style={{ display: "flex", gap: "0.5rem" }}>
            <input
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder="Ex: Leite, detergente..."
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-primary" disabled={isAdding}>
              {isAdding ? "..." : "+ Item"}
            </button>
          </form>
          {error && (
            <p className="alert" role="alert" style={{ marginTop: "0.75rem" }}>
              {error}
            </p>
          )}
        </div>

        <div className="card">
          <p className="card-title" style={{ marginBottom: "0.75rem" }}>
            🛒 Pra comprar
          </p>
          {pendingItems.length === 0 ? (
            <p className="empty-state">Nada na lista por enquanto.</p>
          ) : (
            <ul className="transaction-list">
              {pendingItems.map((item) => (
                <li key={item.id} className="transaction-row" style={{ flexWrap: "wrap" }}>
                  <label className="checkbox-field" style={{ flex: 1, margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() => startChecking(item)}
                    />
                    {item.name}
                  </label>
                  <div className="transaction-row-actions">
                    <button type="button" className="btn-icon" title="Remover" onClick={() => handleDelete(item.id)}>
                      🗑
                    </button>
                  </div>

                  {checkingId === item.id && (
                    <form
                      onSubmit={(e) => handleConfirmCheck(e, item.id)}
                      style={{ width: "100%", display: "flex", flexDirection: "column", gap: "0.6rem", marginTop: "0.6rem" }}
                    >
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label htmlFor={`amount-${item.id}`}>Quanto custou (R$)</label>
                        <input
                          id={`amount-${item.id}`}
                          inputMode="decimal"
                          placeholder="0,00"
                          value={checkAmount}
                          onChange={(e) => setCheckAmount(e.target.value)}
                          required
                          autoFocus
                        />
                      </div>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label htmlFor={`account-${item.id}`}>Conta</label>
                        <select
                          id={`account-${item.id}`}
                          value={checkAccountId}
                          onChange={(e) => setCheckAccountId(e.target.value)}
                        >
                          {accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.type === "joint" ? "💞 " : "👤 "}
                              {account.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label htmlFor={`category-${item.id}`}>Categoria (opcional)</label>
                        <select
                          id={`category-${item.id}`}
                          value={checkCategoryId}
                          onChange={(e) => setCheckCategoryId(e.target.value)}
                        >
                          <option value="">Sem categoria</option>
                          {categories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.emoji ?? ""} {category.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <button type="submit" className="btn btn-primary" disabled={isSubmittingCheck}>
                          {isSubmittingCheck ? "Salvando..." : "Confirmar compra"}
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={() => setCheckingId(null)}>
                          Cancelar
                        </button>
                      </div>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {checkedItems.length > 0 && (
          <div className="card">
            <p className="card-title" style={{ marginBottom: "0.75rem" }}>
              ✓ Já comprados
            </p>
            <ul className="transaction-list">
              {checkedItems.map((item) => (
                <li key={item.id} className="transaction-row">
                  <div className="transaction-info">
                    <span className="transaction-desc" style={{ textDecoration: "line-through" }}>
                      {item.name}
                    </span>
                    <span className="transaction-meta">{memberName(item.checkedBy)}</span>
                  </div>
                  <div className="transaction-row-actions">
                    <button type="button" className="btn-icon" title="Desfazer" onClick={() => handleUncheck(item.id)}>
                      ↺
                    </button>
                    <button type="button" className="btn-icon" title="Remover" onClick={() => handleDelete(item.id)}>
                      🗑
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
