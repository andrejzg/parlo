/**
 * How a round's deadline reads on screen. `closesAt` is the ISO date the
 * backend set when the round went out (`rounds.closes_at`); null means the
 * round stays open. Pure, so the home list, the welcome screen and the agent
 * panel all say the same thing.
 */
export function describeDeadline(closesAt: string | null | undefined, now: number = Date.now()): string | null {
  if (!closesAt) return null;
  const at = new Date(closesAt).getTime();
  if (!Number.isFinite(at)) return null;
  const diff = at - now;
  if (diff <= 0) return "Closed";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `Closes in ${mins} min`;
  const hours = Math.round(diff / 3_600_000);
  if (hours < 24) return `Closes in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(diff / 86_400_000);
  if (days < 7) return `Closes in ${days} ${days === 1 ? "day" : "days"}`;
  return `Closes ${new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}
