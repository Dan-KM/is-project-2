import { z } from "zod";
import { encodeMessage } from "@/lib/i18n";

// Shared Zod building blocks. Error messages are i18n keys (lib/i18n/en.ts),
// translated where they are displayed, so the same schema works on client and
// server. Inputs often arrive from FormData as strings, so the number helpers
// treat "" as "not provided" (never as 0: a fake zero would look like a real
// reading to the model).

const blankToUndefined = (value: unknown) =>
  value === "" || value === null || value === undefined ? undefined : value;

export const id = z.uuid({ error: "validation.id" });

export function requiredText(max: number) {
  return z
    .string({ error: "validation.required" })
    .trim()
    .min(1, { error: "validation.required" })
    .max(max, { error: encodeMessage("validation.tooLong", { max }) });
}

export function optionalText(max: number) {
  return z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(max, { error: encodeMessage("validation.tooLong", { max }) }).optional(),
  );
}

type NumberOptions = { min?: number; max?: number; int?: boolean; positive?: boolean };

function numberSchema({ min, max, int, positive }: NumberOptions) {
  let schema = z.number({ error: "validation.number" }).refine(Number.isFinite, { error: "validation.number" });
  if (int) schema = schema.refine(Number.isInteger, { error: "validation.integer" });
  if (positive) schema = schema.refine((n) => n > 0, { error: "validation.positive" });
  if (min !== undefined && max !== undefined) {
    schema = schema.refine((n) => n >= min && n <= max, { error: encodeMessage("validation.range", { min, max }) });
  } else if (min !== undefined) {
    schema = schema.refine((n) => n >= min, {
      error: min === 0 ? "validation.nonNegative" : encodeMessage("validation.range", { min, max: "∞" }),
    });
  } else if (max !== undefined) {
    schema = schema.refine((n) => n <= max, { error: encodeMessage("validation.max", { max }) });
  }
  return schema;
}

const toNumber = (value: unknown) => {
  const v = blankToUndefined(value);
  return typeof v === "string" ? Number(v) : v;
};

/** A required number; accepts "12.5" from forms. */
export function requiredNumber(options: NumberOptions = {}) {
  return z.preprocess(toNumber, numberSchema(options));
}

/** An optional number; "" or missing → undefined (omitted), never 0. */
export function optionalNumber(options: NumberOptions = {}) {
  return z.preprocess(toNumber, numberSchema(options).optional());
}

/** A moment in time; accepts ISO strings and datetime-local values, returns ISO. */
export const dateTime = z.preprocess(
  blankToUndefined,
  z
    .string({ error: "validation.date" })
    .refine((s) => !Number.isNaN(new Date(s).getTime()), { error: "validation.date" })
    .transform((s) => new Date(s).toISOString()),
);

export const optionalDateTime = z.preprocess(blankToUndefined, dateTime.optional());

/** A calendar date "YYYY-MM-DD" (DATE columns such as planting_date). */
export const dateOnly = z
  .string({ error: "validation.date" })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "validation.date" })
  .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()), { error: "validation.date" });

/** One of a fixed list of labels (dropdowns). */
export function oneOf<const T extends readonly [string, ...string[]]>(values: T) {
  return z.enum(values, { error: "validation.option" });
}

/** Checkbox / "true" / "on" from forms → boolean. */
export const booleanish = z.preprocess(
  (v) => v === true || v === "true" || v === "on" || v === "1",
  z.boolean(),
);
