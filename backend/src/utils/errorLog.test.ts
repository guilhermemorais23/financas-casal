import { describe, expect, it } from "vitest";
import { isQuotaError, listMemoryErrors, logError } from "./errorLog";

describe("errorLog", () => {
  it("reconhece o erro de cota do Firestore", () => {
    expect(isQuotaError(Object.assign(new Error("8 RESOURCE_EXHAUSTED: Quota exceeded."), { code: 8 }))).toBe(true);
    expect(isQuotaError(new Error("Quota exceeded."))).toBe(true);
    expect(isQuotaError(new Error("Invalid argument"))).toBe(false);
  });

  it("guarda o erro na memória mesmo quando não dá pra gravar no Firestore", () => {
    logError("http", Object.assign(new Error("8 RESOURCE_EXHAUSTED: Quota exceeded."), { code: 8 }), { path: "/me" });
    expect(listMemoryErrors(1)[0]).toMatchObject({ source: "http", path: "/me", message: expect.stringContaining("Quota") });
  });
});
