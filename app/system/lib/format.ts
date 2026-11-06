import { FARM_TIME_ZONE, parseDbTimestamp } from "./time";

// Display formatting. Numbers come from the DB as strings ("500.00"); show them
// without trailing zeros and with thousands separators. Dates in Nairobi time.

const numberFormat = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 2 });

export function formatNumber(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? numberFormat.format(n) : "—";
}

export function formatLitres(value: string | number | null | undefined): string {
  const formatted = formatNumber(value);
  return formatted === "—" ? formatted : `${formatted} L`;
}

/** "+500 L" / "−200 L" for budget and ledger changes. */
export function formatSignedLitres(value: string | number | null | undefined): string {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${numberFormat.format(Math.abs(n))} L`;
}

/** Raw form value for an input's defaultValue: "500.00" → "500", null → "". */
export function inputNumber(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : "";
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : value.includes(" ") ? parseDbTimestamp(value) : new Date(value);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: FARM_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(toDate(value));
}

/** "05:15" when the moment is today (Nairobi), otherwise the full date and time. Keeps badges short. */
export function formatTimeOrDate(value: string | Date | null | undefined, now: Date = new Date()): string {
  if (!value) return "—";
  const date = toDate(value);
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: FARM_TIME_ZONE }).format(d);
  if (day(date) !== day(now)) return formatDateTime(date);
  return new Intl.DateTimeFormat("en-KE", { timeZone: FARM_TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(date);
}

/** DATE columns ("2026-09-15") are calendar dates: format without shifting zones. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-KE", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(
    new Date(`${value.slice(0, 10)}T00:00:00Z`),
  );
}
