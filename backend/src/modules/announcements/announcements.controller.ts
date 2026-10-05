import type { Request, Response } from "express";
import { listPeople } from "./announcements.repository";
import {
  AnnouncementNotFoundError,
  InvalidAnnouncementError,
  createAnnouncement,
  listAnnouncementsForAdmin,
  listPendingFor,
  markAnnouncementSeen,
  setActive,
} from "./announcements.service";
import { ensureAdmin } from "../admin/adminGuard";

function notFound(err: unknown, res: Response): boolean {
  if (err instanceof AnnouncementNotFoundError) {
    res.status(404).json({ error: "Pop-up não encontrado." });
    return true;
  }
  return false;
}

// Lado de quem usa o app: o que falta ver e "já vi".
export async function listPendingHandler(req: Request, res: Response) {
  res.json({ announcements: await listPendingFor(req.user!.id) });
}

export async function markSeenHandler(req: Request, res: Response) {
  try {
    await markAnnouncementSeen(String(req.params.id), req.user!.id, req.body?.clicked === true);
    res.status(204).end();
  } catch (err) {
    if (!notFound(err, res)) throw err;
  }
}

// Lado do admin (conferido contra ADMIN_EMAILS).
export async function listForAdminHandler(req: Request, res: Response) {
  if (!ensureAdmin(req, res)) return;
  res.json({ announcements: await listAnnouncementsForAdmin() });
}

export async function listPeopleHandler(req: Request, res: Response) {
  if (!ensureAdmin(req, res)) return;
  res.json({ people: await listPeople() });
}

export async function createHandler(req: Request, res: Response) {
  if (!ensureAdmin(req, res)) return;
  try {
    res.status(201).json(await createAnnouncement(req.body ?? {}, req.user!.email));
  } catch (err) {
    if (err instanceof InvalidAnnouncementError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
}

export async function setActiveHandler(req: Request, res: Response) {
  if (!ensureAdmin(req, res)) return;
  try {
    res.json(await setActive(String(req.params.id), req.body?.active === true));
  } catch (err) {
    if (!notFound(err, res)) throw err;
  }
}
