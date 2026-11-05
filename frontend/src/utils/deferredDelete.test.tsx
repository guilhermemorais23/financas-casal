// Excluir com Desfazer: o que ainda está esperando o tempo de desfazer é
// mandado quando o app sai de cena -- e com keepalive, senão o navegador
// cancela o pedido junto com a página e o lançamento "excluído" volta.
import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleDeferred } from "./deferredDelete";

const realClient = await vi.importActual<typeof import("../api/client")>("../api/client");

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

function spyFetch() {
  return vi.spyOn(window, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
}

describe("exclusão adiada", () => {
  it("ao fechar a página, manda o DELETE com keepalive", async () => {
    const fetchSpy = spyFetch();
    scheduleDeferred("tx:1", () => realClient.apiRequest("/transactions/1", { method: "DELETE" }));

    window.dispatchEvent(new Event("pagehide"));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: "DELETE", keepalive: true });
  });

  it("ao ir pro segundo plano (iPhone nem sempre avisa o pagehide), manda também", async () => {
    const fetchSpy = spyFetch();
    scheduleDeferred("tx:2", () => realClient.apiRequest("/transactions/2", { method: "DELETE" }));

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ keepalive: true });
  });

  it("um pedido comum não vai com keepalive", async () => {
    const fetchSpy = spyFetch();
    await realClient.apiRequest("/transactions/3", { method: "DELETE" }).catch(() => undefined);
    expect(fetchSpy.mock.calls[0][1]).not.toMatchObject({ keepalive: true });
  });
});
