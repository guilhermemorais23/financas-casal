import { describe, expect, it } from "vitest";
import {
  clearReadCache,
  invalidateAllReads,
  invalidateScopes,
  invalidateTransactionReads,
  memoizeReads,
  memoizeScoped,
  runWithReadScope,
} from "./readCache";

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

describe("memoizeScoped", () => {
  it("só guarda dentro de uma leitura (GET); fora dela sempre lê de novo", async () => {
    clearReadCache();
    let loads = 0;
    const load = async () => [++loads];

    expect(await memoizeScoped("u", ["user:1"], load)).toEqual([1]);
    expect(await memoizeScoped("u", ["user:1"], load)).toEqual([2]);

    await runWithReadScope(true, async () => {
      expect(await memoizeScoped("u", ["user:1"], load)).toEqual([3]);
      expect(await memoizeScoped("u", ["user:1"], load)).toEqual([3]);
    });
    await runWithReadScope(false, async () => {
      expect(await memoizeScoped("u", ["user:1"], load)).toEqual([4]);
    });
  });

  it("descarta quando um escopo dele muda, e só ele", async () => {
    clearReadCache();
    let a = 0;
    let b = 0;
    await runWithReadScope(true, async () => {
      await memoizeScoped("a", ["group:A", "cards"], async () => ++a);
      await memoizeScoped("b", ["group:B"], async () => ++b);

      invalidateScopes(["group:A"]);
      expect(await memoizeScoped("a", ["group:A", "cards"], async () => ++a)).toBe(2);
      expect(await memoizeScoped("b", ["group:B"], async () => ++b)).toBe(1);

      invalidateScopes(["cards"]);
      expect(await memoizeScoped("a", ["group:A", "cards"], async () => ++a)).toBe(3);

      invalidateAllReads();
      expect(await memoizeScoped("b", ["group:B"], async () => ++b)).toBe(2);
    });
  });

  it("cada chamador recebe a própria cópia da lista", async () => {
    clearReadCache();
    await runWithReadScope(true, async () => {
      const first = await memoizeScoped("list", ["x"], async () => [3, 1, 2]);
      first.sort();
      expect(await memoizeScoped("list", ["x"], async () => [9])).toEqual([3, 1, 2]);
    });
  });
});
