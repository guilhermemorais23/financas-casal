// Token renovado no meio do pedido: se depois disso o grupo também tiver sido
// perdido, a nova tentativa tem que ir com o token NOVO (antes voltava com o
// velho e dava 401 de novo).
import { afterEach, describe, expect, it, vi } from "vitest";
import { setActiveGroupId } from "./activeGroup";

const client = await vi.importActual<typeof import("./client")>("./client");

afterEach(() => {
  vi.restoreAllMocks();
  client.setTokenRefresher(null);
  setActiveGroupId(null);
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("apiRequest: token renovado + grupo perdido", () => {
  it("a última tentativa vai com o token novo", async () => {
    setActiveGroupId("grupo-antigo");
    client.setTokenRefresher(async () => "token-novo");
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockResolvedValueOnce(json(401, { error: "expired" }))
      .mockResolvedValueOnce(json(403, { error: "sem grupo", code: "group_access" }))
      .mockResolvedValueOnce(json(200, { ok: true }));

    await expect(client.apiRequest("/dashboard", { token: "token-velho" })).resolves.toEqual({ ok: true });

    const auth = fetchSpy.mock.calls.map(([, init]) => (init?.headers as Record<string, string>).Authorization);
    expect(auth).toEqual(["Bearer token-velho", "Bearer token-novo", "Bearer token-novo"]);
  });
});
