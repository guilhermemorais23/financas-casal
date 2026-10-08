import type { PaymentMethod } from "../modules/transactions/transactions.repository";

function plain(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Forma de pagamento pelo que o banco escreveu na linha do extrato ("PIX
// ENVIADO MARIA", "COMPRA CARTAO DEB PADARIA"). Só quando é claro: na dúvida,
// null (a pessoa responde). "Crédito" sozinho numa entrada é dinheiro
// entrando na conta, não cartão -- por isso crédito só vale pra saída.
export function detectPaymentMethod(texts: (string | null | undefined)[], transactionType: "expense" | "income"): PaymentMethod | null {
  const text = plain(texts.filter(Boolean).join(" "));
  if (!text) return null;
  if (/\bpix\b/.test(text)) return "pix";
  if (/\bd[e]?b(ito)?\b|cart(ao)?\s*deb|compra\s*(no\s*)?deb|debito/.test(text) && !/debito automatico/.test(text)) return "debit";
  if (transactionType === "expense" && /compra\s*(no\s*)?cred|cart(ao)?\s*(de\s*)?cred|credito\s*a\s*vista|parcelad/.test(text)) return "credit";
  return null;
}

// "gastei 50 no pix no mercado", "paguei 30 no débito", "recebi 200 em
// dinheiro": a forma dita na mensagem, e a mensagem sem ela (pra descrição).
const SPOKEN: { method: PaymentMethod; re: RegExp }[] = [
  { method: "pix", re: /\b(?:no|na|via|pelo|por|com|de)?\s*pix\b/i },
  { method: "debit", re: /\b(?:no|na|via|pelo|com)?\s*(?:cart[aã]o\s+de\s+)?d[eé]bito\b/i },
  { method: "credit", re: /\b(?:no|na|via|pelo|com)?\s*(?:cart[aã]o(?:\s+de\s+cr[eé]dito)?|cr[eé]dito)\b/i },
  { method: "cash", re: /\b(?:em|no|com|de)?\s*(?:dinheiro|esp[eé]cie)\b/i },
];

export function paymentFromSpeech(text: string): { method: PaymentMethod | null; rest: string } {
  for (const { method, re } of SPOKEN) {
    if (re.test(text)) {
      const rest = text.replace(re, " ").replace(/\s+/g, " ").trim();
      return { method, rest };
    }
  }
  return { method: null, rest: text };
}
