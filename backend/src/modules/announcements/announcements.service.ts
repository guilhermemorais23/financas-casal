import { findMembersByGroupId } from "../groups/groups.repository";
import { findUserById } from "../users/users.repository";
import {
  findAnnouncement,
  findSeenIds,
  findUserCreatedAt,
  insertAnnouncement,
  listActiveAnnouncements,
  listAnnouncements,
  markSeen,
  setAnnouncementActive,
  type Announcement,
  type AnnouncementAudience,
} from "./announcements.repository";

// Ícones que o app sabe desenhar no pop-up (mesmos nomes do components/Icon).
export const ANNOUNCEMENT_ICONS = ["spark", "info", "alert", "heart", "chat", "wrench", "home", "coin", "chart", "target", "card", "cart"];

const AUDIENCES: AnnouncementAudience[] = ["all", "couples", "solo", "new", "user"];
const NEW_ACCOUNT_DAYS = 14;

export class AnnouncementNotFoundError extends Error {}
export class InvalidAnnouncementError extends Error {}

export interface AnnouncementInput {
  icon?: unknown;
  tag?: unknown;
  title?: unknown;
  text?: unknown;
  bullets?: unknown;
  ctaLabel?: unknown;
  ctaPath?: unknown;
  audience?: unknown;
  targetUserId?: unknown;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// Confere e limpa o que veio do formulário do admin. Erros em português,
// prontos pra mostrar na tela.
async function validate(input: AnnouncementInput, createdBy: string) {
  const title = text(input.title, 80);
  const body = text(input.text, 600);
  if (title.length < 2) throw new InvalidAnnouncementError("Escreva um título.");
  if (body.length < 2) throw new InvalidAnnouncementError("Escreva o texto do pop-up.");

  const bullets = Array.isArray(input.bullets)
    ? input.bullets.map((b) => text(b, 80)).filter(Boolean).slice(0, 4)
    : [];

  const ctaLabel = text(input.ctaLabel, 30) || null;
  const ctaPath = text(input.ctaPath, 100) || null;
  // Só telas do próprio app ("/goals", "/cards"...): um pop-up nunca manda
  // ninguém pra fora.
  if (ctaPath && (!ctaPath.startsWith("/") || ctaPath.startsWith("//"))) {
    throw new InvalidAnnouncementError("O link do botão tem que ser uma tela do app, começando com /.");
  }
  if (ctaPath && !ctaLabel) throw new InvalidAnnouncementError("Dê um nome pro botão.");

  const audience: AnnouncementAudience = AUDIENCES.includes(input.audience as AnnouncementAudience)
    ? (input.audience as AnnouncementAudience)
    : "all";
  let targetUserId: string | null = null;
  let targetName: string | null = null;
  if (audience === "user") {
    const target = typeof input.targetUserId === "string" ? await findUserById(input.targetUserId) : null;
    if (!target) throw new InvalidAnnouncementError("Escolha pra quem vai o pop-up.");
    targetUserId = target.id;
    targetName = target.displayName || target.email;
  }

  const icon = typeof input.icon === "string" && ANNOUNCEMENT_ICONS.includes(input.icon) ? input.icon : "spark";

  return {
    icon,
    tag: text(input.tag, 24) || "Novidade",
    title,
    text: body,
    bullets,
    ctaLabel: ctaPath ? ctaLabel : null,
    ctaPath,
    audience,
    targetUserId,
    targetName,
    createdBy,
  };
}

export async function createAnnouncement(input: AnnouncementInput, createdBy: string): Promise<Announcement> {
  return insertAnnouncement(await validate(input, createdBy));
}

export async function listAnnouncementsForAdmin(): Promise<Announcement[]> {
  return listAnnouncements();
}

export async function setActive(id: string, active: boolean): Promise<Announcement> {
  const existing = await findAnnouncement(id);
  if (!existing) throw new AnnouncementNotFoundError();
  await setAnnouncementActive(id, active);
  return { ...existing, active };
}

// O que ainda falta essa pessoa ver, do mais antigo pro mais novo. Um
// comunicado "pra todos" feito antes da conta existir não aparece -- quem
// acabou de chegar já vê a apresentação de boas-vindas.
export async function listPendingFor(userId: string): Promise<Announcement[]> {
  const [active, userCreatedAt] = await Promise.all([listActiveAnnouncements(), findUserCreatedAt(userId)]);
  // Casal ou sozinho: só busca o grupo se tiver algum pop-up com esse público.
  let isCouple: boolean | null = null;
  if (active.some((a) => a.audience === "couples" || a.audience === "solo")) {
    // Casal = está em algum grupo com mais alguém (a pessoa pode ter vários).
    const user = await findUserById(userId);
    const groupIds = user?.groupIds.length ? user.groupIds : user?.groupId ? [user.groupId] : [];
    const sizes = await Promise.all(groupIds.map(async (id) => (await findMembersByGroupId(id)).length));
    isCouple = sizes.some((size) => size > 1);
  }
  const hadAccount = (a: Announcement) => userCreatedAt === null || a.createdAt >= userCreatedAt;
  const mine = active.filter((a) => {
    switch (a.audience) {
      case "user":
        return a.targetUserId === userId;
      case "couples":
        return isCouple === true && hadAccount(a);
      case "solo":
        return isCouple === false && hadAccount(a);
      case "new":
        return userCreatedAt !== null && userCreatedAt >= a.createdAt - NEW_ACCOUNT_DAYS * 24 * 60 * 60 * 1000;
      default:
        return hadAccount(a);
    }
  });
  const seen = await findSeenIds(
    mine.map((a) => a.id),
    userId
  );
  return mine.filter((a) => !seen.has(a.id)).sort((a, b) => a.createdAt - b.createdAt);
}

export async function markAnnouncementSeen(id: string, userId: string, clicked = false): Promise<void> {
  const existing = await findAnnouncement(id);
  if (!existing) throw new AnnouncementNotFoundError();
  await markSeen(id, userId, clicked);
}
