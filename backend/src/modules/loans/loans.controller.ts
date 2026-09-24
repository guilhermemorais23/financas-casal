import type { Request, Response } from "express";
import { NoGroupError } from "../groups/groups.service";
import {
  InvalidLoanAccountError,
  LoanNotFoundError,
  RepaymentNotFoundError,
  RepaymentTooLargeError,
  addRepayment,
  createLoan,
  listLoans,
  removeLoan,
  removeRepayment,
  updateLoanForUser,
} from "./loans.service";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value));
}

function isPositiveAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 100_000_000;
}

function optionalText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : null;
}

function handleKnownErrors(err: unknown, res: Response): boolean {
  if (err instanceof NoGroupError) {
    res.status(404).json({ error: "Crie ou entre num grupo primeiro." });
    return true;
  }
  if (err instanceof LoanNotFoundError) {
    res.status(404).json({ error: "Empréstimo não encontrado." });
    return true;
  }
  if (err instanceof RepaymentNotFoundError) {
    res.status(404).json({ error: "Recebimento não encontrado." });
    return true;
  }
  if (err instanceof InvalidLoanAccountError) {
    res.status(400).json({ error: "Escolha a sua conta ou a Nossa Conta." });
    return true;
  }
  if (err instanceof RepaymentTooLargeError) {
    res.status(400).json({
      error: `Falta receber só R$ ${Number(err.message).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}.`,
    });
    return true;
  }
  return false;
}

export async function listLoansHandler(req: Request, res: Response) {
  try {
    res.json(await listLoans(req.user!.id));
  } catch (err) {
    if (!handleKnownErrors(err, res)) throw err;
  }
}

export async function createLoanHandler(req: Request, res: Response) {
  const { personName, amount, lentAt, dueDate, note, accountId } = req.body ?? {};
  const name = optionalText(personName, 80);
  if (!name) {
    res.status(400).json({ error: "Pra quem você emprestou?" });
    return;
  }
  if (!isPositiveAmount(amount)) {
    res.status(400).json({ error: "Informe um valor válido." });
    return;
  }
  if (!isIsoDate(lentAt)) {
    res.status(400).json({ error: "Data do empréstimo inválida." });
    return;
  }
  if (dueDate !== null && dueDate !== undefined && !isIsoDate(dueDate)) {
    res.status(400).json({ error: "Prazo inválido." });
    return;
  }
  if (isIsoDate(dueDate) && dueDate < lentAt) {
    res.status(400).json({ error: "O prazo não pode ser antes do empréstimo." });
    return;
  }
  try {
    const loan = await createLoan(req.user!.id, {
      personName: name,
      amount,
      lentAt,
      dueDate: isIsoDate(dueDate) ? dueDate : null,
      note: optionalText(note, 300),
      accountId: typeof accountId === "string" && accountId ? accountId : null,
    });
    res.status(201).json(loan);
  } catch (err) {
    if (!handleKnownErrors(err, res)) throw err;
  }
}

export async function addRepaymentHandler(req: Request, res: Response) {
  const { amount, receivedAt, accountId } = req.body ?? {};
  if (!isPositiveAmount(amount)) {
    res.status(400).json({ error: "Informe um valor válido." });
    return;
  }
  if (!isIsoDate(receivedAt)) {
    res.status(400).json({ error: "Data inválida." });
    return;
  }
  try {
    const loan = await addRepayment(req.user!.id, String(req.params.id), {
      amount,
      receivedAt,
      accountId: typeof accountId === "string" && accountId ? accountId : null,
    });
    res.status(201).json(loan);
  } catch (err) {
    if (!handleKnownErrors(err, res)) throw err;
  }
}

export async function removeRepaymentHandler(req: Request, res: Response) {
  try {
    res.json(await removeRepayment(req.user!.id, String(req.params.id), String(req.params.repaymentId)));
  } catch (err) {
    if (!handleKnownErrors(err, res)) throw err;
  }
}

export async function updateLoanHandler(req: Request, res: Response) {
  const { personName, dueDate, note, status } = req.body ?? {};
  if (personName !== undefined && !optionalText(personName, 80)) {
    res.status(400).json({ error: "Pra quem você emprestou?" });
    return;
  }
  if (dueDate !== undefined && dueDate !== null && !isIsoDate(dueDate)) {
    res.status(400).json({ error: "Prazo inválido." });
    return;
  }
  if (status !== undefined && status !== "open" && status !== "forgiven") {
    res.status(400).json({ error: "Status inválido." });
    return;
  }
  try {
    const loan = await updateLoanForUser(req.user!.id, String(req.params.id), {
      ...(personName !== undefined ? { personName: optionalText(personName, 80)! } : {}),
      ...(dueDate !== undefined ? { dueDate } : {}),
      ...(note !== undefined ? { note: optionalText(note, 300) } : {}),
      ...(status !== undefined ? { status } : {}),
    });
    res.json(loan);
  } catch (err) {
    if (!handleKnownErrors(err, res)) throw err;
  }
}

export async function deleteLoanHandler(req: Request, res: Response) {
  try {
    await removeLoan(req.user!.id, String(req.params.id));
    res.status(204).end();
  } catch (err) {
    if (!handleKnownErrors(err, res)) throw err;
  }
}
