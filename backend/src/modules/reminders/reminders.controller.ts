import type { Request, Response } from "express";
import { env } from "../../config/env";
import { generateDueRecurringBills } from "../recurringBills/recurringBills.service";
import { runDueReminders } from "./reminders.service";

// Não é uma rota com login do Firebase -- um cron externo diário
// (cron-job.org, o mesmo que já faz o ping de /api/health) chama isto sem
// ninguém logado, então a proteção é um cabeçalho com segredo compartilhado.
// CRON_SECRET vazio = a rota fica inacessível, o mesmo "desligado por padrão"
// de quando faltam as credenciais do SMTP do Gmail (ver email/mailer.ts).
//
// As contas fixas pegam carona nessa mesma chamada diária (em vez de um
// segundo cron no cron-job.org) -- as duas são trabalho de fundo "uma vez por
// dia, sem usuário", e esta é a chamada externa que já existe e já está
// configurada em produção.
export async function runRemindersHandler(req: Request, res: Response) {
  if (!env.cronSecret || req.header("x-cron-secret") !== env.cronSecret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const [reminders, recurringBills] = await Promise.all([runDueReminders(), generateDueRecurringBills()]);
  res.status(200).json({ reminders, recurringBills });
}
