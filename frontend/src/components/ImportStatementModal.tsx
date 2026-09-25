import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatCurrency, parseLocalDate } from "../utils/format";
import { Icon } from "./Icon";
import { useToast } from "./ToastProvider";

interface PreviewRow {
  date: string;
  description: string;
  amount: string;
  transactionType: "expense" | "income";
  suggestedCategoryId: string | null;
  isDuplicate: boolean;
}

interface PreviewResponse {
  format: "ofx" | "csv";
  assumedAllExpenses: boolean;
  rows: PreviewRow[];
}

interface ReviewRow extends PreviewRow {
  selected: boolean;
  categoryId: string;
}

interface AccountRow {
  id: string;
  type: "personal" | "joint";
  name: string;
  emoji: string | null;
  ownerUserId: string | null;
}

interface CategoryRow {
  id: string;
  name: string;
  emoji: string | null;
}

// Two steps: pick a file -> review what was found -> save only what was
// ticked. Nothing is written until the second button, and rows that look
// like something already in the app start unticked.
export function ImportStatementModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { user, token } = useAuth();
  const { showToast } = useToast();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [accountId, setAccountId] = useState("");
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [assumedAllExpenses, setAssumedAllExpenses] = useState(false);
  const [fileName, setFileName] = useState("");
  const [isReading, setIsReading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([
      apiRequest<{ accounts: AccountRow[] }>("/groups/me", { token }),
      apiRequest<CategoryRow[]>("/categories", { token }),
    ])
      .then(([group, categoryRows]) => {
        setAccounts(group.accounts);
        setCategories(categoryRows);
        const mine = group.accounts.find((a) => a.type === "personal" && a.ownerUserId === user?.id);
        setAccountId((mine ?? group.accounts[0])?.id ?? "");
      })
      .catch(() => setError("Não foi possível carregar suas contas."));
  }, [token, user?.id]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function readFile(file: File) {
    setError(null);
    if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
      setError("PDF ainda não dá pra ler. No app do banco, exporte o extrato em OFX ou CSV.");
      return;
    }
    setIsReading(true);
    setFileName(file.name);
    try {
      const content = await file.text();
      const preview = await apiRequest<PreviewResponse>("/statements/preview", {
        method: "POST",
        token,
        body: { content },
      });
      setAssumedAllExpenses(preview.assumedAllExpenses);
      setRows(
        preview.rows.map((row) => ({
          ...row,
          selected: !row.isDuplicate,
          categoryId: row.suggestedCategoryId ?? "",
        }))
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível ler esse arquivo.");
    } finally {
      setIsReading(false);
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void readFile(file);
  }

  function updateRow(index: number, patch: Partial<ReviewRow>) {
    setRows((current) => current?.map((row, i) => (i === index ? { ...row, ...patch } : row)) ?? current);
  }

  function flipTypes() {
    setRows(
      (current) =>
        current?.map((row) => ({ ...row, transactionType: row.transactionType === "expense" ? "income" : "expense" })) ??
        current
    );
  }

  const selectedCount = useMemo(() => rows?.filter((row) => row.selected).length ?? 0, [rows]);
  const duplicateCount = useMemo(() => rows?.filter((row) => row.isDuplicate).length ?? 0, [rows]);

  async function handleSave() {
    if (!rows || selectedCount === 0 || !accountId) return;
    setIsSaving(true);
    setError(null);
    try {
      await apiRequest("/statements/commit", {
        method: "POST",
        token,
        body: {
          accountId,
          items: rows
            .filter((row) => row.selected)
            .map((row) => ({
              description: row.description,
              amount: Number(row.amount),
              transactionType: row.transactionType,
              occurredAt: row.date,
              categoryId: row.categoryId || null,
            })),
        },
      });
      showToast(`${selectedCount} lançamento${selectedCount === 1 ? "" : "s"} importado${selectedCount === 1 ? "" : "s"}`);
      onImported();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível importar.");
      setIsSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-panel import-panel" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="import-head">
          <h1 id="import-title">Importar extrato</h1>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Fechar">
            <Icon name="x" />
          </button>
        </div>

        {!rows && (
          <>
            <p className="card-subtitle">Traga o extrato do seu banco. O PAR. lê, mostra o que achou e só salva o que você confirmar.</p>
            <div
              className={`import-drop${isDragging ? " dragging" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
            >
              <span className="import-drop-icon">
                <Icon name="upload" />
              </span>
              <strong>{isReading ? `Lendo ${fileName}...` : "Solte o arquivo aqui"}</strong>
              <small>OFX ou CSV, exportado no app ou no site do banco</small>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => inputRef.current?.click()} disabled={isReading}>
                Escolher arquivo
              </button>
              <input
                ref={inputRef}
                id="import-file"
                type="file"
                accept=".ofx,.qfx,.csv,.txt,.pdf,text/csv,application/pdf"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void readFile(file);
                  event.target.value = "";
                }}
              />
            </div>
            <div className="import-connect">
              <span className="import-connect-icon">
                <Icon name="bank" />
              </span>
              <div>
                <strong>Conectar conta</strong>
                <small>Os lançamentos entram sozinhos, sem baixar nada (Open Finance).</small>
              </div>
              <span className="pill-soon">Em breve</span>
            </div>
          </>
        )}

        {rows && (
          <>
            <div className="import-toolbar">
              <label className="import-account" htmlFor="import-account">
                Salvar em
                <select id="import-account" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      
                      {account.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="link-button" onClick={flipTypes}>
                Inverter entradas e saídas
              </button>
            </div>
            {assumedAllExpenses && (
              <p className="import-note">
                Todos os valores vieram positivos, então tratei tudo como saída. Se o seu banco lista as entradas assim, use
                “Inverter”.
              </p>
            )}
            <p className="import-summary">
              <strong>{rows.length}</strong> lançamentos em {fileName}
              {duplicateCount > 0 && <> · {duplicateCount} parecem já existir (desmarcados)</>}
            </p>
            <ul className="import-list">
              {rows.map((row, index) => (
                <li key={`${row.date}-${row.description}-${index}`} className={`import-row${row.selected ? "" : " off"}`}>
                  <input
                    type="checkbox"
                    id={`import-row-${index}`}
                    checked={row.selected}
                    onChange={(event) => updateRow(index, { selected: event.target.checked })}
                    aria-label={`Importar ${row.description}`}
                  />
                  <label htmlFor={`import-row-${index}`} className="import-row-info">
                    <span className="import-row-desc">{row.description}</span>
                    <span className="import-row-meta">
                      {parseLocalDate(row.date).toLocaleDateString("pt-BR")}
                      {row.isDuplicate && <span className="badge">já existe?</span>}
                    </span>
                  </label>
                  <select
                    className="import-row-category"
                    value={row.categoryId}
                    onChange={(event) => updateRow(index, { categoryId: event.target.value })}
                    aria-label={`Categoria de ${row.description}`}
                  >
                    <option value="">Sem categoria</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        
                        {category.name}
                      </option>
                    ))}
                  </select>
                  <span className={`transaction-amount ${row.transactionType}`}>
                    {row.transactionType === "income" ? "+" : "-"}
                    {formatCurrency(Number(row.amount))}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        {rows && (
          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={() => setRows(null)} disabled={isSaving}>
              Trocar arquivo
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={isSaving || selectedCount === 0}>
              {isSaving ? "Importando..." : `Importar ${selectedCount}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
