import type { Request, Response } from "express";
import { BrapiRequestError, fetchStockQuote, getQuoteHistory, QuotesNotConfiguredError } from "./quotes.service";

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

export async function getStockQuoteHandler(req: Request, res: Response) {
  const symbol = typeof req.query.symbol === "string" ? req.query.symbol : undefined;
  if (!symbol) {
    res.status(400).json({ error: "symbol is required" });
    return;
  }

  try {
    const data = await fetchStockQuote(symbol);
    res.status(200).json(data);
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
