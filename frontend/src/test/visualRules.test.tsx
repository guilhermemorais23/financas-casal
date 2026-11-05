// Regras de CSS que só aparecem num aparelho de verdade:
// - no iPhone, um campo com fonte menor que 16px dá zoom ao tocar (e a tela
//   fica com zoom depois);
// - a rolagem de dentro de um modal não pode vazar pra página de trás;
// - no tema escuro, nada de bloco creme claro (as cores olive não tinham
//   versão escura).
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

function mount(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-theme");
});

// Fundo dos cartões no tema escuro (--surface): uma cor translúcida aparece
// misturada com ele.
const DARK_SURFACE = [20, 32, 30];

// Luminância relativa (0 = preto, 1 = branco) de "rgb(...)"/"rgba(...)",
// como aparece sobre o fundo escuro.
function luminance(color: string): number {
  const [r0, g0, b0, a = 1] = (color.match(/[\d.]+/g) ?? []).map(Number);
  const [r, g, b] = [r0, g0, b0].map((c, i) => c * a + DARK_SURFACE[i] * (1 - a));
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

describe("campos no celular", () => {
  it("têm fonte de pelo menos 16px (o iPhone não dá zoom)", async () => {
    await page.viewport(390, 844);
    const host = mount(`
      <form class="split-settle-form"><input id="a" /></form>
      <input class="category-budget-input" id="b" />
      <div class="rules-list"><select id="c"></select></div>
      <div class="bill-row-edit"><select id="d"></select></div>
    `);
    for (const id of ["a", "b", "c", "d"]) {
      const size = parseFloat(getComputedStyle(host.querySelector(`#${id}`)!).fontSize);
      expect(size, `#${id}`).toBeGreaterThanOrEqual(16);
    }
  });
});

describe("modal", () => {
  it("a rolagem de dentro não vaza pra página de trás", () => {
    const host = mount(`<div class="modal-backdrop"><div class="modal-panel" id="p"></div></div>`);
    expect(getComputedStyle(host.querySelector("#p")!).overscrollBehaviorY).toBe("contain");
  });
});

describe("tema escuro", () => {
  it("parcela da fatura e ícone de contas não viram bloco claro", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    const host = mount(`<span class="fatura-parcela" id="a">2/5</span><span class="quick-action-icon bills" id="b"></span>`);
    for (const id of ["a", "b"]) {
      const bg = getComputedStyle(host.querySelector(`#${id}`)!).backgroundColor;
      expect(luminance(bg), `#${id} ${bg}`).toBeLessThan(0.3);
    }
  });
});
