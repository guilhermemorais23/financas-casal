// Configuração da cobrança (tudo por variável de ambiente no Render).
//
// Ligar/desligar a cobrança é pelo Admin > Assinaturas (settings/appSettings.ts).
// BILLING_ENABLED=true no Render só vale enquanto ninguém mexeu no botão.
// Desligada, todo mundo tem tudo e nada é gravado sobre assinatura.
export const TERMS_VERSION = "2026-09-25";

export function billingConfig() {
  const env = process.env;
  return {
    asaasApiKey: env.ASAAS_API_KEY ?? "",
    // "sandbox" (testes, dinheiro de mentira) ou "production".
    asaasEnv: env.ASAAS_ENV === "production" ? "production" : "sandbox",
    // Token que o Asaas manda no cabeçalho de cada webhook (definido por
    // você ao cadastrar o webhook no painel do Asaas).
    webhookToken: env.ASAAS_WEBHOOK_TOKEN ?? "",
    priceMonthly: Number(env.BILLING_PRICE_MONTHLY ?? 14.9),
    priceYearly: Number(env.BILLING_PRICE_YEARLY ?? 149),
    trialDays: Number(env.BILLING_TRIAL_DAYS ?? 14),
    // Dias de tolerância depois do vencimento antes de perder o Premium.
    graceDays: 3,
  };
}

export type Plan = "monthly" | "yearly";

export function priceFor(plan: Plan): number {
  const config = billingConfig();
  return plan === "yearly" ? config.priceYearly : config.priceMonthly;
}
