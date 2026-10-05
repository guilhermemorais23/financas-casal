import { useEffect, useMemo, useState } from "react";
import { ApiError, apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatCurrency } from "../utils/format";
import { Sheet } from "./Sheet";
import { useToast } from "./ToastProvider";

interface UncategorizedGroup {
  key: string;
  label: string;
  count: number;
  total: string;
  transactionIds: string[];
  suggestedCategoryId: string | null;
}

interface CategoryRow {
  id: string;
  name: string;
  emoji: string | null;
}

// "Sem categoria": um nome por linha (todos os lançamentos com esse nome de
// uma vez), escolhe a categoria e salva. Marcado "lembrar", a próxima
// importação já traz esse nome categorizado.
export function UncategorizedModal({ month, onClose, onSaved }: { month: string; onClose: () => void; onSaved: () => void }) {
  const { token } = useAuth();
  const { showToast } = useToast();
  const [groups, setGroups] = useState<UncategorizedGroup[] | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Criar categoria na hora (grupo novo ainda não tem nenhuma).
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  async function createCategory(groupKey: string) {
    const name = newName.trim();
    if (!name) return;
    try {
      const created = await apiRequest<CategoryRow>("/categories", { method: "POST", token, body: { name } });
      setCategories((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
      setChoice((prev) => ({ ...prev, [groupKey]: created.id }));
      setCreatingFor(null);
      setNewName("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não deu pra criar a categoria.");
    }
  }

  useEffect(() => {
    Promise.all([
      apiRequest<{ groups: UncategorizedGroup[] }>(`/transactions/uncategorized?month=${month}`, { token }),
      apiRequest<CategoryRow[]>("/categories", { token }),
    ])
      .then(([list, cats]) => {
        setGroups(list.groups);
        setCategories(cats);
        setChoice(Object.fromEntries(list.groups.filter((g) => g.suggestedCategoryId).map((g) => [g.key, g.suggestedCategoryId!])));
      })
      .catch(() => setError("Não deu pra carregar os lançamentos."));
  }, [month, token]);

  const chosen = useMemo(() => (groups ?? []).filter((g) => choice[g.key]), [groups, choice]);

  async function save() {
    setIsSaving(true);
    setError(null);
    let updated = 0;
    try {
      for (const group of chosen) {
        const res = await apiRequest<{ updated: number }>("/transactions/categorize", {
          method: "POST",
          token,
          body: { transactionIds: group.transactionIds, categoryId: choice[group.key], remember, label: group.label },
        });
        updated += res.updated;
      }
      showToast(`${updated} ${updated === 1 ? "lançamento categorizado" : "lançamentos categorizados"}`, {
        description: remember ? "Na próxima importação, esses nomes já vêm com a categoria." : undefined,
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
    <Sheet onClose={onClose} className="uncat-sheet" labelledBy="uncat-title">
      <h1 id="uncat-title">Gastos sem categoria</h1>
      <p className="card-subtitle">
        Sem categoria, o gasto fica de fora dos relatórios por categoria e do orçamento. Escolha uma vez por nome: vale pra todos os lançamentos com ele.
      </p>

      {!groups && !error && <p className="field-hint">Carregando...</p>}
      {groups && groups.length === 0 && <p className="field-hint">Tudo categorizado neste mês.</p>}

      {groups && groups.length > 0 && (
        <ul className="uncat-list">
          {groups.map((group) => (
            <li key={group.key} className="uncat-row">
              <div className="uncat-row-text">
                <strong>{group.label}</strong>
                <small>
                  {group.count} {group.count === 1 ? "lançamento" : "lançamentos"} · {formatCurrency(Number(group.total))}
                </small>
              </div>
              <select
                aria-label={`Categoria de ${group.label}`}
                value={choice[group.key] ?? ""}
                onChange={(e) => {
                  if (e.target.value === "__new") {
                    setCreatingFor(group.key);
                    setNewName("");
                    return;
                  }
                  setChoice((prev) => ({ ...prev, [group.key]: e.target.value }));
                }}
              >
                <option value="">Escolher...</option>
                <option value="__new">+ Criar categoria</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.emoji ? `${category.emoji} ` : ""}
                    {category.name}
                  </option>
                ))}
              </select>
              {creatingFor === group.key && (
                <div className="uncat-new">
                  <input
                    autoFocus
                    value={newName}
                    maxLength={40}
                    placeholder="Nome da categoria (ex.: Mercado)"
                    aria-label="Nome da nova categoria"
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void createCategory(group.key);
                      }
                    }}
                  />
                  <button type="button" className="btn btn-primary btn-sm" disabled={!newName.trim()} onClick={() => void createCategory(group.key)}>
                    Criar
                  </button>
                  <button type="button" className="link-button" onClick={() => setCreatingFor(null)}>
                    Cancelar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {groups && groups.length > 0 && (
        <label className="uncat-remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Lembrar na próxima importação do extrato
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
