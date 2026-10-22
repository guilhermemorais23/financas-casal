import { describe, expect, it } from "vitest";
import { healthBody } from "./app";

describe("healthBody (/api/health)", () => {
  it("mostra os 7 primeiros caracteres do commit que o Render informa", () => {
    expect(healthBody({ RENDER_GIT_COMMIT: "934f193d1c2b3a4e5f60718293a4b5c6d7e8f901" })).toEqual({
      status: "ok",
      commit: "934f193",
    });
  });

  it("sem a variável (no seu PC), o commit vem null", () => {
    expect(healthBody({})).toEqual({ status: "ok", commit: null });
  });
});
