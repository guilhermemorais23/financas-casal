// Metas: editar a meta e corrigir/apagar um guardar do histórico.
import { beforeEach, describe, expect, it } from "vitest";
import { callsTo, onApi } from "../test/fakeApi";
import { ME, members } from "../test/fakeAuth";
import { renderPage } from "../test/render";
import { GoalsPage } from "./GoalsPage";

const viagem = {
  id: "goal-1",
  name: "Viagem",
  emoji: null,
  photoDataUrl: null,
  targetAmount: "1000.00",
  currentAmount: "300.00",
  deadline: null,
  achievedAt: null,
  items: [],
};

beforeEach(() => {
  onApi("GET", "/goals", [viagem]);
  onApi("GET", "/groups/me", { members });
  onApi("GET", "/goals/goal-1/contributions", [
    { id: "c1", userId: ME, amount: "300.00", itemId: null, itemName: null, accountId: "acc-me", transactionId: "t1", createdAt: Date.UTC(2026, 10, 2) },
  ]);
});

describe("editar meta", () => {
  it("muda nome, alvo e guardado", async () => {
    onApi("PATCH", "/goals/goal-1", { ...viagem, name: "Viagem praia", targetAmount: "1500.00", currentAmount: "250.00" });
    const screen = await renderPage(<GoalsPage />);
    await screen.getByTitle("Editar meta").click();

    await expect.element(screen.getByLabelText("Alvo (R$)")).toHaveValue("1000,00");
    await screen.getByLabelText("Nome").fill("Viagem praia");
    await screen.getByLabelText("Alvo (R$)").fill("1.500,00");
    await screen.getByLabelText("Já guardado (R$)").fill("250");
    await screen.getByRole("button", { name: "Salvar", exact: true }).click();

    await expect.poll(() => callsTo("PATCH", "/goals/goal-1").length).toBe(1);
    expect(callsTo("PATCH", "/goals/goal-1")[0].body).toEqual({ name: "Viagem praia", deadline: null, targetAmount: 1500, currentAmount: 250 });
    await expect.element(screen.getByRole("heading", { name: "Viagem praia" })).toBeVisible();
  });

  it("meta com submetas não deixa mudar alvo e guardado direto", async () => {
    onApi("GET", "/goals", [{ ...viagem, items: [{ id: "i1", name: "Passagem", targetAmount: "1000.00", currentAmount: "300.00", isDone: false }] }]);
    const screen = await renderPage(<GoalsPage />);
    await screen.getByTitle("Editar meta").click();
    await expect.element(screen.getByText(/o alvo e o guardado são a soma delas/)).toBeVisible();
    await expect.element(screen.getByLabelText("Alvo (R$)")).not.toBeInTheDocument();
  });
});

describe("histórico", () => {
  it("corrigir o valor de um guardar", async () => {
    onApi("PATCH", "/goals/goal-1/contributions/c1", { ...viagem, currentAmount: "250.00" });
    const screen = await renderPage(<GoalsPage />);
    await screen.getByRole("button", { name: "Histórico" }).click();
    await screen.getByRole("button", { name: "Corrigir valor" }).click();
    await screen.getByRole("textbox", { name: "Valor certo" }).fill("250,00");
    await screen.getByTitle("Salvar").click();

    await expect.poll(() => callsTo("PATCH", "/goals/goal-1/contributions/c1").length).toBe(1);
    expect(callsTo("PATCH", "/goals/goal-1/contributions/c1")[0].body).toEqual({ amount: 250 });
  });

  it("apagar um guardar avisa que a transferência some do extrato", async () => {
    onApi("DELETE", "/goals/goal-1/contributions/c1", { ...viagem, currentAmount: "0.00" });
    const screen = await renderPage(<GoalsPage />);
    await screen.getByRole("button", { name: "Histórico" }).click();
    await screen.getByRole("button", { name: "Apagar do histórico" }).click();

    await expect.element(screen.getByRole("alertdialog")).toMatchTextContent(/a transferência some do extrato/);
    await screen.getByRole("alertdialog").getByRole("button", { name: "Apagar" }).click();
    await expect.poll(() => callsTo("DELETE", "/goals/goal-1/contributions/c1").length).toBe(1);
  });
});
