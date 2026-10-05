import { timingSafeEqual } from "node:crypto";

// Compara segredos (tokens de webhook, assinaturas) sem vazar pelo tempo de
// resposta quantos caracteres batem.
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
