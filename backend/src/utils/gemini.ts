import { GoogleGenerativeAI, type GenerationConfig, type GenerateContentResult } from "@google/generative-ai";

// Um lugar só pro modelo da IA. O padrão é o Flash-Lite (bem mais barato que
// o Flash e suficiente pra lançar gasto, responder com os números do mês e
// copiar/classificar linhas de extrato). Dá pra trocar sem código pela
// variável GEMINI_MODEL no servidor.
export const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash-lite";

// Preço por 1 milhão de tokens em dólar, só pra estimativa do Admin (a conta
// de verdade é a do Google). Padrão: Gemini 2.5 Flash-Lite.
export const GEMINI_PRICE = {
  inputPerM: Number(process.env.GEMINI_PRICE_INPUT_PER_M ?? 0.1),
  outputPerM: Number(process.env.GEMINI_PRICE_OUTPUT_PER_M ?? 0.4),
  usdToBrl: Number(process.env.USD_TO_BRL ?? 5.5),
};

export interface GeminiTokens {
  input: number;
  output: number;
}

// Sem "raciocínio": nas tarefas daqui ele só encarece (é cobrado como
// resposta) sem melhorar o resultado. O SDK é anterior à opção, então vai
// fora da tipagem; a API recebe como está. Só nos modelos 2.5, que usam
// thinkingBudget.
export function geminiModel(apiKey: string, config: GenerationConfig = {}) {
  const generationConfig = /2\.5/.test(GEMINI_MODEL)
    ? ({ ...config, thinkingConfig: { thinkingBudget: 0 } } as GenerationConfig)
    : config;
  return new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: GEMINI_MODEL, generationConfig });
}

export function tokensOf(result: GenerateContentResult): GeminiTokens {
  const usage = result.response.usageMetadata;
  const input = usage?.promptTokenCount ?? 0;
  const output = Math.max(0, (usage?.totalTokenCount ?? 0) - input);
  return { input, output };
}

export function estimateCostBrl(tokens: GeminiTokens): number {
  const usd = (tokens.input * GEMINI_PRICE.inputPerM + tokens.output * GEMINI_PRICE.outputPerM) / 1_000_000;
  return usd * GEMINI_PRICE.usdToBrl;
}
