// Menu "⋮" das linhas: nas últimas linhas da lista, no celular, o menu abria
// pra baixo, por baixo da barra de navegação de baixo (que fica em cima de
// tudo), e o "Excluir" ficava coberto.
import { describe, expect, it } from "vitest";
import { renderPage } from "../test/render";
import { RowActionsMenu, type RowAction } from "./RowActionsMenu";

const actions: RowAction[] = [
  { key: "edit", label: "Editar", icon: "pencil", onClick: () => {} },
  { key: "cancel", label: "Cancelar recorrência", icon: "repeat", onClick: () => {} },
  { key: "delete", label: "Excluir", icon: "trash", onClick: () => {}, danger: true },
];

// A barra de baixo do app no celular ocupa uns 70px no pé da tela.
const BOTTOM_NAV = 80;

describe("menu de ações da linha", () => {
  it("perto do pé da tela, abre pra cima e fica fora da barra de baixo", async () => {
    const screen = await renderPage(
      <div style={{ position: "fixed", right: 16, bottom: BOTTOM_NAV + 8 }}>
        <RowActionsMenu actions={actions} />
      </div>
    );
    await screen.getByTitle("Mais ações").click();
    const menu = screen.getByRole("menu");
    await expect.element(menu).toBeVisible();
    expect(menu.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight - BOTTOM_NAV);
  });

  it("fica acima da barra de baixo e do botão +", async () => {
    const screen = await renderPage(<RowActionsMenu actions={actions} />);
    await screen.getByTitle("Mais ações").click();
    expect(Number(getComputedStyle(screen.getByRole("menu").element()).zIndex)).toBeGreaterThan(45);
  });

  it("no topo da tela, continua abrindo pra baixo", async () => {
    const screen = await renderPage(
      <div style={{ position: "fixed", right: 16, top: 80 }}>
        <RowActionsMenu actions={actions} />
      </div>
    );
    const button = screen.getByTitle("Mais ações");
    await button.click();
    expect(screen.getByRole("menu").element().getBoundingClientRect().top).toBeGreaterThan(button.element().getBoundingClientRect().bottom);
  });
});
