// Cria um grupo de demonstração no EMULADOR (nunca em produção): duas pessoas,
// conta conjunta com gastos divididos, conta fixa, cartão, dívida, meta,
// orçamento e empréstimos a receber.
// Depois é só entrar no app local com demo@par.local / demo1234.
//
// Uso (com `npm run dev` já rodando na raiz): npm run seed:demo
//
// Tudo passa pela API do backend, com o login do emulador de Auth -- assim o
// seed segue as mesmas regras do app e não precisa saber o formato do banco.
import "dotenv/config";

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const API = `http://localhost:${process.env.PORT ?? 4000}/api`;
const PASSWORD = "demo1234";

if (!AUTH_HOST || !process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("seed:demo só roda contra os emuladores (FIREBASE_AUTH_EMULATOR_HOST e FIRESTORE_EMULATOR_HOST no .env).");
  process.exit(1);
}

async function signIn(email: string): Promise<string> {
  const base = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts`;
  const body = JSON.stringify({ email, password: PASSWORD, returnSecureToken: true });
  const headers = { "Content-Type": "application/json" };
  let res = await fetch(`${base}:signUp?key=demo-api-key`, { method: "POST", headers, body });
  if (!res.ok) res = await fetch(`${base}:signInWithPassword?key=demo-api-key`, { method: "POST", headers, body });
  if (!res.ok) throw new Error(`login de ${email} falhou: ${await res.text()}`);
  return ((await res.json()) as { idToken: string }).idToken;
}

async function api<T>(token: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

interface GroupResponse {
  accounts: { id: string; type: "personal" | "joint"; ownerId?: string | null }[];
  members: { id: string; displayName: string }[];
}

function day(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function main() {
  const you = await signIn("demo@par.local");
  const partner = await signIn("ana.demo@par.local");
  await api(you, "/me/bootstrap", "POST", { displayName: "Guilherme" });
  await api(partner, "/me/bootstrap", "POST", { displayName: "Ana" });

  const existing = await fetch(`${API}/groups/me`, { headers: { Authorization: `Bearer ${you}` } });
  if (existing.ok) {
    console.log("O usuário demo já tem grupo. Entre com demo@par.local / demo1234.");
    return;
  }
  const { inviteToken } = await api<{ inviteToken: string }>(you, "/groups", "POST");
  await api(partner, "/groups/accept", "POST", { token: inviteToken });

  const group = await api<GroupResponse>(you, "/groups/me");
  const youId = group.members.find((m) => m.displayName === "Guilherme")!.id;
  const partnerId = group.members.find((m) => m.displayName === "Ana")!.id;
  const joint = group.accounts.find((a) => a.type === "joint")!.id;
  const mine = group.accounts.find((a) => a.type === "personal")!.id;
  const partnerGroup = await api<GroupResponse>(partner, "/groups/me");
  const hers = partnerGroup.accounts.find((a) => a.type === "personal")!.id;

  const categories = await api<{ id: string; name: string }[]>(you, "/categories");
  const cat = (name: string) => categories.find((c) => c.name === name)?.id ?? null;

  const tx = (token: string, body: Record<string, unknown>) => api(token, "/transactions", "POST", body);
  await tx(you, { accountId: mine, payerId: youId, description: "Salário", amount: 5824.3, transactionType: "income", occurredAt: day(-20) });
  await tx(you, { accountId: mine, payerId: youId, description: "Academia", categoryId: cat("Saúde"), amount: 119.9, occurredAt: day(-15) });
  await tx(you, { accountId: mine, payerId: youId, description: "Uber", categoryId: cat("Transporte"), amount: 42.5, occurredAt: day(-3) });
  await tx(you, { accountId: joint, payerId: youId, description: "Aluguel", categoryId: cat("Moradia"), amount: 1900, occurredAt: day(-18), splitType: "equal" });
  await tx(you, { accountId: joint, payerId: youId, description: "Mercado da semana", categoryId: cat("Alimentação"), amount: 410, occurredAt: day(-6), splitType: "equal" });
  await tx(partner, { accountId: hers, payerId: partnerId, description: "Salário", amount: 4300, transactionType: "income", occurredAt: day(-20) });
  await tx(partner, { accountId: joint, payerId: partnerId, description: "Luz", categoryId: cat("Contas Fixas"), amount: 214.9, occurredAt: day(-10), splitType: "equal" });
  await tx(partner, { accountId: joint, payerId: partnerId, description: "Feira", categoryId: cat("Alimentação"), amount: 96.5, occurredAt: day(-2) });

  await api(you, "/recurring-bills", "POST", { accountId: joint, payerId: youId, description: "Internet", categoryId: cat("Contas Fixas"), amount: 119.9, dayOfMonth: Math.min(28, new Date().getDate() + 3), splitType: "equal" });
  await api(you, "/recurring-bills", "POST", { accountId: mine, payerId: youId, description: "Streaming", categoryId: cat("Lazer"), amount: 55.9, dayOfMonth: 5 });

  const card = await api<{ id: string }>(you, "/cards", "POST", { name: "Cartão do casal", closingDay: 23, dueDay: 30, scope: "joint", limit: 3000, limitType: "normal" });
  await api(you, `/cards/${card.id}/purchases`, "POST", { description: "Tênis", amount: 480, categoryId: null, buyerId: youId, purchaseDate: day(-4), installments: 3 });

  await api(you, "/debts", "POST", { name: "Celular parcelado", totalAmount: 1800, installmentsCount: 6, scope: "personal", startMonth: day(0).slice(0, 7), dueDay: 15 });

  // A receber: um com prazo, um sem prazo e um que a Ana emprestou da Nossa
  // Conta com juros (aparece pros dois, só ela mexe).
  await api(you, "/loans", "POST", { personName: "João", amount: 1000, lentAt: day(-40), dueDate: day(12), note: "Conserto do carro", accountId: mine });
  await api(you, "/loans", "POST", { personName: "Mãe", amount: 350, lentAt: day(-10), dueDate: null, note: null, accountId: mine });
  await api(partner, "/loans", "POST", { personName: "Cunhado", amount: 600, lentAt: day(-35), dueDate: day(60), note: "Entrada da moto", accountId: joint, interestRateMonthly: 2 });

  const goal = await api<{ id: string }>(you, "/goals", "POST", { name: "Viagem pro Nordeste", targetAmount: 8000, deadline: `${new Date().getFullYear()}-12-20` });
  await api(you, `/goals/${goal.id}/contribute`, "POST", { amount: 4200 });

  await api(you, "/budgets/current", "PUT", { capAmount: 5500 }).catch((err) => console.warn("orçamento não criado:", err.message));

  console.log("Pronto. Entre no app local com demo@par.local / demo1234 (a Ana é ana.demo@par.local, mesma senha).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
