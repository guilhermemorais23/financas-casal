// Cliente mínimo da API do Pluggy (Open Finance). O CLIENT_SECRET só existe
// aqui no servidor: o site recebe apenas o connect token de 30 minutos, que
// serve pra abrir a janela de conexão e nada mais.
//
// Uso pessoal grátis: conecte seus bancos no app "Meu Pluggy" e, na janela,
// escolha o conector "MeuPluggy" (até 5 contas do mesmo titular).

const BASE = process.env.PLUGGY_API_URL?.trim() || "https://api.pluggy.ai";

export class PluggyError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export function pluggyConfigured(): boolean {
  return Boolean(process.env.PLUGGY_CLIENT_ID?.trim() && process.env.PLUGGY_CLIENT_SECRET?.trim());
}

// Troca nos testes.
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
let doFetch: FetchLike = (url, init) => fetch(url, init);
export function setPluggyFetch(fn: FetchLike | null) {
  doFetch = fn ?? ((url, init) => fetch(url, init));
  cachedKey = null;
}

// A chave da API vale 2h; renova com folga.
let cachedKey: { value: string; until: number } | null = null;
async function apiKey(): Promise<string> {
  if (cachedKey && cachedKey.until > Date.now()) return cachedKey.value;
  const res = await doFetch(`${BASE}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: process.env.PLUGGY_CLIENT_ID, clientSecret: process.env.PLUGGY_CLIENT_SECRET, nonExpiring: false }),
  });
  if (!res.ok) throw new PluggyError(res.status, "Não foi possível autenticar no Pluggy. Confira PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET.");
  const body = (await res.json()) as { apiKey: string };
  cachedKey = { value: body.apiKey, until: Date.now() + 100 * 60 * 1000 };
  return body.apiKey;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await doFetch(`${BASE}/${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-API-KEY": await apiKey() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `Pluggy respondeu ${res.status}`;
    try {
      const err = (await res.json()) as { message?: string };
      if (err.message) message = err.message;
    } catch {
      // sem corpo
    }
    throw new PluggyError(res.status, message);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export interface PluggyItem {
  id: string;
  clientUserId: string | null;
  status: string;
  executionStatus?: string;
  connector: { id: number; name: string; imageUrl?: string };
  lastUpdatedAt?: string | null;
}

export interface PluggyAccount {
  id: string;
  type: "BANK" | "CREDIT";
  subtype: string;
  name: string;
  marketingName?: string | null;
  number: string;
}

export interface PluggyParticipant {
  name?: string;
}

export interface PluggyTransaction {
  id: string;
  accountId: string;
  date: string;
  description: string;
  descriptionRaw?: string | null;
  type: "DEBIT" | "CREDIT";
  amount: number;
  status?: "PENDING" | "POSTED";
  category?: string | null;
  merchant?: { name?: string; businessName?: string };
  paymentData?: { payer?: PluggyParticipant; receiver?: PluggyParticipant };
}

export const pluggy = {
  // webhookUrl: o Pluggy avisa ali quando a conexão atualiza ou chegam
  // lançamentos novos.
  async createConnectToken(clientUserId: string, itemId?: string, webhookUrl?: string | null): Promise<string> {
    const body = await call<{ accessToken: string }>("POST", "connect_token", {
      itemId,
      options: { clientUserId, avoidDuplicates: true, ...(webhookUrl ? { webhookUrl } : {}) },
    });
    return body.accessToken;
  },
  // Conexão feita antes do aviso existir: passa a avisar também.
  setItemWebhook: (id: string, webhookUrl: string) => call<unknown>("PATCH", `items/${encodeURIComponent(id)}`, { webhookUrl }),
  getItem: (id: string) => call<PluggyItem>("GET", `items/${encodeURIComponent(id)}`),
  deleteItem: (id: string) => call<void>("DELETE", `items/${encodeURIComponent(id)}`),
  async listAccounts(itemId: string): Promise<PluggyAccount[]> {
    return (await call<{ results: PluggyAccount[] }>("GET", `accounts?itemId=${encodeURIComponent(itemId)}`)).results;
  },
  // Todas as transações da conta desde `dateFrom` (AAAA-MM-DD), página a página.
  async listTransactions(accountId: string, dateFrom: string): Promise<PluggyTransaction[]> {
    const out: PluggyTransaction[] = [];
    let after: string | null = null;
    for (let page = 0; page < 50; page++) {
      const query = new URLSearchParams({ accountId, dateFrom });
      if (after) query.set("after", after);
      const body: { results: PluggyTransaction[]; next: string | null } = await call("GET", `v2/transactions?${query}`);
      out.push(...body.results);
      if (!body.next) break;
      after = new URL(body.next, BASE).searchParams.get("after");
      if (!after) break;
    }
    return out;
  },
};
