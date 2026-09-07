export const SITE_FEE_LOVELACE = 5_000_000n;
export const MAX_VALIDITY_WINDOW_MS = 15 * 60 * 1000;
export const VALIDITY_START_BUFFER_MS = 30 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

export type VaultStatus =
  | "active"
  | "due"
  | "missed"
  | "claimable";

export function releaseAt(
  lastCheckInAt: number,
  periodMs: number,
  missesToRelease: number,
) {
  return lastCheckInAt + periodMs * missesToRelease;
}

export function missedCount(
  now: number,
  lastCheckInAt: number,
  periodMs: number,
  missesToRelease: number,
) {
  if (now < lastCheckInAt + periodMs) return 0;
  return Math.min(
    missesToRelease,
    Math.floor((now - lastCheckInAt) / periodMs),
  );
}

export function vaultStatus(
  now: number,
  lastCheckInAt: number,
  periodMs: number,
  missesToRelease: number,
): VaultStatus {
  const missed = missedCount(
    now,
    lastCheckInAt,
    periodMs,
    missesToRelease,
  );
  if (missed >= missesToRelease) return "claimable";
  if (missed > 0) return "missed";
  const dueAt = lastCheckInAt + periodMs;
  if (now >= dueAt - Math.min(periodMs / 4, DAY_MS)) return "due";
  return "active";
}

export function formatAda(lovelace: bigint) {
  return `${(Number(lovelace) / 1_000_000).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  })} ADA`;
}

export function shortHash(value: string, edge = 8) {
  if (value.length <= edge * 2 + 1) return value;
  return `${value.slice(0, edge)}…${value.slice(-edge)}`;
}

export function formatUtc(timestamp: number) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(timestamp) + " UTC";
}
