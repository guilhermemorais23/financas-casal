import type { Request, Response } from "express";
import { PluggyError } from "../../utils/pluggy";
import {
  OpenFinanceItemNotFoundError,
  OpenFinanceNotYoursError,
  OpenFinanceUnavailableError,
  createConnectToken,
  getOpenFinanceStatus,
  markBankSynced,
  previewFromBank,
  registerItem,
  removeBankConnection,
} from "./openFinance.service";

async function handle(res: Response, work: () => Promise<unknown>, status = 200) {
  try {
    const body = await work();
    if (body === undefined) res.status(204).end();
    else res.status(status).json(body);
  } catch (err) {
    if (err instanceof OpenFinanceUnavailableError) {
      res.status(403).json({ error: "Conectar conta ainda não está disponível pra você.", code: "open_finance_unavailable" });
      return;
    }
    if (err instanceof OpenFinanceItemNotFoundError) {
      res.status(404).json({ error: "Conexão não encontrada." });
      return;
    }
    if (err instanceof OpenFinanceNotYoursError) {
      res.status(403).json({ error: "Essa conexão não foi criada por você." });
      return;
    }
    if (err instanceof PluggyError) {
      res.status(502).json({ error: `O Pluggy não respondeu como esperado: ${err.message}` });
      return;
    }
    throw err;
  }
}

const who = (req: Request) => ({ userId: req.user!.id, email: req.user!.email });

export const statusHandler = (req: Request, res: Response) => handle(res, () => getOpenFinanceStatus(who(req).userId, who(req).email));

export const connectTokenHandler = (req: Request, res: Response) =>
  handle(res, () =>
    createConnectToken(who(req).userId, who(req).email, typeof req.body?.itemId === "string" ? req.body.itemId : undefined)
  );

export const registerItemHandler = (req: Request, res: Response) =>
  handle(res, () => registerItem(who(req).userId, who(req).email, String(req.body?.itemId ?? "")), 201);

export const previewHandler = (req: Request, res: Response) =>
  handle(res, () => previewFromBank(who(req).userId, who(req).email, String(req.params.itemId), String(req.body?.accountId ?? "")));

export const syncedHandler = (req: Request, res: Response) =>
  handle(res, async () => {
    await markBankSynced(who(req).userId, who(req).email, String(req.params.itemId), String(req.body?.accountId ?? ""), String(req.body?.until ?? ""));
    return undefined;
  });

export const removeHandler = (req: Request, res: Response) =>
  handle(res, async () => {
    await removeBankConnection(who(req).userId, who(req).email, String(req.params.itemId));
    return undefined;
  });
