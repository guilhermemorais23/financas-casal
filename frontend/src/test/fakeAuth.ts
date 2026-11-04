// Pessoa logada nos testes.
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
  resetPassword: async () => {},
  revokeAllSessions: async () => {},
  switchGroup: () => {},
};

export const members = [
  { id: ME, displayName: "Eu" },
  { id: PARTNER, displayName: "aisha" },
];
