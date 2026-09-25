import { describe, expect, it } from "vitest";
import { answerFromSnapshot, parseQuickEntry, type MonthSnapshot } from "./monthSnapshot";

describe("parseQuickEntry", () => {
  it("reads the common ways people log money", () => {
    expect(parseQuickEntry("gastei 50 no mercado")).toEqual({ type: "expense", amount: 50, description: "Mercado" });
    expect(parseQuickEntry("paguei R$ 1.234,56 de aluguel")).toEqual({ type: "expense", amount: 1234.56, description: "Aluguel" });
    expect(parseQuickEntry("recebi 200")).toEqual({ type: "income", amount: 200, description: "Entrada" });
    expect(parseQuickEntry("quanto posso gastar?")).toBeNull();
  });
});

describe("answerFromSnapshot", () => {
  const snapshot: MonthSnapshot = {
    balanceToday: 5700,
    income: 7500,
    expense: 3000,
    monthLeft: 4500,
    daysLeft: 6,
    dailyAllowance: 750,
    upcoming: [
      { id: "c", kind: "card", direction: "pay", title: "Fatura Nubank", detail: "", amount: 1842.1, dueDate: "2026-09-26", daysUntil: 1, link: "/cards" },
    ],
    loansOutstanding: 1000,
    loansOverdue: 0,
    loans: [{ personName: "Mãe", remaining: 1000, dueDate: null, isOverdue: false }],
    owedOutstanding: 400,
    owed: [{ personName: "Pai", remaining: 400, dueDate: null, isOverdue: false }],
  };

  it("answers the question that was asked", () => {
    expect(answerFromSnapshot(snapshot, "o que vence essa semana?")).toContain("Fatura Nubank");
    expect(answerFromSnapshot(snapshot, "quanto posso gastar por dia?")).toContain("por dia");
    expect(answerFromSnapshot(snapshot, "quem me deve?")).toContain("R$");
    // contas 5.700 + a receber 1.000 - devo 400
    expect(answerFromSnapshot(snapshot, "quanto eu devo?")).toMatch(/6\.300,00/);
  });
});
