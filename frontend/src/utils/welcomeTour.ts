// "Show the welcome tour to this account" flag. Per user id, so a second
// person signing in on the same phone gets their own tour. localStorage can
// throw (private mode, blocked storage) -- a missed tour is harmless, so
// every access just swallows that.
const key = (userId: string) => `par:welcome-tour:${userId}`;

export function markWelcomeTourPending(userId: string): void {
  try {
    localStorage.setItem(key(userId), "pending");
  } catch {
    // ignore
  }
}

export function isWelcomeTourPending(userId: string): boolean {
  try {
    return localStorage.getItem(key(userId)) === "pending";
  } catch {
    return false;
  }
}

export function markWelcomeTourDone(userId: string): void {
  try {
    localStorage.setItem(key(userId), "done");
  } catch {
    // ignore
  }
}
