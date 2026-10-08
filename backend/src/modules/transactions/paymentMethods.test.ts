// Forma de pagamento: vem marcada na importação (texto do banco ou "Sempre
// assim"), é gravada no lançamento e dá pra organizar em lote depois.
import { describe, expect, it } from "vitest";
import { db } from "../../db/firestore";
import { createTestGroup, todayISO } from "../../test-helpers";
import { commitStatement, listImportRules, previewStatement } from "../statements/statements.service";
import { listWithoutPaymentMethod, setPaymentMethods } from "./paymentMethods";
import { createTransaction } from "./transactions.service";

function csvFor(date: string, rows: [string, string][]): string {
  return ["Data;Descrição;Valor", ...rows.map(([desc, amount]) => `${date};${desc};${amount}`)].join("\n");
}

function brDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

describe("forma de pagamento na importação", () => {
  it("marca pelo texto do banco e guarda o 'Sempre assim' pro próximo extrato", async () => {
    const { userAId, personalAccountId } = await createTestGroup();
    const date = brDate(todayISO());
    const first = await previewStatement(userAId, {
      content: csvFor(date, [
        ["PIX ENVIADO MARIA", "-120,00"],
        ["SPOTIFY", "-21,90"],
      ]),
    });
    const pixRow = first.rows.find((row) => row.description.toUpperCase().includes("MARIA"))!;
    expect(pixRow.paymentMethod).toBe("pix");
    const spotify = first.groups.find((group) => group.key === "spotify")!;
    expect(spotify.paymentMethod).toBeNull();

    await commitStatement(
      userAId,
      personalAccountId,
      [{ description: "Spotify", amount: 21.9, transactionType: "expense", occurredAt: todayISO(), categoryId: null, paymentMethod: "credit" }],
      [{ key: "SPOTIFY", label: "Spotify", categoryId: null, notExpense: false, paymentMethod: "credit" }]
    );
    const saved = await db.collection("transactions").where("accountId", "==", personalAccountId).get();
    expect(saved.docs[0].data().paymentMethod).toBe("credit");

    // A regra só guarda com categoria ou "não é gasto"? Guarda a forma também.
    const rules = await listImportRules(userAId);
    expect(rules.find((rule) => rule.key === "spotify")?.paymentMethod).toBe("credit");

    const next = await previewStatement(userAId, { content: csvFor(date, [["SPOTIFY", "-21,90"]]) });
    expect(next.rows[0].paymentMethod).toBe("credit");
  });
});

describe("organizar os sem forma de pagamento", () => {
  it("agrupa pelo nome e marca todos de uma vez", async () => {
    const { userAId, personalAccountId } = await createTestGroup();
    const base = {
      accountId: personalAccountId,
      categoryId: null,
      payerId: userAId,
      transactionType: "expense" as const,
      occurredAt: todayISO(),
      isPrivate: false,
      splitType: "none" as const,
    };
    await createTransaction(userAId, { ...base, description: "Uber", amount: 18.9 });
    await createTransaction(userAId, { ...base, description: "Uber", amount: 22.5 });
    await createTransaction(userAId, { ...base, description: "Feira", amount: 63, paymentMethod: "cash" });

    const month = todayISO().slice(0, 7);
    const list = await listWithoutPaymentMethod(userAId, month);
    expect(list.count).toBe(2);
    expect(list.groups[0]).toMatchObject({ key: "uber", count: 2, total: "41.40" });

    const result = await setPaymentMethods(userAId, {
      transactionIds: list.groups[0].transactionIds,
      paymentMethod: "credit",
      remember: true,
      label: "Uber",
    });
    expect(result.updated).toBe(2);
    expect((await listWithoutPaymentMethod(userAId, month)).count).toBe(0);
    expect((await listImportRules(userAId)).find((rule) => rule.key === "uber")?.paymentMethod).toBe("credit");
  });
});
