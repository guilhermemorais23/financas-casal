// Grupo aberto no app. Quem está em mais de um grupo (o do casal, o da casa
// da família...) vê um de cada vez; toda chamada à API leva este id no
// cabeçalho X-Group-Id e o backend confere se a pessoa é membro dele.
// Fica salvo no aparelho, pra abrir o app já no último grupo usado.
const STORAGE_KEY = "par-active-group";

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

let activeGroupId: string | null = readStored();
const listeners = new Set<() => void>();

export function getActiveGroupId(): string | null {
  return activeGroupId;
}

export function setActiveGroupId(groupId: string | null): void {
  if (groupId === activeGroupId) return;
  activeGroupId = groupId;
  try {
    if (groupId) localStorage.setItem(STORAGE_KEY, groupId);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Sem storage: vale só até fechar o app.
  }
  listeners.forEach((listener) => listener());
}

export function subscribeActiveGroup(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Sufixo pras chaves guardadas no aparelho que apontam pra coisas de um grupo
// (conta, categoria, cartão). Sem grupo aberto, fica a chave de antes.
export function groupSuffix(): string {
  return activeGroupId ? `:${activeGroupId}` : "";
}
