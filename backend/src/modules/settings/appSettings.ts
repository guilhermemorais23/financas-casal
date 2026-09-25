import { db } from "../../db/firestore";

// Chaves que o admin liga e desliga no próprio app (Admin), sem mexer no
// Render: cobrança do Premium e modo manutenção. Um documento só,
// appSettings/global, lido no máximo a cada 30 s por servidor.
export interface AppSettings {
  // null = nunca mexeram no botão: vale a variável BILLING_ENABLED do Render.
  billingEnabled: boolean | null;
  maintenance: { enabled: boolean; message: string };
}

const DEFAULT_MAINTENANCE_MESSAGE = "Estamos atualizando o PAR. Dá pra ver tudo, mas salvar fica pausado por alguns minutos.";
const ref = db.collection("appSettings").doc("global");
const TTL_MS = 30 * 1000;
let cached: { at: number; value: AppSettings } | null = null;

function fromData(data: FirebaseFirestore.DocumentData | undefined): AppSettings {
  return {
    billingEnabled: typeof data?.billingEnabled === "boolean" ? data.billingEnabled : null,
    maintenance: {
      enabled: data?.maintenance?.enabled === true,
      message: typeof data?.maintenance?.message === "string" && data.maintenance.message ? data.maintenance.message : DEFAULT_MAINTENANCE_MESSAGE,
    },
  };
}

export async function getAppSettings(): Promise<AppSettings> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  try {
    const doc = await ref.get();
    cached = { at: Date.now(), value: fromData(doc.data()) };
  } catch (err) {
    // Banco fora (ex.: cota): segue com o último valor conhecido.
    if (cached) return cached.value;
    throw err;
  }
  return cached.value;
}

export async function isBillingEnabled(): Promise<boolean> {
  const settings = await getAppSettings();
  return settings.billingEnabled ?? process.env.BILLING_ENABLED === "true";
}

export async function updateAppSettings(patch: { billingEnabled?: boolean; maintenance?: { enabled: boolean; message?: string } }): Promise<AppSettings> {
  const current = await getAppSettings();
  const next: AppSettings = {
    billingEnabled: patch.billingEnabled ?? current.billingEnabled,
    maintenance: patch.maintenance
      ? { enabled: patch.maintenance.enabled, message: patch.maintenance.message?.trim().slice(0, 200) || current.maintenance.message }
      : current.maintenance,
  };
  await ref.set(next, { merge: true });
  cached = { at: Date.now(), value: next };
  return next;
}

// Test hook.
export function clearAppSettingsCache(): void {
  cached = null;
}
