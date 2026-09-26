// Grupo aberto na requisição. Uma pessoa pode estar em vários grupos (o do
// casal, o da casa da família...); o app manda qual está aberto no cabeçalho
// X-Group-Id e requireAuth guarda aqui. requireGroupId (groups.service.ts)
// confere se a pessoa é mesmo membro antes de usar -- este valor sozinho
// nunca é confiável.
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<{ groupId: string | null }>();

// Ids do Firestore: nada de barra nem texto gigante vindo do cabeçalho.
const GROUP_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function parseGroupIdHeader(value: unknown): string | null {
  return typeof value === "string" && GROUP_ID_PATTERN.test(value) ? value : null;
}

export function runWithActiveGroup<T>(groupId: string | null, fn: () => T): T {
  return store.run({ groupId }, fn);
}

export function requestedGroupId(): string | null {
  return store.getStore()?.groupId ?? null;
}
