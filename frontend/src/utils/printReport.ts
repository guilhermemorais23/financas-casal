import { formatCurrency, parseLocalDate } from "./format";

export interface PrintableRow {
  occurredAt: string;
  description: string;
  categoryLabel: string;
  amount: number;
  transactionType: "expense" | "income";
}

export interface PrintableReport {
  title: string; // e.g. "setembro de 2026"
  ownerName: string;
  incomeTotal: number;
  expenseTotal: number;
  categories: { label: string; emoji: string | null; value: number }[];
  rows: PrintableRow[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Builds a self-contained, print-styled page and opens the browser's print
// dialog on it ("Salvar como PDF" is one click there). Done client-side on
// purpose: no PDF library, no server round trip, and the file is generated
// from exactly the numbers already on screen.
export function printMonthReport(report: PrintableReport): boolean {
  const win = window.open("", "_blank");
  if (!win) return false;

  const balance = report.incomeTotal - report.expenseTotal;
  const categoryRows = report.categories
    .map(
      (c) =>
        `<tr><td>${escapeHtml(`${c.emoji ?? ""} ${c.label}`.trim())}</td><td class="num">${formatCurrency(c.value)}</td>` +
        `<td class="num">${report.expenseTotal > 0 ? Math.round((c.value / report.expenseTotal) * 100) : 0}%</td></tr>`
    )
    .join("");
  const txRows = report.rows
    .map(
      (r) =>
        `<tr><td>${parseLocalDate(r.occurredAt).toLocaleDateString("pt-BR")}</td><td>${escapeHtml(r.description)}</td>` +
        `<td>${escapeHtml(r.categoryLabel)}</td><td class="num ${r.transactionType}">${r.transactionType === "income" ? "+" : "−"}${formatCurrency(r.amount)}</td></tr>`
    )
    .join("");

  win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>PAR. · ${escapeHtml(report.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box}
  body{font-family:"Bricolage Grotesque",-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1d1b30;margin:0;padding:32px;font-size:13px}
  h1{font-size:24px;margin:0 0 4px}
  .sub{color:#5e5c77;margin:0 0 24px}
  .brand{font-weight:800;font-size:18px;margin-bottom:18px}.brand span{color:#6d54ec}
  .kpis{display:flex;gap:16px;margin-bottom:28px}
  .kpi{flex:1;border:1px solid #e4e0d8;border-radius:12px;padding:12px 14px}
  .kpi small{display:block;text-transform:uppercase;letter-spacing:.06em;color:#8b89a3;font-size:10px;font-weight:700}
  .kpi b{font-size:20px}
  h2{font-size:14px;margin:24px 0 8px}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#8b89a3;padding:6px 8px;border-bottom:1px solid #e4e0d8}
  td{padding:6px 8px;border-bottom:1px solid #f0ede6}
  .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .income{color:#006300}
  tr{break-inside:avoid}
  @media print{body{padding:0}}
</style></head><body>
<div class="brand">PAR<span>.</span></div>
<h1>Extrato de ${escapeHtml(report.title)}</h1>
<p class="sub">${escapeHtml(report.ownerName)} · gerado em ${new Date().toLocaleDateString("pt-BR")}</p>
<div class="kpis">
  <div class="kpi"><small>Entrou</small><b>${formatCurrency(report.incomeTotal)}</b></div>
  <div class="kpi"><small>Saiu</small><b>${formatCurrency(report.expenseTotal)}</b></div>
  <div class="kpi"><small>Sobrou</small><b>${formatCurrency(balance)}</b></div>
</div>
<h2>Para onde foi</h2>
<table><thead><tr><th>Categoria</th><th class="num">Valor</th><th class="num">%</th></tr></thead><tbody>${categoryRows}</tbody></table>
<h2>Lançamentos</h2>
<table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th class="num">Valor</th></tr></thead><tbody>${txRows}</tbody></table>
</body></html>`);
  win.document.close();
  win.focus();
  // Wait a tick so the document has laid out before the dialog opens.
  win.setTimeout(() => win.print(), 300);
  return true;
}
