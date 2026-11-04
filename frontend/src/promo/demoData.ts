// Dados de exemplo pro vídeo de apresentação: um grupo de amigos fictício
// ("Rolê da galera": Gui, Ana, Lucas e Bia) em novembro de 2026, com rolê,
// show e viagem. Nada aqui é de usuário de verdade.
import { onApi } from "../test/fakeApi";
import { ME } from "../test/fakeAuth";

export const ANA = "user-ana";
export const LUCAS = "user-lucas";
export const BIA = "user-bia";
export const MONTH = "2026-11";
const members = [
  { id: ME, displayName: "Gui" },
  { id: ANA, displayName: "Ana" },
  { id: LUCAS, displayName: "Lucas" },
  { id: BIA, displayName: "Bia" },
];
const accounts = [
  { id: "acc-gui", type: "personal", name: "Conta do Gui", emoji: null, ownerUserId: ME, balance: 4280.4 },
  { id: "acc-joint", type: "joint", name: "Nossa Conta", emoji: null, ownerUserId: null, balance: 2863.65 },
];
const categories = [
  { id: "cat-mercado", name: "Mercado", emoji: null, type: "expense" },
  { id: "cat-moradia", name: "Moradia", emoji: null, type: "expense" },
  { id: "cat-lazer", name: "Lazer", emoji: null, type: "expense" },
  { id: "cat-transporte", name: "Transporte", emoji: null, type: "expense" },
  { id: "cat-alimentacao", name: "Alimentação", emoji: null, type: "expense" },
  { id: "cat-salario", name: "Salário", emoji: null, type: "income" },
];

function tx(over: Record<string, unknown>) {
  return {
    id: "tx",
    description: "",
    amount: "0.00",
    transactionType: "expense",
    occurredAt: "2026-11-04",
    categoryId: null,
    categoryName: null,
    categoryEmoji: null,
    isPrivate: false,
    recurringGroupId: null,
    splitType: "none",
    isSettled: false,
    accountId: "acc-joint",
    accountType: "joint",
    paymentMethod: "pix",
    payerId: ME,
    linkKind: null,
    ...over,
  };
}

const transactions = [
  tx({ id: "t1", description: "Bar sexta", amount: "240.00", categoryId: "cat-lazer", categoryName: "Lazer", splitType: "equal", paymentMethod: "pix" }),
  tx({ id: "t2", description: "Ingresso do show", amount: "320.00", occurredAt: "2026-11-03", categoryId: "cat-lazer", categoryName: "Lazer", splitType: "equal", payerId: BIA, paymentMethod: "credit" }),
  tx({ id: "t3", description: "Uber da volta", amount: "48.00", occurredAt: "2026-11-03", categoryId: "cat-transporte", categoryName: "Transporte", splitType: "equal", payerId: LUCAS, paymentMethod: "credit" }),
  tx({ id: "t4", description: "Airbnb Floripa", amount: "1200.00", occurredAt: "2026-11-02", categoryId: "cat-moradia", categoryName: "Viagem", splitType: "equal", isSettled: true }),
  tx({ id: "t5", description: "Mercado do churrasco", amount: "186.30", occurredAt: "2026-11-01", categoryId: "cat-mercado", categoryName: "Mercado", splitType: "equal", payerId: ANA, paymentMethod: "debit" }),
  tx({ id: "t6", description: "Salário", amount: "4200.00", transactionType: "income", occurredAt: "2026-11-01", categoryId: "cat-salario", categoryName: "Salário", accountId: "acc-gui", accountType: "personal" }),
];

const byCategory = [
  { categoryId: "cat-moradia", categoryName: "Viagem", categoryEmoji: null, total: "1200.00" },
  { categoryId: "cat-lazer", categoryName: "Lazer", categoryEmoji: null, total: "560.00" },
  { categoryId: "cat-mercado", categoryName: "Mercado", categoryEmoji: null, total: "186.30" },
  { categoryId: "cat-transporte", categoryName: "Transporte", categoryEmoji: null, total: "48.00" },
];

const card = { id: "card-1", name: "Nubank", closingDay: 9, dueDay: 15, scope: "joint", limit: "3000.00", limitUsed: "1268.40", limitType: "normal", securedFromAccount: false, limitReleases: [] };

const nubankDebt = {
  id: "debt-1",
  scope: "joint",
  name: "Sofá novo",
  description: null,
  totalAmount: "2400.00",
  installmentsCount: 6,
  startMonth: "2026-08",
  dueDay: 10,
  categoryId: "cat-moradia",
  installments: [1, 2, 3, 4, 5, 6].map((n) => ({
    id: String(n),
    installmentNumber: n,
    amount: "400.00",
    isPaid: n <= 3,
    referenceMonth: `2026-${String(7 + n).padStart(2, "0")}`,
    dueDate: `2026-${String(7 + n).padStart(2, "0")}-10`.replace("2026-13", "2027-01").replace("2026-14", "2027-02"),
  })),
  paidAmount: 1200,
  remainingAmount: 1200,
  paidCount: 3,
  remainingCount: 3,
};

