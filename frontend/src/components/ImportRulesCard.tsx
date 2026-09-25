import { useEffect, useState } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "./Icon";
import { useToast } from "./ToastProvider";

interface ImportRule {
  key: string;
  label: string;
  categoryId: string | null;
  notExpense: boolean;
}

interface CategoryOption {
  id: string;
  name: string;
}

const NOT_EXPENSE = "__not_expense__";

// "Nome do extrato -> categoria": as respostas das importações. Aqui dá pra
// trocar a categoria de um nome ou esquecer a resposta (aí o PAR. pergunta de
// novo na próxima importação). Some quando ainda não tem nenhuma.
export function ImportRulesCard({ categories, reloadKey }: { categories: CategoryOption[]; reloadKey: number }) {
  const { token } = useAuth();
  const { showToast } = useToast();
  const [rules, setRules] = useState<ImportRule[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    apiRequest<{ rules: ImportRule[] }>("/statements/rules", { token })
      .then((res) => setRules(res.rules))
      .catch(() => setRules([]));
  }, [token, reloadKey]);

  async function change(rule: ImportRule, value: string) {
    setBusyKey(rule.key);
    const notExpense = value === NOT_EXPENSE;
    const categoryId = notExpense ? null : value;
    try {
      await apiRequest("/statements/rules", {
        method: "PUT",
        token,
        body: { key: rule.key, label: rule.label, categoryId, notExpense },
      });
      setRules((list) => list?.map((r) => (r.key === rule.key ? { ...r, categoryId, notExpense } : r)) ?? list);
      showToast("Resposta atualizada");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Não foi possível salvar", { variant: "error" });
    } finally {
      setBusyKey(null);
    }
  }

  async function forget(rule: ImportRule) {
    setBusyKey(rule.key);
    try {
      await apiRequest(`/statements/rules/${encodeURIComponent(rule.key)}`, { method: "DELETE", token });
      setRules((list) => list?.filter((r) => r.key !== rule.key) ?? list);
      showToast("O PAR. vai perguntar esse nome de novo");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Não foi possível apagar", { variant: "error" });
    } finally {
      setBusyKey(null);
    }
  }

  if (!rules || rules.length === 0) return null;
  const visible = showAll ? rules : rules.slice(0, 8);

  return (
    <div className="card">
      <p className="card-title">Nomes do extrato</p>
      <p className="card-subtitle">
        O que você respondeu nas importações. Esses nomes já chegam com categoria; apague um pra ser perguntado de novo.
      </p>
      <ul className="rules-list">
        {visible.map((rule) => (
          <li key={rule.key}>
            <span className="rules-list-name" title={rule.label}>
              {rule.label}
            </span>
            <select
              value={rule.notExpense ? NOT_EXPENSE : (rule.categoryId ?? "")}
              disabled={busyKey === rule.key}
              onChange={(event) => void change(rule, event.target.value)}
              aria-label={`Categoria de ${rule.label}`}
            >
              {!rule.notExpense && !categories.some((c) => c.id === rule.categoryId) && (
                <option value="">Categoria apagada</option>
              )}
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
              <option value={NOT_EXPENSE}>Não é gasto (não entra)</option>
            </select>
            <button
              type="button"
              className="btn-icon"
              title="Esquecer resposta"
              disabled={busyKey === rule.key}
              onClick={() => void forget(rule)}
            >
              <Icon name="trash" />
            </button>
          </li>
        ))}
      </ul>
      {rules.length > 8 && (
        <button type="button" className="link-button" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Mostrar menos" : `Ver todos (${rules.length})`}
        </button>
      )}
    </div>
  );
}
