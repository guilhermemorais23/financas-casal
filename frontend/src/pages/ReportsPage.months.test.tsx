// Relatórios ao trocar de mês: a resposta atrasada de um mês não pode tomar o
// lugar do mês que está na tela, e um erro passageiro não pode ficar preso.
import { beforeEach, describe, expect, it } from "vitest";
import { setActiveGroupId } from "../api/activeGroup";
import { ApiError } from "../api/client";
import { onApi } from "../test/fakeApi";
import { ME } from "../test/fakeAuth";
import { renderPage } from "../test/render";
import { ReportsPage } from "./ReportsPage";

function tx(id: string, description: string, occurredAt: string) {
  return {
    id,
    description,
    amount: "10.00",
    transactionType: "expense",
    occurredAt,
    categoryId: null,
    categoryName: null,
    categoryEmoji: null,
    isPrivate: false,
    recurringGroupId: null,
    splitType: "none",
    isSettled: false,
    accountId: "acc-me",
    accountType: "personal",
    paymentMethod: null,
    payerId: ME,
    linkKind: null,
  };
}

beforeEach(() => {
  onApi("GET", /^\/transactions\/summary\?month=/, { total: "10.00", byCategory: [] });
  onApi("GET", /^\/transactions\/summary\/year\?/, { year: 2026, months: [], totalIncome: "0", totalExpense: "0" });
});

async function pickMonth(screen: Awaited<ReturnType<typeof renderPage>>, current: RegExp, abbreviation: string) {
  await screen.getByRole("button", { name: current }).click();
  await screen.getByRole("button", { name: abbreviation, exact: true }).click();
}

describe("Relatórios trocando de mês", () => {
  it("a resposta atrasada do mês anterior não substitui o mês da tela", async () => {
    let releaseNovember: () => void = () => {};
    const novemberArrived = new Promise<void>((resolve) => (releaseNovember = resolve));
    onApi("GET", /^\/transactions\?limit=500&month=2026-11/, async () => {
      await novemberArrived;
      return [tx("nov", "Gasto de novembro", "2026-11-05")];
    });
    onApi("GET", /^\/transactions\?limit=500&month=2026-10/, [tx("out", "Gasto de outubro", "2026-10-05")]);

    const screen = await renderPage(<ReportsPage />, { route: "/reports?month=2026-11" });
    await pickMonth(screen, /^novembro.2026/, "out");
    await expect.element(screen.getByText("Gasto de outubro")).toBeInTheDocument();

    releaseNovember();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(document.body.textContent).not.toContain("Gasto de novembro");
    expect(document.body.textContent).toContain("Gasto de outubro");
  });

  it("um erro num mês some quando o próximo mês carrega certo", async () => {
    onApi("GET", /^\/transactions\?limit=500&month=2026-11/, () => {
      throw new ApiError("Falhou a conexão", 500, null);
    });
    onApi("GET", /^\/transactions\?limit=500&month=2026-10/, [tx("out", "Gasto de outubro", "2026-10-05")]);

    const screen = await renderPage(<ReportsPage />, { route: "/reports?month=2026-11" });
    await expect.element(screen.getByText("Falhou a conexão")).toBeInTheDocument();
    await pickMonth(screen, /^novembro.2026/, "out");
    await expect.element(screen.getByText("Gasto de outubro")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Falhou a conexão");
  });
});

describe("Relatórios trocando de grupo", () => {
  it("a resposta que chega depois da troca de grupo não vai pro cache do grupo novo", async () => {
    setActiveGroupId("grupo-casal");
    let release: () => void = () => {};
    const arrived = new Promise<void>((resolve) => (release = resolve));
    onApi("GET", /^\/transactions\?limit=500&month=2026-11/, async () => {
      await arrived;
      return [tx("nov", "Gasto do casal", "2026-11-05")];
    });

    await renderPage(<ReportsPage />, { route: "/reports?month=2026-11" });
    setActiveGroupId("grupo-familia");
    release();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const leaked = Object.keys(localStorage).filter((key) => key.startsWith("par-cache:grupo-familia:"));
    expect(leaked).toEqual([]);
    setActiveGroupId(null);
  });
});
