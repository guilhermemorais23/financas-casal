import { describe, expect, it } from "vitest";
import { clearReadCache, invalidateTransactionReads, memoizeReads } from "./readCache";

describe("memoizeReads", () => {
  it("serves the same result without re-running the load, until invalidated", async () => {
    clearReadCache();
    let loads = 0;
    const load = async () => ++loads;

    expect(await memoizeReads("k", load)).toBe(1);
    expect(await memoizeReads("k", load)).toBe(1);
    expect(loads).toBe(1);

    invalidateTransactionReads();
    expect(await memoizeReads("k", load)).toBe(2);
  });

  it("shares one in-flight load between concurrent callers", async () => {
    clearReadCache();
    let loads = 0;
    const load = async () => {
      loads++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return "v";
    };
    const results = await Promise.all([memoizeReads("k", load), memoizeReads("k", load), memoizeReads("k", load)]);
    expect(results).toEqual(["v", "v", "v"]);
    expect(loads).toBe(1);
  });

  it("never serves a failed load again", async () => {
    clearReadCache();
    let calls = 0;
    await expect(
      memoizeReads("k", async () => {
        calls++;
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(await memoizeReads("k", async () => ++calls)).toBe(2);
  });

  it("keeps different keys separate", async () => {
    clearReadCache();
    expect(await memoizeReads("a", async () => "A")).toBe("A");
    expect(await memoizeReads("b", async () => "B")).toBe("B");
  });
});
