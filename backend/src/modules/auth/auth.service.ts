import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { createUser, findUserByEmail, type UserRow } from "./users.repository";

const SALT_ROUNDS = 10;

export class EmailAlreadyRegisteredError extends Error {}
export class InvalidCredentialsError extends Error {}

function toPublicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    coupleId: user.couple_id,
  };
}

function signToken(user: UserRow): string {
  return jwt.sign(
    { sub: user.id, email: user.email, coupleId: user.couple_id },
    env.jwtSecret,
    { expiresIn: "7d" }
  );
}

export async function register(input: { email: string; password: string; displayName: string }) {
  const existing = await findUserByEmail(input.email);
  if (existing) {
    throw new EmailAlreadyRegisteredError();
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const user = await createUser({
    email: input.email,
    passwordHash,
    displayName: input.displayName,
  });

  return { user: toPublicUser(user), token: signToken(user) };
}

export async function login(input: { email: string; password: string }) {
  const user = await findUserByEmail(input.email);
  if (!user) {
    throw new InvalidCredentialsError();
  }

  const passwordMatches = await bcrypt.compare(input.password, user.password_hash);
  if (!passwordMatches) {
    throw new InvalidCredentialsError();
  }

  return { user: toPublicUser(user), token: signToken(user) };
}

export { toPublicUser };
