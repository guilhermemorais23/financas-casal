// Memória rápida (em RAM) pras leituras caras do Firestore, do tamanho do
// histórico (saldos das contas, o "quem deve quem", varreduras de
// lançamentos por mês ou por faixa).
//
// Por que existe: o plano grátis do Firestore dá 50 mil leituras de
// documento por dia, e abrir o Painel uma vez custava ~1,6 mil -- a maior
// parte relendo os mesmos lançamentos em toda tela (menu lateral, troca de
// mês, alertas...). A cobrança é por documento devolvido, então reler dado
// que não mudou é desperdício puro.
//
// Regra de correção: toda gravação de lançamento ou divisão passa pelo
// transactions.repository.ts, que chama invalidateTransactionReads() DEPOIS
// que a gravação confirma -- isso sobe uma versão, e todo item guardado de
// uma versão mais velha é ignorado. (Depois, e não antes: subir antes
// deixaria uma leitura que caísse no meio da gravação guardar o dado antigo
// com a versão nova.) Os itens também vencem sozinhos, então uma mudança
// feita fora do app (ex.: alguém editando no console do Firebase) aparece
// uma hora.
//
// Supõe UM processo de backend só (o plano grátis do Render roda uma
// instância). Se um dia escalar pra várias, troque por um cache
// compartilhado -- um cache dentro do processo serviria dado velho nas
// instâncias que não fizeram a gravação.
import { AsyncLocalStorage } from "node:async_hooks";

const MAX_AGE_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 400;

interface Entry {
  version: number;
  at: number;
  promise: Promise<unknown>;
}

interface GroupEntry extends Entry {
  groupId: string | null;
  groupVersion: number;
}

let version = 0;
const entries = new Map<string, GroupEntry>();
// Uma gravação num grupo só joga fora o que foi lido desse grupo -- antes
// qualquer lançamento de qualquer pessoa zerava o cache de todo mundo.
const groupVersions = new Map<string, number>();

// Sem groupId (não se sabe de qual grupo era o lançamento), joga tudo fora.
export function invalidateTransactionReads(groupId?: string | null): void {
  if (groupId) groupVersions.set(groupId, (groupVersions.get(groupId) ?? 0) + 1);
  else version++;
}

// Guarda a própria promise, então chamadas iguais ao mesmo tempo (ex.: o
// Painel e os alertas dele pedindo o mesmo mês juntos) dividem uma leitura só,
// em vez de as duas irem ao Firestore.
export function memoizeReads<T>(key: string, load: () => Promise<T>, groupId: string | null = null): Promise<T> {
  const now = Date.now();
  const groupVersion = groupId ? groupVersions.get(groupId) ?? 0 : 0;
  const hit = entries.get(key);
  if (hit && hit.version === version && hit.groupVersion === groupVersion && now - hit.at < MAX_AGE_MS) {
    return hit.promise as Promise<T>;
  }

  const promise = load();
  const entry: GroupEntry = { version, at: now, promise, groupId, groupVersion };
  entries.set(key, entry);
  if (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
  // Uma leitura que falhou nunca pode ser servida de novo.
  promise.catch(() => {
    if (entries.get(key) === entry) entries.delete(key);
  });
  return promise;
}

// Gancho pros testes.
export function clearReadCache(): void {
  entries.clear();
  groupVersions.clear();
  scopedEntries.clear();
  version++;
}

// ---------------------------------------------------------------------------
// Cache por "escopo" pros dados pequenos que quase não mudam e que toda tela
// relê: o usuário, o grupo (contas, membros), categorias, dívidas e cartões.
// O Painel sozinho lia as mesmas categorias ~10 vezes e as mesmas parcelas 3
// vezes por chamada.
//
// Regras de segurança:
// - Só vale dentro de uma requisição GET (runWithReadScope, ligado em
//   app.ts). Em POST/PATCH/DELETE, jobs e testes a leitura vai sempre direto
//   no Firestore -- quem está gravando nunca lê algo velho.
// - Depois de toda requisição que grava, app.ts chama invalidateScopes() com
//   o grupo e o usuário de quem gravou e o "tipo" da rota (cards, debts...).
// - Mesmo assim, cada entrada expira sozinha em 10 minutos.
// ---------------------------------------------------------------------------
const SCOPED_MAX_AGE_MS = 10 * 60 * 1000;
const readScope = new AsyncLocalStorage<{ cacheable: boolean }>();
const scopeVersions = new Map<string, number>();

interface ScopedEntry extends Entry {
  scopes: string[];
  scopeVersions: number[];
}
const scopedEntries = new Map<string, ScopedEntry>();

export function runWithReadScope<T>(cacheable: boolean, fn: () => T): T {
  return readScope.run({ cacheable }, fn);
}

export function invalidateScopes(scopes: string[]): void {
  for (const scope of scopes) scopeVersions.set(scope, (scopeVersions.get(scope) ?? 0) + 1);
}

// Joga fora tudo (grupo mudou de gente, conta excluída, job diário...).
export function invalidateAllReads(): void {
  version++;
}

export function memoizeScoped<T>(key: string, scopes: string[], load: () => Promise<T>): Promise<T> {
  if (!readScope.getStore()?.cacheable) return load();
  // Cada chamador recebe a própria cópia da lista (alguém pode ordenar ou
  // filtrar no lugar sem estragar o que o outro recebeu).
  const copy = (value: T) => (Array.isArray(value) ? ([...value] as T) : value);
  const now = Date.now();
  const currentScopeVersions = scopes.map((scope) => scopeVersions.get(scope) ?? 0);
  const hit = scopedEntries.get(key);
  if (
    hit &&
    hit.version === version &&
    now - hit.at < SCOPED_MAX_AGE_MS &&
    hit.scopeVersions.every((v, i) => v === currentScopeVersions[i])
  ) {
    return (hit.promise as Promise<T>).then(copy);
  }
  const promise = load();
  const entry: ScopedEntry = { version, at: now, promise, scopes, scopeVersions: currentScopeVersions };
  scopedEntries.set(key, entry);
  if (scopedEntries.size > MAX_ENTRIES) {
    const oldest = scopedEntries.keys().next().value;
    if (oldest !== undefined) scopedEntries.delete(oldest);
  }
  promise.catch(() => {
    if (scopedEntries.get(key) === entry) scopedEntries.delete(key);
  });
  return promise.then(copy);
}
