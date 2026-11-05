// Lançamento recém-salvo ainda a caminho do servidor (linha otimista com id
// "pending-..."): aparece na lista, mas sem Editar/Excluir -- o id não existe
// no servidor e o pedido daria 404.
import { describe, expect, it } from "vitest";
import { onApi } from "../test/fakeApi";
import { ME } from "../test/fakeAuth";
import { renderPage } from "../test/render";
import { writeCache } from "../utils/pageCache";
import { ReportsPage } from "./ReportsPage";

function row(id: string, description: string) {
  return {
    id, description, amount: "10.00", transactionType: "expense", occurredAt: "2026-11-05", categoryId: null,
    categoryName: null, categoryEmoji: null, isPrivate: false, recurringGroupId: null, splitType: "none",
    isSettled: false, accountId: "acc-me", accountType: "personal", paymentMethod: null, payerId: ME, linkKind: null,
  };
}

describe("linha ainda sendo salva", () => {
  it("não mostra Editar enquanto o servidor não confirmou", async () => {
    writeCache(`reports:summary:2026-11:${ME}`, { total: "20.00", byCategory: [] });
    writeCache(`reports:transactions:2026-11:${ME}`, [row("pending-1", "Padaria"), row("tx-1", "Mercado")]);
    // O servidor ainda não respondeu: a tela fica com o que estava no cache.
    const never = new Promise<never>(() => {});
    onApi("GET", /^\/transactions\/summary\?month=/, () => never);
    onApi("GET", /^\/transactions\?limit=500&month=/, () => never);
    onApi("GET", /^\/transactions\/summary\/year\?/, () => never);
    onApi("GET", /^\/transactions\/summary\?month=2026-10/, () => never);

    const screen = await renderPage(<ReportsPage />, { route: "/reports?month=2026-11" });
    await expect.element(screen.getByText("Padaria")).toBeInTheDocument();
    await expect.element(screen.getByText("Mercado")).toBeInTheDocument();

    const rowOf = (text: string) => [...document.querySelectorAll("li")].find((li) => li.textContent?.includes(text))!;
    expect(rowOf("Mercado").querySelector('[title="Editar"]')).not.toBeNull();
    expect(rowOf("Padaria").querySelector('[title="Editar"]')).toBeNull();
  });
});
