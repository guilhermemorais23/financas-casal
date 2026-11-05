// À noite no Brasil (21h-meia-noite) o UTC já está no dia seguinte: no último
// dia do mês, o padrão "mês atual" pulava pro mês seguinte.
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseMonthRange } from "./month";

afterEach(() => {
  vi.useRealTimers();
});

describe("mês atual à noite no Brasil", () => {
  it("parseMonthRange() sem mês usa o mês do Brasil, não o do UTC", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-30T23:30:00-03:00"));
    expect(parseMonthRange().periodMonth).toBe("2026-11-01");
  });
});
