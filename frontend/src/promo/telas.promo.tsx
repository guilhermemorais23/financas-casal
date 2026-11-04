// Uma captura por cena do vídeo (ver promo/video/roteiro.md).
import type { ReactElement } from "react";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { fakeAuth } from "../test/fakeAuth";
import { renderPage } from "../test/render";
import { prepareCasalApi, prepareDemoApi } from "./demoData";

vi.unmock("../layouts/AppLayout");
vi.mock("../firebase", () => ({ firebaseAuth: {} }));

const { DashboardPage } = await import("../pages/DashboardPage");
const { NewTransactionPage } = await import("../pages/NewTransactionPage");
const { ParPage } = await import("../pages/ParPage");
const { CardStatementPage } = await import("../pages/CardStatementPage");
const { GoalsPage } = await import("../pages/GoalsPage");

fakeAuth.user.displayName = "Gui";

// A fonte do app (Bricolage Grotesque) vem do Google Fonts pelo index.html,
// que os testes não usam: aqui ela entra pelo pacote npm, sem internet.
await import("@fontsource-variable/bricolage-grotesque");
document.documentElement.style.setProperty("--font-sans", '"Bricolage Grotesque Variable", system-ui, sans-serif');
const OUT = "../../../promo/video/public/telas";

type Tela = ReturnType<typeof renderPage> extends Promise<infer R> ? R : never;
type Cena = {
  name: string;
  route: string;
  path: string;
  ui: () => ReactElement;
  ready: RegExp;
  // Rola pra segunda captura (fração da altura da tela)...
  scroll?: number;
  // ...ou até um texto ficar no meio da tela (numa captura só, ou como a
  // segunda se focarNaSegunda: a primeira fica no topo).
  focar?: RegExp;
  focarNaSegunda?: boolean;
  // Mexe na tela antes de capturar (preencher o formulário, por exemplo).
  preparar?: (tela: Tela) => Promise<void>;
  // Dados do grupo de casal em vez do grupo de amigos.
  casal?: boolean;
};

const scenes: Cena[] = [
  { name: "painel", route: "/dashboard", path: "/dashboard", ui: () => <DashboardPage />, ready: /Nubank|Viagem/, scroll: 0.85 },
  {
    name: "lancar",
    route: "/transactions/new",
    path: "/transactions/new",
    ui: () => <NewTransactionPage />,
    ready: /Descrição|Valor/,
    // "Bar sexta · R$ 240 · dividido entre os 4" (roteiro, cena 3).
    preparar: async (tela) => {
      await tela.getByLabelText("Valor (R$)").fill("240,00");
      await tela.getByLabelText("Descrição").fill("Bar sexta");
      await tela.getByRole("button", { name: /Mais opções/ }).click();
      await tela.getByLabelText("Divisão").selectOptions("equal");
    },
    focar: /60,00 cada/,
    focarNaSegunda: true,
  },
  { name: "par", route: "/par", path: "/par", ui: () => <ParPage />, ready: /te deve/, focar: /Lucas te deve/ },
  { name: "casal", route: "/par", path: "/par", ui: () => <ParPage />, ready: /Aluguel/, casal: true },
  { name: "fatura", route: "/cards/card-1/fatura", path: "/cards/:id/fatura", ui: () => <CardStatementPage />, ready: /Ingresso do show/, scroll: 0.55 },
  { name: "metas", route: "/goals", path: "/goals", ui: () => <GoalsPage />, ready: /Viagem pra Floripa/ },
];

for (const scene of scenes) {
  it(scene.name, async () => {
    prepareDemoApi();
    if (scene.casal) prepareCasalApi();
    const screen = await renderPage(scene.ui(), { route: scene.route, path: scene.path, width: 430 });
    await expect.element(screen.getByText(scene.ready).first()).toBeVisible();
    if (scene.preparar) await scene.preparar(screen);
    if (scene.focar && !scene.focarNaSegunda) {
      const alvo = screen.getByText(scene.focar).first();
      await expect.element(alvo).toBeVisible();
      alvo.element().scrollIntoView({ block: "center" });
    }
    await document.fonts.load('700 32px "Bricolage Grotesque Variable"');
    await document.fonts.ready;
    // Deixa as animações de entrada (logo, barras) terminarem.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    // Um quadro fixo do tamanho da tela: a captura sai exatamente com o que
    // aparece no celular (o Chromium não desenha fora da janela, e capturar
    // o body inteiro, rolado, deixava um bloco em branco).
    const frame = document.createElement("div");
    frame.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:-1";
    document.body.appendChild(frame);
    await page.screenshot({ path: `${OUT}/${scene.name}.png`, element: frame });
    // Tela com mais conteúdo: rola e tira a segunda (no vídeo, a cena
    // desliza de uma pra outra, como quem rola o celular).
    if (scene.focar && scene.focarNaSegunda) {
      const alvo = screen.getByText(scene.focar).first();
      await expect.element(alvo).toBeVisible();
      alvo.element().scrollIntoView({ block: "center" });
      await new Promise((resolve) => setTimeout(resolve, 600));
      await page.screenshot({ path: `${OUT}/${scene.name}-2.png`, element: frame });
    }
    if (scene.scroll) {
      window.scrollTo(0, Math.round(window.innerHeight * scene.scroll));
      await new Promise((resolve) => setTimeout(resolve, 600));
      await page.screenshot({ path: `${OUT}/${scene.name}-2.png`, element: frame });
    }
  });
}
