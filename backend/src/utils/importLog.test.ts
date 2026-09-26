import { describe, expect, it } from "vitest";
import { db } from "../db/firestore";
import { createTestGroup } from "../test-helpers";
import { previewStatement } from "../modules/statements/statements.service";
import { getImportStats } from "./importLog";

// logImport não espera a gravação; dá tempo dela chegar.
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

describe("importações por banco (Admin)", () => {
  it("counts each read by source and outcome, without keeping what the statement says", async () => {
    const { userAId } = await createTestGroup();
    await previewStatement(userAId, { content: "Data;Descrição;Valor\n15/09/2026;Padaria;-10,00" });
    await expect(previewStatement(userAId, { content: "" })).rejects.toThrow();
    await settle();

    const mine = await db.collection("importEvents").where("userId", "==", userAId).get();
    expect(mine.size).toBe(2);
    for (const doc of mine.docs) {
      expect(Object.keys(doc.data()).sort()).toEqual(["createdAt", "outcome", "readBy", "rows", "source", "userId"]);
    }

    const stats = await getImportStats(1);
    const csv = stats.sources.find((s) => s.source === "csv");
    expect(csv?.ok).toBeGreaterThanOrEqual(1);
    const file = stats.sources.find((s) => s.source === "arquivo");
    expect(file?.error).toBeGreaterThanOrEqual(1);
  });
});
