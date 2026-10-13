/** Shared time helpers. All timestamps in the API/DB are ISO-8601 UTC strings. */
export function toIso(date: Date): string {
  return date.toISOString();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseIso(value: string): Date {
  return new Date(value);
}

/** Seconds between `iso` and `from`, floored at 0. Used for countdown badges. */
export function secondsUntil(iso: string, from: Date = new Date()): number {
  return Math.max(0, Math.floor((parseIso(iso).getTime() - from.getTime()) / 1000));
}

export function isPast(iso: string, from: Date = new Date()): boolean {
  return parseIso(iso).getTime() <= from.getTime();
}

/** 'YYYY-MM' bucket key for monthly aggregates. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** Inclusive list of the last `count` month keys, oldest first. */
export function recentMonthKeys(count: number, from: Date = new Date()): string[] {
  const keys: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - i, 1));
    keys.push(d.toISOString().slice(0, 7));
  }
  return keys;
}

/** Add hours to a date, returning an ISO string. */
export function isoHoursFrom(date: Date, hours: number): string {
  return new Date(date.getTime() + hours * 3600 * 1000).toISOString();
}
