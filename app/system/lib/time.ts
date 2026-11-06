// The database runs in UTC (decided in Phase 0), so everything that depends on
// the farmer's calendar day or hour is computed here in Nairobi time.

export const FARM_TIME_ZONE = "Africa/Nairobi";

/**
 * Postgres returns timestamptz as text like "2026-11-06 00:35:05.31+00".
 * JS Date can't reliably parse a "+00" offset, so normalise it to ISO first.
 */
export function parseDbTimestamp(value: string): Date {
  const iso = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  return new Date(iso);
}

/** Calendar parts of a moment in the farm's time zone. */
function localParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: FARM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") };
}

/** "YYYY-MM-DD" of a moment in Nairobi time (e.g. for date inputs and DATE columns). */
export function localDateString(date: Date = new Date()): string {
  const { year, month, day } = localParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Day number since the epoch for a local calendar date; differences of these are whole days.
function localDayNumber(date: Date): number {
  const { year, month, day } = localParts(date);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** Model feature Day_of_Year (1–366) in Nairobi time. */
export function dayOfYear(date: Date = new Date()): number {
  const { year } = localParts(date);
  return localDayNumber(date) - Math.floor(Date.UTC(year, 0, 1) / 86_400_000) + 1;
}

/** Model feature Time_of_Day (hour 0–23) in Nairobi time. */
export function hourOfDay(date: Date = new Date()): number {
  return localParts(date).hour;
}

/** Whole calendar days between two moments, counted in Nairobi time (never negative). */
export function calendarDaysBetween(earlier: Date, later: Date = new Date()): number {
  return Math.max(0, localDayNumber(later) - localDayNumber(earlier));
}

// Kenya has no daylight saving, so Nairobi is always UTC+3. Form date-time
// inputs are read as Nairobi time on every device, whatever the phone's zone.
const NAIROBI_OFFSET = "+03:00";

/** "2026-11-06T09:30" from a datetime-local input (Nairobi) → ISO UTC string. */
export function nairobiLocalToIso(local: string): string {
  return new Date(`${local.length === 16 ? `${local}:00` : local}${NAIROBI_OFFSET}`).toISOString();
}

/** A moment → "YYYY-MM-DDTHH:mm" in Nairobi, for a datetime-local input's value. */
export function toNairobiLocalInput(date: Date): string {
  const shifted = new Date(date.getTime() + 3 * 3_600_000);
  return shifted.toISOString().slice(0, 16);
}

/** Days since planting for a DATE column value ("YYYY-MM-DD"). */
export function daysSinceDate(dateOnly: string, now: Date = new Date()): number {
  const [y, m, d] = dateOnly.split("-").map(Number);
  return Math.max(0, localDayNumber(now) - Math.floor(Date.UTC(y, m - 1, d) / 86_400_000));
}
