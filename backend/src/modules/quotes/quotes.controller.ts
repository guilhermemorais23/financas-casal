import type { Request, Response } from "express";
import { BrapiRequestError, getQuoteHistory, QuotesNotConfiguredError } from "./quotes.service";

export async function getQuotesHandler(_req: Request, res: Response) {
  try {
    const series = await getQuoteHistory();
    res.status(200).json(series);
  } catch (err) {
    if (err instanceof QuotesNotConfiguredError) {
      res.status(503).json({ error: "cotações não configuradas" });
      return;
    }
    if (err instanceof BrapiRequestError) {
      res.status(502).json({ error: err.message });
      return;
    }
    throw err;
  }
}
