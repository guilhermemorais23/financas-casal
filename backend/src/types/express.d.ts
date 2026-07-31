export interface AuthenticatedUser {
  id: string;
  email: string;
  coupleId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
