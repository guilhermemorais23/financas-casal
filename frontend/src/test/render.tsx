// Renderiza uma tela com o que o app real põe em volta (rotas, avisos,
// confirmação), numa largura escolhida.
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ConfirmProvider } from "../components/ConfirmDialog";
import { ToastProvider } from "../components/ToastProvider";

export async function renderPage(
  ui: ReactNode,
  {
    route = "/",
    path = "*",
    width = 390,
    frameWidth,
  }: {
    route?: string;
    path?: string;
    width?: number;
    // Largura da coluna onde a tela fica (no PC o conteúdo é uma coluna
    // estreita no meio de uma tela larga -- foi assim que o bug do
    // cabeçalho do dia apareceu).
    frameWidth?: number;
  } = {}
) {
  await page.viewport(width, 844);
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ToastProvider>
        <ConfirmProvider>
          <Routes>
            <Route path={path} element={frameWidth ? <div style={{ width: frameWidth }}>{ui}</div> : ui} />
          </Routes>
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

// Dois elementos se sobrepõem na tela? (retângulos que se cruzam)
export function overlaps(a: Element, b: Element): boolean {
  const r1 = a.getBoundingClientRect();
  const r2 = b.getBoundingClientRect();
  return r1.left < r2.right - 0.5 && r2.left < r1.right - 0.5 && r1.top < r2.bottom - 0.5 && r2.top < r1.bottom - 0.5;
}

// O elemento cabe inteiro dentro do outro (nada vazando pra fora)?
export function isInside(inner: Element, outer: Element): boolean {
  const r1 = inner.getBoundingClientRect();
  const r2 = outer.getBoundingClientRect();
  return r1.left >= r2.left - 0.5 && r1.right <= r2.right + 0.5 && r1.top >= r2.top - 0.5 && r1.bottom <= r2.bottom + 0.5;
}
