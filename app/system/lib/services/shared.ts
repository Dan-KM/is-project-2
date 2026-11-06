// Helpers shared by the services.

// Prisma 8 types VARCHAR(n) and NUMERIC(p,s) inputs as "branded" strings
// (string & { __varcharLength: n }) so a value is tied to its column size.
// Zod has already checked length and range before a service runs, so these
// helpers mark a checked value as acceptable for any VARCHAR / NUMERIC column.
// (A property typed `never` is assignable to every brand value.)
export type DbText = string & { readonly __varcharLength: never };
export type DbNumeric = string & { readonly __numericPrecision: never; readonly __numericScale: never };

/** Mark validated text as a VARCHAR value. */
export function dbText(value: string): DbText;
export function dbText(value: string | null | undefined): DbText | null;
export function dbText(value: string | null | undefined): DbText | null {
  return value === null || value === undefined ? null : (value as DbText);
}

/**
 * Prisma 8 maps NUMERIC columns to strings (no float rounding).
 * Services accept plain JS numbers and convert at the DB boundary.
 */
export function toDbNumber(value: number): DbNumeric;
export function toDbNumber(value: number | null | undefined): DbNumeric | null;
export function toDbNumber(value: number | null | undefined): DbNumeric | null {
  return value === null || value === undefined ? null : (String(value) as DbNumeric);
}

/** NUMERIC/INT from the DB → JS number (null stays null). */
export function fromDbNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
