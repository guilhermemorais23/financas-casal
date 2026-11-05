// Moldura do app: a versão no ar aparece ao lado da logo, no celular e no
// PC, sem empurrar nem cobrir o resto do topo.
import { describe, expect, it, vi } from "vitest";
import { onApi } from "../test/fakeApi";
import { members } from "../test/fakeAuth";
import { overlaps, renderPage } from "../test/render";

vi.unmock("../layouts/AppLayout");
// O Firebase de verdade não sobe nos testes (sem chave); a moldura só
// precisa que o módulo exista.
vi.mock("../firebase", () => ({ firebaseAuth: {} }));

const { AppLayout } = await import("./AppLayout");

function prepare() {
  onApi("GET", "/groups/me", { members, accounts: [] });
  onApi("GET", "/groups", { groups: [{ id: "group-1", name: "Nós", memberCount: 2 }] });
  onApi("GET", "/feedback/unread", { unread: 0 });
  onApi("GET", "/feedback", { messages: [] });
  onApi("GET", "/assistant/greeting", { text: "Oi" });
}

describe("versão no topo", () => {
  for (const [width, header] of [[390, ".app-mobile-topbar"], [1280, ".app-topnav"]] as const) {
    it(`aparece ao lado da logo sem cobrir nada (${width}px)`, async () => {
      prepare();
      const screen = await renderPage(<AppLayout><p>conteúdo</p></AppLayout>, { width });
      await expect.element(screen.getByText("conteúdo")).toBeVisible();

      const bar = document.querySelector(header)!;
      const version = bar.querySelector(".app-version")!;
      expect(version.textContent).toBe(`v${__APP_VERSION__}`);
      expect(getComputedStyle(version).display).not.toBe("none");
      expect(version.getBoundingClientRect().width).toBeGreaterThan(0);

      // Não cobre a logo nem os outros itens do topo.
      for (const other of bar.querySelectorAll(":scope > *")) {
        if (other !== version && other.getBoundingClientRect().width > 0) expect(overlaps(version, other)).toBe(false);
      }
      // E fica dentro da barra (não vaza da tela).
      expect(version.getBoundingClientRect().right).toBeLessThanOrEqual(width);
    });
  }
});

describe("link do e-mail de resposta (?feedback=1)", () => {
  it("abre o chat uma vez e tira o ?feedback=1 do endereço (senão reabre a cada troca de mês)", async () => {
    prepare();
    const { useLocation } = await import("react-router-dom");
    function Where() {
      const loc = useLocation();
      return <p data-testid="where">{`[${loc.pathname}${loc.search}]`}</p>;
    }
    const screen = await renderPage(
      <AppLayout>
        <Where />
      </AppLayout>,
      { route: "/dashboard?month=2026-11&feedback=1" }
    );
    await expect.element(screen.getByTestId("where")).toHaveTextContent("[/dashboard?month=2026-11]");
    expect(screen.getByTestId("where").element().textContent).not.toContain("feedback");
  });
});
