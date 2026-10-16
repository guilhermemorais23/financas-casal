// ============================================================================
// MÓDULO push -- endereços /api/push
// ============================================================================
// O que faz: Notificação no celular (Web Push): chave pública, registrar e
//            cancelar o aparelho, mandar um teste.
// Quem chama: components/PushSettingsCard.tsx (tela Conta) e utils/push.ts.
//
// Caminho de um pedido dentro do módulo:
//   *.routes.ts      endereço -> função (este arquivo)
//   *.controller.ts  lê e valida o pedido (req.body, req.params), responde
//   *.service.ts     regra de negócio (quem pode, o que calcula)
//   *.repository.ts  lê e grava no Firestore
// ============================================================================
import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  InvalidSubscriptionError,
  countSubscriptions,
  pushPublicKey,
  removeSubscription,
  saveSubscription,
  sendPushToUser,
} from "./push.service";

export const pushRouter = Router();

pushRouter.use(requireAuth);

// A chave pública (null = notificações desligadas no servidor) e em quantos
// aparelhos a pessoa já ligou.
pushRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const publicKey = pushPublicKey();
    res.json({ publicKey, devices: publicKey ? await countSubscriptions(req.user!.id) : 0 });
  })
);

pushRouter.post(
  "/subscribe",
  asyncHandler(async (req: Request, res: Response) => {
    if (!pushPublicKey()) {
      res.status(503).json({ error: "Notificações ainda não estão ligadas no servidor." });
      return;
    }
    try {
      await saveSubscription(req.user!.id, req.body?.subscription ?? {}, req.header("user-agent"));
      res.status(204).end();
    } catch (err) {
      if (err instanceof InvalidSubscriptionError) {
        res.status(400).json({ error: "Endereço de notificação inválido." });
        return;
      }
      throw err;
    }
  })
);

pushRouter.post(
  "/unsubscribe",
  asyncHandler(async (req: Request, res: Response) => {
    await removeSubscription(req.user!.id, req.body?.endpoint);
    res.status(204).end();
  })
);

pushRouter.post(
  "/test",
  asyncHandler(async (req: Request, res: Response) => {
    const delivered = await sendPushToUser(req.user!.id, {
      title: "Avisos do PAR. ligados",
      body: "É assim que chegam os lembretes de vencimento e os lançamentos novos do banco.",
      url: "/contas",
      tag: "push-test",
    });
    res.json({ delivered });
  })
);
