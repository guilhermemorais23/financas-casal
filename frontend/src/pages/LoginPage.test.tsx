// Ícone na tela de início do iPhone: abre em "/", que vai pro /login. Quem já
// está logado tem que cair direto no app, e o email fica lembrado pra quem
// saiu (a senha fica com o iPhone: o Chaves do iCloud oferece salvar e
// preencher com Face ID, por isso os campos dizem o que são).
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render } from "vitest-browser-react";
import { fakeAuth } from "../test/fakeAuth";
import { LoginPage } from "./LoginPage";

const loggedInUser = fakeAuth.user;
afterEach(() => {
  fakeAuth.user = loggedInUser;
  fakeAuth.login = async () => {};
});

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<p>Painel aberto</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("tela de login", () => {
  it("quem já está logado vai direto pro Painel", async () => {
    const screen = await renderLogin();
    await expect.element(screen.getByText("Painel aberto")).toBeInTheDocument();
  });

  it("campos marcados pro iPhone oferecer salvar e preencher a senha", async () => {
    fakeAuth.user = null as unknown as typeof loggedInUser;
    const screen = await renderLogin();
    await expect.element(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "username");
    await expect.element(screen.getByLabelText("Senha", { exact: true })).toHaveAttribute("autocomplete", "current-password");
  });

  it("lembra o email depois de entrar", async () => {
    fakeAuth.user = null as unknown as typeof loggedInUser;
    const screen = await renderLogin();
    await screen.getByLabelText("Email").fill("gui@teste.dev");
    await screen.getByLabelText("Senha", { exact: true }).fill("segredo123");
    await expect.element(screen.getByLabelText("Lembrar meu email")).toBeChecked();
    await screen.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect.element(screen.getByText("Painel aberto")).toBeInTheDocument();

    expect(localStorage.getItem("par:remembered-email")).toBe("gui@teste.dev");
  });

  it("abre com o email lembrado; desmarcando, esquece", async () => {
    fakeAuth.user = null as unknown as typeof loggedInUser;
    localStorage.setItem("par:remembered-email", "antigo@teste.dev");
    const screen = await renderLogin();
    await expect.element(screen.getByLabelText("Email")).toHaveValue("antigo@teste.dev");
    await screen.getByLabelText("Lembrar meu email").click();
    await screen.getByLabelText("Senha", { exact: true }).fill("segredo123");
    await screen.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect.element(screen.getByText("Painel aberto")).toBeInTheDocument();
    expect(localStorage.getItem("par:remembered-email")).toBeNull();
  });
});
