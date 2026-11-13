// ============================================================================
// PLANILHA (função opcional, ligada em Conta e grupo > Funções do app)
// ============================================================================
// Pra quem vinha de planilha: no topo, quanto tem na conta, quanto emprestou
// e ainda vai receber, e quanto vai ter depois de receber. Embaixo, o ano
// com os meses lado a lado -- cada categoria abre nas suas subcategorias
// (Casa › Hipoteca, Água, Luz), receitas, e quanto sobrou em cada mês.
// Tocar num valor mostra os lançamentos de dentro; as marcações (#remédio)
// somam o ano atravessando as categorias.
// Os números vêm de /api/sheet (backend/src/modules/sheet).
// ============================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "../components/Icon";
import { SheetImportModal } from "../components/SheetImportModal";
import { AppLayout } from "../layouts/AppLayout";
import { formatCurrency } from "../utils/format";

interface SheetCategory {
  id: string;
  name: string;
  type?: "expense" | "income";
  parentId?: string | null;
}

interface SheetRow {
  categoryId: string | null;
  transactionType: "expense" | "income";
  months: string[];
  total: string;
}

interface SheetResponse {
  year: number;
  categories: SheetCategory[];
  rows: SheetRow[];
  tags: { tag: string; count: number; total: string }[];
}

interface SheetEntry {
  id: string;
  date: string;
  description: string;
  amount: string;
  transactionType: "expense" | "income";
  categoryId: string | null;
  tags: string[];
}

interface LoansResponse {
  summary: { outstanding: string };
  moneyToday?: number;
}

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const NONE = "none";

// Uma linha da tabela: grupo (categoria de cima, soma das filhas) ou filha.
interface Line {
  key: string;
  label: string;
  kind: "group" | "child";
  // Pra abrir o detalhe: a categoria de verdade daquela linha (null no grupo
  // que só soma as filhas).
  cellCategory: string | null;
  values: number[];
  groupKey: string;
}

function buildLines(sheet: SheetResponse, type: "expense" | "income"): Line[] {
  const byId = new Map(sheet.categories.map((category) => [category.id, category]));
  const values = new Map<string, number[]>();
  for (const row of sheet.rows) {
    if (row.transactionType !== type) continue;
    values.set(row.categoryId ?? NONE, row.months.map(Number));
  }
  const zero = () => Array(12).fill(0) as number[];
  const add = (a: number[], b: number[]) => a.map((value, i) => value + b[i]);
  const topOf = (id: string) => {
    const category = byId.get(id);
    return category?.parentId && byId.has(category.parentId) ? category.parentId : id;
  };

  // Categorias de cima que têm algum valor (nelas ou nas filhas) no ano.
  const tops = new Set<string>();
  for (const id of values.keys()) if (id !== NONE) tops.add(topOf(id));
  const lines: Line[] = [];
  const sortedTops = [...tops].sort((a, b) => (byId.get(a)?.name ?? "").localeCompare(byId.get(b)?.name ?? "", "pt-BR"));
  for (const top of sortedTops) {
    const children = sheet.categories
      .filter((category) => category.parentId === top)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    const own = values.get(top);
    const childLines: Line[] = children.map((child) => ({
      key: child.id,
      label: child.name,
      kind: "child",
      cellCategory: child.id,
      values: values.get(child.id) ?? zero(),
      groupKey: top,
    }));
    // O que foi lançado direto em "Casa" (sem subcategoria) vira a linha "Outros em Casa".
    if (own && children.length > 0) {
      childLines.push({ key: `${top}:own`, label: `Outros em ${byId.get(top)?.name ?? ""}`, kind: "child", cellCategory: top, values: own, groupKey: top });
    }
    const total = childLines.reduce((sum, line) => add(sum, line.values), own && children.length === 0 ? own : zero());
    lines.push({
      key: top,
      label: byId.get(top)?.name ?? "Categoria apagada",
      kind: "group",
      cellCategory: children.length === 0 ? top : null,
      values: total,
      groupKey: top,
    });
    lines.push(...childLines.filter((line) => line.values.some((value) => value !== 0) || children.length <= 8));
  }
  const none = values.get(NONE);
  if (none) lines.push({ key: NONE, label: "Sem categoria", kind: "group", cellCategory: NONE, values: none, groupKey: NONE });
  return lines;
}

const sumColumns = (lines: Line[]) =>
  lines.filter((line) => line.kind === "group").reduce((sum, line) => sum.map((value, i) => value + line.values[i]), Array(12).fill(0) as number[]);

