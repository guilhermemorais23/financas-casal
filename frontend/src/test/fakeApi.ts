// API falsa pros testes: cada teste diz o que cada endereço responde e
// depois confere o que a tela pediu (método, endereço, corpo).
import { ApiError } from "../api/client";

type Handler = (call: ApiCall) => unknown;

export interface ApiCall {
  method: string;
  path: string;
  body: unknown;
}

const routes: { method: string; match: string | RegExp; handler: Handler }[] = [];
export const apiCalls: ApiCall[] = [];

// Responde `METHOD caminho` (caminho exato, ou RegExp contra o caminho com a query).
export function onApi(
  method: string,
  match: string | RegExp,
  response: Handler | Record<string, unknown> | unknown[] | string | number | boolean | null
): void {
  routes.unshift({ method, match, handler: typeof response === "function" ? (response as Handler) : () => response });
}

export function resetApi(): void {
  routes.length = 0;
  apiCalls.length = 0;
}

export function callsTo(method: string, match: string | RegExp): ApiCall[] {
  return apiCalls.filter(
    (call) => call.method === method && (typeof match === "string" ? call.path === match : match.test(call.path))
  );
}

export async function fakeApiRequest<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const call: ApiCall = { method: options.method ?? "GET", path, body: options.body };
  apiCalls.push(call);
  const route = routes.find(
    (r) => r.method === call.method && (typeof r.match === "string" ? r.match === path.split("?")[0] || r.match === path : r.match.test(path))
  );
  if (!route) {
    // Endereço que o teste não preparou: falha alto, em vez de a tela ficar
    // carregando pra sempre e o teste passar por engano.
    throw new ApiError(`Sem resposta falsa pra ${call.method} ${path}`, 599, null);
  }
  return route.handler(call) as T;
}
