// Editar lançamento: se a lista de contas/categorias não carregar, a pessoa
// precisa saber (antes os campos ficavam vazios, sem aviso nenhum).
import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { onApi } from "../test/fakeApi";
import { ME } from "../test/fakeAuth";
import { renderPage } from "../test/render";
import { EditTransactionModal } from "./EditTransactionModal";

const transaction = {
  id: "tx-1", description: "Mercado", amount: "54.90", transactionType: "expense" as const, categoryId: null,
  occurredAt: "2026-11-05", accountId: "acc-me", payerId: ME, paymentMethod: null,
};

describe("editar lançamento", () => {
  it("avisa quando não deu pra carregar contas e categorias", async () => {
    onApi("GET", "/categories", () => {
      throw new ApiError("Sem conexão", 0, null);
    });
    onApi("GET", "/groups/me", () => {
      throw new ApiError("Sem conexão", 0, null);
    });
    const screen = await renderPage(<EditTransactionModal transaction={transaction} onClose={() => {}} onSaved={() => {}} />);
    await expect.element(screen.getByRole("alert")).toBeVisible();
  });
});
