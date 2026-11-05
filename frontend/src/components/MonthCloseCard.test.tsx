// Card "Fechamento de outubro" no Painel: depois do "Entendi" não volta mais
// naquele mês -- nem depois de sair e entrar, nem em outro aparelho (o "já vi"
// fica na conta, no servidor). Só volta no mês seguinte.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callsTo, onApi } from "../test/fakeApi";
import { renderPage } from "../test/render";
import { MonthCloseCard } from "./MonthCloseCard";

const close = (seen: boolean) => ({
  month: "2026-10", income: 5000, expense: 3000, left: 2000, previousMonth: "2026-09",
  previousIncome: 0, previousExpense: 0, previousLeft: 0, topCategories: [], hasActivity: true, seen,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-03T12:00:00"));
});
afterEach(() => vi.useRealTimers());

describe("card do fechamento do mês", () => {
  it("Entendi avisa o servidor e o card some", async () => {
    onApi("GET", /^\/month-close\?month=2026-10$/, close(false));
    onApi("POST", "/month-close/seen", null);
    const screen = await renderPage(<MonthCloseCard token="t" />);
    await screen.getByRole("button", { name: "Entendi" }).click();
    await expect.element(screen.getByText("Fechamento de outubro")).not.toBeInTheDocument();
    expect(callsTo("POST", "/month-close/seen").map((c) => c.body)).toEqual([{ month: "2026-10" }]);
  });

  it("já visto na conta: não aparece, mesmo num aparelho que nunca viu", async () => {
    onApi("GET", /^\/month-close\?month=2026-10$/, close(true));
    const screen = await renderPage(<MonthCloseCard token="t" />);
    await vi.waitFor(() => expect(callsTo("GET", /^\/month-close/).length).toBe(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.container.textContent).toBe("");
  });
});
