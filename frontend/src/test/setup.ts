// Roda antes de cada arquivo de teste: troca a API e o login pelos falsos,
// e tira a moldura do app (menu, assistente, Firebase), que não é o que
// os testes de tela conferem.
// (O vi.mock sobe pro topo do arquivo, antes dos imports -- por isso os
// falsos entram por import() dentro de cada fábrica.)
import { beforeEach, vi } from "vitest";
import "../index.css";

vi.mock("../api/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../api/client")>();
  return {
    ...real,
    apiRequest: async (...args: Parameters<typeof real.apiRequest>) => (await import("./fakeApi")).fakeApiRequest(...args),
    apiDownload: vi.fn(),
    warmUpApi: vi.fn(),
  };
});

vi.mock("../auth/AuthContext", async () => {
  const { fakeAuth } = await import("./fakeAuth");
  return {
    useAuth: () => fakeAuth,
    AuthProvider: ({ children }: { children: unknown }) => children,
  };
});

vi.mock("../layouts/AppLayout", () => ({
  AppLayout: ({ children }: { children: unknown }) => children,
}));

beforeEach(async () => {
  (await import("./fakeApi")).resetApi();
  localStorage.clear();
  sessionStorage.clear();
});
