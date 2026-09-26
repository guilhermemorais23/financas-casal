export interface AuthenticatedUser {
  id: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      // X-Group-Id da requisição, ainda sem conferir se a pessoa é membro.
      activeGroupId?: string | null;
    }
  }
}
