import { afterEach, describe, expect, it } from "vitest";
import { getAiUsageSummary, hasAiLeft, recordAiTokens, reserveAi } from "./aiUsage";

const uid = () => `u-${Math.random().toString(36).slice(2, 10)}`;

describe("cota de IA por pessoa", () => {
  afterEach(() => {
    delete process.env.AI_MONTHLY_MESSAGES;
  });

  it("conta até o limite e depois recusa, sem gastar a mais", async () => {
    process.env.AI_MONTHLY_MESSAGES = "2";
    const userId = uid();
    expect(await reserveAi(userId, "message")).toEqual({ allowed: true, used: 1, limit: 2 });
    expect(await hasAiLeft(userId, "message")).toBe(true);
    expect(await reserveAi(userId, "message")).toEqual({ allowed: true, used: 2, limit: 2 });
    expect(await reserveAi(userId, "message")).toEqual({ allowed: false, used: 2, limit: 2 });
    expect(await hasAiLeft(userId, "message")).toBe(false);
    // Importação tem cota separada.
    expect((await reserveAi(userId, "import")).allowed).toBe(true);
  });

  it("soma tokens e estima custo no resumo do Admin", async () => {
    const userId = uid();
    await reserveAi(userId, "message");
    await recordAiTokens(userId, { input: 1_000_000, output: 1_000_000 });
    const summary = await getAiUsageSummary();
    expect(summary.people).toBeGreaterThanOrEqual(1);
    expect(summary.tokens.input).toBeGreaterThanOrEqual(1_000_000);
    // Flash-Lite: (0,10 + 0,40) dólar x 5,5 = R$ 2,75 só deste usuário.
    expect(summary.costBrl).toBeGreaterThanOrEqual(2.75);
  });
});
