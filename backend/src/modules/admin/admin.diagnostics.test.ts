import { afterEach, describe, expect, it } from "vitest";
import { buildDiagnostics } from "./admin.diagnostics";

const KEYS = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

async function item(section: string, label: RegExp) {
  const s = (await buildDiagnostics()).find((x) => x.id === section)!;
  return s.items.find((i) => label.test(i.label))!;
}

describe("Admin > Diagnóstico", () => {
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("canal desligado: segredo é opcional; ligado sem segredo: obrigatório faltando", async () => {
    for (const k of KEYS) delete process.env[k];
    expect(await item("telegram", /Segredo/)).toMatchObject({ ok: false, level: "optional" });
    expect(await item("whatsapp", /App Secret/)).toMatchObject({ ok: false, level: "optional" });

    process.env.TELEGRAM_BOT_TOKEN = "x";
    process.env.WHATSAPP_ACCESS_TOKEN = "y";
    expect(await item("telegram", /Segredo/)).toMatchObject({ ok: false, level: "required", env: "TELEGRAM_WEBHOOK_SECRET" });
    expect(await item("whatsapp", /App Secret/)).toMatchObject({ ok: false, level: "required", env: "WHATSAPP_APP_SECRET" });

    process.env.WHATSAPP_APP_SECRET = "z";
    expect((await item("whatsapp", /App Secret/)).ok).toBe(true);
  });

  it("nunca devolve o valor de uma chave", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "valor-secreto-123";
    expect(JSON.stringify(await buildDiagnostics())).not.toContain("valor-secreto-123");
  });
});
