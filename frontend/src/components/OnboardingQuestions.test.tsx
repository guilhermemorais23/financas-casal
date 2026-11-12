// Pergunta inicial: aparece pra quem nunca respondeu, salva a resposta (ou o
// "Pular") e não volta depois.
import { describe, expect, it } from "vitest";
import { callsTo, onApi } from "../test/fakeApi";
import { fakeAuth } from "../test/fakeAuth";
import { renderPage } from "../test/render";
import { MODULE_KEYS, reopenOnboarding, type Preferences } from "../utils/preferences";
import { OnboardingQuestions } from "./OnboardingQuestions";

const ALL_ON = Object.fromEntries(MODULE_KEYS.map((key) => [key, true])) as Preferences["modules"];

function answer(body: unknown): Preferences {
  const { usage, goals } = body as Pick<Preferences, "usage" | "goals">;
  return { usage, goals, modules: ALL_ON };
}

describe("pergunta inicial", () => {
  it("aparece pra quem nunca respondeu, e Pular salva tudo em branco", async () => {
    onApi("PUT", "/me/preferences", (call) => answer(call.body));
    const screen = await renderPage(<OnboardingQuestions />, { route: "/dashboard" });
    await expect.element(screen.getByRole("heading", { name: "Você vai usar com quem?" })).toBeVisible();

    await screen.getByRole("button", { name: "Pular" }).click();
    await expect.poll(() => callsTo("PUT", "/me/preferences").map((c) => c.body)).toEqual([{ usage: null, goals: [] }]);
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    expect(fakeAuth.user.preferences?.usage).toBeNull();
  });

  it("com meu par + juntar dinheiro: manda as duas respostas", async () => {
    onApi("PUT", "/me/preferences", (call) => answer(call.body));
    const screen = await renderPage(<OnboardingQuestions />, { route: "/dashboard" });

    const continuar = screen.getByRole("button", { name: "Continuar" });
    await expect.element(continuar).toBeDisabled();
    await screen.getByRole("button", { name: "Com meu par" }).click();
    await continuar.click();

    await expect.element(screen.getByRole("heading", { name: "O que você quer resolver?" })).toBeVisible();
    await screen.getByRole("button", { name: "Juntar dinheiro" }).click();
    await expect.element(screen.getByRole("button", { name: "Juntar dinheiro" })).toHaveAttribute("aria-pressed", "true");
    await screen.getByRole("button", { name: "Pronto" }).click();

    await expect
      .poll(() => callsTo("PUT", "/me/preferences").map((c) => c.body))
      .toEqual([{ usage: "couple", goals: ["saving"] }]);
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  });

  it("quem já respondeu não vê a pergunta", async () => {
    fakeAuth.user.preferences = { usage: "solo", goals: [], modules: ALL_ON };
    const screen = await renderPage(
      <>
        <p>tela</p>
        <OnboardingQuestions />
      </>,
      { route: "/dashboard" }
    );
    await expect.element(screen.getByText("tela")).toBeVisible();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("Refazer as perguntas abre de novo, com a resposta de antes marcada", async () => {
    fakeAuth.user.preferences = { usage: "friends", goals: ["split"], modules: ALL_ON };
    const screen = await renderPage(<OnboardingQuestions />, { route: "/account" });
    reopenOnboarding();
    await expect.element(screen.getByRole("button", { name: "Com amigos" })).toHaveAttribute("aria-pressed", "true");
  });
});
