import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatCurrency, parseLocalDate } from "../utils/format";
import { Icon } from "./Icon";
import { PasswordInput } from "./PasswordInput";
import { useToast } from "./ToastProvider";
import { Sheet } from "./Sheet";

type TxType = "expense" | "income";

interface PreviewRow {
  date: string;
  description: string;
  amount: string;
  transactionType: TxType;
  suggestedCategoryId: string | null;
  isDuplicate: boolean;
  groupKey: string;
}

interface PreviewGroup {
  key: string;
  name: string;
  transactionType: TxType;
  count: number;
  total: string;
  rowIndexes: number[];
  rule: { categoryId: string | null; notExpense: boolean } | null;
}

interface PdfCheck {
  reconciled: boolean | null;
  difference: string;
  openingBalance: string | null;
  closingBalance: string | null;
  readBy: "ai" | "text";
  unreadLines?: string[];
}

interface PreviewResponse {
  format: "ofx" | "csv" | "pdf";
  assumedAllExpenses: boolean;
  rows: PreviewRow[];
  groups: PreviewGroup[];
  pdf: PdfCheck | null;
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

// A resposta de uma pergunta (um nome do extrato).
interface Answer {
  status: "open" | "answered" | "skipped";
  fromRule: boolean;
  categoryId: string | null;
  notExpense: boolean;
  descMode: "all" | "each";
  description: string;
  descriptions: Record<number, string>;
}

type Stage = "file" | "questions" | "summary";

const INCOME_HINT = /sal[aá]r|renda|receb|freel|reembol|venda|rendiment|b[oô]nus|comiss|extra/i;

function blankAnswer(group: PreviewGroup): Answer {
  return {
    status: group.rule ? "answered" : "open",
    fromRule: !!group.rule,
    categoryId: group.rule?.categoryId ?? null,
    notExpense: group.rule?.notExpense ?? false,
    descMode: "all",
    description: "",
    descriptions: {},
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Primeira importação, em quatro telas:
//   1. arquivo (OFX, CSV ou o PDF do banco, com senha se tiver) e a conta;
//   2. leitura: o PAR. copia as linhas e confere com o saldo do extrato;
//   3. uma pergunta por nome ("PAO DE ACUCAR 1204" -> Mercado), do maior
//      valor pro menor; nomes já respondidos antes não são perguntados;
//   4. resumo do que entrou/saiu e do que fica guardado pra próxima vez.
// Nada é salvo antes do botão final.
export function ImportStatementModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { user, token } = useAuth();
  const { showToast } = useToast();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [accountId, setAccountId] = useState("");
  const [stage, setStage] = useState<Stage>("file");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [returnToSummary, setReturnToSummary] = useState(false);
  const [showDescription, setShowDescription] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState<string | null>(null);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [fileName, setFileName] = useState("");
  const [pendingPdf, setPendingPdf] = useState<File | null>(null);
  const [password, setPassword] = useState("");
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

  const groupKey = (group: PreviewGroup) => `${group.transactionType}:${group.key}`;

  // Perguntas = nomes que o PAR. ainda não conhece (os de regra já chegam
  // respondidos, mas podem ser mudados no resumo).
  const questions = useMemo(() => preview?.groups.filter((group) => !group.rule) ?? [], [preview]);

  function startReview(result: PreviewResponse) {
    setPreview(result);
    const initial: Record<string, Answer> = {};
    for (const group of result.groups) initial[`${group.transactionType}:${group.key}`] = blankAnswer(group);
    setAnswers(initial);
    setQuestionIndex(0);
    setShowDescription(false);
    setStage(result.groups.some((group) => !group.rule) ? "questions" : "summary");
  }

  async function readFile(file: File, pdfPassword?: string) {
    setError(null);
    const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
    if (isPdf && file.size > 4 * 1024 * 1024) {
      setError("Esse PDF é grande demais. Exporte um período menor.");
      return;
    }
    setIsReading(true);
    setFileName(file.name);
    try {
      const body = isPdf ? { pdfBase64: await fileToBase64(file), password: pdfPassword || undefined } : { content: await file.text() };
      const result = await apiRequest<PreviewResponse>("/statements/preview", { method: "POST", token, body });
      setPendingPdf(null);
      setPassword("");
      startReview(result);
    } catch (err) {
      if (err instanceof ApiError && (err.code === "pdf_password_needed" || err.code === "pdf_password_wrong")) {
        setPendingPdf(file);
        setError(err.code === "pdf_password_wrong" ? "Senha incorreta. Tente de novo." : null);
      } else {
        setError(err instanceof ApiError ? err.message : "Não foi possível ler esse arquivo.");
      }
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

  const current = stage === "questions" ? questions[questionIndex] : undefined;
  const currentAnswer = current ? answers[groupKey(current)] : undefined;

  function patchAnswer(group: PreviewGroup, patch: Partial<Answer>) {
    const key = groupKey(group);
    setAnswers((all) => ({ ...all, [key]: { ...all[key], ...patch } }));
  }

  function goNext() {
    setShowDescription(false);
    setNewCategoryName(null);
    if (returnToSummary || questionIndex >= questions.length - 1) {
      setReturnToSummary(false);
      setStage("summary");
      return;
    }
    setQuestionIndex((index) => index + 1);
  }

  function goBack() {
    setNewCategoryName(null);
    if (questionIndex === 0 || returnToSummary) {
      if (returnToSummary) {
        setReturnToSummary(false);
        setStage("summary");
      } else {
        setStage("file");
        setPreview(null);
      }
      return;
    }
    setQuestionIndex((index) => index - 1);
  }

  function choose(group: PreviewGroup, patch: { categoryId: string | null; notExpense: boolean }) {
    patchAnswer(group, { ...patch, status: "answered", fromRule: false });
    // Com a descrição aberta a pessoa ainda vai digitar; senão, próxima.
    if (!showDescription) goNext();
  }

  function editFromSummary(group: PreviewGroup) {
    let index = questions.indexOf(group);
    if (index === -1) {
      // Nome que veio de regra: vira pergunta só pra essa edição.
      setPreview((p) => (p ? { ...p, groups: p.groups.map((g) => (g === group ? { ...g, rule: null } : g)) } : p));
      index = questions.filter((q) => preview!.groups.indexOf(q) < preview!.groups.indexOf(group)).length;
    }
    setQuestionIndex(index);
    setReturnToSummary(true);
    setShowDescription(false);
    setStage("questions");
  }

  async function createCategory(group: PreviewGroup) {
    const name = newCategoryName?.trim();
    if (!name) return;
    try {
      const created = await apiRequest<CategoryRow>("/categories", { method: "POST", token, body: { name } });
      setCategories((list) => [...list, created]);
      setNewCategoryName(null);
      choose(group, { categoryId: created.id, notExpense: false });
    } catch (err) {
      const existing = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (err instanceof ApiError && err.status === 409 && existing) {
        setNewCategoryName(null);
        choose(group, { categoryId: existing.id, notExpense: false });
        return;
      }
      setError(err instanceof ApiError ? err.message : "Não foi possível criar a categoria.");
    }
  }

  function flipTypes() {
    setPreview((p) => {
      if (!p) return p;
      const flip = (t: TxType): TxType => (t === "expense" ? "income" : "expense");
      const groups = p.groups.map((g) => ({ ...g, transactionType: flip(g.transactionType) }));
      setAnswers((all) => {
        const next: Record<string, Answer> = {};
        for (const g of p.groups) next[`${flip(g.transactionType)}:${g.key}`] = all[`${g.transactionType}:${g.key}`];
        return next;
      });
      return { ...p, assumedAllExpenses: false, rows: p.rows.map((r) => ({ ...r, transactionType: flip(r.transactionType) })), groups };
    });
  }

  // O que vai ser salvo: linhas novas (ou repetidas, se a pessoa quiser),
  // tirando os nomes marcados como "Não é gasto".
  const plan = useMemo(() => {
    if (!preview) return null;
    const items: { description: string; amount: number; transactionType: TxType; occurredAt: string; categoryId: string | null }[] = [];
    let incoming = 0;
    let outgoing = 0;
    let skippedNotExpense = 0;
    // Não conciliado: linhas que vão entrar sem categoria nenhuma.
    const unmatched: { index: number; group: PreviewGroup | null; description: string }[] = [];
    const answeredByRow = new Map<number, { group: PreviewGroup; answer: Answer }>();
    for (const group of preview.groups) {
      const answer = answers[groupKey(group)];
      if (answer) for (const index of group.rowIndexes) answeredByRow.set(index, { group, answer });
    }
    preview.rows.forEach((row, index) => {
      if (row.isDuplicate && !includeDuplicates) return;
      const entry = answeredByRow.get(index);
      const answer = entry?.answer;
      if (answer?.status === "answered" && answer.notExpense) {
        skippedNotExpense++;
        return;
      }
      const custom =
        answer?.descMode === "each" ? answer.descriptions[index]?.trim() : answer?.description.trim();
      const categoryId = answer?.status === "answered" ? answer.categoryId : row.suggestedCategoryId;
      const amount = Number(row.amount);
      if (row.transactionType === "income") incoming += amount;
      else outgoing += amount;
      if (!categoryId) unmatched.push({ index, group: entry?.group ?? null, description: custom || row.description });
      items.push({
        description: custom || row.description,
        amount,
        transactionType: row.transactionType,
        occurredAt: row.date,
        categoryId: categoryId ?? null,
      });
    });
    const rules = preview.groups
      .map((group) => ({ group, answer: answers[groupKey(group)] }))
      .filter(({ answer }) => answer?.status === "answered" && !answer.fromRule && (answer.notExpense || answer.categoryId))
      .map(({ group, answer }) => ({ key: group.key, label: group.name, categoryId: answer.categoryId, notExpense: answer.notExpense }));
    const withoutCategory = unmatched.length;
    return { items, rules, incoming, outgoing, skippedNotExpense, withoutCategory, unmatched };
  }, [preview, answers, includeDuplicates]);

  const duplicateCount = preview?.rows.filter((row) => row.isDuplicate).length ?? 0;
  const unreadLines = preview?.pdf?.unreadLines ?? [];

  async function handleSave() {
    if (!plan || !accountId || (plan.items.length === 0 && plan.rules.length === 0)) return;
    setIsSaving(true);
    setError(null);
    try {
      const result = await apiRequest<{ created: number; rulesSaved: number }>("/statements/commit", {
        method: "POST",
        token,
        body: { accountId, items: plan.items, rules: plan.rules },
      });
      const n = result.created;
      showToast(
        `${n} lançamento${n === 1 ? "" : "s"} importado${n === 1 ? "" : "s"}` +
          (result.rulesSaved > 0 ? ` · ${result.rulesSaved} nome${result.rulesSaved === 1 ? "" : "s"} guardado${result.rulesSaved === 1 ? "" : "s"}` : "")
      );
      onImported();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível importar.");
      setIsSaving(false);
    }
  }

  function categoryLabel(id: string | null) {
    const category = categories.find((c) => c.id === id);
    return category ? `${category.emoji ? `${category.emoji} ` : ""}${category.name}` : "Sem categoria";
  }

  function answerLabel(answer: Answer | undefined, type: TxType) {
    if (!answer || answer.status !== "answered") return "Sem categoria";
    if (answer.notExpense) return type === "income" ? "Não é entrada" : "Não é gasto";
    return categoryLabel(answer.categoryId);
  }

  const orderedCategories = (type: TxType) =>
    type === "income"
      ? [...categories].sort((a, b) => Number(INCOME_HINT.test(b.name)) - Number(INCOME_HINT.test(a.name)))
      : categories;

  const pdfBanner = preview?.pdf && (
    <p className={`import-check ${preview.pdf.reconciled === false ? "warn" : preview.pdf.reconciled ? "ok" : ""}`}>
      {preview.pdf.reconciled === true && (
        <>
          <Icon name="check" /> Conferido: a soma dos lançamentos bate com o saldo do extrato (
          {formatCurrency(Number(preview.pdf.openingBalance))} → {formatCurrency(Number(preview.pdf.closingBalance))}).
        </>
      )}
      {preview.pdf.reconciled === false && (
        <>
          A soma dos lançamentos não bate com o saldo do extrato (diferença de {formatCurrency(Number(preview.pdf.difference))}).
          Pode ter faltado alguma linha: confira no app do banco antes de importar.
        </>
      )}
      {preview.pdf.reconciled === null && <>O extrato não mostra saldo inicial e final, então não deu pra conferir a soma.</>}
    </p>
  );

  return (
    <Sheet onClose={onClose} className="import-panel" labelledBy="import-title">
      <div className="import-head">
        <h1 id="import-title">Importar extrato</h1>
        {stage === "questions" && questions.length > 0 && (
          <span className="import-progress">
            {Math.min(questionIndex + 1, questions.length)} de {questions.length}
          </span>
        )}
      </div>

      {stage === "file" && (
        <>
          <p className="card-subtitle">
            Traga o extrato do banco. O PAR. lê, pergunta o que é cada nome e só salva o que você confirmar.
          </p>
          <label className="import-account" htmlFor="import-account">
            De qual conta é esse extrato?
            <select id="import-account" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.emoji ? `${account.emoji} ` : ""}
                  {account.name}
                </option>
              ))}
            </select>
          </label>

          {pendingPdf ? (
            <form
              className="import-password"
              onSubmit={(event) => {
                event.preventDefault();
                void readFile(pendingPdf, password);
              }}
            >
              <strong>
                <Icon name="lock" /> {pendingPdf.name} tem senha
              </strong>
              <small>Geralmente são os primeiros dígitos do CPF. A senha só abre o arquivo e não fica guardada.</small>
              <PasswordInput
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Senha do PDF"
                autoFocus
                aria-label="Senha do PDF"
              />
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setPendingPdf(null)} disabled={isReading}>
                  Outro arquivo
                </button>
                <button type="submit" className="btn btn-primary" disabled={isReading || !password}>
                  {isReading ? "Abrindo..." : "Abrir"}
                </button>
              </div>
            </form>
          ) : (
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
              <small>
                {isReading
                  ? "Copiando data, nome e valor de cada linha e conferindo com o saldo."
                  : "PDF do extrato (pode ter senha), OFX ou CSV, do app ou do site do banco"}
              </small>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => inputRef.current?.click()} disabled={isReading}>
                Escolher PDF ou arquivo
              </button>
              <input
                ref={inputRef}
                id="import-file"
                type="file"
                accept="application/pdf,.pdf,.ofx,.qfx,.csv,.txt,text/csv"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void readFile(file);
                  event.target.value = "";
                }}
              />
            </div>
          )}
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

      {stage === "questions" && current && currentAnswer && (
        <>
          {questionIndex === 0 && !returnToSummary && pdfBanner}
          {questionIndex === 0 && !returnToSummary && (
            <p className="import-summary">
              <strong>{preview!.rows.length}</strong> lançamentos em {fileName}
              {duplicateCount > 0 && <> · {duplicateCount} já estavam no app</>}
              {preview!.groups.length > questions.length && (
                <> · {preview!.groups.length - questions.length} nomes o PAR. já conhecia</>
              )}
            </p>
          )}
          <div className="import-question">
            <span className={`import-question-type ${current.transactionType}`}>
              {current.transactionType === "income" ? "Entrou" : "Saiu"}
            </span>
            <h2 className="import-question-name">{current.name}</h2>
            <p className="import-question-meta">
              {current.count} {current.count === 1 ? "vez" : "vezes"} com esse nome ·{" "}
              <strong className={`transaction-amount ${current.transactionType}`}>{formatCurrency(Number(current.total))}</strong>
            </p>
            <p className="import-question-ask">O que é isso?</p>
            <div className="chip-row import-chips">
              {orderedCategories(current.transactionType).map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={`import-chip${
                    currentAnswer.status === "answered" && !currentAnswer.notExpense && currentAnswer.categoryId === category.id ? " active" : ""
                  }`}
                  onClick={() => choose(current, { categoryId: category.id, notExpense: false })}
                >
                  {category.emoji ? `${category.emoji} ` : ""}
                  {category.name}
                </button>
              ))}
              <button
                type="button"
                className={`import-chip is-not${currentAnswer.status === "answered" && currentAnswer.notExpense ? " active" : ""}`}
                onClick={() => choose(current, { categoryId: null, notExpense: true })}
                title="Fatura do cartão, aplicação, transferência entre suas contas: não entra"
              >
                {current.transactionType === "income" ? "Não é entrada" : "Não é gasto"}
              </button>
              {newCategoryName === null ? (
                <button type="button" className="import-chip is-new" onClick={() => setNewCategoryName("")}>
                  + Nova categoria
                </button>
              ) : (
                <form
                  className="import-new-category"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void createCategory(current);
                  }}
                >
                  <input
                    value={newCategoryName}
                    onChange={(event) => setNewCategoryName(event.target.value)}
                    placeholder="Nome da categoria"
                    maxLength={40}
                    autoFocus
                    aria-label="Nome da nova categoria"
                  />
                  <button type="submit" className="btn btn-primary btn-sm" disabled={!newCategoryName.trim()}>
                    Criar
                  </button>
                </form>
              )}
            </div>
            <p className="import-hint">
              “{current.transactionType === "income" ? "Não é entrada" : "Não é gasto"}” é pra fatura do cartão, aplicação e
              transferência entre suas contas: essas linhas não entram.
            </p>

            {!showDescription ? (
              <button type="button" className="link-button" onClick={() => setShowDescription(true)}>
                + Descrição (opcional)
              </button>
            ) : (
              <div className="import-description">
                {current.count > 1 && (
                  <div className="segmented" role="tablist">
                    {(["all", "each"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        role="tab"
                        aria-selected={currentAnswer.descMode === mode}
                        className={`segmented-option${currentAnswer.descMode === mode ? " active" : ""}`}
                        onClick={() => patchAnswer(current, { descMode: mode })}
                      >
                        {mode === "all" ? "Uma pra todos" : "Uma pra cada"}
                      </button>
                    ))}
                  </div>
                )}
                {currentAnswer.descMode === "all" || current.count === 1 ? (
                  <input
                    value={currentAnswer.description}
                    onChange={(event) => patchAnswer(current, { description: event.target.value })}
                    placeholder={current.name}
                    maxLength={120}
                    aria-label="Descrição"
                  />
                ) : (
                  <ul className="import-each">
                    {current.rowIndexes.map((index) => {
                      const row = preview!.rows[index];
                      return (
                        <li key={index}>
                          <span>
                            {parseLocalDate(row.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ·{" "}
                            {formatCurrency(Number(row.amount))}
                          </span>
                          <input
                            value={currentAnswer.descriptions[index] ?? ""}
                            onChange={(event) =>
                              patchAnswer(current, { descriptions: { ...currentAnswer.descriptions, [index]: event.target.value } })
                            }
                            placeholder={row.description}
                            maxLength={120}
                            aria-label={`Descrição de ${row.date}`}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {stage === "summary" && preview && plan && (
        <>
          {pdfBanner}
          {preview.assumedAllExpenses && (
            <p className="import-note">
              Todos os valores vieram positivos, então tratei tudo como saída.{" "}
              <button type="button" className="link-button" onClick={flipTypes}>
                Inverter entradas e saídas
              </button>
            </p>
          )}
          <div className="import-totals">
            <div>
              <small>Entrou</small>
              <strong className="transaction-amount income">{formatCurrency(plan.incoming)}</strong>
            </div>
            <div>
              <small>Saiu</small>
              <strong className="transaction-amount expense">{formatCurrency(plan.outgoing)}</strong>
            </div>
            <div>
              <small>Lançamentos</small>
              <strong>{plan.items.length}</strong>
            </div>
          </div>
          <p className="import-summary">
            Em <strong>{accounts.find((a) => a.id === accountId)?.name ?? "—"}</strong>
            {plan.skippedNotExpense > 0 && <> · {plan.skippedNotExpense} não entram (não é gasto)</>}
            {plan.withoutCategory > 0 && <> · {plan.withoutCategory} entram sem categoria</>}
          </p>
          {duplicateCount > 0 && (
            <label className="import-dup-toggle">
              <input type="checkbox" checked={includeDuplicates} onChange={(event) => setIncludeDuplicates(event.target.checked)} />
              {duplicateCount} {duplicateCount === 1 ? "parece" : "parecem"} já estar no app (mesmo dia, valor e sentido). Importar
              mesmo assim
            </label>
          )}
          {(plan.unmatched.length > 0 || unreadLines.length > 0) && (
            <>
              <h2 className="import-rules-title">
                Não conciliado <span className="import-unmatched-count">{plan.unmatched.length + unreadLines.length}</span>
              </h2>
              <p className="card-subtitle">
                {plan.unmatched.length > 0 && "Esses entram sem categoria. Toque pra dizer o que é."}
                {plan.unmatched.length > 0 && unreadLines.length > 0 && " "}
                {unreadLines.length > 0 && "As linhas marcadas “não li” estão no PDF mas não viraram lançamento: confira no app do banco."}
              </p>
              <ul className="import-rules import-unmatched">
                {plan.unmatched.map(({ index, group, description }) => {
                  const row = preview.rows[index];
                  return (
                    <li key={`row-${index}`}>
                      <button type="button" onClick={() => group && editFromSummary(group)} disabled={!group}>
                        <span className="import-rules-name">
                          {description}
                          <small>
                            {parseLocalDate(row.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ·{" "}
                            {row.transactionType === "income" ? "entrou" : "saiu"}
                          </small>
                        </span>
                        <span className={`import-rules-answer transaction-amount ${row.transactionType}`}>
                          {formatCurrency(Number(row.amount))}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {unreadLines.map((line, i) => (
                  <li key={`unread-${i}`} className="import-unread">
                    <span className="import-rules-name">
                      {line}
                      <small>não li</small>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h2 className="import-rules-title">Guardado pra próxima vez</h2>
          <p className="card-subtitle">Toque num nome pra mudar a resposta. Na próxima importação o PAR. só pergunta nomes novos.</p>
          <ul className="import-rules">
            {preview.groups.map((group) => {
              const answer = answers[groupKey(group)];
              return (
                <li key={groupKey(group)}>
                  <button type="button" onClick={() => editFromSummary(group)}>
                    <span className="import-rules-name">
                      {group.name}
                      <small>
                        {group.count}× · {formatCurrency(Number(group.total))}
                        {answer?.fromRule && " · já sabia"}
                      </small>
                    </span>
                    <span className={`import-rules-answer${answer?.status === "answered" ? "" : " muted"}`}>
                      → {answerLabel(answer, group.transactionType)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      {stage === "questions" && current && (
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={goBack}>
            Voltar
          </button>
          {showDescription ? (
            <button type="button" className="btn btn-primary" onClick={goNext}>
              {currentAnswer?.status === "answered" ? "Próxima" : "Pular"}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                if (currentAnswer?.status !== "answered") patchAnswer(current, { status: "skipped" });
                goNext();
              }}
            >
              Pular
            </button>
          )}
        </div>
      )}

      {stage === "summary" && plan && (
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              if (questions.length > 0) {
                setQuestionIndex(questions.length - 1);
                setStage("questions");
              } else {
                setStage("file");
                setPreview(null);
              }
            }}
            disabled={isSaving}
          >
            Voltar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={isSaving || (plan.items.length === 0 && plan.rules.length === 0)}
          >
            {isSaving ? "Importando..." : plan.items.length > 0 ? `Importar ${plan.items.length}` : "Guardar respostas"}
          </button>
        </div>
      )}
    </Sheet>
  );
}
