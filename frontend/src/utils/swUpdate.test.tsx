// O app da tela de início procura versão nova ao voltar pra tela e só
// recarrega quando ninguém está digitando.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUpdateWatcher } from "./swUpdate";

function setup(start = 0) {
  let agora = start;
  const update = vi.fn(() => Promise.resolve());
  const reload = vi.fn();
  const watcher = createUpdateWatcher({ update, reload, now: () => agora });
  return { watcher, update, reload, avancar: (ms: number) => (agora += ms) };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("checagem de versão nova", () => {
  it("procura ao voltar pro app, no máximo uma vez por minuto", () => {
    const { watcher, update, avancar } = setup(1_000_000);
    watcher.check();
    watcher.check();
    expect(update).toHaveBeenCalledTimes(1);
    avancar(61_000);
    watcher.check();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("versão nova sem ninguém digitando: recarrega na hora", () => {
    const { watcher, reload } = setup();
    watcher.needReload();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("com alguém digitando: espera sair do campo", async () => {
    const { watcher, reload } = setup();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    watcher.needReload();
    expect(reload).not.toHaveBeenCalled();
    input.blur();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
