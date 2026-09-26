import { describe, expect, it, vi } from "vitest";

const reply = vi.hoisted(() => ({ text: "" }));
vi.mock("../../utils/gemini", () => ({
  geminiModel: () => ({
    generateContent: async () => ({
      response: { text: () => reply.text, usageMetadata: { promptTokenCount: 100, totalTokenCount: 130 } },
    }),
  }),
  tokensOf: () => ({ input: 100, output: 30 }),
}));

import { suggestCategories } from "./suggestCategories";

const categories = [
  { id: "c-casa", name: "Contas da casa" },
  { id: "c-saude", name: "Saúde" },
];
const names = [
  { key: "energisa pb", name: "ENERGISA PB", kind: "Pix qr code estatico", transactionType: "expense" as const, total: "175.65" },
  { key: "raia drogasil sa", name: "RAIA DROGASIL SA", kind: null, transactionType: "expense" as const, total: "161.20" },
  { key: "maria silva", name: "Maria Silva", kind: "Pix enviado", transactionType: "expense" as const, total: "50.00" },
  { key: "transf saldo c sal p cc", name: "TRANSF SALDO C/SAL P/CC", kind: null, transactionType: "income" as const, total: "16050.02" },
];

describe("suggestCategories", () => {
  it("lê a resposta da IA: categoria pelo número, 'não é gasto' e dúvida sem sugestão", async () => {
    reply.text = JSON.stringify([
      { i: 0, c: 1, n: false },
      { i: 1, c: 2, n: false },
      { i: 2, c: null, n: false },
      { i: 3, c: null, n: true },
      { i: 9, c: 1, n: false }, // índice que não existe
      { i: 0, c: 99, n: false }, // categoria que não existe não sobrescreve
    ]);
    const tokens: number[] = [];
    const out = await suggestCategories(names, categories, "key", (t) => tokens.push(t.input));
    expect(Object.fromEntries(out)).toEqual({
      "expense:energisa pb": { categoryId: "c-casa", notExpense: false },
      "expense:raia drogasil sa": { categoryId: "c-saude", notExpense: false },
      "income:transf saldo c sal p cc": { categoryId: null, notExpense: true },
    });
    expect(tokens).toEqual([100]);
  });

  it("resposta quebrada vira nenhuma sugestão, sem erro", async () => {
    reply.text = "não é json";
    expect((await suggestCategories(names, categories, "key")).size).toBe(0);
  });
});
