import { describe, expect, it } from "vitest";
import { createTestGroup } from "../../test-helpers";
import { getMyConversation, getMyUnread, getThreadForTeam, replyAsTeam, sendUserMessage } from "./feedback.service";

describe("feedback chat", () => {
  it("thanks right away, then the team's answer shows up unread for the person", async () => {
    const { userAId } = await createTestGroup();
    const first = await sendUserMessage(userAId, "a@test.com", { kind: "problem", text: "Não acho o vencimento", page: "/cards" });
    expect(first.messages.map((m) => m.from)).toEqual(["user", "auto"]);

    // Uma segunda mensagem logo em seguida não ganha outra resposta
    // automática.
    const second = await sendUserMessage(userAId, "a@test.com", { kind: "problem", text: "É no cartão", page: null });
    expect(second.messages.map((m) => m.from)).toEqual(["user", "auto", "user"]);

    const team = await getThreadForTeam(userAId);
    expect(team.messages).toHaveLength(3);

    await replyAsTeam(userAId, "guilherme", "Contas > Cartões > Editar");
    expect(await getMyUnread(userAId)).toBe(1);

    const mine = await getMyConversation(userAId);
    expect(mine.messages.at(-1)).toMatchObject({ from: "team", text: "Contas > Cartões > Editar" });
    expect(await getMyUnread(userAId)).toBe(0);
  });
});
