// Calendar-date helpers. Dates are 'YYYY-MM-DD' strings and months are
// 'YYYY-MM' strings; all arithmetic is done in UTC so results never depend
// on the server's time zone.

const DAY_MS = 86_400_000;

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function toISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isISODate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(toDate(value).getTime());
}

export function isMonthKey(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function addDays(iso: string, days: number): string {
  return toISO(new Date(toDate(iso).getTime() + days * DAY_MS));
}

export function daysBetween(fromISO: string, toISODate: string): number {
  return Math.round((toDate(toISODate).getTime() - toDate(fromISO).getTime()) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(iso: string): number {
  return toDate(iso).getUTCDay();
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function addMonths(month: string, count: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + count, 1));
  return toISO(date).slice(0, 7);
}

export function monthRange(month: string): { from: string; to: string } {
  const from = `${month}-01`;
  const to = addDays(`${addMonths(month, 1)}-01`, -1);
  return { from, to };
}

export type WeekStart = "sunday" | "monday";

/** The seven-day week containing the given date, starting on the given weekday. */
export function weekRange(iso: string, startsOn: WeekStart): { from: string; to: string } {
  const startDay = startsOn === "sunday" ? 0 : 1;
  const daysSinceStart = (dayOfWeek(iso) - startDay + 7) % 7;
  const from = addDays(iso, -daysSinceStart);
  return { from, to: addDays(from, 6) };
}

/** Today's calendar date in the given IANA time zone. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function formatMonth(month: string): string {
  return toDate(`${month}-01`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatShortMonth(month: string): string {
  return toDate(`${month}-01`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
}

export function formatDay(iso: string): string {
  return toDate(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatDayWithYear(iso: string): string {
  return toDate(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
