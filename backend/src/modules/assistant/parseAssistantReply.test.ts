// O que a IA devolve não é confiável: um valor negativo virava um gasto
// negativo (que aumenta o saldo), e um texto quebrava depois de gravar.
import { describe, expect, it } from "vitest";
import { parseAssistantReply } from "./assistant.service";

describe("parseAssistantReply", () => {
  it("lê o JSON da IA (com ou sem a cerca de código)", () => {
    expect(parseAssistantReply('```json\n{"intent":"log_expense","amount":50.5}\n```')).toMatchObject({ intent: "log_expense", amount: 50.5 });
  });

  it("descarta valor negativo, texto ou absurdo", () => {
    expect(parseAssistantReply('{"intent":"log_expense","amount":-50}')?.amount).toBeUndefined();
    expect(parseAssistantReply('{"intent":"log_expense","amount":"cinquenta"}')?.amount).toBeUndefined();
    expect(parseAssistantReply('{"intent":"log_expense","amount":1e12}')?.amount).toBeUndefined();
  });

  it("aceita guardado zero (\"não tenho nada guardado\")", () => {
    expect(parseAssistantReply('{"intent":"set_savings","amount":0}')?.amount).toBe(0);
  });
});
