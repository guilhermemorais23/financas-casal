// Cache "mostra o velho enquanto busca o novo" pros dados das telas: a tela
// abre na hora com o último valor visto (que sobrevive a fechar o app, via
// localStorage) enquanto uma busca nova roda em segundo plano e substitui. As
// chaves são definidas por quem chama (incluem o id do usuário), então trocar
// de conta nunca mostra dado de outra pessoa, e aqui ganham o grupo aberto
// na frente, então trocar de grupo também nunca mostra os números do outro
// grupo.
import { getActiveGroupId } from "../api/activeGroup";

const memoryCache = new Map<string, unknown>();

// As respostas guardadas têm o formato que a API tinha quando foram gravadas
// -- um deploy que acrescenta ou renomeia um campo deixava todo mês já
// guardado no navegador sem ele, e as telas leem o cache primeiro (ver
// DashboardPage.load), então trocar pra um mês guardado velho quebrava a
// tela ("Algo deu errado... Recarregar"). Amarrar o cache à versão do app
// joga tudo fora no primeiro carregamento depois de qualquer release, então
// um item do cache só é lido pelo mesmo pacote que o gravou.
const CACHE_VERSION_KEY = "par-cache-version";
export function clearCache(): void {
  memoryCache.clear();
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("par-cache:")) localStorage.removeItem(key);
    }
  } catch {
    // Armazenamento indisponível -- não há nada guardado pra limpar.
  }
}
try {
  if (localStorage.getItem(CACHE_VERSION_KEY) !== __APP_VERSION__) {
    clearCache();
    localStorage.setItem(CACHE_VERSION_KEY, __APP_VERSION__);
  }
} catch {
  // Armazenamento indisponível: o cache é melhor esforço de qualquer jeito.
}

function scopedKey(key: string): string {
  return `${getActiveGroupId() ?? "-"}:${key}`;
}

function storageKey(key: string): string {
  return `par-cache:${key}`;
}

export function readCache<T>(rawKey: string): T | null {
  const key = scopedKey(rawKey);
  if (memoryCache.has(key)) return memoryCache.get(key) as T;
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const value = JSON.parse(raw) as T;
    memoryCache.set(key, value);
    return value;
  } catch {
    return null;
  }
}

export function writeCache<T>(rawKey: string, value: T): void {
  const key = scopedKey(rawKey);
  memoryCache.set(key, value);
  try {
    localStorage.setItem(storageKey(key), JSON.stringify(value));
  } catch {
    // Armazenamento cheio ou indisponível -- o cache é um extra, não é
    // obrigatório.
  }
}
