// Which edition of the welcome / "o que tem de novo" tour this account has
// already seen. Everyone -- new and existing accounts -- sees each edition
// once; bump TOUR_EDITION when the tour gets new content worth showing again.
// Per user id, so a second person signing in on the same phone gets their own.
// localStorage can throw (private mode, blocked storage) -- a missed tour is
// harmless, so every access just swallows that.
export const TOUR_EDITION = "2026-09-a-receber";

const key = (userId: string) => `par:welcome-tour:${userId}`;

export function isWelcomeTourPending(userId: string): boolean {
  try {
    return localStorage.getItem(key(userId)) !== TOUR_EDITION;
  } catch {
    return false;
  }
}

export function markWelcomeTourDone(userId: string): void {
  try {
    localStorage.setItem(key(userId), TOUR_EDITION);
  } catch {
    // ignore
  }
}
