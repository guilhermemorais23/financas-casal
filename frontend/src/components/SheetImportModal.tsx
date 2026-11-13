// Importar a planilha antiga (Excel ou CSV) pra Planilha do PAR.
//
// 1. A pessoa escolhe o arquivo (e a aba, se tiver mais de uma).
// 2. utils/sheetImport.ts acha a linha dos meses, os grupos (Casa) e as
//    linhas (Hipoteca), e pula total/saldo.
// 3. Prévia: dá pra desmarcar linha, trocar gasto/receita e escolher conta e
//    ano. Cada valor vira um lançamento no dia 1 do mês, marcado #planilha.
// 4. Depois de importar, o aviso tem "Desfazer" (apaga tudo que entrou).
import { useEffect, useMemo, useState } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatCurrency } from "../utils/format";
import { parseCsvGrid, parseSheetGrid, type CellValue, type SheetImportRow } from "../utils/sheetImport";
import { Sheet } from "./Sheet";
import { useToast } from "./ToastProvider";

interface AccountRow {
  id: string;
  type: "personal" | "joint";
  name: string;
  ownerUserId: string | null;
}

interface PreviewRow extends SheetImportRow {
  include: boolean;
}

export function SheetImportModal({
  defaultYear,
  onClose,
  onImported,
  onUndone,
}: {
  defaultYear: number;
  onClose: () => void;
  onImported: (year: number) => void;
  onUndone: () => void;
}) {
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [accountId, setAccountId] = useState("");
  const [year, setYear] = useState(String(defaultYear));
  const [tabs, setTabs] = useState<{ sheet: string; data: CellValue[][] }[]>([]);
  const [tabIndex, setTabIndex] = useState(0);
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    apiRequest<{ accounts: AccountRow[] }>("/groups/me", { token })
      .then((group) => {
        const usable = group.accounts.filter((account) => account.type === "joint" || account.ownerUserId === user?.id);
        setAccounts(usable);
        const mine = usable.find((account) => account.type === "personal") ?? usable[0];
        if (mine) setAccountId(mine.id);
      })
      .catch(() => setError("Não deu pra carregar as contas."));
  }, [token, user?.id]);

  function readTab(data: CellValue[][]) {
    const parsed = parseSheetGrid(data);
    if (parsed.monthsFound < 3) {
      setRows(null);
      setError("Não achei a linha com os meses (Jan, Fev, Mar...). Confira se é essa a aba da planilha.");
      return;
    }
    setError(null);
    if (parsed.year) setYear(String(parsed.year));
    setRows(parsed.rows.map((row) => ({ ...row, include: true })));
  }

  async function handleFile(file: File) {
    setIsReading(true);
    setError(null);
    setRows(null);
    try {
      if (/\.csv$/i.test(file.name)) {
        const grid = parseCsvGrid(await file.text());
        setTabs([{ sheet: file.name, data: grid }]);
        setTabIndex(0);
        readTab(grid);
      } else {
        const { default: readXlsxFile } = await import("read-excel-file/browser");
        const sheets = (await readXlsxFile(file)) as { sheet: string; data: CellValue[][] }[];
        setTabs(sheets);
        // Começa pela primeira aba que tenha meses.
        const first = Math.max(0, sheets.findIndex((sheet) => parseSheetGrid(sheet.data).monthsFound >= 3));
        setTabIndex(first);
        readTab(sheets[first]?.data ?? []);
      }
    } catch {
      setError("Não consegui abrir esse arquivo. Use .xlsx (Excel) ou .csv.");
    } finally {
      setIsReading(false);
    }
  }

  const chosen = useMemo(() => (rows ?? []).filter((row) => row.include), [rows]);
  const count = chosen.reduce((sum, row) => sum + row.months.filter((value) => value).length, 0);
  const total = (type: "expense" | "income") =>
    chosen.filter((row) => row.transactionType === type).reduce((sum, row) => sum + row.months.reduce<number>((a, b) => a + (b ?? 0), 0), 0);

  function update(index: number, patch: Partial<PreviewRow>) {
    setRows((current) => current && current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function handleImport() {
    const parsedYear = Number(year);
    if (!Number.isInteger(parsedYear) || parsedYear < 2000 || parsedYear > 2100) return setError("Ano inválido.");
    if (!accountId) return setError("Escolha a conta.");
    if (chosen.length === 0) return setError("Marque ao menos uma linha.");
    setIsSaving(true);
    setError(null);
    try {
      const result = await apiRequest<{ importId: string; created: number; categoriesCreated: number }>("/sheet/import", {
        method: "POST",
        token,
        body: {
          year: parsedYear,
          accountId,
          rows: chosen.map(({ group, name, transactionType, months }) => ({ group, name, transactionType, months })),
        },
      });
      showToast(`${result.created} lançamentos importados`, {
        description: result.categoriesCreated > 0 ? `${result.categoriesCreated} categorias novas criadas.` : undefined,
        actionLabel: "Desfazer",
        durationMs: 12000,
        onAction: () => {
          apiRequest(`/sheet/import/${result.importId}`, { method: "DELETE", token })
            .then(() => {
              showToast("Importação desfeita");
              onUndone();
            })
            .catch(() => showToast("Não deu pra desfazer", { variant: "error" }));
        },
      });
      onImported(parsedYear);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não deu pra importar.");
      setIsSaving(false);
    }
  }

  return (
    <Sheet onClose={onClose} className="sheet-import">
      <h1>Importar planilha</h1>
      <p className="card-subtitle">
        A planilha com os meses lado a lado (Jan, Fev, Mar...). Linha sem valores vira grupo (ex.: Casa), e as de baixo viram
        subcategorias (Hipoteca, Água). Linhas de total e saldo ficam de fora.
      </p>

      <div className="field">
        <label htmlFor="sheet-file">Arquivo (.xlsx ou .csv)</label>
        <input
          id="sheet-file"
          type="file"
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
      </div>
      {isReading && <p className="card-subtitle">Lendo a planilha…</p>}

      {tabs.length > 1 && (
        <div className="field">
          <label htmlFor="sheet-tab">Aba</label>
          <select
            id="sheet-tab"
            value={tabIndex}
            onChange={(e) => {
              const index = Number(e.target.value);
              setTabIndex(index);
              readTab(tabs[index].data);
            }}
          >
            {tabs.map((tab, index) => (
              <option key={tab.sheet + index} value={index}>
                {tab.sheet}
              </option>
            ))}
          </select>
        </div>
      )}

      {rows && (
        <>
          <div className="field-row">
            <div className="field">
              <label htmlFor="sheet-year">Ano</label>
              <input id="sheet-year" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="sheet-account">Em qual conta</label>
              <select id="sheet-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="card-subtitle">
            {count} lançamentos · gastos {formatCurrency(total("expense"))} · receitas {formatCurrency(total("income"))}
          </p>
          <ul className="sheet-import-rows">
            {rows.map((row, index) => (
              <li key={index} className={row.include ? undefined : "is-off"}>
                <label className="checkbox-field">
                  <input type="checkbox" checked={row.include} onChange={(e) => update(index, { include: e.target.checked })} />
                  <span>
                    {row.group ? <small>{row.group} › </small> : null}
                    {row.name}
                  </span>
                </label>
                <select
                  aria-label={`${row.name}: gasto ou receita`}
                  value={row.transactionType}
                  onChange={(e) => update(index, { transactionType: e.target.value as "expense" | "income" })}
                >
                  <option value="expense">Gasto</option>
                  <option value="income">Receita</option>
                </select>
                <strong>{formatCurrency(row.months.reduce<number>((a, b) => a + (b ?? 0), 0))}</strong>
              </li>
            ))}
          </ul>
        </>
      )}

      {error && <p className="form-error">{error}</p>}
      <div className="sheet-import-footer">
        <button type="button" className="btn btn-outline" onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className="btn btn-primary" disabled={!rows || isSaving || chosen.length === 0} onClick={handleImport}>
          {isSaving ? "Importando…" : `Importar ${count} lançamentos`}
        </button>
      </div>
    </Sheet>
  );
}
