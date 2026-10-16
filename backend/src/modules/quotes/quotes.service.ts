export class QuotesNotConfiguredError extends Error {}
export class BrapiRequestError extends Error {}

export interface QuoteHistoryPoint {
  date: string;
  close: number;
}

export interface QuoteSeries {
  ticker: string;
  shortName: string;
  currentPrice: number;
  changePercent: number;
  points: QuoteHistoryPoint[];
}

// Uma lista pequena e fixa (a pessoa ainda não escolhe) -- Ibovespa mais
// algumas ações grandes, pra sempre ter algo com sentido pra mostrar sem
// precisar antes de uma carteira de investimentos.
const DEFAULT_TICKERS = ["^BVSP", "PETR4", "VALE3", "ITUB4", "BBDC4"];

const CACHE_TTL_MS = 15 * 60 * 1000;
let cache: { data: QuoteSeries[]; expiresAt: number } | null = null;

function requireToken(): string {
  const token = process.env.BRAPI_TOKEN;
  if (!token) throw new QuotesNotConfiguredError();
  return token;
}

interface BrapiErrorBody {
  error: true;
  message: string;
  code: string;
}

// A brapi responde HTTP 200 mesmo com token faltando ou inválido, ou acima do
// limite -- a falha só aparece no corpo ({error: true, code}).
function isBrapiError(body: unknown): body is BrapiErrorBody {
  return typeof body === "object" && body !== null && (body as { error?: unknown }).error === true;
}

interface BrapiHistoricalPoint {
  date: number;
  close: number;
}

interface BrapiQuoteResult {
  symbol: string;
  shortName?: string;
  regularMarketPrice: number;
  regularMarketChangePercent: number;
  historicalDataPrice?: BrapiHistoricalPoint[];
}

async function fetchTickerHistory(ticker: string, token: string): Promise<QuoteSeries> {
  const url = `https://brapi.dev/api/quote/${encodeURIComponent(ticker)}?range=1mo&interval=1d`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await response.json()) as { results?: BrapiQuoteResult[] } | BrapiErrorBody;

  if (!response.ok || isBrapiError(body)) {
    if (!response.ok && (response.status === 401 || response.status === 403)) {
      throw new QuotesNotConfiguredError();
    }
    if (isBrapiError(body) && (body.code === "MISSING_TOKEN" || body.code === "INVALID_TOKEN")) {
      throw new QuotesNotConfiguredError();
    }
    throw new BrapiRequestError(isBrapiError(body) ? body.message : `brapi request failed (${response.status})`);
  }

  const result = (body as { results?: BrapiQuoteResult[] }).results?.[0];
  if (!result) throw new BrapiRequestError(`brapi returned no result for ${ticker}`);

  return {
    ticker: result.symbol,
    shortName: result.shortName ?? result.symbol,
    currentPrice: result.regularMarketPrice,
    changePercent: result.regularMarketChangePercent,
    points: (result.historicalDataPrice ?? []).map((point) => ({
      date: new Date(point.date * 1000).toISOString().slice(0, 10),
      close: point.close,
    })),
  };
}

// O plano grátis da brapi aceita um símbolo só por pedido (pedir mais volta
// com erro QUOTES_PER_REQUEST_EXCEEDED no corpo, e não com pedido recusado) --
// então a lista é buscada em N pedidos de um papel só, em paralelo, em vez de
// uma chamada combinada.
export async function getQuoteHistory(): Promise<QuoteSeries[]> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.data;
  }

  const token = requireToken();
  const series = await Promise.all(DEFAULT_TICKERS.map((ticker) => fetchTickerHistory(ticker, token)));

  cache = { data: series, expiresAt: Date.now() + CACHE_TTL_MS };
  return series;
}

export interface StockQuoteData {
  shortName: string;
  longName?: string;
  currency: string;
  regularMarketPrice: number;
  regularMarketChange: number;
  regularMarketChangePercent: number;
  regularMarketTime: string;
  regularMarketDayHigh: number;
  regularMarketDayLow: number;
  regularMarketPreviousClose: number;
  regularMarketOpen: number;
  fiftyTwoWeekLow: number;
  fiftyTwoWeekHigh: number;
  logourl?: string;
}

interface BrapiV2QuoteResult {
  requestedSymbol: string;
  symbol: string;
  data: StockQuoteData;
}

// Consulta avulsa da "cotação atual de um papel" pelo endpoint v2 de ações
// da brapi -- separada do getQuoteHistory() acima (que precisa do
// historicalDataPrice, que só existe no endpoint antigo, estilo v1).
export async function fetchStockQuote(symbol: string): Promise<StockQuoteData> {
  const token = requireToken();
  const url = `https://brapi.dev/api/v2/stocks/quote?symbols=${encodeURIComponent(symbol)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await response.json()) as { results?: BrapiV2QuoteResult[] } | BrapiErrorBody;

  if (!response.ok || isBrapiError(body)) {
    if (!response.ok && (response.status === 401 || response.status === 403)) {
      throw new QuotesNotConfiguredError();
    }
    if (isBrapiError(body) && (body.code === "MISSING_TOKEN" || body.code === "INVALID_TOKEN")) {
      throw new QuotesNotConfiguredError();
    }
    throw new BrapiRequestError(isBrapiError(body) ? body.message : `brapi request failed (${response.status})`);
  }

  const result = (body as { results?: BrapiV2QuoteResult[] }).results?.[0];
  if (!result) throw new BrapiRequestError(`brapi returned no result for ${symbol}`);
  return result.data;
}
