// ============================================================================
// CONVERSA COM O BACKEND -- todo pedido do app pro servidor passa por aqui
// ============================================================================
// As telas nunca chamam fetch() direto. Elas chamam:
//
//   apiRequest<Tipo>("/recurring-bills", { token })              // GET
//   apiRequest("/debts", { method: "POST", token, body: {...} }) // POST
//
// e o apiRequest cuida do resto:
//   1. junta API_URL (o endereço do backend) + o caminho;
//   2. põe o token de login no cabeçalho Authorization ("Bearer ...") -- é
//      como o backend sabe quem está pedindo (middleware/auth.ts no backend);
//   3. põe o grupo aberto no cabeçalho X-Group-Id (ver activeGroup.ts);
//   4. se o token estava velho (401), pede um novo e tenta de novo uma vez;
//   5. devolve o JSON da resposta, ou lança ApiError com a mensagem do
//      backend (as telas mostram err.message).
//
// Por que centralizar: o endereço, o login e o tratamento de erro ficam num
// lugar só. Mudou o servidor? Muda uma variável, não 100 telas.
// ============================================================================
import { getActiveGroupId, setActiveGroupId } from "./activeGroup";

// Endereço do backend. TODO pedido do app pro servidor começa com isto.
// Vem da variável de ambiente VITE_API_URL:
//   - no seu PC: frontend/.env -> VITE_API_URL=http://localhost:4000/api
//   - em produção: o CI (.github/workflows/ci.yml) define
//     VITE_API_URL=https://financas-casal-m496.onrender.com/api na hora do build.
// O Vite troca `import.meta.env.VITE_API_URL` pelo valor escrito durante o
// build -- o navegador recebe o endereço já pronto. Só variáveis que começam
// com VITE_ chegam no navegador (as outras ficam de fora de propósito, pra
// nenhum segredo vazar). O tipo dela está declarado em src/vite-env.d.ts.
const API_URL = import.meta.env.VITE_API_URL;

function groupHeader(): Record<string, string> {
  const groupId = getActiveGroupId();
  return groupId ? { "X-Group-Id": groupId } : {};
}

// O backend recusou o grupo aberto (a pessoa saiu dele ou foi removida em
// outro aparelho): volta pro grupo padrão e avisa o app pra reler o perfil.
function isGroupLost(status: number, data: { code?: unknown } | null): boolean {
  if (status !== 403 || data?.code !== "group_access" || !getActiveGroupId()) return false;
  setActiveGroupId(null);
  window.dispatchEvent(new CustomEvent("par:group-lost"));
  return true;
}

export class ApiError extends Error {
  status: number;
  code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// O AuthContext preenche isto uma vez, quando abre. É o jeito deste arquivo
// pedir um token novo ao Firebase sem importar o AuthContext (daria um ciclo
// de dependência: o AuthContext é justamente quem chama o apiRequest).
let refreshToken: (() => Promise<string | null>) | null = null;
export function setTokenRefresher(fn: (() => Promise<string | null>) | null): void {
  refreshToken = fn;
}

export async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {}
): Promise<T> {
  const doFetch = async (token?: string | null) => {
    const headers: Record<string, string> = { "Content-Type": "application/json", ...groupHeader() };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return fetch(`${API_URL}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  };

  let response = await doFetch(options.token);

  // Um 401 num pedido que FOI com token normalmente quer dizer que o token
  // estava velho, e não que a pessoa saiu -- quase sempre porque a aba ficou
  // em segundo plano tanto tempo que o renovador automático do Firebase não
  // chegou a rodar. Pede um token novo e tenta de novo uma única vez, antes de
  // devolver qualquer erro pra quem chamou.
  if (response.status === 401 && options.token && refreshToken) {
    const freshToken = await refreshToken().catch(() => null);
    if (freshToken && freshToken !== options.token) {
      response = await doFetch(freshToken);
    }
  }

  let data = await response.json().catch(() => null);

  if (isGroupLost(response.status, data)) {
    response = await doFetch(options.token);
    data = await response.json().catch(() => null);
  }

  if (!response.ok) {
    // Recurso do Premium: avisa o app (components/PremiumPrompt abre a janela
    // "Isso é do Premium") além de devolver o erro pra tela que chamou.
    if (response.status === 402 && data?.code === "premium_required") {
      window.dispatchEvent(new CustomEvent("par:premium-required"));
    }
    throw new ApiError(data?.error ?? "Request failed", response.status, typeof data?.code === "string" ? data.code : null);
  }

  return data as T;
}

// Pra baixar arquivo (exportar CSV etc.) -- o apiRequest sempre lê a
// resposta como JSON, e arquivo não é JSON. Busca com o mesmo cabeçalho de
// login e entrega um arquivo de verdade pro navegador por um <a download>
// descartável.
export async function apiDownload(path: string, token: string | null, filename: string): Promise<void> {
  const fetchWith = (t: string | null) =>
    fetch(`${API_URL}${path}`, { headers: { ...groupHeader(), ...(t ? { Authorization: `Bearer ${t}` } : {}) } });

  let response = await fetchWith(token);
  if (response.status === 401 && token && refreshToken) {
    const freshToken = await refreshToken().catch(() => null);
    if (freshToken && freshToken !== token) {
      response = await fetchWith(freshToken);
    }
  }

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    if (response.status === 402 && data?.code === "premium_required") {
      window.dispatchEvent(new CustomEvent("par:premium-required"));
    }
    throw new ApiError(data?.error ?? "Request failed", response.status, typeof data?.code === "string" ? data.code : null);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// O backend roda no plano grátis do Render, que põe o servidor pra dormir
// depois de um tempo parado -- o primeiro pedido depois disso pode levar mais
// de 30 s enquanto ele liga. Mandar um ping descartável no /health assim que
// o app abre faz essa partida acontecer enquanto a pessoa digita e-mail e
// senha (ou o Firebase restaura a sessão), em vez de cair tudo no toque em
// "Entrar".
let warmUpStarted = false;
export function warmUpApi(): void {
  if (warmUpStarted || !API_URL) return;
  warmUpStarted = true;
  fetch(`${API_URL}/health`, { cache: "no-store" }).catch(() => {});
}
