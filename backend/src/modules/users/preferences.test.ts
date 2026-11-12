// Preferências: pra que a pessoa usa o app e quais módulos aparecem.
import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { createTestGroup } from "../../test-helpers";
import { defaultModules, parsePreferencesBody } from "./preferences";
import { patchPreferenceModulesHandler, putPreferencesHandler, toPublicUser } from "./users.controller";
import { findUserById } from "./users.repository";

// Os testes do projeto não sobem HTTP: chamam o handler com um pedido e uma
// resposta de mentira e olham o que ele respondeu.
async function call(
  handler: (req: Request, res: Response) => Promise<void>,
  userId: string,
  body: unknown
): Promise<{ status: number; body: unknown }> {
  const result = { status: 0, body: undefined as unknown };
  const res = {
    status(code: number) {
      result.status = code;
      return this;
    },
    json(payload: unknown) {
      result.body = payload;
      return this;
    },
  };
  await handler({ user: { id: userId }, body } as unknown as Request, res as unknown as Response);
  return result;
}

describe("defaultModules", () => {
  it("sem resposta (usage null): tudo ligado", () => {
    expect(Object.values(defaultModules(null, [])).every(Boolean)).toBe(true);
    expect(Object.values(defaultModules(null, ["spending"])).every(Boolean)).toBe(true);
  });

  it("só controlar gastos, sozinho: só o básico", () => {
    expect(defaultModules("solo", ["spending"])).toEqual({
      cards: true,
      payables: true,
      reports: true,
      goals: false,
      investments: false,
      debts: false,
      loans: false,
      shopping: false,
    });
  });

  it("guardar dinheiro liga metas e investimentos; dívidas liga dívidas e empréstimos", () => {
    const saving = defaultModules("friends", ["saving"]);
    expect(saving).toMatchObject({ goals: true, investments: true, debts: false, loans: false, shopping: false });
    const debts = defaultModules("solo", ["debts"]);
    expect(debts).toMatchObject({ goals: false, investments: false, debts: true, loans: true });
  });

  it("lista de compras só pra casal", () => {
    expect(defaultModules("couple", []).shopping).toBe(true);
    expect(defaultModules("friends", []).shopping).toBe(false);
    expect(defaultModules("solo", ["split", "saving", "debts"]).shopping).toBe(false);
    expect(defaultModules("couple", ["split", "saving", "debts"])).toEqual({
      cards: true,
      payables: true,
      reports: true,
      goals: true,
      investments: true,
      debts: true,
      loans: true,
      shopping: true,
    });
  });
});

describe("parsePreferencesBody", () => {
  it("modules parcial completa com o padrão", () => {
    expect(parsePreferencesBody({ usage: "solo", goals: [], modules: { shopping: true, cards: false } }).modules).toEqual({
      ...defaultModules("solo", []),
      shopping: true,
      cards: false,
    });
  });

  it("recusa uso, objetivo e módulo desconhecidos, objetivo repetido e valor não booleano", () => {
    const invalid = [
      undefined,
      [],
      { usage: "family", goals: [] },
      { goals: [] },
      { usage: "solo" },
      { usage: "solo", goals: ["travel"] },
      { usage: "solo", goals: ["saving", "saving"] },
      { usage: "solo", goals: [], modules: { pets: true } },
      { usage: "solo", goals: [], modules: { cards: "sim" } },
      { usage: "solo", goals: [], modules: ["cards"] },
    ];
    for (const body of invalid) {
      expect(() => parsePreferencesBody(body), JSON.stringify(body)).toThrow();
    }
  });
});

describe("PUT /api/me/preferences e PATCH /api/me/preferences/modules", () => {
  it("PUT salva com os módulos padrão e aparece no /api/me", async () => {
    const { userAId } = await createTestGroup();
    expect((await toPublicUser((await findUserById(userAId))!)).preferences).toBeNull();

    const response = await call(putPreferencesHandler, userAId, { usage: "couple", goals: ["split", "saving"] });
    expect(response.status).toBe(200);
    const expected = { usage: "couple", goals: ["split", "saving"], modules: defaultModules("couple", ["split", "saving"]) };
    expect(response.body).toEqual(expected);

    const user = await findUserById(userAId);
    expect(user?.preferences).toEqual(expected);
    const publicUser = await toPublicUser(user!);
    expect(publicUser.preferences).toEqual(expected);
    // Os campos de antes continuam lá.
    expect(publicUser).toMatchObject({ id: userAId, displayName: "A", welcomePending: false });
  });

  it("PUT inválido responde 400 com a mensagem e não grava nada", async () => {
    const { userAId } = await createTestGroup();
    const response = await call(putPreferencesHandler, userAId, { usage: "família", goals: [] });
    expect(response.status).toBe(400);
    expect(typeof (response.body as { error: unknown }).error).toBe("string");
    expect((await findUserById(userAId))?.preferences).toBeNull();
  });

  it("PATCH sem preferências parte do padrão (tudo ligado) e só muda o que veio", async () => {
    const { userAId } = await createTestGroup();
    const response = await call(patchPreferenceModulesHandler, userAId, { loans: false });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ usage: null, goals: [], modules: { ...defaultModules(null, []), loans: false } });
    expect((await findUserById(userAId))?.preferences?.modules.loans).toBe(false);
  });

  it("PATCH depois do PUT mantém uso e objetivos", async () => {
    const { userAId } = await createTestGroup();
    await call(putPreferencesHandler, userAId, { usage: "solo", goals: ["spending"] });
    const response = await call(patchPreferenceModulesHandler, userAId, { goals: true });
    expect(response.body).toEqual({
      usage: "solo",
      goals: ["spending"],
      modules: { ...defaultModules("solo", ["spending"]), goals: true },
    });
  });

  it("PATCH com módulo desconhecido ou valor errado: 400", async () => {
    const { userAId } = await createTestGroup();
    expect((await call(patchPreferenceModulesHandler, userAId, { pets: true })).status).toBe(400);
    expect((await call(patchPreferenceModulesHandler, userAId, { cards: 1 })).status).toBe(400);
    expect((await call(patchPreferenceModulesHandler, userAId, null)).status).toBe(400);
    expect((await findUserById(userAId))?.preferences).toBeNull();
  });
});