const goals = [
  { id: "g1", name: "Viagem pra Floripa", emoji: null, photoDataUrl: null, targetAmount: "8000.00", currentAmount: "4800.00", deadline: "2027-01-01", achievedAt: null, items: [] },
  { id: "g2", name: "Ingressos do festival", emoji: null, photoDataUrl: null, targetAmount: "2400.00", currentAmount: "900.00", deadline: null, achievedAt: null, items: [] },
];

export function prepareDemoApi(): void {
  onApi("GET", "/groups/me", { accounts, members });
  onApi("GET", "/groups", { groups: [{ id: "group-1", name: "Rolê da galera", memberCount: 4, emoji: "🍻" }] });
  onApi("GET", "/categories", categories);
  onApi("GET", "/feedback/unread", { unread: 0 });
  onApi("GET", "/feedback", { messages: [] });
  onApi("GET", "/assistant/greeting", { text: "Oi" });
  onApi("GET", "/open-finance/pending", { total: 0, banks: [] });
  onApi("GET", /^\/transactions\/uncategorized/, { count: 0 });
  onApi("GET", "/transactions?limit=1", [transactions[0]]);
  onApi("GET", /^\/transactions\?limit=500&month=/, transactions);
  onApi("GET", /^\/transactions\?limit=50&accountId=/, transactions.filter((t) => t.accountId === "acc-joint"));
  onApi("GET", /^\/transactions\/summary\/year/, {
    year: 2026,
    months: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"].map((m, i) => ({
      month: `2026-${m}`,
      income: i < 11 ? "6200.00" : "0",
      expense: i < 11 ? String(3900 + ((i * 377) % 900)) : "0",
    })),
    totalIncome: "68200.00",
    totalExpense: "47110.00",
  });
  onApi("GET", /^\/transactions\/summary\?month=/, {
    total: "2532.50",
    byCategory,
    byPayer: [{ payerId: ME, total: "1440.00" }, { payerId: BIA, total: "320.00" }, { payerId: ANA, total: "186.30" }, { payerId: LUCAS, total: "48.00" }],
  });
  onApi("GET", "/transactions/balance", { balances: [{ fromUserId: LUCAS, toUserId: ME, amount: 60 }, { fromUserId: BIA, toUserId: ME, amount: 60 }, { fromUserId: ANA, toUserId: ME, amount: 13.42 }] });
  onApi("GET", /^\/budgets\/current/, { budget: { capAmount: "4000.00" }, spent: 2532.5 });
  onApi("GET", "/cards", [
    { ...card, currentStatement: { month: MONTH, dueDate: "2026-11-15", total: "692.40", isPaid: false, byPerson: [{ userId: ME, total: "412.10" }, { userId: ANA, total: "280.30" }] } },
  ]);
  onApi("GET", "/cards/card-1/statements", [
    { month: "2026-12", dueDate: "2026-12-15", total: "576.00", isPaid: false },
    { month: "2026-11", dueDate: "2026-11-15", total: "692.40", isPaid: false },
    { month: "2026-10", dueDate: "2026-10-15", total: "1104.85", isPaid: true },
    { month: "2026-09", dueDate: "2026-09-15", total: "938.20", isPaid: true },
  ]);
  onApi("GET", /^\/cards\/card-1\/statement\?month=/, {
    month: MONTH,
    dueDate: "2026-11-15",
    total: "692.40",
    isPaid: false,
    purchases: [
      { id: "p1", description: "Ingresso do show", amount: "320.00", categoryId: "cat-lazer", buyerId: BIA, purchaseDate: "2026-11-03", installmentNumber: 1, installmentsCount: 1 },
      { id: "p2", description: "Rodada no bar", amount: "96.00", categoryId: "cat-alimentacao", buyerId: LUCAS, purchaseDate: "2026-11-02", installmentNumber: 1, installmentsCount: 1 },
      { id: "p3", description: "Passagem Floripa", amount: "215.40", categoryId: "cat-transporte", buyerId: ANA, purchaseDate: "2026-09-20", installmentNumber: 2, installmentsCount: 3 },
      { id: "p4", description: "Gasolina", amount: "228.10", categoryId: "cat-transporte", buyerId: ME, purchaseDate: "2026-10-28", installmentNumber: 1, installmentsCount: 1 },
    ],
  });
  onApi("GET", "/debts", [nubankDebt]);
  onApi("GET", "/goals", goals);
  onApi("GET", /^\/dashboard\?month=/, {
    group: { accounts, members },
    recent: transactions.slice(0, 5),
    debts: [{ id: "debt-1", name: "Sofá novo", totalAmount: "2400.00", installmentsCount: 6, paidAmount: 1200, remainingAmount: 1200, remainingCount: 3 }],
    summary: { total: "2532.50", byCategory },
    jointSummary: { byPayer: [{ payerId: ME, total: "1440.00" }, { payerId: BIA, total: "320.00" }, { payerId: ANA, total: "186.30" }, { payerId: LUCAS, total: "48.00" }] },
    balance: { balances: [{ fromUserId: LUCAS, toUserId: ME, amount: 60 }, { fromUserId: BIA, toUserId: ME, amount: 60 }, { fromUserId: ANA, toUserId: ME, amount: 13.42 }] },
    budget: { budget: { capAmount: "4000.00" }, spent: 2532.5 },
    categoryBudgets: [],
    dailyTrend: [],
    personalMonthTotals: { income: 6200, expense: 2532.5 },
    personalPrevMonthTotals: { income: 6200, expense: 4310.2 },
    goalHighlight: { id: "g1", name: "Viagem pra Floripa", emoji: null, currentAmount: "4800.00", targetAmount: "8000.00" },
    nextInvoice: { cardName: "Nubank", dueDate: "2026-11-15", total: "692.40", limit: "3000.00", limitUsed: "1268.40", status: "open" },
    upcoming: [
      { id: "u1", kind: "debt", direction: "pay", title: "Sofá novo", detail: "Parcela 4 de 6", amount: 400, dueDate: "2026-11-10", daysUntil: 6, link: "/a-pagar", amountMode: undefined },
      { id: "u2", kind: "card", direction: "pay", title: "Fatura Nubank", detail: "Cartão do grupo", amount: 692.4, dueDate: "2026-11-15", daysUntil: 11, link: "/cards" },
      { id: "u3", kind: "recurring", direction: "pay", title: "Internet", detail: "Conta fixa", amount: 99.9, dueDate: "2026-11-20", daysUntil: 16, link: "/a-pagar" },
    ],
    trend6m: ["06", "07", "08", "09", "10", "11"].map((m, i) => ({ month: `2026-${m}`, income: 6200, expense: [4120, 3980, 4410, 3870, 4310, 2532][i], net: 6200 - [4120, 3980, 4410, 3870, 4310, 2532][i] })),
    alerts: [],
    heroDaily: Array.from({ length: 30 }, (_, i) => ({ day: `2026-11-${String(i + 1).padStart(2, "0")}`, balance: 7144 - i * 62 + (i % 5) * 40 })),
    cardsSummary: [{ id: "card-1", name: "Nubank", limit: "3000.00", limitUsed: "1268.40", limitType: "normal", statementTotal: "692.40", statementIsPaid: false, dueDate: "2026-11-15" }],
    goalsSummary: goals.map((g) => ({ id: g.id, name: g.name, currentAmount: g.currentAmount, targetAmount: g.targetAmount, deadline: g.deadline, itemsCount: 0 })),
    savedInGoals: 15950,
  });
}