export function SheetPage() {
  const { token } = useAuth();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [sheet, setSheet] = useState<SheetResponse | null>(null);
  const [loans, setLoans] = useState<LoansResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [detail, setDetail] = useState<{ title: string; entries: SheetEntry[] | null } | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    apiRequest<SheetResponse>(`/sheet?year=${year}`, { token })
      .then((data) => alive && setSheet(data))
      .catch((err) => alive && setError(err instanceof ApiError ? err.message : "Não deu pra carregar a planilha."));
    return () => {
      alive = false;
    };
  }, [token, year, reloadKey]);

  useEffect(() => {
    apiRequest<LoansResponse>("/loans", { token })
      .then(setLoans)
      .catch(() => setLoans(null));
  }, [token, reloadKey]);

  const expenseLines = useMemo(() => (sheet ? buildLines(sheet, "expense") : []), [sheet]);
  const incomeLines = useMemo(() => (sheet ? buildLines(sheet, "income") : []), [sheet]);
  const expenseTotal = sumColumns(expenseLines);
  const incomeTotal = sumColumns(incomeLines);
  const left = incomeTotal.map((value, i) => value - expenseTotal[i]);
  const nowMonth = year === thisYear ? new Date().getMonth() : -1;
  // No celular a tabela rola pros lados: já abre mostrando o mês atual.
  useEffect(() => {
    const box = scrollRef.current;
    const now = box?.querySelector<HTMLElement>("thead .is-now");
    if (box && now && now.offsetLeft + now.offsetWidth > box.clientWidth) {
      box.scrollLeft = now.offsetLeft - box.clientWidth / 2;
    }
  }, [sheet]);

  const categoryName = (id: string) => sheet?.categories.find((category) => category.id === id)?.name ?? "";

  const bank = loans?.moneyToday ?? null;
  const lent = Number(loans?.summary.outstanding ?? 0);

  async function openDetail(title: string, query: string) {
    setDetail({ title, entries: null });
    try {
      const entries = await apiRequest<SheetEntry[]>(`/sheet/entries?year=${year}&${query}`, { token });
      setDetail({ title, entries });
    } catch {
      setDetail({ title, entries: [] });
    }
  }

  function openCell(line: Line, month: number) {
    if (line.values[month] === 0) return;
    if (line.cellCategory) {
      const name = line.kind === "child" ? `${categoryName(line.groupKey)} › ${line.label}` : line.label;
      void openDetail(`${name} · ${MONTHS[month]}`, `month=${month + 1}&categoryId=${encodeURIComponent(line.cellCategory)}`);
    } else {
      // Grupo com filhas: abre o grupo pra mostrar de onde vem.
      setClosed((current) => ({ ...current, [line.groupKey]: false }));
    }
  }

  function renderLines(lines: Line[]) {
    return lines
      .filter((line) => line.kind === "group" || !closed[line.groupKey])
      .map((line) => {
        const hasChildren = line.kind === "group" && lines.some((other) => other.kind === "child" && other.groupKey === line.key);
        return (
          <tr key={line.key} className={line.kind === "group" ? "sheet-group" : "sheet-child"}>
            <th scope="row">
              {hasChildren ? (
                <button
                  type="button"
                  className="sheet-toggle"
                  aria-expanded={!closed[line.key]}
                  onClick={() => setClosed((current) => ({ ...current, [line.key]: !current[line.key] }))}
                >
                  <Icon name="chevron" />
                  {line.label}
                </button>
              ) : (
                line.label
              )}
            </th>
            {line.values.map((value, month) => (
              <td key={month} className={month === nowMonth ? "is-now" : undefined}>
                {value === 0 ? (
                  <span className="sheet-empty">–</span>
                ) : (
                  <button type="button" className="sheet-cell" onClick={() => openCell(line, month)}>
                    {formatCurrency(value)}
                  </button>
                )}
              </td>
            ))}
            <td className="sheet-total">{formatCurrency(line.values.reduce((sum, value) => sum + value, 0))}</td>
          </tr>
        );
      });
  }

  const totalRow = (label: string, values: number[], className: string, signed = false) => (
    <tr className={className}>
      <th scope="row">{label}</th>
      {values.map((value, month) => (
        <td key={month} className={`${month === nowMonth ? "is-now" : ""} ${signed && value !== 0 ? (value > 0 ? "is-pos" : "is-neg") : ""}`}>
          {value === 0 ? <span className="sheet-empty">–</span> : formatCurrency(value)}
        </td>
      ))}
      <td className={`sheet-total ${signed ? (values.reduce((a, b) => a + b, 0) >= 0 ? "is-pos" : "is-neg") : ""}`}>
        {formatCurrency(values.reduce((a, b) => a + b, 0))}
      </td>
    </tr>
  );

  const isEmpty = sheet !== null && sheet.rows.length === 0;

  return (
    <AppLayout wide>
      <div className="page-stack sheet-page">
        <div className="page-title-row">
          <h1>Planilha</h1>
          <div className="sheet-actions">
            <div className="sheet-year" role="group" aria-label="Ano">
              <button type="button" className="btn-icon" aria-label="Ano anterior" onClick={() => setYear((y) => y - 1)}>
                ‹
              </button>
              <strong>{year}</strong>
              <button type="button" className="btn-icon" aria-label="Próximo ano" onClick={() => setYear((y) => y + 1)} disabled={year >= thisYear + 1}>
                ›
              </button>
            </div>
            <button type="button" className="btn btn-outline btn-compact" onClick={() => setIsImportOpen(true)}>
              <Icon name="upload" />
              Importar planilha
            </button>
          </div>
        </div>

        <section className="painel-band sheet-band" aria-label="Quanto você tem">
          <div className="sheet-trio">
            <div>
              <span className="painel-band-kpi-label">Na conta hoje</span>
              <strong className="sheet-trio-value">{bank === null ? "…" : formatCurrency(bank)}</strong>
              <span className="painel-band-kpi-sub">Contas e guardado em cartões.</span>
            </div>
            <div>
              <span className="painel-band-kpi-label">Emprestado, a receber</span>
              <strong className="sheet-trio-value sheet-trio-lent">{formatCurrency(lent)}</strong>
              <span className="painel-band-kpi-sub">
                <Link to="/loans">Ver empréstimos</Link>
              </span>
            </div>
            <div>
              <span className="painel-band-kpi-label">Depois de receber tudo</span>
              <strong className="sheet-trio-value">{bank === null ? "…" : formatCurrency(bank + lent)}</strong>
              <span className="painel-band-kpi-sub">Conta + o que voltar dos empréstimos.</span>
            </div>
          </div>
        </section>

        {error && <p className="form-error">{error}</p>}

        {isEmpty && (
          <div className="card">
            <p className="card-title">Nada lançado em {year}</p>
            <p className="card-subtitle">
              Lance gastos e receitas como sempre, ou traga a planilha que você já usa em <strong>Importar planilha</strong>. Os meses
              aparecem aqui lado a lado.
            </p>
          </div>
        )}

        {sheet && !isEmpty && (
          <section className="card sheet-card" aria-label={`Planilha de ${year}`}>
            <p className="card-subtitle">Toque num valor pra ver os lançamentos de dentro. Toque no nome da categoria pra abrir ou fechar.</p>
            <div className="sheet-scroll" ref={scrollRef}>
              <table className="sheet-table">
                <thead>
                  <tr>
                    <th scope="col">Categoria</th>
                    {MONTHS.map((month, i) => (
                      <th key={month} scope="col" className={i === nowMonth ? "is-now" : undefined}>
                        {month}
                      </th>
                    ))}
                    <th scope="col">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {renderLines(expenseLines)}
                  {totalRow("Total de gastos", expenseTotal, "sheet-sum")}
                  {incomeLines.length > 0 && (
                    <tr className="sheet-section">
                      <th scope="row" colSpan={14}>
                        <span>Receitas</span>
                      </th>
                    </tr>
                  )}
                  {renderLines(incomeLines)}
                  {totalRow("Total de receitas", incomeTotal, "sheet-sum")}
                  {totalRow("Sobrou no mês", left, "sheet-result", true)}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {detail && (
          <section className="card" aria-label="Lançamentos">
            <div className="section-header">
              <p className="card-title">{detail.title}</p>
              <button type="button" className="link-button" onClick={() => setDetail(null)}>
                Fechar
              </button>
            </div>
            {detail.entries === null ? (
              <p className="card-subtitle">Carregando…</p>
            ) : detail.entries.length === 0 ? (
              <p className="card-subtitle">Nenhum lançamento aqui.</p>
            ) : (
              <ul className="sheet-entries">
                {detail.entries.map((entry) => (
                  <li key={entry.id}>
                    <span className="sheet-entry-text">
                      <strong>{entry.description}</strong>
                      <small>
                        {entry.date.split("-").reverse().join("/")}
                        {entry.categoryId && entry.categoryId !== NONE ? ` · ${categoryName(entry.categoryId)}` : ""}
                      </small>
                      {entry.tags.length > 0 && (
                        <span className="sheet-tags">
                          {entry.tags.map((tag) => (
                            <span key={tag} className="sheet-tag">
                              #{tag}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                    <strong className={entry.transactionType === "income" ? "income-text" : undefined}>
                      {entry.transactionType === "income" ? "+" : ""}
                      {formatCurrency(Number(entry.amount))}
                    </strong>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {sheet && sheet.tags.length > 0 && (
          <section className="card" aria-label="Marcações">
            <p className="card-title">Marcações em {year}</p>
            <p className="card-subtitle">Atravessam as categorias: #família junta mercado, viagem e o que mais tiver.</p>
            <ul className="sheet-tag-list">
              {sheet.tags.map((tag) => (
                <li key={tag.tag}>
                  <button type="button" className="sheet-tag is-button" onClick={() => void openDetail(`#${tag.tag} em ${year}`, `tag=${encodeURIComponent(tag.tag)}`)}>
                    #{tag.tag}
                  </button>
                  <small>
                    {tag.count} {tag.count === 1 ? "lançamento" : "lançamentos"}
                  </small>
                  <strong>{formatCurrency(Number(tag.total))}</strong>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {isImportOpen && (
        <SheetImportModal
          defaultYear={year}
          onClose={() => setIsImportOpen(false)}
          onImported={(importedYear) => {
            setIsImportOpen(false);
            setYear(importedYear);
            setReloadKey((key) => key + 1);
          }}
          onUndone={() => setReloadKey((key) => key + 1)}
        />
      )}
    </AppLayout>
  );
}
