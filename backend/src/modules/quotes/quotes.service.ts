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

// A small, fixed watchlist (not user-configurable yet) -- Ibovespa plus a
// handful of large-cap tickers, so there's always something meaningful to
// show without needing a portfolio feature first.
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

// brapi answers HTTP 200 even for a missing/invalid token or an over-limit
// request -- the failure only shows up in the body ({error: true, code}).
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

// The free brapi plan allows exactly one symbol per request (asking for
// more comes back as a QUOTES_PER_REQUEST_EXCEEDED body error, not a
// rejected request) -- so the watchlist is fetched as N parallel
// single-ticker requests instead of one combined call.
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

// One-off "current quote for a single symbol" lookup via brapi's v2 stocks
// endpoint -- kept separate from getQuoteHistory() above (which needs
// historicalDataPrice, only available on the older v1-style endpoint).
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
