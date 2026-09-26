import { billingConfig } from "../billing/billing.config";
import { isBillingEnabled } from "../settings/appSettings";
import { emailProvider } from "../../email/mailer";
import { aiLimits } from "../aiUsage/aiUsage";
import { GEMINI_MODEL } from "../../utils/gemini";

// Admin > Diagnóstico: tudo que o servidor precisa ter configurado, por
// área, com o que acontece se faltar. Nunca devolve o valor de uma chave,
// só se ela existe.
//   required:    sem ela algo importante quebra ou fica inseguro;
//   recommended: funciona sem, mas pior;
//   optional:    só liga um recurso extra.
export type DiagLevel = "required" | "recommended" | "optional";

export interface DiagItem {
  label: string;
  ok: boolean;
  level: DiagLevel;
  env?: string; // nome da variável no Render
  hint?: string; // o que fazer / o que acontece sem ela
}

export interface DiagSection {
  id: string;
  title: string;
  summary?: string;
  items: DiagItem[];
  test?: "email" | "ai";
}

const has = (name: string) => Boolean(process.env[name]?.trim());

export async function buildDiagnostics(): Promise<DiagSection[]> {
  const billing = billingConfig();
  const billingOn = await isBillingEnabled();
  const telegramOn = has("TELEGRAM_BOT_TOKEN");
  const whatsappOn = has("WHATSAPP_ACCESS_TOKEN") || has("WHATSAPP_PHONE_NUMBER_ID");
  const provider = emailProvider();
  const limits = aiLimits();

  return [
    {
      id: "server",
      title: "Servidor e segurança",
      items: [
        { label: "Projeto do Firebase", ok: has("FIREBASE_PROJECT_ID"), level: "required", env: "FIREBASE_PROJECT_ID" },
        {
          label: "Só o seu site pode chamar o servidor",
          ok: has("ALLOWED_ORIGIN"),
          level: "required",
          env: "ALLOWED_ORIGIN",
          hint: "O endereço do site (ex.: https://par-projeto.web.app). Sem ela, qualquer site pode chamar a API.",
        },
        { label: "Admins definidos", ok: has("ADMIN_EMAILS"), level: "required", env: "ADMIN_EMAILS", hint: "Seu email, separado por vírgula se tiver mais de um." },
        { label: "Endereço do site nos emails", ok: has("APP_URL"), level: "optional", env: "APP_URL", hint: "Sem ela os links usam par-projeto.web.app." },
      ],
    },
    {
      id: "email",
      title: "Emails",
      summary: `Provedor: ${provider === "brevo" ? "Brevo (API)" : provider === "gmail-smtp" ? "Gmail SMTP" : "nenhum"}`,
      test: "email",
      items: [
        {
          label: "Brevo configurado",
          ok: provider === "brevo",
          level: "recommended",
          env: "BREVO_API_KEY",
          hint: "O Render grátis bloqueia Gmail SMTP. Crie uma chave em brevo.com.",
        },
        { label: "Remetente", ok: has("EMAIL_FROM") || has("GMAIL_USER"), level: "required", env: "EMAIL_FROM", hint: "O email verificado na Brevo." },
        {
          label: "Quem recebe os avisos",
          ok: has("OWNER_EMAIL") || has("ADMIN_EMAILS"),
          level: "recommended",
          env: "OWNER_EMAIL",
          hint: "Também recebe os alertas: muitos erros seguidos, banco sem cota, Telegram parado, IA perto do orçamento (AI_MONTHLY_BUDGET_BRL, padrão R$ 50).",
        },
      ],
    },
    {
      id: "ai",
      title: "IA (Gemini)",
      summary: `Modelo ${GEMINI_MODEL} · limite por pessoa: ${limits.message} mensagens e ${limits.import} importações por mês`,
      test: "ai",
      items: [
        {
          label: "Chave do Gemini",
          ok: has("GEMINI_API_KEY"),
          level: "recommended",
          env: "GEMINI_API_KEY",
          hint: "Sem ela o assistente responde só com os números e não há sugestão de categoria. aistudio.google.com/apikey",
        },
      ],
    },
    {
      id: "reminders",
      title: "Lembretes diários",
      items: [
        { label: "Rodam sozinhos 1x por dia", ok: true, level: "optional", hint: "No primeiro acesso depois das 8h, mesmo sem o cron." },
        { label: "Cron externo", ok: has("CRON_SECRET"), level: "optional", env: "CRON_SECRET", hint: "Mesmo valor no cabeçalho x-cron-secret do cron-job.org." },
      ],
    },
    {
      id: "billing",
      title: "Cobrança (Asaas)",
      summary: billingOn ? "Cobrança ligada" : "Cobrança desligada: todo mundo é Premium",
      items: [
        {
          label: `Chave do Asaas (${billing.asaasEnv === "production" ? "produção" : "testes"})`,
          ok: Boolean(billing.asaasApiKey) && (!billingOn || billing.asaasEnv === "production"),
          level: billingOn ? "required" : "optional",
          env: "ASAAS_API_KEY / ASAAS_ENV",
          hint: billingOn ? "Com a cobrança ligada, ASAAS_ENV precisa ser production." : undefined,
        },
        {
          label: "Webhook do Asaas",
          ok: Boolean(billing.webhookToken),
          level: billingOn ? "required" : "optional",
          env: "ASAAS_WEBHOOK_TOKEN",
          hint: "Sem ele quem paga não vira Premium sozinho. O mesmo token do painel do Asaas.",
        },
      ],
    },
    {
      id: "push",
      title: "Notificação no celular",
      summary: has("VAPID_PUBLIC_KEY") && has("VAPID_PRIVATE_KEY") ? "Ligada" : "Desligada",
      items: [
        {
          label: "Chaves de notificação (VAPID)",
          ok: has("VAPID_PUBLIC_KEY") && has("VAPID_PRIVATE_KEY"),
          level: "recommended",
          env: "VAPID_PUBLIC_KEY",
          hint: "Gere uma vez com: npx web-push generate-vapid-keys. Coloque a pública em VAPID_PUBLIC_KEY e a privada em VAPID_PRIVATE_KEY. Trocar depois desliga os avisos de quem já tinha ligado.",
        },
      ],
    },
    {
      id: "telegram",
      title: "Assistente no Telegram",
      summary: telegramOn ? "Ligado" : "Desligado",
      items: [
        { label: "Token do bot", ok: telegramOn, level: "optional", env: "TELEGRAM_BOT_TOKEN", hint: "Do @BotFather." },
        {
          label: "Segredo do webhook",
          ok: has("TELEGRAM_WEBHOOK_SECRET"),
          level: telegramOn ? "required" : "optional",
          env: "TELEGRAM_WEBHOOK_SECRET",
          hint: "Sem ele o servidor recusa as mensagens do Telegram (proteção contra mensagens falsas). Use o mesmo valor no setWebhook (secret_token).",
        },
      ],
    },
    {
      id: "whatsapp",
      title: "Assistente no WhatsApp",
      summary: whatsappOn ? "Ligado" : "Desligado",
      items: [
        { label: "Token de acesso da Meta", ok: has("WHATSAPP_ACCESS_TOKEN"), level: "optional", env: "WHATSAPP_ACCESS_TOKEN" },
        { label: "Número do WhatsApp", ok: has("WHATSAPP_PHONE_NUMBER_ID"), level: whatsappOn ? "required" : "optional", env: "WHATSAPP_PHONE_NUMBER_ID" },
        {
          label: "Token de verificação do webhook",
          ok: has("WHATSAPP_VERIFY_TOKEN"),
          level: whatsappOn ? "required" : "optional",
          env: "WHATSAPP_VERIFY_TOKEN",
          hint: "Você inventa e digita o mesmo no painel da Meta.",
        },
        {
          label: "App Secret (assinatura das mensagens)",
          ok: has("WHATSAPP_APP_SECRET"),
          level: whatsappOn ? "required" : "optional",
          env: "WHATSAPP_APP_SECRET",
          hint: "Painel da Meta > Configurações do app > Básico. Sem ele o servidor recusa as mensagens (proteção contra mensagens falsas).",
        },
      ],
    },
    {
      id: "extras",
      title: "Extras",
      items: [
        { label: "Cotações (Investimentos)", ok: has("BRAPI_TOKEN"), level: "optional", env: "BRAPI_TOKEN", hint: "Token grátis em brapi.dev." },
        {
          label: "Open Finance (Pluggy)",
          ok: has("PLUGGY_CLIENT_ID") && has("PLUGGY_CLIENT_SECRET"),
          level: "optional",
          env: "PLUGGY_CLIENT_ID / PLUGGY_CLIENT_SECRET",
          hint: "Liga o \"Conectar conta\" na importação. Grátis pra uso pessoal: conecte seus bancos no app Meu Pluggy e escolha o conector MeuPluggy.",
        },
        {
          label: "Quem pode conectar conta",
          ok: true,
          level: "optional",
          env: "PLUGGY_ALLOWED_EMAILS",
          hint: has("PLUGGY_ALLOWED_EMAILS") ? undefined : "Sem ela, só os admins (o plano grátis do Pluggy é pra uso pessoal).",
        },
      ],
    },
  ];
}
