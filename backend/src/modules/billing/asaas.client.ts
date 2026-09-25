import { billingConfig, type Plan } from "./billing.config";

// Cliente mínimo da API v3 do Asaas (https://docs.asaas.com). Só o que a
// assinatura precisa: cliente, assinatura, cobranças dela, cancelar e
// estornar. O cartão/Pix/boleto é digitado na página de pagamento do próprio
// Asaas -- nenhum dado de cartão passa pelo PAR.
export class AsaasNotConfiguredError extends Error {}
export class AsaasError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function baseUrl(): string {
  return billingConfig().asaasEnv === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
}

async function asaas<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = billingConfig().asaasApiKey;
  if (!key) throw new AsaasNotConfiguredError();
  const res = await fetch(baseUrl() + path, {
    method,
    headers: { "Content-Type": "application/json", access_token: key, "User-Agent": "PAR" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => null)) as { errors?: { description?: string }[] } | null;
  if (!res.ok) {
    const message = data?.errors?.map((e) => e.description).filter(Boolean).join(" ") || `Asaas respondeu ${res.status}`;
    throw new AsaasError(message, res.status);
  }
  return data as T;
}

export async function createCustomer(input: { name: string; email: string; cpfCnpj: string; userId: string }) {
  return asaas<{ id: string }>("POST", "/customers", {
    name: input.name,
    email: input.email,
    cpfCnpj: input.cpfCnpj,
    externalReference: input.userId,
  });
}

export async function createSubscription(input: { customerId: string; plan: Plan; value: number; nextDueDate: string; groupId: string }) {
  return asaas<{ id: string }>("POST", "/subscriptions", {
    customer: input.customerId,
    // O cliente escolhe Pix, boleto ou cartão na página de pagamento.
    billingType: "UNDEFINED",
    value: input.value,
    nextDueDate: input.nextDueDate,
    cycle: input.plan === "yearly" ? "YEARLY" : "MONTHLY",
    description: input.plan === "yearly" ? "PAR. Premium (anual)" : "PAR. Premium (mensal)",
    externalReference: input.groupId,
  });
}

export interface AsaasPayment {
  id: string;
  status: string;
  value: number;
  dueDate: string;
  invoiceUrl?: string;
  subscription?: string;
  externalReference?: string;
  confirmedDate?: string;
  paymentDate?: string;
}

export async function listSubscriptionPayments(subscriptionId: string) {
  return asaas<{ data: AsaasPayment[] }>("GET", `/subscriptions/${subscriptionId}/payments`);
}

export async function deleteSubscription(subscriptionId: string) {
  return asaas<{ deleted: boolean }>("DELETE", `/subscriptions/${subscriptionId}`);
}

export async function refundPayment(paymentId: string) {
  return asaas<AsaasPayment>("POST", `/payments/${paymentId}/refund`, {});
}
