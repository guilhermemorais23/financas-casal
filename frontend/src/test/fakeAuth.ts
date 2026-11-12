// Pessoa logada nos testes.
import type { Preferences } from "../utils/preferences";

export const ME = "user-me";
export const PARTNER = "user-aisha";

export const fakeAuth = {
  user: {
    id: ME,
    email: "eu@teste.dev",
    displayName: "Eu",
    groupId: "group-1",
    groupIds: ["group-1"],
    photoDataUrl: null,
    phone: null,
    isAdmin: false,
    // null = nunca respondeu a pergunta inicial (o setup.ts volta pra null
    // antes de cada teste).
    preferences: null as Preferences | null,
  },
  token: "test-token",
  isLoading: false,
  activeGroupId: "group-1",
  login: async () => {},
  loginWithProvider: async () => true,
  deleteAccount: async () => {},
  register: async () => {},
  logout: async () => {},
  refreshUser: async () => {},
  setPreferences: (preferences: Preferences) => {
    fakeAuth.user.preferences = preferences;
  },
  resetPassword: async () => {},
  revokeAllSessions: async () => {},
  switchGroup: () => {},
};

export const members = [
  { id: ME, displayName: "Eu" },
  { id: PARTNER, displayName: "aisha" },
];