// Cena "a dois" (roteiro, cena 7): o mesmo app num grupo de casal, com
// aluguel e mercado. Registrado depois do prepareDemoApi, então vale por cima.
export function prepareCasalApi(): void {
  const casal = [
    { id: ME, displayName: "Gui" },
    { id: ANA, displayName: "Ana" },
  ];
  const doCasal = [
    tx({ id: "c1", description: "Aluguel", amount: "1800.00", occurredAt: "2026-11-02", categoryId: "cat-moradia", categoryName: "Moradia", splitType: "equal", isSettled: true, recurringGroupId: "rg1" }),
    tx({ id: "c2", description: "Mercado do mês", amount: "486.30", categoryId: "cat-mercado", categoryName: "Mercado", splitType: "equal", payerId: ANA, paymentMethod: "debit" }),
    tx({ id: "c3", description: "Internet", amount: "99.90", occurredAt: "2026-11-01", categoryId: "cat-moradia", categoryName: "Moradia", splitType: "equal" }),
    tx({ id: "c4", description: "Jantar a dois", amount: "184.00", occurredAt: "2026-11-03", categoryId: "cat-lazer", categoryName: "Lazer", splitType: "equal", paymentMethod: "credit" }),
  ];
  onApi("GET", "/groups/me", { accounts, members: casal });
  onApi("GET", "/groups", { groups: [{ id: "group-1", name: "Gui e Ana", memberCount: 2, emoji: "🏡" }] });
  onApi("GET", /^\/transactions\?limit=50&accountId=/, doCasal);
  onApi("GET", /^\/transactions\/summary\?month=/, {
    total: "2570.20",
    byCategory: [
      { categoryId: "cat-moradia", categoryName: "Moradia", categoryEmoji: null, total: "1899.90" },
      { categoryId: "cat-mercado", categoryName: "Mercado", categoryEmoji: null, total: "486.30" },
      { categoryId: "cat-lazer", categoryName: "Lazer", categoryEmoji: null, total: "184.00" },
    ],
    byPayer: [
      { payerId: ME, total: "2083.90" },
      { payerId: ANA, total: "486.30" },
    ],
  });
  onApi("GET", "/transactions/balance", { balances: [{ fromUserId: ANA, toUserId: ME, amount: 798.8 }] });
}
